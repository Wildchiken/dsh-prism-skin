#!/usr/bin/env node
/**
 * 把 Google 的 material-color-utilities（Apache-2.0）里用到的部分打成一个 ESM 文件：src/vendor/material-color-utilities.js。
 *
 * 这个库发布的 ESM 里 import 不带扩展名，Node 直接跑源码（测试、脚本）时找不到模块，所以先打一份进仓库。
 * 升级版本：改 package.json 里的版本号、npm install，再跑 `node scripts/vendor-mcu.mjs`。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/@material/material-color-utilities/package.json'), 'utf8'))
const NAMES = ['argbFromHex', 'hexFromArgb', 'Hct', 'DynamicScheme', 'DynamicColor', 'MaterialDynamicColors', 'SchemeContent', 'SchemeExpressive', 'SchemeFidelity', 'SchemeFruitSalad', 'SchemeMonochrome', 'SchemeNeutral', 'SchemeRainbow', 'SchemeTonalSpot', 'SchemeVibrant']

const result = await build({
  absWorkingDir: root,
  stdin: { contents: `export { ${NAMES.join(', ')} } from '@material/material-color-utilities'`, resolveDir: root, loader: 'js' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'silent',
})
const head = [
  '// 自动生成，不要手改：node scripts/vendor-mcu.mjs',
  `// material-color-utilities ${pkg.version}（https://github.com/material-foundation/material-color-utilities）`,
  '// Copyright Google LLC. Licensed under the Apache License, Version 2.0; see licenses/material-color-utilities.txt.',
  '',
].join('\n')
const out = join(root, 'src/vendor/material-color-utilities.js')
writeFileSync(out, head + result.outputFiles[0].text)
writeFileSync(join(root, 'licenses/material-color-utilities.txt'), readFileSync(join(root, 'node_modules/@material/material-color-utilities/LICENSE'), 'utf8'))
console.log('写入', out, `${(Buffer.byteLength(head + result.outputFiles[0].text) / 1024).toFixed(1)} KB`)
