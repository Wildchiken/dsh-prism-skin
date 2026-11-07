/**
 * 把别家的主题换算成棱镜的种子：dream-skin 主题包、dream-skin 内置主题、dream-skin 的整套设置。
 *
 * 别家主题是一张写死的颜色表，只有一种明暗。棱镜只取它的「底色、强调色、明暗」，
 * 在种子空间里找画布底色最接近的一组（色相、中性色调、明暗），其余颜色由引擎重算，
 * 所以换算后亮暗两种都有，对比度照样自动达标；代价是和原包不会一模一样。
 */
import { clamp, over, parseHex, toHex, toOklch } from './color.js'
import { canvasOf } from './generate.js'

const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const BLACK = { r: 0, g: 0, b: 0, a: 1 }

/**
 * 解析 `#hex`、`rgb()`、`rgba()`，半透明的叠在白（亮色）或黑（暗色）上变成不透明。
 * @param {unknown} text 颜色文本
 * @param {'light' | 'dark'} scheme 明暗
 * @returns {string | undefined} `#rrggbb`；认不出时为 undefined
 */
export function opaqueColor(text, scheme) {
  if (typeof text !== 'string') return undefined
  const value = text.trim().toLowerCase()
  let color = parseHex(value)
  if (color === undefined) {
    const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(value)
    if (match === null) return undefined
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number.parseFloat(match[4]) / 100 : Number(match[4])
    color = { r: Number(match[1]) / 255, g: Number(match[2]) / 255, b: Number(match[3]) / 255, a: clamp(alpha, 0, 1) }
    if ([color.r, color.g, color.b, color.a].some((v) => !Number.isFinite(v))) return undefined
  }
  const flat = color.a >= 1 ? color : over(color, scheme === 'dark' ? BLACK : WHITE)
  return toHex({ r: clamp(flat.r, 0, 1), g: clamp(flat.g, 0, 1), b: clamp(flat.b, 0, 1), a: 1 })
}

/** OKLab 距离。 */
function distance(a, b) {
  const p = toOklch(a)
  const q = toOklch(b)
  const ax = p.c * Math.cos((p.h * Math.PI) / 180)
  const ay = p.c * Math.sin((p.h * Math.PI) / 180)
  const bx = q.c * Math.cos((q.h * Math.PI) / 180)
  const by = q.c * Math.sin((q.h * Math.PI) / 180)
  return Math.hypot(p.l - q.l, ax - bx, ay - by)
}

/**
 * 找一组种子，使它在给定明暗下的画布底色最接近目标。
 * @param {{base: string, accent: string, scheme: 'light' | 'dark'}} target 目标：底色、强调色（都是 `#rrggbb`）、明暗
 * @returns {{seed: import('../shared/state.js').Seed, error: number}} 种子和剩下的色差（OKLab）
 */
export function fitSeed({ base, accent, scheme }) {
  const goal = /** @type {import('./color.js').Rgba} */ (parseHex(base))
  const tone = toOklch(goal)
  const accentHue = toOklch(/** @type {import('./color.js').Rgba} */ (parseHex(accent))).h
  // 近灰的底色看不出色相，用强调色的色相（中性色调会接近 0，影响不大）
  const hue = Math.round(tone.c > 0.006 ? tone.h : accentHue)
  let best = { neutral: 0.5, depth: 0, error: Infinity }
  const tryAt = (neutral, depth) => {
    const n = clamp(neutral, 0, 1)
    const d = clamp(depth, -1, 1)
    const error = distance(canvasOf({ hue, neutral: n, depth: d, accent, chroma: 1, contrast: 0 }, scheme), goal)
    if (error < best.error) best = { neutral: n, depth: d, error }
  }
  for (let n = 0; n <= 1.0001; n += 0.1) for (let d = -1; d <= 1.0001; d += 0.1) tryAt(n, d)
  for (const step of [0.04, 0.015]) {
    const { neutral, depth } = best
    for (let i = -2; i <= 2; i += 1) for (let j = -2; j <= 2; j += 1) tryAt(neutral + i * step, depth + j * step)
  }
  const round = (v) => Math.round(v * 1000) / 1000
  return { seed: { hue, chroma: 1, neutral: round(best.neutral), contrast: 0, depth: round(best.depth), accent }, error: best.error }
}

/** dream-skin 的主题包格式。 */
export const PACK_FORMAT = 'dsh-dream-skin/pack'

/**
 * 解析 dream-skin 主题包。
 * @param {unknown} data 解析好的 JSON
 * @returns {{ok: true, name: string, nameZh?: string, scheme: 'light' | 'dark', seed: import('../shared/state.js').Seed} | {ok: false, code: 'not-pack' | 'bad-pack'}} 结果
 */
export function packToTheme(data) {
  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isRecord(data) || data.format !== PACK_FORMAT) return { ok: false, code: 'not-pack' }
  const manifest = data.manifest
  if (!isRecord(manifest) || !isRecord(manifest.tokens)) return { ok: false, code: 'bad-pack' }
  const scheme = manifest.colorScheme === 'dark' ? 'dark' : 'light'
  const tokens = manifest.tokens
  const base = opaqueColor(tokens['--dsw-alias-bg-base'], scheme)
  const accent = opaqueColor(manifest.accent, scheme) ?? opaqueColor(tokens['--dsw-alias-brand-primary'], scheme) ?? opaqueColor(tokens['--dsw-alias-button-primary-fill'], scheme)
  if (base === undefined || accent === undefined) return { ok: false, code: 'bad-pack' }
  const text = (value, max) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined)
  const name = text(manifest.name, 60) ?? text(manifest.id, 60) ?? 'Pack'
  const nameZh = text(manifest.nameZh, 60)
  return { ok: true, name, ...(nameZh === undefined ? {} : { nameZh }), scheme, seed: fitSeed({ base, accent, scheme }).seed }
}

