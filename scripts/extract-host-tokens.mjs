#!/usr/bin/env node
/**
 * 从真宿主的 ui-theme 包里抽出全部颜色变量，生成 src/engine/host-tokens.js。
 *
 * 用法：node scripts/extract-host-tokens.mjs <宿主目录> [更新版本的宿主目录...]
 * 宿主目录指装了 @deepseek-ai/dsh 的目录。多个版本取并集，后面的版本优先。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** 这些样式表里声明颜色变量。 */
const SHEETS = ['design_platform_css_default', 'onboarding_css_default', 'gradient_shadow_text_css_default', 'shiki_css_default', 'base_css_default']

/** 不是颜色的变量（阴影、模糊等合成值）。 */
const SKIP = /^--(?:dsw-(?:font|shadow|elevation|mask-blur|menu-backdrop|radius|corner|focus)|dsh-|ds-)/

/**
 * 读出 `var xxx_css_default = "..."` 的 CSS 文本。
 * @param {string} source client.js 源码
 * @param {string} name 变量名
 * @returns {string} CSS
 */
function sheetText(source, name) {
  const at = source.indexOf(`var ${name} = "`)
  if (at < 0) throw new Error(`宿主里找不到样式表 ${name}`)
  const start = at + `var ${name} = `.length
  let end = start + 1
  while (source[end] !== '"') end += source[end] === '\\' ? 2 : 1
  return JSON.parse(source.slice(start, end + 1))
}

/**
 * 解析一层或两层（@supports）的 CSS 规则。
 * @param {string} css CSS 文本
 * @returns {{selector: string, decls: [string, string][]}[]} 规则
 */
function parseRules(css) {
  const rules = []
  const stack = []
  let buffer = ''
  let quote = ''
  for (const ch of css) {
    if (quote !== '') {
      buffer += ch
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
      buffer += ch
    } else if (ch === '{') {
      stack.push(buffer.trim())
      buffer = ''
    } else if (ch === '}') {
      const decls = []
      let depth = 0
      let current = ''
      for (const c of `${buffer};`) {
        if (c === '(') depth += 1
        if (c === ')') depth -= 1
        if (c === ';' && depth === 0) {
          const i = current.indexOf(':')
          if (i > 0) decls.push([current.slice(0, i).trim(), current.slice(i + 1).trim()])
          current = ''
        } else current += c
      }
      rules.push({ selector: stack.join(' >> '), decls })
      stack.pop()
      buffer = ''
    } else buffer += ch
  }
  return rules
}

/**
 * 读一个宿主版本的颜色变量。
 * @param {string} host 宿主目录
 * @returns {Map<string, {light?: string, dark?: string}>} 变量名 → 亮暗公式
 */
function readHost(host) {
  const file = join(host, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js')
  const source = readFileSync(file, 'utf8')
  const tokens = new Map()
  for (const sheet of SHEETS) {
    for (const { selector, decls } of parseRules(sheetText(source, sheet))) {
      const isLight = selector === 'body' || selector === ':root'
      const isDark = selector === 'body[data-ds-dark-theme]'
      if (!isLight && !isDark) continue
      for (const [name, value] of decls) {
        if (!name.startsWith('--') || SKIP.test(name)) continue
        const entry = tokens.get(name) ?? {}
        if (isLight) entry.light = value
        else entry.dark = value
        tokens.set(name, entry)
      }
    }
  }
  return tokens
}

const shorten = (value) => value.replace(/var\(--dsw-([a-z0-9-]+)\)/g, '$$$1').replace(/var\(--(shiki-[a-z0-9-]+)\)/g, '$$--$1')

const hosts = process.argv.slice(2).map((path) => resolve(path))
if (hosts.length === 0) {
  console.error('用法：node scripts/extract-host-tokens.mjs <宿主目录> [更新版本的宿主目录...]')
  process.exit(2)
}

/** @type {Map<string, {light?: string, dark?: string}>} */
const merged = new Map()
for (const host of hosts) for (const [name, entry] of readHost(host)) merged.set(name, entry)

const lines = [...merged.entries()]
  .sort(([a], [b]) => a.localeCompare(b, 'en'))
  .map(([name, entry]) => {
    const light = shorten(entry.light ?? entry.dark)
    const dark = shorten(entry.dark ?? entry.light)
    const label = name.startsWith('--dsw-') ? name.slice(6) : name
    return light === dark ? `${label}=${light}` : `${label}=${light}|${dark}`
  })

const out = `// 生成文件，不要手改。来源：宿主 ui-theme 包的样式表。
// 重新生成：npm run tokens:extract -- <宿主目录>...
// 每行 \`名字=亮色公式|暗色公式\`（亮暗相同时只写一个）；\`$x\` 表示 \`var(--dsw-x)\`。

/** 宿主全部颜色变量的默认公式。 */
export const HOST_TOKEN_TABLE = \`${lines.join('\n')}\`
`
writeFileSync(join(here, '../src/engine/host-tokens.js'), out)
console.log(`写入 ${lines.length} 个变量（${out.length} B）`)
