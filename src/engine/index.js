/**
 * 引擎入口：把「主题 → 我的调整 → 高级覆盖」三层合成最终变量，有壁纸时再叠上玻璃。
 */
import { generate } from './generate.js'
import { BASE_SEED, THEMES, themeById } from './themes.js'
import { colorWall } from './wall.js'
import { packOf } from '../shared/state.js'

export { audit, auditSeed, completeSeed, generate, LEGIBILITY, tokenNames } from './generate.js'
export { BASE_SEED, THEMES, themeById } from './themes.js'
export { CODE_SCHEMES, codeSchemeById } from './code.js'
export { effectiveCss, PACK_PREFIX, packOf } from '../shared/state.js'
export { colorWall, GRADIENTS, gradientWall, imageWall, seedFromWall, SOLIDS, stopsDerived } from './wall.js'

/** 自定义种子对应的主题 id。 */
export const CUSTOM_THEME = 'custom'

/** 第一次设壁纸时的玻璃感。 */
export const DEFAULT_GLASS = 0.5

/** 宿主的圆角档位（px）。只有这几个走变量，约七成的圆角跟着变，其余写死在宿主样式里。 */
export const RADIUS_TOKENS = { '--dsw-radius-xs': 4, '--dsw-radius-sm': 8, '--dsw-radius-md': 12, '--dsw-radius-lg': 16, '--dsw-radius-xl': 20, '--dsw-radius-panel': 28 }

/**
 * @param {number | null} radius 圆角倍数；null 表示不改
 * @returns {import('./generate.js').TokenLayer} 圆角变量
 */
export function radiusTokens(radius) {
  /** @type {import('./generate.js').TokenLayer} */
  const out = {}
  if (radius === null || radius === undefined) return out
  for (const [name, px] of Object.entries(RADIUS_TOKENS)) {
    const value = `${Math.round(px * radius)}px`
    out[name] = { light: value, dark: value }
  }
  return out
}

/**
 * 算出当前设置对应的基底种子。
 * @param {Pick<import('../shared/state.js').Values, 'theme' | 'custom' | 'adjust'> & {wallpaper?: unknown, library?: import('../shared/state.js').ThemePack[]}} values 设置
 * @returns {Partial<import('../shared/state.js').Seed> | undefined} 种子；不换肤时为 undefined
 */
export function seedOf(values) {
  const hasAdjust = Object.keys(values.adjust).length > 0
  if (values.theme === CUSTOM_THEME && values.custom !== null) return { ...values.custom, ...values.adjust }
  const pack = packOf(values)
  if (pack !== undefined) return { ...pack.seed, ...values.adjust }
  const theme = themeById(values.theme)
  if (theme !== undefined) return { ...theme.seed, ...values.adjust }
  return hasAdjust || (values.wallpaper ?? null) !== null ? { ...BASE_SEED, ...values.adjust } : undefined
}

/**
 * 三层合成（不算玻璃的旧入口）。
 * @param {Pick<import('../shared/state.js').Values, 'theme' | 'custom' | 'adjust' | 'overrides'>} values 设置
 * @returns {import('./generate.js').TokenLayer | null} 变量；什么都没设时为 null（完全沿用宿主）
 */
export function resolveTokens(values) {
  return resolveLayer({ radius: null, ...values, wallpaper: null }, null).tokens
}

/**
 * @typedef {object} Layer 交给宿主的一层变量。
 * @property {import('./generate.js').TokenLayer | null} tokens 变量
 * @property {import('./generate.js').TokenLayer | null} opaque 省电时（含系统「减少透明度」）要换掉的那部分：
 *   把壁纸当成它的平均色，表面全是不透明纯色，没有固定背景、没有透明
 * @property {(import('./generate.js').Wall & {key: string}) | null} wall 当前壁纸
 */

/**
 * 合成最终的一层：主题 → 我的调整（含圆角）→ 玻璃 → 高级覆盖。
 * @param {Pick<import('../shared/state.js').Values, 'theme' | 'custom' | 'adjust' | 'overrides' | 'wallpaper' | 'glass'> & {radius?: number | null, library?: import('../shared/state.js').ThemePack[]}} values 设置
 * @param {(import('./generate.js').Wall & {key?: string}) | null} wall 当前壁纸；还没分析好时传 null，只出不透明的主题
 * @returns {Layer} 结果
 */
export function resolveLayer(values, wall) {
  const seed = seedOf(values)
  const pack = packOf(values)
  // 主题自带的覆盖算主题的一部分，用户自己的覆盖再盖在上面
  const overrides = pack?.overrides === undefined ? values.overrides : { ...pack.overrides, ...values.overrides }
  const hasOverrides = Object.keys(overrides).length > 0
  const radius = radiusTokens(values.radius ?? pack?.radius ?? null)
  if (seed === undefined && !hasOverrides && Object.keys(radius).length === 0) return { tokens: null, opaque: null, wall: null }
  const level = values.glass ?? DEFAULT_GLASS
  const active = seed !== undefined && wall !== null && level > 0
  const tokens = seed === undefined ? {} : generate(seed, active ? { level, wall } : null)
  let opaque = null
  if (active && wall.kind !== 'color') {
    const flat = generate(seed, { level, wall: colorWall(wall.base) })
    opaque = {}
    for (const name of Object.keys(tokens)) {
      const plain = flat[name] ?? { light: '', dark: '' }
      if (overrides[name] === undefined && (plain.light !== tokens[name].light || plain.dark !== tokens[name].dark)) opaque[name] = plain
    }
  }
  return { tokens: { ...tokens, ...radius, ...overrides }, opaque, wall: wall === null ? null : { key: '', ...wall } }
}

/**
 * 随机种子：色相、强调色都随机，但范围收在好看的区间。
 * @param {() => number} [random] 随机数来源
 * @returns {import('../shared/state.js').Seed} 种子
 */
export function randomSeed(random = Math.random) {
  const hue = Math.round(random() * 360)
  const offset = [0, 0, 30, -30, 150, 180][Math.floor(random() * 6)]
  const accentHue = (hue + offset + 360) % 360
  return {
    hue,
    chroma: 0.9 + random() * 0.2,
    neutral: 0.25 + random() * 0.55,
    contrast: 0,
    depth: (random() - 0.5) * 0.5,
    accent: hueToAccent(accentHue, 0.6 + random() * 0.08, 0.13 + random() * 0.05),
  }
}

/**
 * @param {number} hue 色相
 * @param {number} l 明度
 * @param {number} c 彩度
 * @returns {string} `#rrggbb`
 */
function hueToAccent(hue, l, c) {
  const rad = (hue * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const f = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
  const x = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const y = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const z = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  const channel = (v) => Math.round(Math.min(1, Math.max(0, f(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')
  return `#${channel(4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z)}${channel(-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z)}${channel(-0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z)}`
}
