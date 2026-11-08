// 取 Material 3 主题用到的 Material Symbols 图标到 .cache/material-symbols（只检出用到的文件，不进仓库）。
// 用法：node themes/src/fetch-symbols.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ICONS } from './material-3-icons.mjs'

const dir = fileURLToPath(new URL('../../.cache/material-symbols', import.meta.url))
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] })
if (!existsSync(`${dir}/.git`)) {
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', 'https://github.com/google/material-design-icons.git', dir], { stdio: 'inherit' })
}
const files = ['/LICENSE', ...new Set(Object.values(ICONS))].map((spec) => {
  if (spec === '/LICENSE') return spec
  const [name, fill] = spec.split(':')
  return `/symbols/web/${name}/materialsymbolsrounded/${name}${fill ? '_fill1' : ''}_24px.svg`
})
git('sparse-checkout', 'set', '--no-cone', ...files)
git('checkout')
console.log(`取到 ${files.length - 1} 个图标：${dir}`)
