/**
 * 对比度计算：WCAG 2.x 比值和 APCA（W3 0.0.98G-4g 常数）的 Lc。
 * 入参都是不透明的 sRGB 颜色；有透明度的先用 `over` 合成。
 */

/** @typedef {import('./color.js').Rgba} Rgba */

const wcagChannel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/** @param {Rgba} c 颜色 @returns {number} 相对亮度 */
const luminance = (c) => 0.2126 * wcagChannel(c.r) + 0.7152 * wcagChannel(c.g) + 0.0722 * wcagChannel(c.b)

/**
 * @param {Rgba} a 颜色 A
 * @param {Rgba} b 颜色 B
 * @returns {number} WCAG 对比度（1..21）
 */
export function wcag(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const apcaY = (c) => {
  const y = 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4
  return y < 0.022 ? y + (0.022 - y) ** 1.414 : y
}

/**
 * @param {Rgba} text 文字色
 * @param {Rgba} background 背景色
 * @returns {number} APCA Lc 的绝对值（0..108）
 */
export function apca(text, background) {
  const yText = apcaY(text)
  const yBack = apcaY(background)
  if (Math.abs(yBack - yText) < 0.0005) return 0
  if (yBack > yText) {
    const sapc = (yBack ** 0.56 - yText ** 0.57) * 1.14
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100
  }
  const sapc = (yBack ** 0.65 - yText ** 0.62) * 1.14
  return sapc > -0.1 ? 0 : -(sapc + 0.027) * 100
}
