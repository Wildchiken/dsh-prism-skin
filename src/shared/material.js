// Material 动态取色的主题字段（只做校验，不含算法；算法在 engine/material.js，用的是 Google 的 material-color-utilities）。
//
// 主题包里写：
//   material: {
//     scheme: 'tonal' | 'vibrant' | ...,   // 整体用哪种 Material 配色方案（默认 tonal，安卓默认的 Tonal Spot）
//     neutral: 'tonal' | ...,              // 可选：底色、文字、描边改用另一种方案的中性色板
//     containers: 'tonal' | ...,           // 可选：六个容器色（primary/secondary/tertiary 的 Container 和 on-Container）改取另一种方案
//     spec: '2021' | '2025',               // 配色规格（默认 2025，安卓 16）
//     roles: { '--变量名': 角色写法 | { light: 角色写法, dark: 角色写法 } }
//   }
// 角色写法：`primary`（角色）、`onSurface/8`（角色叠 8% 不透明度）、`surfaceContainer+onSurface/8`（前者上叠后者 8%）。
// 源色取当前生效种子的强调色：用户在棱镜里换强调色，整套 Material 配色跟着重算。

/** material-color-utilities 0.4.0 里 MaterialDynamicColors 的配色角色。 */
export const MATERIAL_ROLES = /** @type {const} */ ([
  'background', 'onBackground', 'surface', 'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest', 'onSurface', 'surfaceVariant', 'onSurfaceVariant', 'inverseSurface', 'inverseOnSurface',
  'outline', 'outlineVariant', 'shadow', 'scrim', 'surfaceTint', 'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer', 'inversePrimary',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer', 'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer', 'primaryFixed', 'primaryFixedDim', 'onPrimaryFixed', 'onPrimaryFixedVariant',
  'secondaryFixed', 'secondaryFixedDim', 'onSecondaryFixed', 'onSecondaryFixedVariant', 'tertiaryFixed', 'tertiaryFixedDim', 'onTertiaryFixed',
  'onTertiaryFixedVariant',
])

/** 可选的配色方案（对应官方的 Scheme* 类）。 */
export const MATERIAL_SCHEMES = /** @type {const} */ (['tonal', 'vibrant', 'expressive', 'fidelity', 'content', 'neutral', 'monochrome', 'rainbow', 'fruit-salad'])

/** 容器色那一组角色（`containers` 字段换的就是这些）。 */
export const CONTAINER_ROLES = /** @type {const} */ (['primaryContainer', 'onPrimaryContainer', 'secondaryContainer', 'onSecondaryContainer', 'tertiaryContainer', 'onTertiaryContainer'])

const ROLE_SET = new Set(MATERIAL_ROLES)
const SCHEME_SET = new Set(MATERIAL_SCHEMES)
const EXPR = /^([a-z][A-Za-z]{0,40})(?:\+([a-z][A-Za-z]{0,40}))?(?:\/(\d{1,3}))?$/
const ROLES_LIMIT = 300

/**
 * @typedef {{scheme: typeof MATERIAL_SCHEMES[number], neutral?: typeof MATERIAL_SCHEMES[number], containers?: typeof MATERIAL_SCHEMES[number], spec: '2021' | '2025', roles: Record<string, {light: string, dark: string}>}} Material
 */

/**
 * 拆开一条角色写法。
 * @param {string} expr 写法
 * @returns {{base: string, over?: string, alpha?: number} | undefined} 拆好的结果；不合法时 undefined
 */
export function parseRoleExpr(expr) {
  if (typeof expr !== 'string') return undefined
  const match = EXPR.exec(expr)
  if (match === null) return undefined
  const [, base, over, pct] = match
  if (!ROLE_SET.has(base) || (over !== undefined && !ROLE_SET.has(over))) return undefined
  const alpha = pct === undefined ? undefined : Number(pct)
  if (alpha !== undefined && alpha > 100) return undefined
  // 「A+B」必须带不透明度：B 叠在 A 上多少
  if (over !== undefined && alpha === undefined) return undefined
  return { base, ...(over === undefined ? {} : { over }), ...(alpha === undefined ? {} : { alpha }) }
}

/**
 * @param {unknown} raw 任意输入
 * @returns {Material | undefined} 合法的 Material 字段；不合法或没有任何角色时 undefined
 */
export function normalizeMaterial(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = /** @type {Record<string, unknown>} */ (raw)
  const scheme = source.scheme === undefined ? 'tonal' : source.scheme
  if (!SCHEME_SET.has(/** @type {never} */ (scheme))) return undefined
  const spec = source.spec === undefined ? '2025' : source.spec
  if (spec !== '2021' && spec !== '2025') return undefined
  const roles = /** @type {Record<string, {light: string, dark: string}>} */ ({})
  if (source.roles === null || typeof source.roles !== 'object' || Array.isArray(source.roles)) return undefined
  for (const [name, value] of Object.entries(source.roles)) {
    if (Object.keys(roles).length >= ROLES_LIMIT) break
    if (!/^--[a-zA-Z0-9-]{1,80}$/.test(name)) continue
    const pair = typeof value === 'string' ? { light: value, dark: value } : value
    if (pair === null || typeof pair !== 'object') continue
    const { light, dark } = /** @type {{light: unknown, dark: unknown}} */ (pair)
    if (parseRoleExpr(/** @type {string} */ (light)) === undefined || parseRoleExpr(/** @type {string} */ (dark)) === undefined) continue
    roles[name] = { light: /** @type {string} */ (light), dark: /** @type {string} */ (dark) }
  }
  if (Object.keys(roles).length === 0) return undefined
  /** @type {Material} */
  const out = { scheme: /** @type {Material['scheme']} */ (scheme), spec, roles }
  for (const key of /** @type {const} */ (['neutral', 'containers'])) {
    const value = source[key]
    if (value === undefined) continue
    if (!SCHEME_SET.has(/** @type {never} */ (value))) return undefined
    out[key] = /** @type {Material['scheme']} */ (value)
  }
  return out
}
