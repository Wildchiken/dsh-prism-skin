/**
 * 读 dream-skin 的设置文件（`$DSH_HOME/dream-skin.json`），给迁移用。只读，绝不写它。
 *
 * 那个文件是扁平的字符串表（键和 localStorage 里一样，`dsh-dream-skin:*`），
 * 壁纸图片以 data URL 存在里面，可能有好几 MB，所以接口只回一个标记，图片另走一个接口直接存进棱镜的壁纸目录。
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 迁移会用到的键（去掉前缀）。其余的（收藏、历史、内部记账）不读。 */
export const DREAM_KEYS = ['skin', 'accent', 'packs', 'wallpaper', 'wallpaper-kind', 'wallpaper-url', 'wallpaper-gradient', 'wallpaper-folder', 'wallpaper-rotation', 'wallpaper-refresh']
const PREFIX = 'dsh-dream-skin:'
/** 文件上限：图片 data URL 让它可能很大，再大就不读了。 */
const FILE_MAX_BYTES = 64 * 1024 * 1024
/** 单个值（除图片外）的上限：主题包列表最大，dream-skin 自己每个包限 1MB。 */
const VALUE_MAX_LENGTH = 4 * 1024 * 1024

/**
 * @param {string} statePath 棱镜的存档路径（`$DSH_HOME/dsh-prism-skin/state.json`）
 * @returns {string} dream-skin 设置文件的路径
 */
export const dreamPath = (statePath) => join(dirname(dirname(statePath)), 'dream-skin.json')

/**
 * 读出文件里的原始表。
 * @param {string} path 文件路径
 * @returns {{found: false} | {found: true, tooLarge: true} | {found: true, raw: Record<string, unknown>}} 结果
 */
function readRaw(path) {
  let size
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return { found: false }
    size = stat.size
  } catch {
    return { found: false }
  }
  if (size > FILE_MAX_BYTES) return { found: true, tooLarge: true }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { found: true, raw } : { found: false }
  } catch {
    return { found: false }
  }
}

/**
 * 读 dream-skin 的设置，只留迁移用得到的键；图片换成标记。
 * @param {string} path 文件路径
 * @returns {{found: boolean, tooLarge?: boolean, keys: Record<string, string>, image?: {bytes: number}}} 结果
 */
export function readDreamSettings(path) {
  const result = readRaw(path)
  if (!result.found || 'tooLarge' in result) return { found: result.found, ...('tooLarge' in result ? { tooLarge: true } : {}), keys: {} }
  /** @type {Record<string, string>} */
  const keys = {}
  let image
  for (const name of DREAM_KEYS) {
    const value = result.raw[PREFIX + name]
    if (typeof value !== 'string') continue
    if (name === 'wallpaper') {
      if (value.startsWith('data:image/')) image = { bytes: Math.floor((value.length - value.indexOf(',') - 1) * 0.75) }
      continue
    }
    if (value.length <= VALUE_MAX_LENGTH) keys[name] = value
  }
  return { found: true, keys, ...(image === undefined ? {} : { image }) }
}

/**
 * 取出 dream-skin 设置里的壁纸图片。
 * @param {string} path 文件路径
 * @returns {Buffer | undefined} 图片内容；没有或不是 base64 图片时为 undefined
 */
export function readDreamImage(path) {
  const result = readRaw(path)
  if (!result.found || 'tooLarge' in result) return undefined
  const value = result.raw[`${PREFIX}wallpaper`]
  if (typeof value !== 'string') return undefined
  const match = /^data:image\/[a-z0-9.+-]+;base64,/i.exec(value)
  if (match === null) return undefined
  return Buffer.from(value.slice(match[0].length), 'base64')
}
