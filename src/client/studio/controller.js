/**
 * 界面背后的操作：换主题、微调、撤销、预览。
 *
 * 所有改动都走 `commit`：算出新变量，交给设置中枢落盘和同步。悬停预览和滑块拖动中
 * 只改宿主的变量层，不写存档也不进撤销历史，松手或点击才算数。
 */
import { CUSTOM_THEME, audit, auditSeed, colorWall, completeSeed, DEFAULT_GLASS, effectiveCss, gradientWall, imageWall, PACK_PREFIX, packOf, randomSeed, resolveLayer, seedFromWall, seedOf } from '../../engine/index.js'

const PREVIEW_DELAY_MS = 70

/** 切换主题时保留的微调：这两项是个人偏好，不属于某个主题。其余修改（变量覆盖、CSS、圆角）换主题时清掉。 */
const KEEP_ON_SWITCH = ['contrast', 'depth']

const keptAdjust = (adjust) => {
  /** @type {Partial<import('../../shared/state.js').Seed>} */
  const kept = {}
  for (const key of KEEP_ON_SWITCH) if (adjust[key] !== undefined) kept[key] = adjust[key]
  return kept
}

/**
 * @param {any} host 入口传来的宿主能力
 * @returns {ReturnType<typeof build>} 操作集合
 */
export function createController(host) {
  return build(host)
}

