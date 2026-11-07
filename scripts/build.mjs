#!/usr/bin/env node
/**
 * 构建：用 esbuild 把 src/ 打成 lib/index.js（host 半）、lib/client.js（入口）和
 * lib/client.*.js（懒加载分块），并检查体积门。
 *
 * 客户端文件的外层是宿主要求的 `window.__ModuleLoader__.load({id, factory})` 形状；
 * 分块额外带 `chunk` 字段。React 等宿主模块（platform seed）一律 external。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** 体积硬门（字节）。 */
export const LIMITS = {
  entry: 25 * 1024,
  clientTotal: 160 * 1024, // 0.5.0 放宽：主题库界面在按需加载的设置分块里，首屏入口不受影响
  anyFile: 262144,
}

/** 宿主 module table 里提供的模块，不打进包。 */
const SEEDS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']

/** 分块：入口路径 → 产物文件名。文件名必须匹配 `client.*.js`。 */
const CHUNKS = {
  'src/client/studio/index.js': 'client.studio.js',
  'src/client/wall/index.js': 'client.wall.js',
  'src/client/custom/index.js': 'client.custom.js',
}

const define = { __PRISM_VERSION__: JSON.stringify(pkg.version) }

/**
 * 打包一个客户端文件。
 * @param {string} entry 入口源码
 * @param {string | undefined} chunk 分块文件名；入口文件不传
 * @returns {Promise<string>} 可以直接写盘的文本
 */
async function buildClient(entry, chunk) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    external: SEEDS,
    define,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text.trim()
  const head = chunk === undefined ? `id:${JSON.stringify(pkg.name)}` : `id:${JSON.stringify(pkg.name)},chunk:${JSON.stringify(chunk)}`
  return `window.__ModuleLoader__.load({${head},factory:(require)=>{const __HOST_REQUIRE__=require;var module={exports:{}},exports=module.exports;${code}\nreturn module.exports}});\n`
}

/**
 * 打包 host 半。不压缩，出问题时看得懂堆栈。
 * @returns {Promise<string>} 文本
 */
async function buildHost() {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['src/host/index.js'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    legalComments: 'none',
    charset: 'utf8',
    define,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

/**
 * @param {string} [outdir] 输出目录
 * @returns {Promise<{files: Record<string, number>, entry: number, clientTotal: number, failures: string[]}>} 体积结果
 */
export async function buildAll(outdir = join(root, 'lib')) {
  rmSync(outdir, { recursive: true, force: true })
  mkdirSync(outdir, { recursive: true })
  /** @type {Record<string, string>} */
  const outputs = {
    'index.js': await buildHost(),
    'client.js': await buildClient('src/client/entry.js'),
  }
  for (const [entry, fileName] of Object.entries(CHUNKS)) outputs[fileName] = await buildClient(entry, fileName)

  /** @type {Record<string, number>} */
  const files = {}
  for (const [fileName, text] of Object.entries(outputs)) {
    writeFileSync(join(outdir, fileName), text)
    files[fileName] = Buffer.byteLength(text)
  }
  const clientFiles = Object.keys(files).filter((fileName) => fileName.startsWith('client'))
  const clientTotal = clientFiles.reduce((sum, fileName) => sum + files[fileName], 0)
  const failures = []
  if (files['client.js'] > LIMITS.entry) failures.push(`入口 client.js ${files['client.js']} B 超过 ${LIMITS.entry} B`)
  if (clientTotal > LIMITS.clientTotal) failures.push(`客户端合计 ${clientTotal} B 超过 ${LIMITS.clientTotal} B`)
  for (const [fileName, size] of Object.entries(files)) {
    if (size >= LIMITS.anyFile) failures.push(`${fileName} ${size} B 超过单文件上限 ${LIMITS.anyFile} B`)
  }
  return { files, entry: files['client.js'], clientTotal, failures }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { files, clientTotal, failures } = await buildAll()
  for (const [fileName, size] of Object.entries(files)) console.log(`${fileName.padEnd(22)} ${(size / 1024).toFixed(1).padStart(7)} KB`)
  console.log(`${'客户端合计'.padEnd(17)} ${(clientTotal / 1024).toFixed(1).padStart(7)} KB`)
  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`)
    process.exit(1)
  }
}