/** dream-skin 11.4.1 内置主题：明暗、画布底色、强调色。 */
export const DREAM_BUILTINS = {
  abyss: ['dark', '#111317', '#a093fb'],
  aurora: ['dark', '#0f1415', '#00bbc5'],
  nebula: ['dark', '#131116', '#b48df5'],
  ember: ['dark', '#15110e', '#eb8555'],
  midnight: ['dark', '#0b0b0c', '#889ef6'],
  ivory: ['light', '#f3f0e7', '#1d6cc1'],
  mist: ['light', '#e3edf4', '#006cb5'],
  rose: ['light', '#f8eced', '#a74693'],
}

const PACK_PREFIX = 'dream-pack:'

/**
 * 从渐变 CSS 里取出颜色和角度。
 * @param {string} css 渐变
 * @returns {{kind: 'gradient', stops: string[], angle: number} | null} 棱镜的渐变壁纸；取不出两个颜色时为 null
 */
export function gradientFromCss(css) {
  const stops = []
  for (const match of css.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
    const color = opaqueColor(match[0], 'light')
    if (color !== undefined && !stops.includes(color)) stops.push(color)
    if (stops.length === 4) break
  }
  if (stops.length < 2) return null
  const angle = /(-?\d+(?:\.\d+)?)deg/.exec(css)
  return { kind: 'gradient', stops, angle: angle === null ? 160 : Math.round(((Number(angle[1]) % 360) + 360) % 360) }
}

/**
 * @typedef {object} DreamPlan 迁移计划。
 * @property {{name: string, scheme: 'light' | 'dark', seed: import('../shared/state.js').Seed} | null} theme 主题（换算成种子）
 * @property {import('../shared/state.js').Wallpaper | null} wallpaper 不需要下载的壁纸（渐变、文件夹轮播）
 * @property {{kind: 'dream-image'} | {kind: 'local-image'} | {kind: 'url', url: string} | {kind: 'urls', urls: string[], interval: number, shuffle: boolean} | null} fetch 要先存进棱镜的图片
 * @property {string[]} skipped 认出来但不迁移的项（说明给用户看）
 */

/**
 * 把 dream-skin 的设置换算成迁移计划。
 * @param {Record<string, string>} keys 设置（键去掉 `dsh-dream-skin:` 前缀）
 * @param {{fileImage?: boolean, localImage?: boolean}} [images] 哪里有图片
 * @returns {DreamPlan} 计划
 */
export function planDream(keys, images = {}) {
  /** @type {DreamPlan} */
  const plan = { theme: null, wallpaper: null, fetch: null, skipped: [] }
  const json = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const accentOverride = /^#[0-9a-f]{6}$/i.test(keys.accent ?? '') ? keys.accent.toLowerCase() : undefined
  const skin = keys.skin ?? ''
  if (skin.startsWith(PACK_PREFIX)) {
    const packs = json(keys.packs ?? '[]')
    const id = skin.slice(PACK_PREFIX.length)
    const found = Array.isArray(packs) ? packs.find((item) => item?.id === id || item?.manifest?.id === id) : undefined
    const parsed = found === undefined ? undefined : packToTheme(found.format === PACK_FORMAT ? found : { format: PACK_FORMAT, manifest: found.manifest ?? found })
    if (parsed?.ok) plan.theme = { name: parsed.nameZh ?? parsed.name, scheme: parsed.scheme, seed: parsed.seed }
    else plan.skipped.push('pack')
  } else if (Object.hasOwn(DREAM_BUILTINS, skin)) {
    const [scheme, base, accent] = DREAM_BUILTINS[skin]
    plan.theme = { name: skin, scheme: /** @type {'light' | 'dark'} */ (scheme), seed: fitSeed({ base, accent, scheme: /** @type {'light' | 'dark'} */ (scheme) }).seed }
  } else if (skin !== '') plan.skipped.push('skin')
  if (plan.theme !== null && accentOverride !== undefined) plan.theme.seed = { ...plan.theme.seed, accent: accentOverride }

  const rotation = json(keys['wallpaper-rotation'] ?? '')
  const rotating = rotation !== null && typeof rotation === 'object' && (rotation.on === 1 || rotation.on === true)
  const interval = rotating ? clamp(Math.round(Number(rotation.minutes) || 15) * 60, 10, 7 * 86400) : 900
  const shuffle = rotating && rotation.mode === 'random'
  const folder = (keys['wallpaper-folder'] ?? '').trim()
  const kind = keys['wallpaper-kind'] ?? 'image'
  if (rotating && rotation.source === 'folder' && folder !== '') {
    plan.wallpaper = { kind: 'folder', path: folder, interval, shuffle, epoch: 0 }
  } else if (rotating && Array.isArray(rotation.urls) && rotation.urls.length > 0) {
    const urls = rotation.urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)).slice(0, 20)
    if (urls.length > 0) plan.fetch = { kind: 'urls', urls, interval, shuffle }
  } else if (kind === 'gradient') {
    plan.wallpaper = gradientFromCss(keys['wallpaper-gradient'] ?? '')
    if (plan.wallpaper === null) plan.skipped.push('gradient')
  } else if (kind === 'url' && /^https?:\/\//i.test(keys['wallpaper-url'] ?? '')) {
    plan.fetch = { kind: 'url', url: keys['wallpaper-url'] }
  } else if (images.fileImage === true) {
    plan.fetch = { kind: 'dream-image' }
  } else if (images.localImage === true) {
    plan.fetch = { kind: 'local-image' }
  }
  return plan
}