function build(host) {
  const { core } = host
  const { checkCss, effectiveTokens, layerChange, undoChange, normalizeName, LIBRARY_LIMIT } = host.shared
  let previewTimer
  let bare = false

  /**
   * 提交一次改动，同时记入撤销历史。
   * @param {object} next 要改的层
   * @param {object} [explicitWall] 已经分析好的壁纸
   * @param {{library?: import('../../shared/state.js').ThemePack[]}} [extra] 一起写、但不进撤销历史的键（「我的主题」）
   */
  const commit = (next, explicitWall, extra) => {
    const values = core.values()
    const change = layerChange(values, next)
    if (extra !== undefined) Object.assign(change, extra)
    if (Object.keys(change).length === 0) return
    finish(values, change, explicitWall)
  }

  /** 改动之后的壁纸是什么。图片的分析结果在 host 上，本地没有时先出不透明主题，写完再问 host。 */
  const wallAfter = (values, change, explicit) => {
    if (explicit !== undefined) return explicit
    const current = core.layer().wall
    if (!('wallpaper' in change) || JSON.stringify(change.wallpaper) === JSON.stringify(values.wallpaper)) return current
    const spec = change.wallpaper
    if (spec?.kind === 'gradient') return { key: `g${spec.angle}${spec.stops.join('')}`, ...gradientWall(spec) }
    if (spec?.kind === 'color') return { key: `c${spec.color}`, ...colorWall(spec.color) }
    return null
  }

  const finish = (values, change, explicit) => {
    const wall = wallAfter(values, change, explicit)
    core.commit(change, resolveLayer({ ...values, ...change }, wall))
    if ((change.wallpaper ?? null) !== null && wall === null) {
      void core.flush().then(() => core.refresh())
    }
  }

  /** 这一层实际显示出来的变量（系统开了减少透明度时不带玻璃）。 */
  const visible = (next) => effectiveTokens(resolveLayer(next, core.layer().wall), host.reduced())

  /** 不写存档，只让宿主显示这批变量。 */
  const show = (tokens) => {
    if (tokens === null) {
      // 预览「宿主默认」：临时撤掉主层
      bare = true
      host.preview(null)
      host.setMainLayer(null)
      return
    }
    if (bare) {
      bare = false
      host.setMainLayer(effectiveTokens(core.layer(), host.reduced()))
    }
    host.preview(tokens)
  }

  const clearPreview = () => {
    if (previewTimer !== undefined) {
      clearTimeout(previewTimer)
      previewTimer = undefined
    }
    host.preview(null)
    if (bare) {
      bare = false
      host.setMainLayer(effectiveTokens(core.layer(), host.reduced()))
    }
  }

  /** 选「宿主默认」时彻底让位：连我的调整也清掉，只剩高级覆盖（如果有的话）。 */
  const layersForTheme = (id, custom = null) => {
    const values = core.values()
    return { theme: id, custom, adjust: id === null ? {} : keptAdjust(values.adjust), overrides: {}, css: '', radius: null }
  }

  /**
   * 把一套主题存进「我的主题」：同名的覆盖原来那个（id 不变），否则新加一个。
   * @param {import('../../shared/state.js').Values} values 当前值
   * @param {Omit<import('../../shared/state.js').ThemePack, 'id'>} pack 主题
   * @returns {{id: string, library: import('../../shared/state.js').ThemePack[]} | null} 新的列表；满了时 null
   */
  const storePack = (values, pack) => {
    const same = values.library.find((item) => item.name === pack.name)
    if (same === undefined && values.library.length >= LIBRARY_LIMIT) return null
    const id = same?.id ?? Math.random().toString(36).slice(2, 10).padEnd(6, '0')
    const item = { ...pack, id }
    return { id, library: same === undefined ? [...values.library, item] : values.library.map((old) => (old.id === id ? item : old)) }
  }

  /**
   * 当前实际看到的这套（主题 + 用户修改合在一起）。
   * @param {import('../../shared/state.js').Values} values 当前值
   * @returns {import('../../shared/share.js').ThemeFile} 主题文件内容（不含名字）
   */
  const currentFile = (values) => {
    const pack = packOf(values)
    const radius = values.radius ?? pack?.radius ?? null
    const seed = seedOf(values)
    return {
      // 宿主默认上没有种子：存成空种子（沿用宿主配色），导出时再补成完整种子
      seed: seed === undefined ? {} : completeSeed(seed),
      ...(radius === null ? {} : { radius }),
      overrides: { ...pack?.overrides, ...values.overrides },
      css: effectiveCss(values),
      ...(pack?.scheme === undefined ? {} : { scheme: pack.scheme }),
    }
  }

  /** 选中「我的主题」里要求明暗的那个时，宿主跟着切。 */
  const followScheme = (scheme) => {
    if (scheme !== undefined && scheme !== host.scheme()) host.setScheme(scheme)
  }

  /** 审计结果按变量对象缓存：设置页每次重绘都要显示，变量没变就不重算。 */
  let audited
  let auditedFor

  return {
    /** @param {string | null} id 主题 id；null 回到宿主默认 */
    pickTheme(id) {
      commit(layersForTheme(id))
      clearPreview()
      followScheme(packOf(core.values())?.scheme)
    },

    randomize() {
      commit(layersForTheme(CUSTOM_THEME, randomSeed()))
      clearPreview()
    },

    /**
     * 换壁纸。
     * @param {import('../../shared/state.js').Wallpaper | null} wallpaper 壁纸
     * @param {object} [wall] 已经分析好的引擎视图（不传时渐变和纯色现算，图片问 host）
     */
    setWallpaper(wallpaper, wall) {
      commit({ wallpaper }, wall)
      clearPreview()
    },

    /**
     * 换成一张已经分析好的图片：不用等 host，立刻显示。
     * @param {import('../../shared/state.js').Wallpaper} wallpaper 壁纸
     * @param {{base: string, samples: string[]}} derived 分析结果
     */
    setWallpaperImage(wallpaper, derived) {
      commit({ wallpaper }, { key: wallpaper.id, ...imageWall(`/prism-skin/api/wallpaper/blur/${wallpaper.id}.jpg`, derived) })
      clearPreview()
    },

    /**
     * 省电模式。
     * @param {'auto' | 'on' | 'off'} power 跟随系统 / 开 / 关
     */
    setPower(power) {
      commit({ power })
      clearPreview()
    },

    /** 拖动玻璃感：立刻看到效果，但不写存档。 */
    liveGlass(glass) {
      show(visible({ ...core.values(), glass }))
    },

    /** 松手：写存档，记一步撤销。 */
    commitGlass(glass) {
      commit({ glass })
      clearPreview()
    },

    /**
     * 从壁纸取色：生成一套种子。
     * @param {{base: string, palette: object[]}} derived 分析结果
     */
    useWallColors(derived) {
      commit(layersForTheme(CUSTOM_THEME, seedFromWall(derived)))
      clearPreview()
    },

    undo() {
      const values = core.values()
      const change = undoChange(values)
      if (change === undefined) return
      finish(values, change)
      clearPreview()
    },

    /** 丢掉自己的修改（微调、变量覆盖、CSS、圆角），回到当前主题原样。可撤销。 */
    discardChanges() {
      commit({ adjust: {}, overrides: {}, css: '', radius: null })
      clearPreview()
    },

    /** 恢复默认：主题、修改、背景全部清掉，回到宿主原样。可撤销；「我的主题」留着。 */
    restoreDefaults() {
      commit({ theme: null, custom: null, adjust: {}, overrides: {}, css: '', radius: null, wallpaper: null, glass: null })
      clearPreview()
    },

    /**
     * 把当前看到的这套存成「我的主题」并选中它（看起来不变，修改并进主题里）。
     * @param {string} name 名字；和已有的同名时覆盖那个
     * @returns {true | 'name' | 'css' | 'full'} 成功，或失败原因：名字为空 / CSS 合起来超长 / 存满了
     */
    saveAsMine(name) {
      const values = core.values()
      const clean = normalizeName(name)
      if (clean === '') return 'name'
      const file = currentFile(values)
      if (!checkCss(file.css).ok) return 'css'
      const { css, overrides, ...rest } = file
      const stored = storePack(values, { name: clean, ...rest, ...(Object.keys(overrides).length > 0 ? { overrides } : {}), ...(css === '' ? {} : { css }) })
      if (stored === null) return 'full'
      commit({ theme: PACK_PREFIX + stored.id, custom: null, adjust: {}, overrides: {}, css: '', radius: null }, undefined, { library: stored.library })
      clearPreview()
      return true
    },

    /**
     * 删掉一个「我的主题」。正在用的话先回到宿主默认。删除本身不能撤销。
     * @param {string} id 包 id
     */
    deleteMine(id) {
      const values = core.values()
      const library = values.library.filter((pack) => pack.id !== id)
      if (library.length === values.library.length) return
      commit(values.theme === PACK_PREFIX + id ? layersForTheme(null) : {}, undefined, { library })
      clearPreview()
    },

    /** @param {string | null} id 代码配色方案；null 跟随主题 */
    setCode(id) {
      const values = core.values()
      const adjust = { ...values.adjust }
      if (id === null) delete adjust.code
      else adjust.code = id
      commit({ adjust })
      clearPreview()
    },

    /** 悬停预览代码配色。 */
    hoverCode(id) {
      const values = core.values()
      const adjust = { ...values.adjust }
      if (id === null) delete adjust.code
      else adjust.code = id
      show(visible({ ...values, adjust }))
    },

    /** 拖动圆角：只预览。 */
    liveRadius(radius) {
      show(visible({ ...core.values(), radius }))
    },

    /** @param {number | null} radius 圆角倍数；null 用宿主的圆角 */
    commitRadius(radius) {
      commit({ radius })
      clearPreview()
    },

    /**
     * 改一个变量（高级覆盖）。
     * @param {string} name 变量名
     * @param {{light: string, dark: string} | null} value 值；null 去掉这一项
     */
    setOverride(name, value) {
      const overrides = { ...core.values().overrides }
      if (value === null) delete overrides[name]
      else overrides[name] = value
      commit({ overrides })
      clearPreview()
    },

    /**
     * 保存自定义 CSS。
     * @param {string} css 内容
     * @returns {ReturnType<typeof checkCss>} 检查结果；不通过时不保存
     */
    setCss(css) {
      const checked = checkCss(css)
      if (checked.ok) commit({ css: checked.css })
      return checked
    },

    /**
     * 导入一份主题：整份写进去，记一步撤销。写完发现不对（生成失败）就撤回，不留半截状态。
     * @param {import('../../shared/share.js').ThemeFile} file 已经校验过的内容
     * 整套存进「我的主题」（同名的覆盖）并选中；原来的修改清掉。可撤销（「我的主题」里的这一项会留着）。
     * @param {{wallpaper?: import('../../shared/state.js').Wallpaper | null, fallbackName?: string}} [extra] 一起写入的壁纸（迁移用）；文件没写名字时用的名字
     * @returns {boolean | 'full'} 是否成功；「我的主题」存满了时是 'full'
     */
    importTheme(file, extra = {}) {
      const values = core.values()
      const before = values.history.length
      const name = normalizeName(file.name) || normalizeName(extra.fallbackName) || 'Theme'
      const stored = storePack(values, {
        name,
        seed: file.seed,
        ...(file.radius === undefined ? {} : { radius: file.radius }),
        ...(file.overrides === undefined || Object.keys(file.overrides).length === 0 ? {} : { overrides: file.overrides }),
        ...(file.css === undefined || file.css === '' ? {} : { css: file.css }),
        ...(file.scheme === undefined ? {} : { scheme: file.scheme }),
      })
      if (stored === null) return 'full'
      // 整套换上，原来的修改清掉（可撤销）
      const next = { theme: PACK_PREFIX + stored.id, custom: null, adjust: {}, overrides: {}, css: '', radius: null }
      if ('wallpaper' in extra) next.wallpaper = extra.wallpaper
      try {
        commit(next, undefined, { library: stored.library })
        const tokens = core.layer().tokens
        if (tokens === null || tokens['--dsw-alias-bg-base'] === undefined) throw new Error('导入后没有生成变量')
      } catch (error) {
        if (core.values().history.length > before) {
          const current = core.values()
          const change = undoChange(current)
          if (change !== undefined) finish(current, { ...change, library: values.library })
        }
        console.warn('[dsh-prism-skin] 导入失败，已撤回：', error)
        return false
      }
      clearPreview()
      if (file.scheme !== undefined && file.scheme !== host.scheme()) host.setScheme(file.scheme)
      if (file.font !== undefined) {
        try {
          if (file.font.text !== undefined) host.setFont('text', 'family', file.font.text)
          if (file.font.code !== undefined) host.setFont('code', 'family', file.font.code)
          if (file.font.size !== undefined) host.setFont('text', 'size', file.font.size)
          if (file.font.codeSize !== undefined) host.setFont('code', 'size', file.font.codeSize)
        } catch (error) {
          console.warn('[dsh-prism-skin] 写入字体失败：', error)
        }
      }
      return true
    },

    /** @returns {import('../../shared/share.js').ThemeFile} 当前设置导出成主题文件的内容 */
    exportTheme() {
      const file = currentFile(core.values())
      return Object.keys(file.seed).length > 0 ? file : { ...file, seed: completeSeed(undefined) }
    },

    /** 拖动中：立刻看到效果，但不写存档。 */
    liveAdjust(field, value) {
      const values = core.values()
      show(visible({ ...values, adjust: { ...values.adjust, [field]: value } }))
    },

    /** 松手：写存档，记一步撤销。 */
    commitAdjust(field, value) {
      const values = core.values()
      commit({ adjust: { ...values.adjust, [field]: value } })
      clearPreview()
    },

    /** @param {string} field 恢复成主题给的值 */
    clearAdjust(field) {
      const values = core.values()
      const adjust = { ...values.adjust }
      delete adjust[field]
      commit({ adjust })
      clearPreview()
    },

    /** 悬停预览（延迟一点点，鼠标划过时不会闪一路）。 */
    hoverTheme(id) {
      if (previewTimer !== undefined) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => {
        previewTimer = undefined
        const values = core.values()
        show(visible({ ...values, ...layersForTheme(id, id === CUSTOM_THEME ? values.custom : null) }))
      }, PREVIEW_DELAY_MS)
    },

    clearPreview,

    toggleScheme() {
      host.setScheme(host.scheme() === 'dark' ? 'light' : 'dark')
    },

    /** @returns {import('../../shared/state.js').Seed} 当前生效的完整种子 */
    currentSeed() {
      return completeSeed(seedOf(core.values()))
    },

    /** @returns {{pairs: number, failed: number} | null} 当前变量的对比度审计；没换肤时为 null */
    auditSummary() {
      const layer = core.layer()
      const tokens = layer.tokens
      if (tokens === null || tokens['--dsw-alias-bg-base'] === undefined) return null
      if (auditedFor !== tokens) {
        const values = core.values()
        const rows = layer.wall === null ? audit(tokens) : auditSeed(seedOf(values), { level: values.glass ?? DEFAULT_GLASS, wall: layer.wall })
        audited = { pairs: rows.length, failed: rows.filter((row) => !row.pass).length }
        auditedFor = tokens
      }
      return audited
    },
  }
}
