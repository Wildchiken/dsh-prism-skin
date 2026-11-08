// 把 Material Symbols（圆角、24px、960 网格）的路径压短，好放进棱镜的变量覆盖（单个值最多 1024 字）。
// 做法：路径全部换成绝对坐标 → 960 网格缩到 grid 网格取整 → 再按取整后的坐标写回相对命令（不会累积误差）。
// 图标文件由 fetch-symbols.mjs 取到 .cache/material-symbols（不进仓库）。
import fs from 'node:fs'

const ROOT = new URL('../../.cache/material-symbols/symbols/web/', import.meta.url)

const fmt = (n) => {
  const s = String(Math.round(n))
  return s === '-0' ? '0' : s
}
// 拼数字：负号开头时不需要分隔符
const join = (nums) => nums.reduce((acc, s, i) => (i === 0 ? s : acc + (s.startsWith('-') ? '' : ' ') + s), '')

/**
 * 压缩路径。
 * @param {string} d 960 网格（viewBox 0 -960 960 960）的原路径
 * @param {number} [grid] 缩到多大的网格
 * @returns {string} 压缩后的路径（viewBox 0 -grid grid grid）
 */
export function compress(d, grid = 96) {
  const SCALE = grid / 960
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  const ARGS = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4, Z: 0, A: 7 }
  let i = 0
  let cmd = ''
  let cx = 0, cy = 0, sx = 0, sy = 0 // 原坐标里的当前点、子路径起点
  let rx = 0, ry = 0, rsx = 0, rsy = 0 // 取整后的当前点、子路径起点
  const q = (v) => Math.round(v * SCALE)
  const out = []
  let lastOut = ''
  const emit = (c, nums) => {
    const text = join(nums.map(fmt))
    if (c === lastOut && c !== 'm') out.push((text.startsWith('-') ? '' : ' ') + text)
    else out.push(c + text)
    lastOut = c === 'm' ? 'l' : c
  }
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    if (up === 'Z') { emit('z', []); cx = sx; cy = sy; rx = rsx; ry = rsy; lastOut = ''; continue }
    if (!(up in ARGS)) throw new Error(`不认识的路径命令：${cmd}`)
    const a = tokens.slice(i, i + ARGS[up]).map(Number)
    i += ARGS[up]
    const X = (v) => (rel ? cx + v : v)
    const Y = (v) => (rel ? cy + v : v)
    if (up === 'H') { const nx = X(a[0]); const r = q(nx); emit('h', [r - rx]); cx = nx; rx = r; continue }
    if (up === 'V') { const ny = Y(a[0]); const r = q(ny); emit('v', [r - ry]); cy = ny; ry = r; continue }
    if (up === 'A') {
      const nx = X(a[5]), ny = Y(a[6]); const ex = q(nx), ey = q(ny)
      emit('a', [a[0] * SCALE, a[1] * SCALE, a[2], a[3], a[4], ex - rx, ey - ry]); cx = nx; cy = ny; rx = ex; ry = ey; continue
    }
    // 其余命令都是 (x,y) 成对
    const pts = []
    for (let k = 0; k < a.length; k += 2) pts.push([X(a[k]), Y(a[k + 1])])
    const rounded = pts.map(([x, y]) => [q(x), q(y)])
    emit(up.toLowerCase(), rounded.flatMap(([x, y]) => [x - rx, y - ry]))
    const [ex, ey] = pts[pts.length - 1]
    cx = ex; cy = ey
    ;[rx, ry] = rounded[rounded.length - 1]
    if (up === 'M') { sx = cx; sy = cy; rsx = rx; rsy = ry; cmd = rel ? 'l' : 'L' }
  }
  return out.join('')
}

/**
 * 图标的路径。
 * @param {string} spec 图标名；'thumb_up:fill' 取实心版
 * @returns {string} 960 网格的原路径
 */
export function iconPath(spec) {
  const [name, fill] = spec.split(':')
  const file = new URL(`${name}/materialsymbolsrounded/${name}${fill ? '_fill1' : ''}_24px.svg`, ROOT)
  if (!fs.existsSync(file)) throw new Error(`没有图标 ${spec}：先跑 node themes/src/fetch-symbols.mjs`)
  const svg = fs.readFileSync(file, 'utf8')
  // 仓库里少数图标还是旧的 24 网格（没有 viewBox），缩放会错，直接报出来换一个
  if (!svg.includes('viewBox="0 -960 960 960"')) throw new Error(`图标 ${spec} 不是 960 网格，换一个图标`)
  return /\sd="([^"]+)"/.exec(svg)[1]
}
