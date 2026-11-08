// Material 动态取色：用 Google 官方的 material-color-utilities（Apache-2.0）从源色算出整套 Material 3 配色角色，
// 再按主题里的 `material.roles` 写成宿主变量。规则说明见 shared/material.js。
import {
  argbFromHex,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
} from '../vendor/material-color-utilities.js'
import { CONTAINER_ROLES, MATERIAL_ROLES, parseRoleExpr } from '../shared/material.js'

const SCHEMES = {
  tonal: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  neutral: SchemeNeutral,
  monochrome: SchemeMonochrome,
  rainbow: SchemeRainbow,
  'fruit-salad': SchemeFruitSalad,
}

/**
 * 按一种方案建 DynamicScheme；`neutral` 指定时，中性色板（底色、文字、描边）换成那种方案的。
 * @param {import('@material/material-color-utilities').Hct} source 源色
 * @param {boolean} dark 暗色
 * @param {import('../shared/material.js').Material} material 设置
 * @param {string} [variant] 用哪种方案；默认 material.scheme
 * @returns {import('@material/material-color-utilities').DynamicScheme} 方案
 */
function schemeOf(source, dark, material, variant = material.scheme) {
  const Scheme = SCHEMES[/** @type {keyof typeof SCHEMES} */ (variant)]
  const base = new Scheme(source, dark, 0, material.spec, 'phone')
  if (material.neutral === undefined || material.neutral === variant) return base
  const NeutralScheme = SCHEMES[material.neutral]
  const neutral = new NeutralScheme(source, dark, 0, material.spec, 'phone')
  return new DynamicScheme({
    sourceColorHct: source,
    variant: base.variant,
    contrastLevel: 0,
    isDark: dark,
    platform: 'phone',
    specVersion: material.spec,
    primaryPalette: base.primaryPalette,
    secondaryPalette: base.secondaryPalette,
    tertiaryPalette: base.tertiaryPalette,
    neutralPalette: neutral.neutralPalette,
    neutralVariantPalette: neutral.neutralVariantPalette,
    errorPalette: base.errorPalette,
  })
}

/**
 * 算出全部配色角色（亮暗两套）。
 * @param {string} accent 源色 `#rrggbb`
 * @param {import('../shared/material.js').Material} material 设置
 * @returns {Record<string, {light: string, dark: string}>} 角色 → 颜色
 */
export function materialRoles(accent, material) {
  const source = Hct.fromInt(argbFromHex(accent))
  /** @type {Record<string, {light: string, dark: string}>} */
  const out = {}
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light'
    const scheme = schemeOf(source, dark, material)
    const containers = material.containers === undefined ? null : schemeOf(source, dark, material, material.containers)
    for (const role of MATERIAL_ROLES) {
      const from = containers !== null && CONTAINER_ROLES.includes(/** @type {never} */ (role)) ? containers : scheme
      const color = /** @type {import('@material/material-color-utilities').DynamicColor} */ (MaterialDynamicColors[/** @type {keyof typeof MaterialDynamicColors} */ (role)])
      ;(out[role] ??= { light: '', dark: '' })[mode] = hexFromArgb(color.getArgb(from))
    }
  }
  return out
}

const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0')
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

/**
 * 按角色写法取颜色：`role`、`role/8`（8% 不透明度）、`base+over/8`（base 上叠 8% 的 over，结果不透明）。
 * @param {string} expr 写法（已校验过）
 * @param {Record<string, string>} colors 当前明暗下的角色颜色
 * @returns {string} 颜色
 */
function colorOf(expr, colors) {
  const parsed = /** @type {NonNullable<ReturnType<typeof parseRoleExpr>>} */ (parseRoleExpr(expr))
  const base = colors[parsed.base]
  if (parsed.alpha === undefined) return base
  const a = parsed.alpha / 100
  if (parsed.over === undefined) return `${base}${hex2(a * 255)}`
  const over = rgb(colors[parsed.over])
  return `#${rgb(base).map((c, i) => hex2(c * (1 - a) + over[i] * a)).join('')}`
}

let cacheKey = ''
/** @type {import('./generate.js').TokenLayer} */
let cacheValue = {}

/**
 * 主题的 Material 规则 → 宿主变量。同一组输入只算一次（设置页拖取色器时会连续调用）。
 * @param {import('../shared/material.js').Material} material 设置
 * @param {string} accent 源色 `#rrggbb`
 * @returns {import('./generate.js').TokenLayer} 变量
 */
export function materialTokens(material, accent) {
  const key = JSON.stringify([accent, material])
  if (key === cacheKey) return cacheValue
  const roles = materialRoles(accent, material)
  const light = Object.fromEntries(Object.entries(roles).map(([role, pair]) => [role, pair.light]))
  const dark = Object.fromEntries(Object.entries(roles).map(([role, pair]) => [role, pair.dark]))
  /** @type {import('./generate.js').TokenLayer} */
  const out = {}
  for (const [name, pair] of Object.entries(material.roles)) out[name] = { light: colorOf(pair.light, light), dark: colorOf(pair.dark, dark) }
  cacheKey = key
  cacheValue = out
  return out
}
