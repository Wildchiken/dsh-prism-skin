/**
 * 界面背后的操作：换主题、微调、撤销、预览。
 *
 * 所有改动都走 `commit`：算出新变量，交给设置中枢落盘和同步。悬停预览和滑块拖动中
 * 只改宿主的变量层，不写存档也不进撤销历史，松手或点击才算数。
 */
import { CUSTOM_THEME, audit, auditSeed, colorWall, completeSeed, DEFAULT_GLASS, gradientWall, imageWall, randomSeed, resolveLayer, seedFromWall, seedOf } from '../../engine/index.js'

const PREVIEW_DELAY_MS = 70

/** 切换主题时保留的微调：这两项是个人偏好，不属于某个主题。 */
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
  const { checkCss, effectiveTokens, layerChange, undoChange } = host.shared
  let previewTimer
  let bare = false

  /** 提交一次改动，同时记入撤销历史。 */
  const commit = (next, explicitWall) => {
    const values = core.values()
    const change = layerChange(values, next)
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
    return { theme: id, custom, adjust: id === null ? {} : keptAdjust(values.adjust) }
  }

  /** 审计结果按变量对象缓存：设置页每次重绘都要显示，变量没变就不重算。 */
  let audited
  let auditedFor

  return {
    /** @param {string | null} id 主题 id；null 回到宿主默认 */
    pickTheme(id) {
      commit(layersForTheme(id))
      clearPreview()
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
      const values = core.values()
      commit({ theme: CUSTOM_THEME, custom: seedFromWall(derived), adjust: keptAdjust(values.adjust) })
      clearPreview()
    },

    undo() {
      const values = core.values()
      const change = undoChange(values)
      if (change === undefined) return
      finish(values, change)
      clearPreview()
    },

    /**
     * 重置一层：主题回到宿主默认（保留我的调整）；我的调整连圆角一起清；高级覆盖连自定义 CSS 一起清。
     * @param {'theme' | 'adjust' | 'overrides'} layer 要重置的层
     */
    resetLayer(layer) {
      if (layer === 'theme') commit({ theme: null, custom: null })
      else if (layer === 'adjust') commit({ adjust: {}, radius: null })
      else commit({ overrides: {}, css: '' })
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
     * @param {{wallpaper?: import('../../shared/state.js').Wallpaper | null}} [extra] 一起写入的壁纸（迁移用）
     * @returns {boolean} 是否成功
     */
    importTheme(file, extra = {}) {
      const values = core.values()
      const before = values.history.length
      const next = { theme: CUSTOM_THEME, custom: file.seed, adjust: {} }
      if (file.radius !== undefined) next.radius = file.radius
      if (file.overrides !== undefined) next.overrides = file.overrides
      if (file.css !== undefined) next.css = file.css
      if ('wallpaper' in extra) next.wallpaper = extra.wallpaper
      try {
        commit(next)
        const tokens = core.layer().tokens
        if (tokens === null || tokens['--dsw-alias-bg-base'] === undefined) throw new Error('导入后没有生成变量')
      } catch (error) {
        if (core.values().history.length > before) {
          const current = core.values()
          const change = undoChange(current)
          if (change !== undefined) finish(current, change)
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
      const values = core.values()
      const seed = completeSeed(seedOf(values))
      return { seed, ...(values.radius === null ? {} : { radius: values.radius }), overrides: values.overrides, css: values.css }
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
