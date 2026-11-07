#!/usr/bin/env node
/**
 * 悬停状态前后对比：两个版本的插件，同一主题和壁纸，鼠标停在侧栏会话行上，裁出侧栏左右拼图。
 *
 * 用法：node scripts/hover-shots.mjs --host <宿主目录> --before <旧 tgz> --after <新 tgz> --out <目录>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { launchChrome } from './lib/cdp.mjs'
import { paintWallpaper } from './lib/fixtures.mjs'
import { dismissOnboarding, makeHome, startServer } from './lib/host.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'

const { values: args } = parseArgs({ options: { host: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' }, port: { type: 'string', default: '18961' } } })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const out = resolve(args.out)
mkdirSync(out, { recursive: true })
const CASES = [
  { id: 'seasalt-image-light', theme: 'seasalt', wall: 'lagoon', scheme: 'light' },
  { id: 'iris-gradient-dark', theme: 'iris', wall: { kind: 'gradient', stops: ['#2b1d4f', '#7a3b69', '#e0886a'], angle: 150 }, scheme: 'dark' },
]
const CLIP = { x: 0, y: 0, width: 280, height: 360, scale: 2 }

async function capture(tgz, port) {
  const home = makeHome('hover')
  execFileSync(join(resolve(args.host), 'node_modules/.bin/dsh'), ['plugin', '--profile', 'web', 'add', resolve(tgz)], { env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' })
  const mock = await startMockLlm(port + 1)
  const server = await startServer(resolve(args.host), home, port, { DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' })
  const browser = await launchChrome()
  const shots = {}
  try {
    const page = await browser.newPage()
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
    await page.send('Emulation.setLocaleOverride', { locale: 'zh-CN' })
    await page.send('Network.setUserAgentOverride', { userAgent: await page.evaluate(() => navigator.userAgent), acceptLanguage: 'zh-CN' })
    await page.goto(server.url)
    await page.waitFor(`document.querySelector('[contenteditable=true]') !== null`, { timeout: 60000 })
    await dismissOnboarding(page)
    await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
    await page.send('Input.insertText', { text: '示例' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await page.waitFor(`document.body.innerText.includes('示例回复') && !document.body.innerText.includes('Deep diving')`, { timeout: 60000 })
    const lagoon = (await (await fetch(`${server.origin}/prism-skin/api/wallpaper/upload`, { method: 'POST', body: await paintWallpaper(page, 'lagoon') })).json()).id
    const url = await page.evaluate(() => location.href)
    for (const item of CASES) {
      const wallpaper = item.wall === 'lagoon' ? { kind: 'image', id: lagoon } : item.wall
      const patch = { theme: item.theme, wallpaper, glass: 0.5 }
      await fetch(`${server.origin}/prism-skin/api/state`, { method: 'POST', body: JSON.stringify({ patch: Object.fromEntries(Object.entries(patch).map(([key, v]) => [key, { v, t: Date.now(), by: 'hover' }])) }) })
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: item.scheme }] })
      await page.goto(url)
      await page.waitFor(`document.body.innerText.includes('示例回复') && /linear-gradient|blur/.test(document.body.style.getPropertyValue('--dsw-alias-bg-base'))`, { timeout: 60000, label: item.id })
      await sleep(1500)
      // 鼠标停在侧栏「插件」这一行上
      const box = await page.evaluate(() => {
        const row = [...document.querySelectorAll('button,a,[role=button]')].find((el) => el.textContent.trim() === '插件' && el.getBoundingClientRect().left < 280)
        const rect = row.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
      await sleep(500)
      const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: CLIP })
      shots[item.id] = { data, hover: await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-interactive-bg-hover').trim()) }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 })
    }
  } finally {
    await browser.close()
    await server.stop()
    await mock.close()
  }
  return shots
}

const before = await capture(args.before, Number(args.port))
const after = await capture(args.after, Number(args.port) + 10)
const browser = await launchChrome()
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  for (const item of CASES) {
    const png = await page.evaluate(async (a, b, la, lb) => {
      const load = async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        return image
      }
      const [x, y] = await Promise.all([load(a), load(b)])
      const canvas = document.createElement('canvas')
      canvas.width = x.width * 2 + 24
      canvas.height = x.height + 64
      const c = canvas.getContext('2d')
      c.fillStyle = '#808080'
      c.fillRect(0, 0, canvas.width, canvas.height)
      c.drawImage(x, 0, 64)
      c.drawImage(y, x.width + 24, 64)
      c.fillStyle = '#fff'
      c.font = '600 26px sans-serif'
      c.fillText(la, 12, 42)
      c.fillText(lb, x.width + 36, 42)
      return canvas.toDataURL('image/png').split(',')[1]
    }, before[item.id].data, after[item.id].data, `之前 悬停底色 ${before[item.id].hover}`, `之后 悬停底色 ${after[item.id].hover}`)
    writeFileSync(join(out, `hover-${item.id}.png`), Buffer.from(png, 'base64'))
    console.log(`${item.id}\t悬停底色 ${before[item.id].hover} → ${after[item.id].hover}`)
  }
} finally {
  await browser.close()
}
