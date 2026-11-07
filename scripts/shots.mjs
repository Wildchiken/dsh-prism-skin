#!/usr/bin/env node
/**
 * 真宿主截图：每套主题的亮暗两种都截一张，存到 docs/screenshots/。
 *
 * 用法：node scripts/shots.mjs --host <装了 @deepseek-ai/dsh 的目录> [--themes a,b] [--out 目录] [--scale 1] [--locale zh-CN] [--extras] [--wallpapers] [--p3]
 *
 * 用本机假模型跑一段真实对话（不联网），所以截到的是宿主真正渲染出来的正文和代码块。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildAll } from './build.mjs'
import { launchChrome } from './lib/cdp.mjs'
import { paintWallpaper } from './lib/fixtures.mjs'
import { dismissOnboarding, installPlugin, makeHome, openPrismSettings, ROOT, startServer } from './lib/host.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'
import { THEMES } from '../src/engine/index.js'

const { values: args } = parseArgs({
  options: {
    host: { type: 'string' },
    themes: { type: 'string' },
    out: { type: 'string' },
    scale: { type: 'string', default: '1' },
    port: { type: 'string', default: '18771' },
    extras: { type: 'boolean', default: false },
    locale: { type: 'string', default: 'zh-CN' },
    wallpapers: { type: 'boolean', default: false },
    p3: { type: 'boolean', default: false },
  },
})
if (args.host === undefined) {
  console.error('用法：node scripts/shots.mjs --host <宿主目录> [--themes a,b] [--out 目录] [--scale 1]')
  process.exit(2)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const outDir = resolve(args.out ?? join(ROOT, 'docs/screenshots'))
const wanted = args.themes?.split(',') ?? (args.wallpapers || args.p3 ? [] : THEMES.map((theme) => theme.id))
mkdirSync(outDir, { recursive: true })

await buildAll()
const home = makeHome('shots')
installPlugin(resolve(args.host), home)
const mock = await startMockLlm(Number(args.port) + 1)
const server = await startServer(resolve(args.host), home, Number(args.port), { DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' })
const browser = await launchChrome()

/** 直接写 host 设置文件的接口：和客户端保存走同一条路。 */
async function setTheme(id, wallpaper = null, glass = null) {
  const t = Date.now()
  const entry = (v) => ({ v, t, by: 'shots' })
  const response = await fetch(`${server.origin}/prism-skin/api/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patch: { theme: entry(id), custom: entry(null), adjust: entry({}), overrides: entry({}), wallpaper: entry(wallpaper), glass: entry(glass) } }),
  })
  if (!response.ok) throw new Error(`写设置失败：${response.status}`)
}

/** 写任意几个键（P3 截图用）。 */
async function setKeys(values) {
  const t = Date.now()
  const patch = Object.fromEntries(Object.entries(values).map(([key, v]) => [key, { v, t, by: 'shots' }]))
  const response = await fetch(`${server.origin}/prism-skin/api/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) })
  if (!response.ok) throw new Error(`写设置失败：${response.status}`)
}

