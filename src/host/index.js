/**
 * dsh-prism-skin — host 半。
 *
 *   1. `webserver/index-inject`：渲染 index.html 时带上已保存的变量，首屏不闪；
 *   2. `/prism-skin/api/state`：读写设置文件（设置以这个文件为准）；
 *   3. `/prism-skin/api/wallpaper/*`：存壁纸原图、模糊图和分析结果，替用户下载链接里的图，
 *      列出并读取轮播文件夹里的图。
 */
import { createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { colorWall, gradientWall, imageWall, resolveLayer } from '../engine/index.js'
import { bootRows, packLayer } from '../shared/boot.js'
import { indexAt, nextChange } from '../shared/schedule.js'
import { docValues, normalizeValues, stampPatch } from '../shared/state.js'
import { dreamPath, readDreamImage, readDreamSettings } from './dream.js'
import { defaultStatePath, StateStore } from './store.js'
import { IMAGE_MAX_BYTES, WallpaperStore } from './wallpapers.js'

/** 插件名。 */
export const name = 'dsh-prism-skin'
/** 只依赖 web 服务；不带 web 的 profile 里这个插件什么都不做。 */
export const inject = ['webServer']

/* global __PRISM_VERSION__ */
const VERSION = typeof __PRISM_VERSION__ === 'string' ? __PRISM_VERSION__ : 'dev'
const API_PREFIX = '/prism-skin/api'
const WALL_API = `${API_PREFIX}/wallpaper`
const MAX_BODY_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 20000
const WRITABLE_KEYS = new Set(['theme', 'custom', 'adjust', 'overrides', 'history', 'wallpaper', 'glass', 'power', 'radius', 'css'])

/**
 * 现在该显示哪张壁纸，以及还有哪些图等着浏览器分析（当前这张和下一张）。
 * @param {import('../shared/state.js').Values} values 设置
 * @param {WallpaperStore} walls 壁纸文件
 * @param {number} now 当前时刻
 * @returns {{wall: (import('../engine/generate.js').Wall & {key: string}) | null, needs: {key: string, src: string}[]}} 结果
 */
export function currentWall(values, walls, now) {
  const spec = values.wallpaper
  if (spec === null) return { wall: null, needs: [] }
  if (spec.kind === 'gradient') return { wall: { key: `g${spec.angle}${spec.stops.join('')}`, ...gradientWall(spec) }, needs: [] }
  if (spec.kind === 'color') return { wall: { key: `c${spec.color}`, ...colorWall(spec.color) }, needs: [] }
  const fromKey = (key) => {
    const derived = walls.derived(key)
    return derived === undefined ? null : { key, ...imageWall(`${WALL_API}/blur/${key}.jpg`, derived) }
  }
  const fileItem = (id) => ({ key: id, src: `${WALL_API}/file/${id}` })
  if (spec.kind === 'image') {
    const wall = fromKey(spec.id)
    return { wall, needs: wall === null ? [fileItem(spec.id)] : [] }
  }
  const items = spec.kind === 'rotate' ? spec.items.map((item) => fileItem(item.id)) : walls.folder(spec.path).map((item) => ({ key: item.key, src: `${WALL_API}/folder/${encodeURIComponent(item.name)}` }))
  if (items.length === 0) return { wall: null, needs: [] }
  const current = items[indexAt(spec, items.length, now)]
  const next = items[indexAt(spec, items.length, nextChange(spec, now))]
  const wall = fromKey(current.key)
  const needs = [current, next].filter((item, i, list) => list.findIndex((other) => other.key === item.key) === i && walls.derived(item.key) === undefined)
  if (wall !== null) return { wall, needs }
  // 这张还没分析好：先用一张分析好的顶着，分析完再换
  for (const item of items.slice(0, 50)) {
    const fallback = fromKey(item.key)
    if (fallback !== null) return { wall: fallback, needs }
  }
  return { wall: null, needs }
}

/**
 * 记住上一次的计算结果：每个页面加载都会走这里，不需要每次都重算。
 * @param {WallpaperStore} walls 壁纸文件
 * @param {() => number} [now] 时钟
 * @returns {(doc: import('../shared/state.js').Doc) => {layer: ReturnType<typeof resolveLayer>, needs: {key: string, src: string}[]}} 带缓存的计算函数
 */
function layerResolver(walls, now = Date.now) {
  let lastKey
  let lastLayer
  return (doc) => {
    const values = docValues(doc)
    const { wall, needs } = currentWall(values, walls, now())
    const key = JSON.stringify([values.theme, values.custom, values.adjust, values.overrides, values.glass, values.radius, wall?.key ?? null, wall?.samples ?? null])
    if (key !== lastKey) {
      lastLayer = resolveLayer(values, wall)
      lastKey = key
    }
    return { layer: lastLayer, needs }
  }
}

/** 这个部署允许的非本机地址。两代宿主放的位置不一样，都走 `ctx.get()`（没 inject 的服务直接访问会抛错）。 */
function trustedAuthorities(ctx) {
  const startup = ctx.get('webStartup')
  if (startup !== undefined && startup !== null) return startup.trustedHosts ?? []
  const runtime = ctx.get('webRuntime')
  if (runtime !== undefined && runtime !== null) return runtime.trustedHosts ?? []
  return []
}

const authorityUrl = (authority) => {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

const isLoopback = (hostname) => hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)

/**
 * 只放行本机或受信地址上的同源请求。
 * @param {import('node:http').IncomingMessage} req 请求
 * @param {readonly string[]} trusted 受信地址
 * @returns {boolean} 是否放行
 */
export function isTrustedRequest(req, trusted) {
  const host = typeof req.headers.host === 'string' ? authorityUrl(req.headers.host) : undefined
  if (host === undefined) return false
  const known = isLoopback(host.hostname) || trusted.some((entry) => {
    const url = authorityUrl(entry)
    return url !== undefined && (url.port === '' ? url.hostname === host.hostname : url.host === host.host)
  })
  if (!known) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host.host
  } catch {
    return false
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/**
 * @param {import('node:http').IncomingMessage} req 请求
 * @param {number} limit 上限
 * @returns {Promise<Buffer>} 请求体；超限时 reject 且错误码为 `too-large`
 */
function readBytes(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('请求体太大'), { code: 'too-large' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** @returns {Promise<unknown>} JSON 请求体；解析失败时错误码为 `bad-json` */
async function readJson(req, limit = MAX_BODY_BYTES) {
  const bytes = await readBytes(req, limit)
  try {
    return bytes.length === 0 ? {} : JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw Object.assign(error, { code: 'bad-json' })
  }
}

/**
 * 替用户下载链接里的图：图片要在画布上模糊、取色，跨域图会污染画布，所以经 host 中转。
 * 只认 http/https，有大小和时间上限，文件头不是图片就不存。
 * @param {string} url 地址
 * @returns {Promise<Buffer>} 文件内容
 */
export async function downloadImage(url) {
  let target
  try {
    target = new URL(url)
  } catch {
    throw Object.assign(new Error('链接不对'), { code: 'bad-url' })
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw Object.assign(new Error('只支持 http/https'), { code: 'bad-url' })
  const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => undefined)
  if (response === undefined || !response.ok || response.body === null) throw Object.assign(new Error('下载失败'), { code: 'download-failed' })
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > IMAGE_MAX_BYTES) throw Object.assign(new Error('图片太大'), { code: 'too-large' })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** 把一个文件发给浏览器。内容按 id 不变的文件可以长期缓存。 */
async function sendFile(res, path, type, cache) {
  res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'x-content-type-options': 'nosniff' })
  await pipeline(createReadStream(path), res)
}

const IMMUTABLE = 'public, max-age=31536000, immutable'

/** 处理 `/prism-skin/api/wallpaper/*`。 */
async function handleWallpaper(req, res, path, { store, walls }) {
  const rest = path.slice(WALL_API.length + 1).split('/')
  const [action, arg] = rest
  const missing = () => sendJson(res, 404, { ok: false, code: 'not-found' })
  if (req.method === 'POST') {
    let body
    try {
      if (action === 'upload' && rest.length === 1) {
        const saved = walls.saveImage(await readBytes(req, IMAGE_MAX_BYTES))
        return saved === undefined ? sendJson(res, 415, { ok: false, code: 'not-an-image' }) : sendJson(res, 200, { ok: true, ...saved })
      }
      if (action === 'fetch' && rest.length === 1) {
        body = await readJson(req)
        const saved = walls.saveImage(await downloadImage(String(body?.url ?? '')))
        return saved === undefined ? sendJson(res, 415, { ok: false, code: 'not-an-image' }) : sendJson(res, 200, { ok: true, ...saved })
      }
      if (action === 'derived' && rest.length === 2) {
        body = await readJson(req)
        return walls.saveDerived(arg, body) ? sendJson(res, 200, { ok: true }) : sendJson(res, 400, { ok: false, code: 'bad-derived' })
      }
    } catch (error) {
      const code = typeof error?.code === 'string' ? error.code : 'internal'
      const status = code === 'too-large' ? 413 : code === 'bad-json' || code === 'bad-url' ? 400 : code === 'download-failed' ? 502 : 500
      if (status === 500) throw error
      return sendJson(res, status, { ok: false, code })
    }
    return missing()
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
  if (rest.length !== 2) return missing()
  if (action === 'file') {
    const image = walls.image(arg)
    return image === undefined ? missing() : sendFile(res, image.path, image.type, IMMUTABLE)
  }
  if (action === 'blur') {
    const blur = walls.blurPath(arg.replace(/\.jpg$/, ''))
    const known = blur !== undefined && walls.derived(arg.replace(/\.jpg$/, '')) !== undefined
    return known ? sendFile(res, blur, 'image/jpeg', IMMUTABLE) : missing()
  }
  if (action === 'derived') {
    const derived = walls.derived(arg)
    return derived === undefined ? missing() : sendJson(res, 200, { ok: true, ...derived })
  }
  if (action === 'folder') {
    // 只认存档里选定的那个文件夹，请求里传不了路径
    const spec = docValues(store.read()).wallpaper
    if (spec?.kind !== 'folder') return missing()
    let fileName
    try {
      fileName = decodeURIComponent(arg)
    } catch {
      return missing()
    }
    const file = walls.folderFile(spec.path, fileName)
    return file === undefined ? missing() : sendFile(res, file, 'application/octet-stream', 'no-store')
  }
  return missing()
}

/**
 * 只接受认识的键，值清洗后才落盘；时间戳和写入方沿用客户端给的。
 * @param {unknown} raw 请求里的补丁
 * @returns {Record<string, import('../shared/state.js').KeyEntry>} 干净的补丁
 */
export function sanitizePatch(raw) {
  /** @type {Record<string, import('../shared/state.js').KeyEntry>} */
  const patch = {}
  if (raw === null || typeof raw !== 'object') return patch
  for (const [key, entry] of Object.entries(raw)) {
    if (!WRITABLE_KEYS.has(key) || entry === null || typeof entry !== 'object') continue
    const { t, by, v } = /** @type {import('../shared/state.js').KeyEntry} */ (entry)
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    const clean = normalizeValues({ [key]: v })[key]
    Object.assign(patch, stampPatch({ [key]: clean }, t, typeof by === 'string' ? by.slice(0, 64) : 'unknown'))
  }
  return patch
}

/**
 * 处理一次 API 请求。
 * @param {import('node:http').IncomingMessage} req 请求
 * @param {import('node:http').ServerResponse} res 响应
 * @param {{store: StateStore, walls: WallpaperStore, layerOf: ReturnType<typeof layerResolver>, dreamFile?: string}} deps 依赖
 */
export async function handleApi(req, res, deps) {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path.startsWith(`${WALL_API}/`)) return handleWallpaper(req, res, path, deps)
  // dream-skin 迁移：只读它的设置文件；图片直接存进棱镜自己的壁纸目录
  if (path === `${API_PREFIX}/dream-skin` && deps.dreamFile !== undefined) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
    return sendJson(res, 200, { ok: true, ...readDreamSettings(deps.dreamFile) })
  }
  if (path === `${API_PREFIX}/dream-skin/wallpaper` && deps.dreamFile !== undefined) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
    const bytes = readDreamImage(deps.dreamFile)
    const saved = bytes === undefined ? undefined : deps.walls.saveImage(bytes)
    return saved === undefined ? sendJson(res, 404, { ok: false, code: 'no-image' }) : sendJson(res, 200, { ok: true, ...saved })
  }
  if (path !== `${API_PREFIX}/state`) return sendJson(res, 404, { ok: false, code: 'not-found' })
  if (req.method === 'GET') {
    const doc = deps.store.read()
    const { layer, needs } = deps.layerOf(doc)
    return sendJson(res, 200, { ok: true, version: VERSION, doc, layer: packLayer(layer), needs })
  }
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
  let body
  try {
    body = await readJson(req)
  } catch (error) {
    const code = error?.code === 'too-large' ? 'too-large' : 'bad-json'
    return sendJson(res, code === 'too-large' ? 413 : 400, { ok: false, code })
  }
  const { doc, changed } = deps.store.merge(sanitizePatch(/** @type {any} */ (body)?.patch))
  return sendJson(res, 200, { ok: true, doc, changed })
}

/**
 * host 半入口。
 * @param {any} ctx cordis 上下文
 */
export function apply(ctx) {
  const statePath = defaultStatePath()
  const store = new StateStore(statePath)
  const walls = new WallpaperStore(join(dirname(statePath), 'wallpapers'))
  const layerOf = layerResolver(walls)
  const dreamFile = dreamPath(statePath)

  ctx.on('webserver/index-inject', (table) => {
    // 任何异常都不能挡住页面渲染：顶多这次没有首屏注入，客户端会自己再取一次
    try {
      const doc = store.read()
      table.push(...bootRows({ doc, layer: layerOf(doc).layer, version: VERSION, css: docValues(doc).css }))
    } catch (error) {
      console.warn('[dsh-prism-skin] 首屏注入失败：', error)
    }
  })

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          try {
            if (!isTrustedRequest(req, trustedAuthorities(ctx))) return sendJson(res, 403, { ok: false, code: 'forbidden' })
            await handleApi(req, res, { store, walls, layerOf, dreamFile })
          } catch (error) {
            console.error('[dsh-prism-skin] 接口出错：', error)
            if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'internal' })
          }
        },
      }),
    'dsh-prism-skin:routes',
  )
}
