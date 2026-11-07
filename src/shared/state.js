/**
 * 设置存档的数据模型：host 文件、浏览器缓存、多标签同步都用这一份。
 *
 * 存档按键记时间戳（后写者胜，同一时刻按写入方排序），所以两个标签页同时改
 * 不同的键不会互相覆盖。看不懂的键原样保留，新版写过的存档旧版不会弄丢。
 */

/** 存档结构版本。 */
export const SCHEMA = 1
/** 撤销历史最多留多少步。 */
export const HISTORY_LIMIT = 30
/** 高级覆盖最多多少条（防止存档被写爆）。 */
const OVERRIDES_LIMIT = 600
const VALUE_MAX_LENGTH = 400
/** 自定义 CSS 的上限（字符）。 */
export const CSS_MAX_LENGTH = 8192
/** 「我的主题」最多存多少个。 */
export const LIBRARY_LIMIT = 24
/** 主题名最长多少字。 */
export const NAME_MAX_LENGTH = 60
const PACK_ID = /^[a-z0-9]{4,16}$/

/**
 * @typedef {object} Seed 生成配色的种子。
 * @property {number} hue 色相 0–360：表面和中性色的主色相
 * @property {number} chroma 彩度 0–1.5：强调色和状态色的鲜艳程度
 * @property {number} neutral 中性色调 0–1：表面染色的强度，0 是纯灰
 * @property {number} contrast 对比度 -1–1
 * @property {number} depth 明暗 -1–1：负数表面更深，正数表面更亮
 * @property {string} accent 强调色 `#rrggbb`
 * @property {boolean} [ink] 主按钮用墨色（亮色模式接近黑、暗色模式接近白）而不是强调色
 * @property {string} [code] 代码配色方案 id；不设时跟随主题
 */

/**
 * @typedef {object} Values 用户设置的当前值。
 * @property {string | null} theme 主题 id；null 表示不换肤，沿用宿主配色
 * @property {Partial<Seed> | null} custom 主题 id 为 `custom` 时用的完整种子（比如随机出来的）
 * @property {Partial<Seed>} adjust 「我的调整」：盖在主题种子上
 * @property {Record<string, {light: string, dark: string}>} overrides 「高级覆盖」：直接盖在生成结果上
 * @property {Wallpaper | null} wallpaper 壁纸
 * @property {number | null} glass 玻璃感 0–1；null 表示用默认值
 * @property {'auto' | 'on' | 'off'} power 省电模式：跟随系统 / 开 / 关
 * @property {number | null} radius 圆角倍数 0–2（「我的调整」）；null 表示用宿主的圆角
 * @property {string} css 自定义 CSS（「高级覆盖」）；空串表示没有
 * @property {HistoryEntry[]} history 撤销历史，最新的在最后
 * @property {ThemePack[]} library 「我的主题」：导入或保存下来的整套主题。不进撤销历史
 */

/**
 * @typedef {object} ThemePack 一整套主题：选它时这些一起生效，用户自己的修改再叠在上面。
 * @property {string} id 小写字母和数字；主题 id 是 `my-<id>`
 * @property {string} name 名字
 * @property {Partial<Seed>} seed 种子
 * @property {number} [radius] 圆角倍数
 * @property {Values['overrides']} [overrides] 主题自带的变量覆盖
 * @property {string} [css] 主题自带的 CSS
 * @property {'light' | 'dark'} [scheme] 主题要求的明暗；选中时宿主跟着切
 */

/**
 * @typedef {{theme: string | null, custom: Partial<Seed> | null, adjust: Partial<Seed>, overrides: Values['overrides'], wallpaper: Wallpaper | null, glass: number | null, power: 'auto' | 'on' | 'off', radius: number | null, css: string}} HistoryEntry
 */

/**
 * @typedef {{kind: 'image', id: string, src?: string}
 *   | {kind: 'gradient', stops: string[], angle: number}
 *   | {kind: 'color', color: string}
 *   | {kind: 'rotate', items: {id: string, src?: string}[], interval: number, shuffle: boolean, epoch: number}
 *   | {kind: 'folder', path: string, interval: number, shuffle: boolean, epoch: number}} Wallpaper
 * 壁纸。id 是 host 存下的文件的内容哈希；src 只用来给用户看来源。
 */

