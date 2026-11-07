/**
 * 壁纸文件：host 半负责存（Desktop 端口随机、页面存储不可靠，不能只放浏览器里）。
 *
 *   wallpapers/<id>.<扩展名>   原图（用户上传，或者替用户从链接下载的）
 *   wallpapers/<id>.blur.jpg   预先模糊好的小图，界面背景用的就是它
 *   wallpapers/<id>.json       分析结果：底色、明暗极值、主色
 *
 * 图片解码和模糊都在浏览器里做（host 没有图像库），做完把结果交回来存。
 * id 是内容哈希，同一张图只存一份。文件夹轮播的图不复制，只存分析结果。
 */
import { createHash, randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 单张原图上限。 */
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024
const BLUR_MAX_BYTES = 256 * 1024
const FOLDER_MAX_ITEMS = 500
const FOLDER_TTL_MS = 5000
const ID = /^[a-f0-9]{16,64}$/
const HEX6 = /^#[0-9a-f]{6}$/i
const FOLDER_EXT = /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i
const NAME_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** 只认文件头，不信扩展名和 content-type。 */
const SIGNATURES = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'gif', type: 'image/gif', test: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  { ext: 'webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { ext: 'avif', type: 'image/avif', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(avif|avis)$/.test(b.subarray(8, 12).toString('latin1')) },
  { ext: 'bmp', type: 'image/bmp', test: (b) => b.subarray(0, 2).toString('latin1') === 'BM' },
]

/**
 * @param {Buffer} bytes 文件内容
 * @returns {{ext: string, type: string} | undefined} 图片类型；不是认识的图片时为 undefined
 */
export const sniffImage = (bytes) => SIGNATURES.find((row) => bytes.length > 12 && row.test(bytes))

const isHex = (value) => typeof value === 'string' && HEX6.test(value)

/**
 * 清洗客户端交回来的分析结果：这些值会进 CSS，只留严格格式的颜色和数字。
 * @param {any} raw 请求体
 * @returns {{base: string, dock?: string, samples: string[], palette: object[], width: number, height: number, blur: Buffer} | undefined} 合法结果
 */
export function normalizeDerived(raw) {
  if (raw === null || typeof raw !== 'object' || !isHex(raw.base) || !Array.isArray(raw.samples) || typeof raw.blur !== 'string') return undefined
  const samples = raw.samples.filter(isHex).slice(0, 12).map((hex) => hex.toLowerCase())
  if (samples.length === 0 || raw.blur.length > BLUR_MAX_BYTES * 2) return undefined
  const blur = Buffer.from(raw.blur, 'base64')
  if (blur.length === 0 || blur.length > BLUR_MAX_BYTES || sniffImage(blur)?.ext !== 'jpg') return undefined
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const palette = (Array.isArray(raw.palette) ? raw.palette : [])
    .slice(0, 8)
    .filter((row) => row !== null && typeof row === 'object' && isHex(row.hex))
    .map((row) => ({ hex: row.hex.toLowerCase(), l: number(row.l), c: number(row.c), h: number(row.h), weight: number(row.weight) }))
  return { base: raw.base.toLowerCase(), ...(isHex(raw.dock) ? { dock: raw.dock.toLowerCase() } : {}), samples, palette, width: Math.round(number(raw.width)), height: Math.round(number(raw.height)), blur }
}

/** 壁纸文件目录。 */
export class WallpaperStore {
  /** @param {string} dir 目录 */
  constructor(dir) {
    this.dir = dir
    this.folderCache = undefined
  }

  /** 原子写，权限 0600。 */
  write(name, bytes) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const temp = join(this.dir, `.${name}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      writeFileSync(temp, bytes, { mode: 0o600 })
      renameSync(temp, join(this.dir, name))
    } catch (error) {
      rmSync(temp, { force: true })
      throw error
    }
  }

  /**
   * 存一张原图。
   * @param {Buffer} bytes 文件内容
   * @returns {{id: string, type: string} | undefined} 结果；不是图片时为 undefined
   */
  saveImage(bytes) {
    const kind = sniffImage(bytes)
    if (kind === undefined || bytes.length > IMAGE_MAX_BYTES) return undefined
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    this.write(`${id}.${kind.ext}`, bytes)
    return { id, type: kind.type }
  }

  /**
   * @param {string} id 图片 id
   * @returns {{path: string, type: string} | undefined} 原图位置
   */
  image(id) {
    if (!ID.test(id)) return undefined
    for (const { ext, type } of SIGNATURES) {
      const path = join(this.dir, `${id}.${ext}`)
      try {
        if (lstatSync(path).isFile()) return { path, type }
      } catch {
        // 换下一个扩展名
      }
    }
    return undefined
  }

  /**
   * @param {string} id 图片 id
   * @returns {string | undefined} 模糊图路径
   */
  blurPath(id) {
    return ID.test(id) ? join(this.dir, `${id}.blur.jpg`) : undefined
  }

  /**
   * @param {string} id 图片 id
   * @returns {{base: string, samples: string[], palette: object[], width: number, height: number} | undefined} 分析结果；没有时为 undefined
   */
  derived(id) {
    if (!ID.test(id)) return undefined
    try {
      return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8'))
    } catch {
      return undefined
    }
  }

  /**
   * 存分析结果。
   * @param {string} id 图片 id
   * @param {unknown} raw 请求体
   * @returns {boolean} 是否存下
   */
  saveDerived(id, raw) {
    const clean = normalizeDerived(raw)
    if (clean === undefined || !ID.test(id)) return false
    const { blur, ...stats } = clean
    this.write(`${id}.blur.jpg`, blur)
    this.write(`${id}.json`, JSON.stringify(stats))
    return true
  }

  /**
   * 列出文件夹里的图片（不递归、不跟符号链接）。列一次缓存几秒：每个页面加载都会走到这里。
   * @param {string} path 文件夹
   * @returns {{name: string, key: string}[]} 图片，按文件名自然排序
   */
  folder(path) {
    const now = Date.now()
    if (this.folderCache?.path === path && now - this.folderCache.at < FOLDER_TTL_MS) return this.folderCache.items
    const items = []
    try {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (items.length >= FOLDER_MAX_ITEMS) break
        if (!entry.isFile() || !FOLDER_EXT.test(entry.name)) continue
        const stat = lstatSync(join(path, entry.name))
        if (stat.size > IMAGE_MAX_BYTES) continue
        const key = createHash('sha256').update(`${path}\0${entry.name}\0${stat.size}\0${stat.mtimeMs}`).digest('hex').slice(0, 32)
        items.push({ name: entry.name, key })
      }
    } catch {
      // 文件夹不存在或没权限：当作空的
    }
    items.sort((a, b) => NAME_ORDER.compare(a.name, b.name))
    this.folderCache = { path, at: now, items }
    return items
  }

  /**
   * @param {string} path 文件夹
   * @param {string} name 文件名
   * @returns {string | undefined} 文件路径。只认列表里有的名字，所以路径穿越走不通
   */
  folderFile(path, name) {
    return this.folder(path).some((item) => item.name === name) ? join(path, name) : undefined
  }
}
