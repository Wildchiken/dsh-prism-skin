/**
 * 壁纸在引擎这边的表示：渐变和纯色可以直接算，图片要靠客户端先分析（见 client/wall）。
 */
import { clamp, fromOklch, mixSrgb, parseHex, toHex, toOklch } from './color.js'

/** @typedef {import('./generate.js').Wall} Wall */
/** @typedef {{l: number, c: number, h: number, weight: number, hex: string}} Cluster 壁纸上的一种主色 */

/** 内置渐变。 */
export const GRADIENTS = [
  { id: 'aurora', name: { zh: '极光', en: 'Aurora' }, stops: ['#0f2a4a', '#1f6f78', '#6fd3a8'], angle: 160 },
  { id: 'dusk', name: { zh: '暮色', en: 'Dusk' }, stops: ['#2b1d4f', '#7a3b69', '#e0886a'], angle: 150 },
  { id: 'deep', name: { zh: '夜海', en: 'Deep sea' }, stops: ['#0b1026', '#1b2a5c', '#3a4fa0'], angle: 170 },
  { id: 'moss', name: { zh: '青苔', en: 'Moss' }, stops: ['#1f3a2c', '#3f6b4a', '#9cbf8a'], angle: 155 },
  { id: 'mist', name: { zh: '海雾', en: 'Sea mist' }, stops: ['#cfe3f5', '#a8c8e8', '#e6eef7'], angle: 165 },
  { id: 'peach', name: { zh: '桃杏', en: 'Peach' }, stops: ['#ffd6c9', '#ffb3a7', '#fbe3d4'], angle: 140 },
  { id: 'lilac', name: { zh: '雾紫', en: 'Lilac' }, stops: ['#e8def8', '#c9b8ef', '#f4eefc'], angle: 150 },
  { id: 'dawn', name: { zh: '晨光', en: 'Dawn' }, stops: ['#fbe7c6', '#f4c2c2', '#c6d8f4'], angle: 135 },
]

/** 内置纯色。 */
export const SOLIDS = ['#20242e', '#1e2f2a', '#3a2a2a', '#2c2640', '#d9e4f0', '#e4e9d8', '#f0e2d6', '#ecdfe9']

const luminance = (color) => {
  const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** 输入框卡片在视口里的大致位置（主栏底部居中，按 1440×900 的窗口估）。 */
const DOCK_POINT = { x: 0.6, y: 0.87 }
const DOCK_BOX = { w: 1440, h: 900 }

/**
 * CSS linear-gradient 在某一点的颜色（色标均匀分布，gamma 空间插值，和浏览器一致）。
 * @returns {import('./color.js').Rgba} 颜色
 */
function gradientAt(stops, angle, x, y) {
  const rad = (angle * Math.PI) / 180
  const { w, h } = DOCK_BOX
  const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))
  const t = clamp(((x - 0.5) * w * Math.sin(rad) - (y - 0.5) * h * Math.cos(rad)) / length + 0.5, 0, 1)
  const span = t * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(span))
  return mixSrgb(stops[i + 1], stops[i], span - i)
}

/**
 * @param {{stops: string[], angle: number}} spec 渐变
 * @returns {Wall} 引擎视图。CSS 的渐变在 gamma 空间混色，中间可能比两端都暗，所以沿途采样找极值。
 */
export function gradientWall(spec) {
  const stops = spec.stops.map(parseHex)
  const walk = []
  for (let i = 0; i < stops.length - 1; i += 1) {
    for (let step = 0; step <= 16; step += 1) walk.push(mixSrgb(stops[i + 1], stops[i], step / 16))
  }
  let darkest = walk[0]
  let lightest = walk[0]
  const sum = { r: 0, g: 0, b: 0 }
  for (const color of walk) {
    if (luminance(color) < luminance(darkest)) darkest = color
    if (luminance(color) > luminance(lightest)) lightest = color
    sum.r += color.r
    sum.g += color.g
    sum.b += color.b
  }
  const base = toHex({ r: sum.r / walk.length, g: sum.g / walk.length, b: sum.b / walk.length, a: 1 })
  const dock = toHex(gradientAt(stops, spec.angle, DOCK_POINT.x, DOCK_POINT.y))
  const list = spec.stops.map((stop, i) => `${stop} ${Math.round((i / (spec.stops.length - 1)) * 100)}%`).join(',')
  return {
    kind: 'gradient',
    css: `linear-gradient(${Math.round(spec.angle)}deg,${list}) fixed`,
    base,
    dock,
    samples: [...new Set([toHex(darkest), toHex(lightest), ...spec.stops])],
  }
}

/**
 * @param {string} color `#rrggbb`
 * @returns {Wall} 引擎视图
 */
export const colorWall = (color) => ({ kind: 'color', base: color, samples: [color] })

/**
 * @param {string} url 模糊图的地址（只含安全字符）
 * @param {{base: string, dock?: string, samples: string[]}} derived 分析结果
 * @returns {Wall} 引擎视图
 */
export const imageWall = (url, derived) => ({
  kind: 'image',
  css: `url("${url}") center / cover no-repeat fixed`,
  base: derived.base,
  dock: derived.dock ?? derived.base,
  samples: derived.samples,
})

/**
 * 渐变和纯色没有像素分析，用它们自己的颜色当主色。
 * @param {string[]} colors 颜色
 * @returns {{base: string, palette: Cluster[]}} 和图片分析结果同样的形状
 */
export function stopsDerived(colors) {
  const parsed = colors.map(parseHex)
  const sum = parsed.reduce((all, color) => ({ r: all.r + color.r, g: all.g + color.g, b: all.b + color.b }), { r: 0, g: 0, b: 0 })
  const palette = parsed.map((color, i) => ({ ...toOklch(color), hex: colors[i], weight: 1 / colors.length }))
  return { base: toHex({ r: sum.r / parsed.length, g: sum.g / parsed.length, b: sum.b / parsed.length, a: 1 }), palette }
}

/**
 * 从壁纸取色：主色相给表面，最鲜艳的那种颜色给强调色，整体明暗决定表面深浅。
 * 对比度不用在这里操心，引擎会保证。
 * @param {{base: string, palette: Cluster[]}} derived 分析结果
 * @returns {import('../shared/state.js').Seed} 种子
 */
export function seedFromWall(derived) {
  const base = toOklch(parseHex(derived.base))
  const palette = derived.palette ?? []
  const chromatic = palette.filter((cluster) => cluster.c > 0.03)
  const dominant = chromatic.reduce((best, cluster) => (best === undefined || cluster.weight > best.weight ? cluster : best), undefined)
  const hue = dominant?.h ?? base.h
  const vivid = chromatic.filter((cluster) => cluster.weight >= 0.04).reduce((best, cluster) => (best === undefined || cluster.c ** 2 * Math.sqrt(cluster.weight) > best.c ** 2 * Math.sqrt(best.weight) ? cluster : best), undefined)
  const accentHue = vivid?.h ?? hue
  const accentChroma = clamp(vivid?.c ?? 0.13, 0.1, 0.19)
  return {
    hue: Math.round(hue * 10) / 10,
    chroma: 1,
    neutral: Math.round(clamp(base.c / 0.07, 0.12, 0.9) * 100) / 100,
    contrast: 0,
    depth: Math.round(clamp(base.l - 0.6, -0.45, 0.25) * 100) / 100,
    accent: toHex(fromOklch(0.6, accentChroma, accentHue)),
  }
}
