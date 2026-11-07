/**
 * 壁纸分析：模糊、算明暗极值、取主色。全是纯函数，操作 RGBA 字节数组，可以在 node 里测。
 */
import { toHex, toOklch } from '../../engine/color.js'

/**
 * 三遍盒式模糊（效果接近高斯），原地修改。边缘按最近的像素延伸，不会发黑。
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} width 宽
 * @param {number} height 高
 * @param {number} radius 半径（像素）
 * @param {number} [passes] 遍数
 */
export function boxBlur(data, width, height, radius, passes = 3) {
  if (radius < 1 || width === 0 || height === 0) return
  const r = Math.floor(radius)
  const size = r * 2 + 1
  const line = (start, stride, count) => {
    for (let channel = 0; channel < 3; channel += 1) {
      const source = new Float64Array(count)
      for (let i = 0; i < count; i += 1) source[i] = data[start + i * stride + channel]
      let sum = 0
      for (let i = -r; i <= r; i += 1) sum += source[Math.min(count - 1, Math.max(0, i))]
      for (let i = 0; i < count; i += 1) {
        data[start + i * stride + channel] = sum / size
        sum += source[Math.min(count - 1, i + r + 1)] - source[Math.max(0, i - r)]
      }
    }
  }
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) line(y * width * 4, 4, width)
    for (let x = 0; x < width; x += 1) line(x * 4, width * 4, height)
  }
}

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = (r, g, b) => 0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255)
const rgba = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 })

/**
 * 主色：在 OKLab 里做 k-means。初始中心按明度均匀取，结果是确定的。
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} k 几种颜色
 * @returns {{hex: string, l: number, c: number, h: number, weight: number}[]} 按占比从大到小
 */
function clusters(data, k) {
  const total = data.length / 4
  const stride = Math.max(1, Math.floor(total / 3000))
  const points = []
  for (let i = 0; i < total; i += stride) {
    const color = toOklch(rgba(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))
    const rad = (color.h * Math.PI) / 180
    points.push([color.l, color.c * Math.cos(rad), color.c * Math.sin(rad)])
  }
  const sorted = [...points].sort((a, b) => a[0] - b[0])
  let centers = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)])
  let counts = new Array(k).fill(0)
  for (let round = 0; round < 8; round += 1) {
    const sums = centers.map(() => [0, 0, 0])
    counts = new Array(k).fill(0)
    for (const point of points) {
      let best = 0
      let bestDistance = Infinity
      centers.forEach((center, index) => {
        const distance = (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2 + (point[2] - center[2]) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = index
        }
      })
      counts[best] += 1
      sums[best][0] += point[0]
      sums[best][1] += point[1]
      sums[best][2] += point[2]
    }
    centers = centers.map((center, index) => (counts[index] === 0 ? center : sums[index].map((sum) => sum / counts[index])))
  }
  // 用离中心最近的真实像素当代表色，避免算出画面里没有的颜色
  const output = []
  centers.forEach((center, index) => {
    if (counts[index] === 0) return
    let bestPixel = 0
    let bestDistance = Infinity
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]
      const distance = (point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2 + (point[2] - center[2]) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        bestPixel = i
      }
    }
    const at = bestPixel * stride * 4
    const color = rgba(data[at], data[at + 1], data[at + 2])
    const k2 = toOklch(color)
    output.push({ hex: toHex(color), l: k2.l, c: k2.c, h: k2.h, weight: counts[index] / points.length })
  })
  return output.sort((a, b) => b.weight - a.weight)
}

/**
 * 分析一张（已经模糊好的）图。
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} [width] 宽（给了宽高才算 dock）
 * @param {number} [height] 高
 * @returns {{base: string, dock?: string, samples: string[], palette: ReturnType<typeof clusters>}} base 是平均色；dock 是输入框卡片大致位置（底部偏中）的平均色；samples 含最暗和最亮的像素，引擎拿它们保证对比度
 */
export function analyze(data, width, height) {
  let minY = Infinity
  let maxY = -Infinity
  let darkest = 0
  let lightest = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const total = data.length / 4
  for (let i = 0; i < total; i += 1) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    sumR += r
    sumG += g
    sumB += b
    const y = luminance(r, g, b)
    if (y < minY) {
      minY = y
      darkest = i
    }
    if (y > maxY) {
      maxY = y
      lightest = i
    }
  }
  const at = (i) => toHex(rgba(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]))
  const palette = clusters(data, 5)
  let dock
  if (width !== undefined && height !== undefined && width * height * 4 === data.length) {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = Math.floor(height * 0.76); y < Math.ceil(height * 0.98); y += 1) {
      for (let x = Math.floor(width * 0.35); x < Math.ceil(width * 0.85); x += 1) {
        const i = (y * width + x) * 4
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        n += 1
      }
    }
    if (n > 0) dock = toHex(rgba(r / n, g / n, b / n))
  }
  return {
    base: toHex(rgba(sumR / total, sumG / total, sumB / total)),
    ...(dock === undefined ? {} : { dock }),
    samples: [...new Set([at(darkest), at(lightest), ...palette.map((row) => row.hex)])],
    palette,
  }
}