/** @typedef {{v: unknown, t: number, by?: string}} KeyEntry 一个键的值和写入时间。 */
/** @typedef {{schema: number, rev: number, keys: Record<string, KeyEntry>}} Doc 存档。 */

/** 用户设置里参与撤销的键。 */
export const LAYER_KEYS = /** @type {const} */ (['theme', 'custom', 'adjust', 'overrides', 'wallpaper', 'glass', 'power', 'radius', 'css'])
const VALUE_KEYS = [...LAYER_KEYS, 'history', 'library']

const clampNumber = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value)
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** @returns {Doc} 空存档。 */
export function emptyDoc() {
  return { schema: SCHEMA, rev: 0, keys: {} }
}

/**
 * 清洗种子里的每个字段，丢掉不认识或越界的内容。
 * @param {unknown} raw 任意输入
 * @returns {Partial<Seed>} 合法的部分
 */
export function normalizeSeed(raw) {
  /** @type {Partial<Seed>} */
  const seed = {}
  if (!isRecord(raw)) return seed
  const number = (key, lo, hi) => {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value)) seed[key] = clampNumber(value, lo, hi)
  }
  number('hue', 0, 360)
  number('chroma', 0, 1.5)
  number('neutral', 0, 1)
  number('contrast', -1, 1)
  number('depth', -1, 1)
  if (typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent)) seed.accent = raw.accent.toLowerCase()
  if (typeof raw.ink === 'boolean') seed.ink = raw.ink
  if (typeof raw.code === 'string' && /^[a-z0-9-]{1,24}$/.test(raw.code)) seed.code = raw.code
  return seed
}

/** token 值只放颜色和渐变这类东西，凡是能跳出声明的字符一律不要。 */
const safeValue = (value) => typeof value === 'string' && value.length > 0 && value.length <= VALUE_MAX_LENGTH && !/[;{}<>\\]/.test(value)

/**
 * @param {unknown} raw 任意输入
 * @returns {Values['overrides']} 合法的覆盖项
 */
export function normalizeOverrides(raw) {
  /** @type {Values['overrides']} */
  const out = {}
  if (!isRecord(raw)) return out
  let count = 0
  for (const [name, value] of Object.entries(raw)) {
    if (count >= OVERRIDES_LIMIT) break
    if (!/^--[a-zA-Z0-9-]{1,80}$/.test(name) || !isRecord(value)) continue
    if (!safeValue(value.light) || !safeValue(value.dark)) continue
    out[name] = { light: value.light, dark: value.dark }
    count += 1
  }
  return out
}

/**
 * 检查自定义 CSS。不接受的情况：超长、`<`（跳出 style 标签）、反斜杠（转义能绕过下面的检查）、
 * `@import`、外链 `url()`（只放行 `url(data:…)`）、`image-set()` 这类不经 url() 也能取外部资源的写法。
 * @param {unknown} raw 任意输入
 * @returns {{ok: true, css: string} | {ok: false, code: 'too-long' | 'bad-char' | 'import' | 'remote-url'}} 结果
 */
