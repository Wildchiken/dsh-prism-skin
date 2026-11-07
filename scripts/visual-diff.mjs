#!/usr/bin/env node
/**
 * 前后视觉对比：同一个宿主、同一视口、同一壁纸，分别装两个版本的插件截图，逐像素比较。
 *
 * 用法：node scripts/visual-diff.mjs --host <宿主目录> --before <旧 tgz> --after <新 tgz> --out <目录>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { launchChrome } from './lib/cdp.mjs'
import { paintWallpaper } from './lib/fixtures.mjs'
import { dismissOnboarding, makeHome, startServer } from './lib/host.mjs'
import { startMockLlm } from './lib/mock-llm.mjs'

const { values: args } = parseArgs({ options: { host: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' }, port: { type: 'string', default: '18931' } } })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const out = resolve(args.out)
mkdirSync(out, { recursive: true })
const SCENES = [
  ['lagoon', 0.5, 'dark'],
  ['lagoon', 0.5, 'light'],
  ['lagoon', 1, 'dark'],
  ['valley', 0.5, 'dark'],
  ['valley', 1, 'light'],
]

async function capture(label, tgz, port) {
  const home = makeHome('vis')
  execFileSync(join(resolve(args.host), 'node_modules/.bin/dsh'), ['plugin', '--profile', 'web', 'add', resolve(tgz)], { env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' })
  const mock = await startMockLlm(port + 1)
  const server = await startServer(resolve(args.host), home, port, { DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' })
  const browser = await launchChrome()
  const rects = {}
  try {
    const page = await browser.newPage()
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
    await page.goto(server.url)
    await page.waitFor(`document.querySelector('[contenteditable=true]') !== null`, { timeout: 60000 })
    await dismissOnboarding(page)
    await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
    await page.send('Input.insertText', { text: '示例' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await page.waitFor(`document.body.innerText.includes('示例回复') && !document.body.innerText.includes('Deep diving')`, { timeout: 60000 })
    await sleep(1000)
    const url = await page.evaluate(() => location.href)
    const ids = {}
    for (const name of new Set(SCENES.map(([name]) => name))) {
      ids[name] = (await (await fetch(`${server.origin}/prism-skin/api/wallpaper/upload`, { method: 'POST', body: await paintWallpaper(page, name) })).json()).id
    }
    for (const [name, glass, scheme] of SCENES) {
      const patch = { theme: 'seasalt', wallpaper: { kind: 'image', id: ids[name] }, glass }
      await fetch(`${server.origin}/prism-skin/api/state`, { method: 'POST', body: JSON.stringify({ patch: Object.fromEntries(Object.entries(patch).map(([key, v]) => [key, { v, t: Date.now(), by: 'vis' }])) }) })
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await page.goto(url)
      await page.waitFor(`document.body.innerText.includes('示例回复') && document.body.style.getPropertyValue('--dsw-alias-bg-base').includes('/wallpaper/blur/')`, { timeout: 60000, label: `${label} ${name}` })
      await sleep(1200)
      const key = `${name}-${glass}-${scheme}`
      rects[key] = await page.evaluate(() => {
        const r = document.querySelector('[data-composer-card]')?.getBoundingClientRect()
        return r === undefined ? null : { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      })
      await page.screenshot(join(out, `${key}-${label}.png`))
    }
  } finally {
    await browser.close()
    await server.stop()
    await mock.close()
  }
  return rects
}

const rects = await capture('before', args.before, Number(args.port))
await capture('after', args.after, Number(args.port) + 10)

// 在浏览器里解码两张图、逐像素比较，顺便出一张放大 8 倍的差异图
const browser = await launchChrome()
const rows = []
try {
  const page = await browser.newPage()
  await page.goto('about:blank')
  for (const [name, glass, scheme] of SCENES) {
    const key = `${name}-${glass}-${scheme}`
    const load = (label) => `data:image/png;base64,${readFileSync(join(out, `${key}-${label}.png`)).toString('base64')}`
    const result = await page.evaluate(async (a, b, card) => {
      const decode = async (src) => {
        const image = new Image()
        image.src = src
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [x, y] = await Promise.all([decode(a), decode(b)])
      const diff = new ImageData(x.width, x.height)
      const stat = { all: [0, 0, 0], card: [0, 0, 0] }
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]))
        const px = (i / 4) % x.width
        const py = Math.floor(i / 4 / x.width)
        const inCard = card !== null && px >= card.x && px < card.x + card.w && py >= card.y && py < card.y + card.h
        for (const bucket of inCard ? [stat.all, stat.card] : [stat.all]) {
          bucket[0] += d
          bucket[1] = Math.max(bucket[1], d)
          bucket[2] += 1
        }
        diff.data.set([Math.min(255, d * 8), Math.min(255, d * 8), Math.min(255, d * 8), 255], i)
      }
      const canvas = document.createElement('canvas')
      canvas.width = x.width
      canvas.height = x.height
      canvas.getContext('2d').putImageData(diff, 0, 0)
      const fmt = ([sum, max, n]) => ({ mean: n === 0 ? 0 : sum / n, max })
      return { all: fmt(stat.all), card: fmt(stat.card), png: canvas.toDataURL('image/png').split(',')[1] }
    }, load('before'), load('after'), rects[key])
    writeFileSync(join(out, `${key}-diff.png`), Buffer.from(result.png, 'base64'))
    rows.push(`${key}\t整页平均差 ${result.all.mean.toFixed(3)}/255，最大 ${result.all.max}\t输入框卡片平均差 ${result.card.mean.toFixed(2)}/255，最大 ${result.card.max}`)
  }
} finally {
  await browser.close()
}
console.log(rows.join('\n'))
