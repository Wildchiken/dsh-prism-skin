/**
 * 主题文件和分享码。
 *
 * 主题文件就是种子 JSON（几百字节），可选带上圆角、高级覆盖、自定义 CSS、字体。
 * 分享码只编码种子和圆角，形如 `prism1.212.95.40.0.-10.4b78e6.0.one.120`，放进链接的 `#` 后面也很短。
 * 导入时一律先过清洗，任何一项不合法就整份拒绝，不会只导进去一半。
 *
 * 清洗函数从外面传进来（浏览器里由入口交出，不让每个分块各打包一份存档模型）。
 */
/** 主题文件的版本号字段。 */
export const FILE_VERSION = 1
/** 主题文件大小上限（字节）。 */
export const FILE_MAX_BYTES = 256 * 1024
const CODE_PREFIX = 'prism1.'

/**
 * @typedef {object} ThemeFile 导入导出的内容。
 * @property {string} [name] 名字
 * @property {import('./state.js').Seed} seed 完整种子
 * @property {'light' | 'dark'} [scheme] 建议的明暗（别家主题包只有一种）
 * @property {number} [radius] 圆角倍数
 * @property {Record<string, {light: string, dark: string}>} [overrides] 高级覆盖
 * @property {string} [css] 自定义 CSS
 * @property {{text?: string, code?: string, size?: number, codeSize?: number}} [font] 字体（写进宿主自己的字体设置）
 */

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits

/** 字体：只收宿主接受的写法（逗号分隔的字体名）。 */
export function normalizeFont(raw) {
  /** @type {NonNullable<ThemeFile['font']>} */
  const font = {}
  if (raw === null || typeof raw !== 'object') return font
  const family = (value) => (typeof value === 'string' && value.length <= 200 && !/[;{}<>\\():@]/.test(value) ? value.trim() : undefined)
  const size = (value, lo, hi) => (Number.isInteger(value) && value >= lo && value <= hi ? value : undefined)
  const text = family(raw.text)
  const code = family(raw.code)
  const textSize = size(raw.size, 10, 22)
  const codeSize = size(raw.codeSize, 10, 16)
  if (text !== undefined) font.text = text
  if (code !== undefined) font.code = code
  if (textSize !== undefined) font.size = textSize
  if (codeSize !== undefined) font.codeSize = codeSize
  return font
}

/**
 * 生成主题文件的文本。
 * @param {ThemeFile} file 内容
 * @returns {string} JSON
 */
export function serializeTheme(file) {
  const { seed } = file
  /** @type {Record<string, unknown>} */
  const out = { prism: FILE_VERSION }
  if (file.name !== undefined && file.name !== '') out.name = file.name
  out.seed = { hue: round(seed.hue, 1), chroma: round(seed.chroma), neutral: round(seed.neutral), contrast: round(seed.contrast), depth: round(seed.depth), accent: seed.accent, ...(seed.ink === true ? { ink: true } : {}), ...(seed.code === undefined ? {} : { code: seed.code }) }
  if (file.scheme !== undefined) out.scheme = file.scheme
  if (file.radius !== undefined) out.radius = file.radius
  if (file.overrides !== undefined && Object.keys(file.overrides).length > 0) out.overrides = file.overrides
  if (file.css !== undefined && file.css !== '') out.css = file.css
  if (file.font !== undefined && Object.keys(file.font).length > 0) out.font = file.font
  return JSON.stringify(out, null, 1)
}

const FULL_SEED = ['hue', 'chroma', 'neutral', 'contrast', 'depth', 'accent']

/**
 * @param {{checkCss: typeof import('./state.js').checkCss, normalizeOverrides: typeof import('./state.js').normalizeOverrides, normalizeSeed: typeof import('./state.js').normalizeSeed}} state 存档的清洗函数
 * @returns {{parseThemeFile: typeof parseThemeFile, decodeShare: typeof decodeShare, encodeShare: typeof encodeShare, serializeTheme: typeof serializeTheme}} 绑定好的函数
 */
export function createShare(state) {
  return {
    parseThemeFile: (data) => parseThemeFile(data, state),
    decodeShare: (text) => decodeShare(text, state),
    encodeShare,
    serializeTheme,
  }
}

/**
 * 解析主题文件。
 * @param {unknown} data 解析好的 JSON
 * @param {Parameters<typeof createShare>[0]} state 存档的清洗函数
 * @returns {{ok: true, file: ThemeFile} | {ok: false, code: 'not-theme' | 'bad-seed' | 'bad-css' | 'bad-overrides' | 'bad-font'}} 结果
 */
