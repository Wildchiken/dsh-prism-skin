#!/usr/bin/env node
/**
 * 主题文件体检：主题自带的 CSS 里，依赖宿主结构的选择器（类名片段、data-*、role）在真宿主里还能不能匹配到元素。
 * DSH 升级后先跑一遍，就知道哪些框体会失效、要不要更新主题文件。
 *
 * 用法：node scripts/check-theme.mjs --host <装了 @deepseek-ai/dsh 的目录> --theme themes/cyberpunk-hud.json [--port 18765]
 *
 * 会依次打开对话页、设置窗、斜杠菜单、模型菜单，每个选择器只要在其中一处匹配到就算通过。
 * 宿主跑在隔离的临时环境里（临时 DSH_HOME、主目录、时区），用本机假模型，不联网。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildAll } from './build.mjs'
import { launchChrome } from './lib/cdp.mjs'
import { dismissOnboarding, installPlugin, makeHome, startServer } from './lib/host.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'

const { values: args } = parseArgs({ options: { host: { type: 'string' }, theme: { type: 'string' }, port: { type: 'string', default: '18765' } } })
if (args.host === undefined || args.theme === undefined) {
  console.error('用法：node scripts/check-theme.mjs --host <宿主目录> --theme <主题文件>')
  process.exit(2)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const theme = JSON.parse(readFileSync(resolve(args.theme), 'utf8'))
const css = typeof theme.css === 'string' ? theme.css : ''
// 只看依赖宿主结构的部分；data-ds-dark-theme、data-platform、data-prism-* 是宿主或棱镜自己固定的标记，不算
const SELECTOR = /\[class\*=[^\]]+\]|\[data-(?!ds-dark-theme|platform|prism-)[a-z-]+(?:=(?:"[^"]*"|[^\]]+))?\]|\[role=[a-z]+\]|\.md-code-block/g
const selectors = [...new Set(css.match(SELECTOR) ?? [])].sort()
if (selectors.length === 0) {
  console.log(`「${theme.name ?? args.theme}」没有依赖宿主结构的选择器，不用检查。`)
  process.exit(0)
}

await buildAll()
const port = Number(args.port)
const home = makeHome('check-theme')
installPlugin(resolve(args.host), home)
// 斜杠菜单里的「技能」分组只有装了技能才出现：在隔离的临时主目录里放一个演示技能
const skill = join(home, 'home', '.agents', 'skills', 'prism-demo')
mkdirSync(skill, { recursive: true })
writeFileSync(join(skill, 'SKILL.md'), '---\nname: prism-demo\ndescription: Demo skill for checking theme selectors.\n---\n\nDemo.\n')
const mock = await startMockLlm(port + 1)
const server = await startServer(resolve(args.host), home, port, { DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' })
const browser = await launchChrome()
const found = new Set()
const collect = async (where) => {
  const hits = await page.evaluate((list) => list.filter((sel) => document.querySelector(sel) !== null), selectors)
  for (const sel of hits) found.add(sel)
  console.log(`  ${where}：匹配 ${hits.length} 个`)
}
const key = async (name, code, keyCode) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode })
}

let page
try {
  page = await browser.newPage()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
  await page.goto(server.url)
  await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏' })
  await sleep(800)
  await dismissOnboarding(page)
  await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
  await page.send('Input.insertText', { text: '帮我看看这段配色代码，顺便给个示例。' })
  await key('Enter', 'Enter', 13)
  await page.waitFor(`document.querySelector('.md-code-block') !== null`, { timeout: 90000, label: '回复' })
  await sleep(600)
  console.log(`检查「${theme.name ?? args.theme}」里的 ${selectors.length} 个宿主选择器：`)
  await collect('对话页')

  // 设置窗（通用设置页有开关）
  await page.evaluate(() => document.querySelector('[data-slot="settings.launcher"] button')?.click())
  await sleep(400)
  await page.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menu] button')].find((b) => /^(Settings|设置)/.test(b.textContent.trim()))?.click())
  await page.waitFor(`document.querySelector('[role=dialog][aria-modal]') !== null`, { timeout: 15000, label: '设置窗' })
  await sleep(500)
  await collect('设置窗')
  await key('Escape', 'Escape', 27)
  await sleep(400)

  // 斜杠菜单
  await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
  await page.send('Input.insertText', { text: '/' })
  await sleep(800)
  await key('ArrowDown', 'ArrowDown', 40)
  await sleep(200)
  await collect('斜杠菜单')
  await key('Escape', 'Escape', 27)
  await key('Backspace', 'Backspace', 8)
  await sleep(300)

  // 模型菜单
  await page.evaluate(() => document.querySelector('[data-slot="conversation.input.model"] button, button[aria-label^="Select model"], button[aria-label^="选择模型"]')?.click())
  await sleep(600)
  await page.evaluate(() => document.querySelector('[role=menuitem]')?.focus())
  await sleep(200)
  await collect('模型菜单')
  await key('Escape', 'Escape', 27)
} finally {
  await browser.close()
  await server.stop()
  await mock.close?.()
  rmSync(home, { recursive: true, force: true })
}

const missing = selectors.filter((sel) => !found.has(sel))
for (const sel of selectors) console.log(`${found.has(sel) ? '✓' : '✗'} ${sel}`)
if (missing.length === 0) {
  console.log(`\n全部匹配（${selectors.length} 个）：这个宿主版本上主题框体都能生效。`)
} else {
  console.log(`\n${missing.length} 个选择器没匹配到：宿主结构变了，相关框体会失效（配色不受影响），需要更新主题文件。`)
  process.exitCode = 1
}
process.exit()
