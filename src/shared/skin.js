/**
 * 导出成 skin-center 的 v2 皮肤目录（`skin.json` + `skin.css`），打成 zip 给用户下载。
 *
 * 只导出颜色、圆角这类变量和自定义 CSS；不带壁纸（skin-center 的背景要放进皮肤目录的 assets，
 * 而且它禁止外部和跨目录的 url），带玻璃的变量用省电时那套不透明的值，所以导出的皮肤不依赖棱镜。
 */

/** skin-center 的 id 规则。 */
const SKIN_ID = /^[a-z][a-z0-9-]{0,31}$/

/**
 * 把名字变成合法的皮肤 id。
 * @param {string} name 名字
 * @returns {string} id
 */
export function skinId(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const id = `prism-${slug}`.slice(0, 32).replace(/-+$/, '')
  return SKIN_ID.test(id) ? id : 'prism-theme'
}

/**
 * 生成两份文件的文本。
 * @param {{id: string, name: string, nameEn: string, accent: string, version: string, tokens: Record<string, {light: string, dark: string}>, css?: string}} input 内容
 * @returns {{json: string, css: string}} `skin.json` 和 `skin.css`
 */
export function skinCenterFiles({ id, name, nameEn, accent, version, tokens, css = '' }) {
  const manifest = {
    $schema: 'https://schemas.linxin666.org/dsh-skin/v2.json',
    skinManifestVersion: 2,
    id,
    name,
    nameEn,
    version: /^\d+\.\d+\.\d+$/.test(version) ? version : '1.0.0',
    author: 'dsh-prism-skin',
    tagline: '由棱镜导出 · Exported from Prism',
    tags: ['prism'],
    ...(/^#[0-9a-f]{6}$/i.test(accent) ? { accent } : {}),
    contributes: { stylesheet: 'skin.css' },
  }
  let light = ''
  let dark = ''
  for (const name of Object.keys(tokens).sort()) {
    const value = tokens[name]
    // 带 url() 的（壁纸）不导出：skin-center 不接受指向皮肤目录外的地址
    if (/url\(/i.test(value.light) || /url\(/i.test(value.dark) || name.startsWith('--prism-')) continue
    light += `  ${name}: ${value.light};\n`
    dark += `  ${name}: ${value.dark};\n`
  }
  const sheet = `/* ${name} — exported from dsh-prism-skin */\n:root {\n${light}}\n\nbody[data-ds-dark-theme] {\n${dark}}\n${css === '' ? '' : `\n/* 自定义 CSS · custom CSS */\n${css}\n`}`
  return { json: `${JSON.stringify(manifest, null, 2)}\n`, css: sheet }
}

/** CRC-32（zip 用的那种）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** @param {Uint8Array} bytes 内容 @returns {number} CRC-32 */
export function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 打一个不压缩的 zip（文件很小，不值得带压缩代码）。
 * @param {{name: string, text: string}[]} files 文件（路径用 `/` 分隔）
 * @returns {Uint8Array} zip 内容
 */
export function zip(files) {
  const encoder = new TextEncoder()
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.text)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0x0800, true) // 文件名是 UTF-8
    view.setUint16(8, 0, true) // 不压缩
    view.setUint16(12, 0x21, true) // 1980-01-01，日期固定，同样的内容产出同样的字节
    view.setUint32(14, crc, true)
    view.setUint32(18, data.length, true)
    view.setUint32(22, data.length, true)
    view.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + centralSize + 22)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}