try {
  const page = await browser.newPage()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: Number(args.scale), mobile: false })
  // 界面语言：宿主没有显式选择时跟浏览器走
  await page.send('Emulation.setLocaleOverride', { locale: args.locale })
  await page.send('Network.setUserAgentOverride', { userAgent: await page.evaluate(() => navigator.userAgent), acceptLanguage: args.locale })
  await page.goto(server.url)
  await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏按钮' })
  await sleep(1200)
  await dismissOnboarding(page)

  // 跑一段对话，之后每次重新加载都从 URL 回到它
  await page.waitFor(`document.querySelector('[contenteditable=true]') !== null`, { timeout: 30000, label: '输入框' })
  await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
  await page.send('Input.insertText', { text: '帮我看看这段配色代码，顺便给个示例。' })
  await sleep(300)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.waitFor(`document.body.innerText.includes('示例回复') && document.querySelector('pre, code') !== null && !document.body.innerText.includes('Deep diving')`, { timeout: 90000, label: '模型回复' })
  await sleep(600)
  const sessionUrl = await page.evaluate(() => location.href)

  for (const id of wanted) {
    for (const scheme of ['light', 'dark']) {
      await setTheme(id)
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await page.goto(sessionUrl)
      await page.waitFor(`document.querySelector('[data-prism-quick]') !== null && document.body.innerText.includes('示例回复')`, { timeout: 45000, label: `${id}/${scheme} 对话` })
      await sleep(900)
      await page.screenshot(join(outDir, `${id}-${scheme}.png`))
      console.log(`✓ ${id}-${scheme}`)
    }
  }

  // 壁纸：图片、渐变、纯色各亮暗一张；再来一组取色前后
  if (args.wallpapers) {
    const upload = async (bytes) => (await (await fetch(`${server.origin}/prism-skin/api/wallpaper/upload`, { method: 'POST', body: bytes })).json()).id
    const lagoon = await upload(await paintWallpaper(page, 'lagoon'))
    const bloom = await upload(await paintWallpaper(page, 'bloom'))
    const show = async (theme, wallpaper, scheme, ready) => {
      await setTheme(theme, wallpaper)
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await page.goto(sessionUrl)
      await page.waitFor(`document.querySelector('[data-prism-quick]') !== null && document.body.innerText.includes('示例回复') && ${ready}`, { timeout: 60000, label: `壁纸 ${scheme}` })
      await sleep(900)
    }
    const hasBlur = `document.body.style.getPropertyValue('--dsw-alias-bg-base').includes('/wallpaper/blur/')`
    const sets = [
      ['image', 'seasalt', { kind: 'image', id: lagoon }, hasBlur],
      ['gradient', 'iris', { kind: 'gradient', stops: ['#2b1d4f', '#7a3b69', '#e0886a'], angle: 150 }, `document.body.style.getPropertyValue('--dsw-alias-bg-base').includes('linear-gradient')`],
      ['solid', 'pine', { kind: 'color', color: '#1e2f2a' }, `/^#/.test(document.body.style.getPropertyValue('--dsw-alias-bg-base'))`],
    ]
    for (const [label, theme, wallpaper, ready] of sets) {
      for (const scheme of ['light', 'dark']) {
        await show(theme, wallpaper, scheme, ready)
        await page.screenshot(join(outDir, `wall-${label}-${scheme}.png`))
        console.log(`✓ wall-${label}-${scheme}`)
      }
    }
    // 取色前后：同一张暖色图，蓝色主题 → 从壁纸取色
    await show('mist', { kind: 'image', id: bloom }, 'dark', hasBlur)
    await page.screenshot(join(outDir, 'extract-before.png'))
    await openPrismSettings(page)
    await page.click('[data-prism-extract]')
    await sleep(800)
    await page.screenshot(join(outDir, 'wall-settings.png'))
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(600)
    await page.screenshot(join(outDir, 'extract-after.png'))
    console.log('✓ 取色前后')
  }

  // 设置页和侧栏面板各截亮暗一张（用第一套主题）
  if (args.extras) {
    for (const scheme of ['light', 'dark']) {
      await setTheme(wanted[0] ?? 'mist')
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await page.goto(sessionUrl)
      await page.waitFor(`document.querySelector('[data-prism-quick]') !== null && document.body.innerText.includes('示例回复')`, { timeout: 45000, label: '对话' })
      await sleep(600)
      await page.click('[data-prism-quick]')
      await page.waitFor(`document.querySelector('[data-prism-panel]') !== null`, { timeout: 15000, label: '侧栏面板' })
      await page.hover(`[data-prism-dot=${wanted[0] ?? 'mist'}]`)
      await sleep(500)
      await page.screenshot(join(outDir, `panel-${scheme}.png`))
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await openPrismSettings(page)
      await sleep(500)
      await page.screenshot(join(outDir, `settings-${scheme}.png`))
      console.log(`✓ 设置页、面板 ${scheme}`)
    }
  }
  // P3：代码配色、字体、高级、导入导出
  if (args.p3) {
    const open = async (theme, scheme, extra = {}) => {
      await setKeys({ theme, custom: null, adjust: {}, overrides: {}, wallpaper: null, glass: null, radius: null, css: '', ...extra })
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await page.goto(sessionUrl)
      await page.waitFor(`document.querySelector('[data-prism-quick]') !== null && document.body.innerText.includes('示例回复')`, { timeout: 45000, label: '对话' })
      await sleep(800)
    }
    const scrollTo = async (selector) => {
      await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), selector)
      await sleep(500)
    }
    await open('abyss', 'dark', { adjust: { code: 'dracula' } })
    await page.screenshot(join(outDir, 'p3-code-dracula-dark.png'))
    await open('mist', 'light', { adjust: { code: 'github' } })
    await openPrismSettings(page)
    await scrollTo('[data-prism-fonts]')
    await page.screenshot(join(outDir, 'p3-fonts-code-light.png'))
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await open('abyss', 'dark', { overrides: { '--dsw-alias-bg-base': { light: '#f7f7f7', dark: '#0e1016' } } })
    await openPrismSettings(page)
    await page.evaluate(() => document.querySelector('[data-prism-open-advanced]').click())
    await page.waitFor(`document.querySelector('[data-prism-var-search]') !== null`, { timeout: 15000, label: '高级' })
    await page.evaluate(() => {
      const input = document.querySelector('[data-prism-var-search]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'bg-base')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(300)
    await page.evaluate(() => document.querySelector('[data-prism-var="--dsw-alias-bg-base"]')?.click())
    await scrollTo('[data-prism-advanced-group]')
    await page.screenshot(join(outDir, 'p3-advanced-dark.png'))
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await open('pine', 'light')
    await openPrismSettings(page)
    await page.evaluate(() => document.querySelector('[data-prism-open-transfer]').click())
    await page.waitFor(`document.querySelector('[data-prism-export-share]') !== null`, { timeout: 15000, label: '导入导出' })
    await page.evaluate(() => document.querySelector('[data-prism-export-share]').click())
    await scrollTo('[data-prism-transfer-group]')
    await page.screenshot(join(outDir, 'p3-transfer-light.png'))
    console.log('✓ P3 截图')
  }
  const problems = page.console.filter((row) => row.type === 'error' || row.type === 'exception')
  if (problems.length > 0) console.log('控制台报错：', problems.slice(0, 5).map((row) => row.text.slice(0, 200)))
} finally {
  await browser.close()
  await server.stop()
  await mock.close()
  rmSync(home, { recursive: true, force: true })
}