export function parseThemeFile(data, { checkCss, normalizeOverrides, normalizeSeed }) {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || /** @type {any} */ (data).prism !== FILE_VERSION) return { ok: false, code: 'not-theme' }
  const raw = /** @type {Record<string, any>} */ (data)
  const seed = normalizeSeed(raw.seed)
  if (!FULL_SEED.every((key) => key in seed)) return { ok: false, code: 'bad-seed' }
  /** @type {ThemeFile} */
  const file = { seed: /** @type {import('./state.js').Seed} */ (seed) }
  if (typeof raw.name === 'string' && raw.name.trim() !== '') file.name = raw.name.trim().slice(0, 60)
  if (raw.scheme === 'light' || raw.scheme === 'dark') file.scheme = raw.scheme
  if (raw.radius !== undefined) {
    if (typeof raw.radius !== 'number' || !(raw.radius >= 0 && raw.radius <= 2)) return { ok: false, code: 'bad-seed' }
    file.radius = round(raw.radius, 2)
  }
  if (raw.overrides !== undefined) {
    const overrides = normalizeOverrides(raw.overrides)
    if (raw.overrides === null || typeof raw.overrides !== 'object' || Object.keys(overrides).length !== Object.keys(raw.overrides).length) return { ok: false, code: 'bad-overrides' }
    file.overrides = overrides
  }
  if (raw.css !== undefined) {
    const checked = checkCss(raw.css)
    if (!checked.ok || typeof raw.css !== 'string') return { ok: false, code: 'bad-css' }
    file.css = checked.css
  }
  if (raw.font !== undefined) {
    const font = normalizeFont(raw.font)
    if (raw.font === null || typeof raw.font !== 'object' || Object.keys(font).length !== Object.keys(raw.font).length) return { ok: false, code: 'bad-font' }
    file.font = font
  }
  return { ok: true, file }
}

/**
 * 生成分享码。
 * @param {import('./state.js').Seed} seed 完整种子
 * @param {number | null} [radius] 圆角倍数
 * @returns {string} 分享码
 */
export function encodeShare(seed, radius = null) {
  const pct = (value) => String(Math.round(value * 100))
  const fields = [String(Math.round(seed.hue)), pct(seed.chroma), pct(seed.neutral), pct(seed.contrast), pct(seed.depth), seed.accent.slice(1), seed.ink === true ? '1' : '0', seed.code ?? '', radius === null ? '' : pct(radius)]
  while (fields.at(-1) === '') fields.pop()
  return CODE_PREFIX + fields.join('.')
}

/**
 * 解析分享码（也接受带分享码的整条链接）。
 * @param {string} text 文本
 * @param {Parameters<typeof createShare>[0]} state 存档的清洗函数
 * @returns {{ok: true, seed: import('./state.js').Seed, radius?: number} | {ok: false}} 结果
 */
export function decodeShare(text, { normalizeSeed }) {
  const at = text.indexOf(CODE_PREFIX)
  if (at < 0) return { ok: false }
  const fields = text.slice(at + CODE_PREFIX.length).split(/[^0-9a-z.-]/i)[0].split('.')
  if (fields.length < 7 || fields.length > 9) return { ok: false }
  const int = (value) => (/^-?\d{1,3}$/.test(value) ? Number(value) : Number.NaN)
  const [hue, chroma, neutral, contrast, depth] = fields.slice(0, 5).map(int)
  const within = (value, lo, hi) => Number.isFinite(value) && value >= lo && value <= hi
  if (!within(hue, 0, 360) || !within(chroma, 0, 150) || !within(neutral, 0, 100) || !within(contrast, -100, 100) || !within(depth, -100, 100)) return { ok: false }
  if (!/^[0-9a-f]{6}$/i.test(fields[5]) || !/^[01]$/.test(fields[6])) return { ok: false }
  const seed = normalizeSeed({ hue, chroma: chroma / 100, neutral: neutral / 100, contrast: contrast / 100, depth: depth / 100, accent: `#${fields[5]}`, ...(fields[6] === '1' ? { ink: true } : {}), ...(fields[7] ? { code: fields[7] } : {}) })
  if (fields[7] && seed.code === undefined) return { ok: false }
  const radius = fields[8] === undefined || fields[8] === '' ? undefined : int(fields[8]) / 100
  if (radius !== undefined && !(radius >= 0 && radius <= 2)) return { ok: false }
  return { ok: true, seed: /** @type {import('./state.js').Seed} */ (seed), ...(radius === undefined ? {} : { radius }) }
}
