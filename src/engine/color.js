/**
 * 颜色基础运算：sRGB ⇄ OKLab/OKLCH、十六进制读写、sRGB 混色。
 *
 * 全部是纯函数，host 半和浏览器分块共用。颜色对象统一用 `{r, g, b, a}`，
 * 分量都在 0..1（`r/g/b` 是 gamma 编码后的 sRGB）。
 */

/**
 * @typedef {{r: number, g: number, b: number, a: number}} Rgba
 * @typedef {{l: number, c: number, h: number}} Oklch
 */

/** @param {number} v 值 @param {number} lo 下限 @param {number} hi 上限 @returns {number} 夹紧后的值 */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/**
 * 解析 `#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`。
 * @param {string} hex 十六进制颜色
 * @returns {Rgba | undefined} 解析结果；格式不对时为 undefined
 */
export function parseHex(hex) {
  if (typeof hex !== 'string' || !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return undefined
  let s = hex.slice(1)
  if (s.length <= 4) s = [...s].map((c) => c + c).join('')
  const at = (i) => parseInt(s.slice(i, i + 2), 16) / 255
  return { r: at(0), g: at(2), b: at(4), a: s.length === 8 ? at(6) : 1 }
}

const byte = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')

/**
 * @param {Rgba} c 颜色
 * @returns {string} `#rrggbb`，有透明度时 `#rrggbbaa`
 */
export function toHex(c) {
  const alpha = c.a === undefined || c.a >= 0.9985 ? '' : byte(c.a)
  return `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${alpha}`
}

/**
 * @param {Rgba} c sRGB 颜色
 * @returns {Oklch} OKLCH（h 单位：度；近灰时 h 为 0）
 */
export function toOklch(c) {
  const r = toLinear(c.r)
  const g = toLinear(c.g)
  const b = toLinear(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const h = C < 1e-5 ? 0 : (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: C, h: h < 0 ? h + 360 : h }
}

/** @returns {[number, number, number]} 线性 sRGB（可能超出 0..1） */
function oklchToLinear(l, c, h) {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const x = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const y = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const z = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ]
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/**
 * OKLCH → sRGB。超色域时保持 L、h，二分降低 C（不做裁剪，避免色相漂移）。
 * @param {number} l 明度 0..1
 * @param {number} c 彩度
 * @param {number} h 色相（度）
 * @param {number} [a] 透明度
 * @returns {Rgba} sRGB 颜色
 */
export function fromOklch(l, c, h, a = 1) {
  const L = clamp(l, 0, 1)
  let rgb = oklchToLinear(L, c, h)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 14; i += 1) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid
      else hi = mid
    }
    rgb = oklchToLinear(L, lo, h)
  }
  return { r: toGamma(clamp(rgb[0], 0, 1)), g: toGamma(clamp(rgb[1], 0, 1)), b: toGamma(clamp(rgb[2], 0, 1)), a }
}

/**
 * 把 `top` 按自身透明度叠到 `bottom` 上（sRGB 空间，与浏览器合成一致）。
 * @param {Rgba} top 上层
 * @param {Rgba} bottom 下层
 * @returns {Rgba} 合成结果
 */
export function over(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a)
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a }
}

/**
 * 等价 CSS `color-mix(in srgb, a p%, b)`（预乘透明度，与规范一致）。
 * @param {Rgba} a 颜色 A
 * @param {Rgba} b 颜色 B
 * @param {number} p A 的比例 0..1
 * @returns {Rgba} 混色结果
 */
export function mixSrgb(a, b, p) {
  const q = 1 - p
  const alpha = a.a * p + b.a * q
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  const ch = (x, y) => (x * a.a * p + y * b.a * q) / alpha
  return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha }
}

/** @param {Rgba} c 颜色 @param {number} a 新透明度 @returns {Rgba} 换了透明度的颜色 */
export const withAlpha = (c, a) => ({ r: c.r, g: c.g, b: c.b, a })