export function checkCss(raw) {
  const css = typeof raw === 'string' ? raw : ''
  if (css.length > CSS_MAX_LENGTH) return { ok: false, code: 'too-long' }
  if (/[<\\\0]/.test(css)) return { ok: false, code: 'bad-char' }
  const lower = css.toLowerCase()
  if (lower.includes('@import')) return { ok: false, code: 'import' }
  if (/image-set\s*\(/.test(lower)) return { ok: false, code: 'remote-url' }
  for (const match of lower.matchAll(/url\s*\(\s*(['"]?)\s*([^'")\s]*)/g)) {
    if (!match[2].startsWith('data:')) return { ok: false, code: 'remote-url' }
  }
  return { ok: true, css }
}

const HEX6 = /^#[0-9a-f]{6}$/i
const WALL_ID = /^[a-f0-9]{16,64}$/
const ROTATE_LIMIT = 100
const INTERVAL_MIN = 10
const INTERVAL_MAX = 7 * 86400

const normalizeSrc = (raw) => (typeof raw === 'string' && raw.length <= 2048 && /^https?:\/\//i.test(raw) && !/[\s"'()<>\\;{}]/.test(raw) ? raw : undefined)

const normalizeWallItem = (raw) => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !WALL_ID.test(raw.id)) return undefined
  const src = normalizeSrc(raw.src)
  return { id: raw.id, ...(src === undefined ? {} : { src }) }
}

const normalizeTiming = (raw) => ({
  interval: typeof raw.interval === 'number' && Number.isFinite(raw.interval) ? clampNumber(Math.round(raw.interval), INTERVAL_MIN, INTERVAL_MAX) : 900,
  shuffle: raw.shuffle === true,
  epoch: typeof raw.epoch === 'number' && Number.isFinite(raw.epoch) && raw.epoch >= 0 ? Math.floor(raw.epoch) : 0,
})

/**
 * 清洗壁纸设置。这里的值会进 CSS，所以颜色、id 都卡严格格式，不接受任何 CSS 片段。
 * @param {unknown} raw 任意输入
 * @returns {Wallpaper | null} 合法的壁纸；不合法时为 null
 */
export function normalizeWallpaper(raw) {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'image': {
      const item = normalizeWallItem(raw)
      return item === undefined ? null : { kind: 'image', ...item }
    }
    case 'gradient': {
      if (!Array.isArray(raw.stops)) return null
      const stops = raw.stops.filter((stop) => typeof stop === 'string' && HEX6.test(stop)).map((stop) => stop.toLowerCase())
      if (stops.length < 2 || stops.length > 4) return null
      const angle = typeof raw.angle === 'number' && Number.isFinite(raw.angle) ? clampNumber(Math.round(raw.angle), 0, 360) : 160
      return { kind: 'gradient', stops, angle }
    }
    case 'color':
      return typeof raw.color === 'string' && HEX6.test(raw.color) ? { kind: 'color', color: raw.color.toLowerCase() } : null
    case 'rotate': {
      if (!Array.isArray(raw.items)) return null
      const items = raw.items.slice(0, ROTATE_LIMIT).map(normalizeWallItem).filter((item) => item !== undefined)
      return items.length === 0 ? null : { kind: 'rotate', items, ...normalizeTiming(raw) }
    }
    case 'folder':
      if (typeof raw.path !== 'string' || raw.path.length === 0 || raw.path.length > 1024 || raw.path.includes('\0')) return null
      if (!raw.path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(raw.path)) return null
      return { kind: 'folder', path: raw.path, ...normalizeTiming(raw) }
    default:
      return null
  }
}

/**
 * @param {unknown} raw 任意输入
 * @returns {string} 去掉控制字符、首尾空白，截到上限的名字；不合法时是空串
 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return ''
  return [...raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, NAME_MAX_LENGTH).join('').trim()
}

/**
 * @param {unknown} raw 任意输入
 * @returns {ThemePack | undefined} 合法的主题包；不合法时 undefined
 */
function normalizePack(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !PACK_ID.test(raw.id)) return undefined
  const name = normalizeName(raw.name)
  const seed = normalizeSeed(raw.seed)
  if (name === '' || Object.keys(seed).length === 0) return undefined
  /** @type {ThemePack} */
  const pack = { id: raw.id, name, seed }
  if (typeof raw.radius === 'number' && Number.isFinite(raw.radius)) pack.radius = Math.round(clampNumber(raw.radius, 0, 2) * 100) / 100
  const overrides = normalizeOverrides(raw.overrides)
  if (Object.keys(overrides).length > 0) pack.overrides = overrides
  const css = checkCss(raw.css)
  if (css.ok && css.css !== '') pack.css = css.css
  if (raw.scheme === 'light' || raw.scheme === 'dark') pack.scheme = raw.scheme
  return pack
}

/**
 * @param {unknown} raw 任意输入
 * @returns {ThemePack[]} 合法的「我的主题」：丢掉坏条目和重复 id，最多 LIBRARY_LIMIT 个
 */
export function normalizeLibrary(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  /** @type {ThemePack[]} */
  const out = []
  for (const item of raw) {
    const pack = normalizePack(item)
    if (pack === undefined || seen.has(pack.id)) continue
    seen.add(pack.id)
    out.push(pack)
    if (out.length >= LIBRARY_LIMIT) break
  }
  return out
}

/** 「我的主题」的主题 id 前缀：`my-<包 id>`。 */
export const PACK_PREFIX = 'my-'

/**
 * @param {{theme: string | null, library?: ThemePack[]}} values 设置
 * @returns {ThemePack | undefined} 当前选中的「我的主题」；不是或已删掉时 undefined
 */
export function packOf(values) {
  if (typeof values.theme !== 'string' || !values.theme.startsWith(PACK_PREFIX)) return undefined
  const id = values.theme.slice(PACK_PREFIX.length)
  return (values.library ?? []).find((pack) => pack.id === id)
}

/**
 * @param {{theme: string | null, library?: ThemePack[], css: string}} values 设置
 * @returns {string} 实际生效的 CSS：主题自带的在前，用户自己的在后
 */
export function effectiveCss(values) {
  const own = packOf(values)?.css ?? ''
  return own === '' ? values.css : values.css === '' ? own : `${own}\n${values.css}`
}

const normalizeThemeId = (raw) => (typeof raw === 'string' && /^[a-z0-9-]{1,40}$/.test(raw) ? raw : null)

/**
 * @param {unknown} raw 任意输入
 * @returns {HistoryEntry} 合法的历史条目
 */
function normalizeEntry(raw) {
  const source = isRecord(raw) ? raw : {}
  const custom = normalizeSeed(source.custom)
  return {
    theme: normalizeThemeId(source.theme),
    custom: Object.keys(custom).length > 0 ? custom : null,
    adjust: normalizeSeed(source.adjust),
    overrides: normalizeOverrides(source.overrides),
    wallpaper: normalizeWallpaper(source.wallpaper),
    glass: typeof source.glass === 'number' && Number.isFinite(source.glass) ? clampNumber(source.glass, 0, 1) : null,
    power: source.power === 'on' || source.power === 'off' ? source.power : 'auto',
    radius: typeof source.radius === 'number' && Number.isFinite(source.radius) ? Math.round(clampNumber(source.radius, 0, 2) * 100) / 100 : null,
    css: (() => {
      const checked = checkCss(source.css)
      return checked.ok ? checked.css : ''
    })(),
  }
}

/**
 * 把任意输入清洗成合法的设置值。
 * @param {unknown} raw 任意输入
 * @returns {Values} 设置值
 */
export function normalizeValues(raw) {
  const source = isRecord(raw) ? raw : {}
  const history = Array.isArray(source.history) ? source.history.slice(-HISTORY_LIMIT).map(normalizeEntry) : []
  return { ...normalizeEntry(source), history, library: normalizeLibrary(source.library) }
}

/**
 * @param {Doc} doc 存档
 * @returns {Values} 存档里的当前值
 */
export function docValues(doc) {
  /** @type {Record<string, unknown>} */
  const raw = {}
  for (const key of VALUE_KEYS) {
    const entry = doc.keys[key]
    if (entry !== undefined) raw[key] = entry.v
  }
  return normalizeValues(raw)
}

/**
 * 解析磁盘或网络上来的存档；结构不对就当作空存档，但保留能认的键。
 * @param {unknown} raw 任意输入
 * @returns {Doc} 合法的存档
 */
export function normalizeDoc(raw) {
  const doc = emptyDoc()
  if (!isRecord(raw)) return doc
  if (typeof raw.schema === 'number' && raw.schema > SCHEMA) doc.schema = raw.schema
  if (typeof raw.rev === 'number' && Number.isFinite(raw.rev) && raw.rev >= 0) doc.rev = Math.floor(raw.rev)
  if (isRecord(raw.keys)) {
    for (const [key, entry] of Object.entries(raw.keys)) {
      if (isRecord(entry) && typeof entry.t === 'number' && Number.isFinite(entry.t)) {
        doc.keys[key] = { v: entry.v, t: entry.t, ...(typeof entry.by === 'string' ? { by: entry.by } : {}) }
      }
    }
  }
  return doc
}

/**
 * 判断 `next` 能不能盖住 `current`：时间新的赢，同一时刻按写入方字典序定胜负，
 * 这样无论消息到达顺序如何，所有副本都收敛到同一个结果。
 * @param {KeyEntry | undefined} current 现有条目
 * @param {KeyEntry} next 新条目
 * @returns {boolean} 是否覆盖
 */
function wins(current, next) {
  if (current === undefined) return true
  if (next.t !== current.t) return next.t > current.t
  return (next.by ?? '') > (current.by ?? '')
}

/**
 * 把一批带时间戳的键合并进存档。
 * @param {Doc} doc 现有存档（不修改）
 * @param {Record<string, KeyEntry>} patch 带时间戳的键
 * @returns {{doc: Doc, changed: string[]}} 新存档和真正变了的键
 */
export function mergeKeys(doc, patch) {
  const keys = { ...doc.keys }
  const changed = []
  for (const [key, entry] of Object.entries(patch)) {
    if (!isRecord(entry) || typeof entry.t !== 'number' || !Number.isFinite(entry.t)) continue
    if (!wins(keys[key], entry)) continue
    keys[key] = { v: entry.v, t: entry.t, ...(typeof entry.by === 'string' ? { by: entry.by } : {}) }
    changed.push(key)
  }
  if (changed.length === 0) return { doc, changed }
  return { doc: { schema: doc.schema, rev: doc.rev + 1, keys }, changed }
}

/**
 * 给要写入的值盖上时间戳。
 * @param {Partial<Values>} values 改动的值
 * @param {number} t 时间戳
 * @param {string} by 写入方（标签页 id）
 * @returns {Record<string, KeyEntry>} 可以合并的补丁
 */
export function stampPatch(values, t, by) {
  /** @type {Record<string, KeyEntry>} */
  const patch = {}
  for (const [key, v] of Object.entries(values)) patch[key] = { v, t, by }
  return patch
}

/**
 * @param {Values} values 当前值
 * @returns {HistoryEntry} 当前三层的快照
 */
export function snapshotLayers(values) {
  return { theme: values.theme, custom: values.custom, adjust: values.adjust, overrides: values.overrides, wallpaper: values.wallpaper, glass: values.glass, power: values.power, radius: values.radius, css: values.css }
}

/**
 * @param {HistoryEntry} a 快照 A
 * @param {HistoryEntry} b 快照 B
 * @returns {boolean} 两个快照是否相同
 */
export function sameLayers(a, b) {
  return LAYER_KEYS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

/**
 * 算出「改到 next」要写的键，同时把旧值压进撤销历史。
 * @param {Values} current 当前值
 * @param {Partial<HistoryEntry>} next 想改的层
 * @returns {Partial<Values>} 要写的键；没有变化时是空对象
 */
export function layerChange(current, next) {
  const before = snapshotLayers(current)
  const after = { ...before, ...next }
  if (sameLayers(before, after)) return {}
  /** @type {Partial<Values>} */
  const change = {}
  for (const key of LAYER_KEYS) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) change[key] = after[key]
  }
  change.history = [...current.history, before].slice(-HISTORY_LIMIT)
  return change
}

/**
 * 算出撤销一步要写的键。
 * @param {Values} current 当前值
 * @returns {Partial<Values> | undefined} 要写的键；没有可撤销的内容时为 undefined
 */
export function undoChange(current) {
  const last = current.history.at(-1)
  if (last === undefined) return undefined
  return { ...last, history: current.history.slice(0, -1) }
}
