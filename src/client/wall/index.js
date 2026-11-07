/**
 * 懒加载分块：壁纸的上传、下载和分析。只有用户设壁纸、或者轮播遇到没分析过的图时才加载。
 *
 * 模糊只做一次：把图缩到很小再模糊，存成一张几 KB 的 JPEG，之后界面只显示这张，
 * 不需要实时 backdrop-filter。
 */
import { analyze, boxBlur } from './process.js'

const API = '/prism-skin/api/wallpaper'
/** 模糊图的长边。放大显示时浏览器的插值正好再柔化一次。 */
const BLUR_SIZE = 384
const BLUR_RADIUS = 10
const JPEG_QUALITY = 0.82

async function parse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok !== true) throw Object.assign(new Error(body.code ?? `HTTP ${response.status}`), { code: body.code ?? 'failed' })
  return body
}

/**
 * 把一张图解码、缩小、模糊、分析。
 * @param {Blob} blob 图片
 * @returns {Promise<object>} 交给 host 存的结果
 */
export async function derive(blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = BLUR_SIZE / Math.max(bitmap.width, bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    boxBlur(image.data, width, height, BLUR_RADIUS)
    context.putImageData(image, 0, 0)
    const stats = analyze(image.data, width, height)
    return { ...stats, width, height, blur: canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] }
  } finally {
    bitmap.close()
  }
}

/**
 * 分析一张 host 上的图，结果存回 host。
 * @param {{key: string, src: string}} item 图
 * @returns {Promise<object>} 分析结果
 */
export async function processItem({ key, src }) {
  const response = await fetch(src)
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'read-failed' })
  const derived = await derive(await response.blob())
  await parse(await fetch(`${API}/derived/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(derived) }))
  return derived
}

/**
 * 依次分析 host 点名的图。一张失败不影响下一张（比如文件夹里混了解不开的格式）。
 * @param {{key: string, src: string}[]} needs 待分析的图
 * @returns {Promise<number>} 成功几张
 */
export async function processNeeds(needs) {
  let done = 0
  for (const item of needs) {
    try {
      await processItem(item)
      done += 1
    } catch (error) {
      console.warn('[dsh-prism-skin] 壁纸分析失败：', item.src, error)
    }
  }
  return done
}

const prepared = async (id) => {
  const derived = await processItem({ key: id, src: `${API}/file/${id}` })
  return { id, derived }
}

/**
 * 上传本地图片并分析。
 * @param {File | Blob} file 文件
 * @returns {Promise<{id: string, derived: object}>} 结果
 */
export async function addFile(file) {
  const { id } = await parse(await fetch(`${API}/upload`, { method: 'POST', body: file }))
  return prepared(id)
}

/**
 * 让 host 下载链接里的图并分析。
 * @param {string} url 链接
 * @returns {Promise<{id: string, derived: object}>} 结果
 */
export async function addUrl(url) {
  const { id } = await parse(await fetch(`${API}/fetch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }))
  return prepared(id)
}

/**
 * @param {string} key 图的 id
 * @returns {Promise<object>} host 存的分析结果
 */
export const readDerived = async (key) => parse(await fetch(`${API}/derived/${key}`))
