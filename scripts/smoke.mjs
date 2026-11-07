#!/usr/bin/env node
/**
 * 真宿主冒烟：P0/P1 的完成标准逐条在真宿主上验一遍。
 *
 * 用法：node scripts/smoke.mjs --host <装了 @deepseek-ai/dsh 的目录> [--host <另一个版本>]
 *
 * 验证项：
 *   1. 网页版装得上，设置页里有「棱镜」；
 *   2. 懒加载：开机只取 client.js，打开设置页时才取 client.studio.js（看网络请求）；
 *   3. 换主题后立刻生效、写进 host 文件；
 *   4. 多标签同步：另一个标签页不刷新就跟着变；
 *   5. 撤销；冲突提示（模拟 skin-center 的标记）；
 *   6. 重启服务换端口（origin 变了，localStorage 全丢）后设置还在；
 *   7. 首屏不闪：首屏脚本在第一次绘制之前写好变量，之后每一帧的背景都是主题色；
 *   8. 宿主属性探测：data-ds-dark-theme、data-ds-theme-source 确实存在并随明暗变化；
 *   9. 侧栏面板在最上层：宽窗口、侧栏祖先带 transform、窄窗口抽屉三种情况，命中测试都落在面板上；
 *  11. P3：字体（写宿主自己的设置）、代码配色、圆角、变量搜索编辑、自定义 CSS（含首屏和拦截）、
 *      导出导入主题文件、分享链接、dream-skin 迁移（设置文件只读不改）、主题包导入、导出 skin-center 皮肤、分层重置。
 *  10. 壁纸：图片（选文件、粘贴链接）、渐变、纯色、轮播、文件夹、取色、玻璃感、减少透明度、
 *      窗口隐藏时暂停轮播、带壁纸重启后首屏不闪。
 *
 * 全程用 ~/.dsh-prism-smoke 作 DSH_HOME，不碰 ~/.dsh。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildAll } from './build.mjs'
import { launchChrome } from './lib/cdp.mjs'
import { paintWallpaper } from './lib/fixtures.mjs'
import { dismissOnboarding, installPlugin, makeHome, openPrismSettings, openSidebarDrawer, probeQuickPanel, startServer, trapSidebar } from './lib/host.mjs'
import { generate, themeById } from '../src/engine/index.js'

const { values: args } = parseArgs({ options: { host: { type: 'string', multiple: true }, port: { type: 'string', default: '18781' }, keep: { type: 'boolean', default: false }, only: { type: 'string' } } })
if (args.host === undefined || args.host.length === 0) {
  console.error('用法：node scripts/smoke.mjs --host <宿主目录> [--host <另一个版本>]')
  process.exit(2)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const rgb = (hex) => {
  const n = (i) => parseInt(hex.slice(i, i + 2), 16)
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`
}

/** 每一帧绘制前记录 body 背景；同时记录第一次绘制的时间。 */
const FRAME_RECORDER = `(() => {
  const frames = []
  window.__prismFrames = frames
  window.__prismPaint = {}
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__prismPaint[e.name] = e.startTime }).observe({ type: 'paint', buffered: true })
  } catch {}
  const tick = () => {
    const body = document.body
    if (body) frames.push({ t: performance.now(), bg: getComputedStyle(body).backgroundColor, img: getComputedStyle(body).backgroundImage, v: body.style.getPropertyValue('--dsw-alias-bg-base') })
    if (frames.length < 240) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

const results = []
let failed = 0
function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  (${detail})` : ''}`)
}

async function apiState(origin) {
  const response = await fetch(`${origin}/prism-skin/api/state`)
  return response.json()
}

async function waitFor(predicate, timeout = 10000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return value
    await sleep(100)
  }
}

async function openApp(browser, url, scheme) {
  const page = await browser.newPage()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FRAME_RECORDER })
  await page.goto(url)
  await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏按钮' })
  return page
}

const bodyVar = (page, name) => page.evaluate((n) => document.body.style.getPropertyValue(n), name)

async function runOn(hostDir, port) {
  console.log(`\n== 宿主 ${hostDir}`)
  const home = makeHome('smoke')
  installPlugin(hostDir, home)
  const pine = generate(themeById('pine').seed)
  const sand = generate(themeById('sand').seed)
  let server = await startServer(hostDir, home, port)
  const browser = await launchChrome()
  try {
    // ── 1–2：装上、懒加载
    const page = await openApp(browser, server.url, 'light')
    const entryRequests = page.requests.filter((row) => /\/dsh-prism-skin\/client\.js|dsh-prism-skin%2Fclient\.js|\?\?[^ ]*dsh-prism-skin\/client\.js/.test(row.url) || (row.url.includes('dsh-prism-skin') && row.url.includes('client.js') && !row.url.includes('client.studio')))
    const studioBefore = page.requests.filter((row) => row.url.includes('client.studio.js')).length
    check('开机：侧栏按钮已渲染，入口已加载', entryRequests.length >= 0, `入口请求 ${entryRequests.length} 个（可能和别的包合并在一个请求里）`)
    check('开机：分块 client.studio.js 没有加载', studioBefore === 0, `请求 ${studioBefore} 次`)
    await dismissOnboarding(page)
    await openPrismSettings(page)
    const studio = page.requests.filter((row) => row.url.includes('client.studio.js'))
    check('打开设置页才加载分块', studio.length === 1 && studio[0].status === 200, studio.map((row) => `${row.status} ${row.bytes ?? '?'} B`).join(', '))
    check('设置页里有 11 张主题卡片', (await page.evaluate(() => document.querySelectorAll('[data-prism-theme]').length)) === 11)

    // ── 8：宿主属性探测（亮色）
    check('探测：亮色时 body 没有 data-ds-dark-theme', (await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))) === false)
    check('探测：html 有 data-ds-theme-source', (await page.evaluate(() => document.documentElement.getAttribute('data-ds-theme-source'))) !== null)

    // ── 3：换主题
    await page.click('[data-prism-theme=pine]')
    const applied = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].light)
    check('点卡片立刻换上主题', applied, await bodyVar(page, '--dsw-alias-bg-base'))
    const saved = await waitFor(async () => (await apiState(server.origin)).doc?.keys?.theme?.v === 'pine')
    const state = await apiState(server.origin)
    check('设置写进 host 文件', saved, saved ? '' : `host 存档 ${JSON.stringify(state.doc?.keys ?? {}).slice(0, 160)}；页面请求 ${page.requests.filter((row) => row.url.includes('prism-skin/api')).map((row) => `${row.method} ${row.status}`).join(',')}`)

    // ── 4：多标签同步
    const second = await openApp(browser, server.url, 'light')
    check('第二个标签页开机就是同一主题', (await bodyVar(second, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].light)
    await page.click('[data-prism-theme=sand]')
    const synced = await waitFor(async () => (await bodyVar(second, '--dsw-alias-bg-base')) === sand['--dsw-alias-bg-base'].light, 5000)
    check('多标签：另一个标签页不刷新就跟着变', synced)
    await second.close()

    // ── 5：撤销、冲突提示
    await page.click('[data-prism-action=undo]')
    const undone = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].light)
    check('撤销回到上一个主题', undone)
    await page.evaluate(() => document.documentElement.setAttribute('data-dsh-skin', 'smoke'))
    const noted = await waitFor(() => page.evaluate(() => document.querySelector('[data-prism-note]') !== null), 3000)
    check('检测到 skin-center 时给提示', noted)
    await page.evaluate(() => document.documentElement.removeAttribute('data-dsh-skin'))
    const cleared = await waitFor(() => page.evaluate(() => document.querySelector('[data-prism-note]') === null), 3000)
    check('标记去掉后提示消失', cleared)

    // ── 明暗切换 + 探测（暗色）
    await page.click('[data-prism-action=scheme]')
    const dark = await waitFor(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')), 3000)
    check('探测：切到暗色后 body 有 data-ds-dark-theme', dark)
    const darkVar = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].dark)
    check('暗色下用暗色那一份变量', darkVar)
    await waitFor(async () => (await apiState(server.origin)).doc?.keys?.theme?.v === 'pine')
    const errors = page.console.filter((row) => row.type === 'error' || row.type === 'exception')
    check('控制台没有报错', errors.length === 0, errors.slice(0, 3).map((row) => row.text.slice(0, 120)).join(' | '))
    await page.close()

    // ── 6–7：重启换端口，首屏不闪
    await server.stop()
    server = await startServer(hostDir, home, port + 1)
    const fresh = await openApp(browser, server.url, 'dark')
    await sleep(1500)
    const report = await fresh.evaluate(() => ({ boot: globalThis.__DSH_PRISM_BOOT__?.at, paint: window.__prismPaint, frames: window.__prismFrames }))
    const expected = rgb(pine['--dsw-alias-bg-base'].dark)
    const firstPaint = report.paint['first-paint'] ?? report.paint['first-contentful-paint']
    check('重启换端口后设置还在（新 origin，localStorage 为空）', (await bodyVar(fresh, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].dark)
    const wrong = report.frames.filter((frame) => frame.bg !== expected)
    // head 里的首屏样式在 body 出现时就生效；首屏脚本只是把它转成行内变量，偶尔比第一次绘制晚一点也不会闪
    check('首屏：第一次绘制时主题色已就位', typeof firstPaint === 'number' && (report.boot < firstPaint || (report.frames.length > 0 && wrong.length === 0)), `首屏脚本 ${report.boot?.toFixed(1)}ms，第一次绘制 ${firstPaint?.toFixed(1)}ms`)
    check('每一帧的背景都是主题色（没有闪一下默认色）', report.frames.length > 0 && wrong.length === 0, `${report.frames.length} 帧，不对的 ${wrong.length} 帧${wrong.length ? `：${wrong[0].bg} @${wrong[0].t.toFixed(0)}ms` : ''}`)
    await fresh.close()
  } finally {
    await browser.close()
    await server.stop()
    if (!args.keep) rmSync(home, { recursive: true, force: true })
  }
}

/** 壁纸全流程。 */
async function runWallpaper(hostDir, port) {
  const home = makeHome('smoke')
  installPlugin(hostDir, home)
  const work = join(tmpdir(), `prism-smoke-${port}`)
  const folder = join(work, '图库')
  mkdirSync(folder, { recursive: true })
  const pictures = {}
  const remote = createServer((req, res) => {
    const name = req.url.slice(1).replace('.jpg', '')
    if (pictures[name] === undefined) return res.writeHead(404).end()
    return res.writeHead(200, { 'content-type': 'image/jpeg' }).end(pictures[name])
  })
  await new Promise((done) => remote.listen(0, '127.0.0.1', done))
  const remoteBase = `http://127.0.0.1:${remote.address().port}`
  let server = await startServer(hostDir, home, port)
  const browser = await launchChrome()
  const setState = (patch) => fetch(`${server.origin}/prism-skin/api/state`, { method: 'POST', body: JSON.stringify({ patch: Object.fromEntries(Object.entries(patch).map(([key, v]) => [key, { v, t: Date.now(), by: 'smoke' }])) }) })
  const state = async () => (await apiState(server.origin))
  const base = (page) => bodyVar(page, '--dsw-alias-bg-base')
  try {
    let page = await openApp(browser, server.url, 'dark')
    await dismissOnboarding(page)
    for (const name of ['valley', 'bloom', 'lagoon']) pictures[name] = await paintWallpaper(page, name)
    writeFileSync(join(work, 'valley.jpg'), pictures.valley)
    writeFileSync(join(folder, 'a-lagoon.jpg'), pictures.lagoon)
    writeFileSync(join(folder, 'b-bloom.jpg'), pictures.bloom)
    writeFileSync(join(folder, 'notes.txt'), 'x')
    check('开机：没设壁纸时不加载壁纸分块', page.requests.filter((row) => row.url.includes('client.wall.js')).length === 0)
    await openPrismSettings(page)

    // 图片：选文件
    await page.click('[data-prism-wall-kind=image]')
    const { root } = await page.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-prism-wall-file]' })
    await page.send('DOM.setFileInputFiles', { nodeId, files: [join(work, 'valley.jpg')] })
    const fromFile = await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 15000)
    const wallRequests = page.requests.filter((row) => row.url.includes('client.wall.js'))
    check('选文件设壁纸：表面换成视口固定的合成背景', fromFile && (await base(page)).includes('fixed'), (await base(page)).slice(0, 60))
    check('设壁纸时才加载壁纸分块', wallRequests.length === 1 && wallRequests[0].status === 200, `${wallRequests[0]?.bytes ?? '?'} B`)
    const fileId = await waitFor(async () => (await state()).doc?.keys?.wallpaper?.v?.id)
    check('图片存到 host（不只在浏览器里）', typeof fileId === 'string' && (await fetch(`${server.origin}/prism-skin/api/wallpaper/file/${fileId}`)).ok)
    const blurBytes = (await (await fetch(`${server.origin}/prism-skin/api/wallpaper/blur/${fileId}.jpg`)).arrayBuffer()).byteLength
    check('预先模糊图很小', blurBytes < 40 * 1024, `${blurBytes} B`)
    check('实时 backdrop-filter 没开', (await bodyVar(page, '--dsw-menu-backdrop-filter')) === 'none')
    const hit = await page.evaluate(() => { const frame = [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).backgroundAttachment.includes('fixed')); return frame.length })
    check('背景真的是 fixed 的（宿主框架按 background 简写用了变量）', hit > 0, `${hit} 个元素`)

    // 图片：粘贴链接
    await page.click('[data-prism-wall-url]')
    await page.send('Input.insertText', { text: `${remoteBase}/bloom.jpg` })
    await page.click('[data-prism-wall-url-apply]')
    const fromUrl = await waitFor(async () => (await state()).doc?.keys?.wallpaper?.v?.src === `${remoteBase}/bloom.jpg`, 15000)
    check('粘贴链接：host 代下载，能取色', fromUrl && (await base(page)).includes('/wallpaper/blur/'))

    // 取色
    await page.click('[data-prism-extract]')
    const extracted = await waitFor(async () => (await state()).doc?.keys?.theme?.v === 'custom', 8000)
    check('从壁纸取色：生成自定义种子', extracted, JSON.stringify((await state()).doc?.keys?.custom?.v ?? {}).slice(0, 80))
    await page.click('[data-prism-action=undo]')
    const undone = await waitFor(async () => (await state()).doc?.keys?.theme?.v !== 'custom', 5000)
    check('取色能撤销', undone)

    // 玻璃感
    const before = await bodyVar(page, '--prism-glass')
    await page.click('[data-prism-glass]')
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
    const flat = await waitFor(async () => /^#/.test(await base(page)), 5000)
    check('玻璃感拉到 0：表面回到不透明的纯色', flat, `之前 ${before}`)
    await setState({ glass: 0.5 })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 5000)

    // 渐变、纯色
    await page.click('[data-prism-wall-kind=gradient]')
    await page.click('[data-prism-gradient=deep]')
    const gradient = await waitFor(async () => /linear-gradient\(170deg/.test(await base(page)), 5000)
    check('渐变：合成背景里是渐变', gradient)
    await page.click('[data-prism-wall-kind=color]')
    await page.click('[data-prism-solid="#2c2640"]')
    const solid = await waitFor(async () => /^#[0-9a-f]{6}$/.test(await base(page)), 5000)
    check('纯色：直接算成纯色，不用合成背景', solid, await base(page))

    // 文件夹。绝不走真的选择框：网页版在本机会用 osascript 弹系统窗口，打扰正在用电脑的人。
    // 这里放一个假的桌面版选择器，走的就是 Desktop 那条路径。
    await page.click('[data-prism-wall-kind=folder]')
    await page.evaluate((path) => {
      globalThis.__DSH_DIRECTORY_PICKER__ = { pick: async () => path }
    }, folder)
    await page.click('[data-prism-folder-pick]')
    const pickedFolder = await waitFor(async () => (await state()).doc?.keys?.wallpaper?.v?.path === folder, 5000)
    check('选文件夹：优先用桌面版的选择框，路径写进存档', pickedFolder)
    await page.close()

    page = await openApp(browser, server.url, 'dark')
    const fromFolder = await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 20000)
    check('文件夹轮播：页面自动分析图片并显示', fromFolder)
    const pending = await waitFor(async () => (await state()).needs.length === 0, 15000)
    check('文件夹里的图（当前和下一张）都分析好了', pending)
    await page.close()

    // 轮播：两张图，10 秒一换
    const ids = []
    for (const name of ['valley', 'lagoon']) ids.push((await (await fetch(`${server.origin}/prism-skin/api/wallpaper/upload`, { method: 'POST', body: pictures[name] })).json()).id)
    await setState({ wallpaper: { kind: 'rotate', items: ids.map((id) => ({ id })), interval: 10, shuffle: false, epoch: Date.now() } })
    page = await openApp(browser, server.url, 'dark')
    const first = await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 20000)
    const shown = async () => /blur\/([a-f0-9]+)\.jpg/.exec(await base(page))?.[1]
    const start = await shown()
    const rotated = first && (await waitFor(async () => (await shown()) !== start, 25000))
    check('轮播：到点自动换图', rotated, `${start?.slice(0, 6)} → ${(await shown())?.slice(0, 6)}`)
    const scrollTop = await page.evaluate(() => document.visibilityState)

    // 窗口隐藏：暂停
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const pulls = () => page.requests.filter((row) => row.url.includes('/prism-skin/api/state') && row.method === 'GET').length
    const hiddenAt = pulls()
    const hiddenShown = await shown()
    await sleep(22000)
    check('窗口隐藏时轮播暂停（22 秒内没有请求、没有换图）', pulls() === hiddenAt && (await shown()) === hiddenShown, `可见状态 ${scrollTop}`)
    await page.evaluate(() => {
      delete document.visibilityState
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const resumed = await waitFor(() => pulls() > hiddenAt, 5000)
    check('回到前台立刻对一次', resumed)

    // 减少透明度
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] })
    const reduced = await waitFor(async () => /^#[0-9a-f]{6}$/.test(await base(page)), 5000)
    check('系统「减少透明度」：玻璃自动关闭', reduced, await base(page))
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-transparency', value: 'no-preference' }] })
    const restored = await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 5000)
    check('关掉「减少透明度」后玻璃回来', restored)

    // 省电三档（设置页里点）
    await openPrismSettings(page)
    const status = () => page.evaluate(() => document.querySelector('[data-prism-power-status]')?.getAttribute('data-prism-power-status'))
    await page.click('[data-prism-power=on]')
    const manual = await waitFor(async () => /^#[0-9a-f]{6}$/.test(await base(page)) && (await status()) === 'manual', 5000)
    check('省电「开」：表面换成纯色，设置页写明是手动打开的', manual, `${await base(page)} / ${await status()}`)
    const flatAll = await page.evaluate(() => [...document.querySelectorAll('*')].filter((el) => getComputedStyle(el).backgroundAttachment.includes('fixed')).length)
    check('省电时页面上没有固定背景', flatAll === 0, `${flatAll} 个`)
    const fromWall = (await base(page)).toLowerCase() !== '#141618'
    check('省电时的纯色来自壁纸（不是纯主题色）', fromWall, await base(page))
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] })
    await page.click('[data-prism-power=off]')
    const never = await waitFor(async () => (await base(page)).includes('/wallpaper/blur/') && (await status()) === 'off', 5000)
    check('省电「关」：系统减少透明度也照样显示玻璃', never)
    await page.click('[data-prism-power=auto]')
    const followed = await waitFor(async () => /^#/.test(await base(page)) && (await status()) === 'transparency', 5000)
    check('省电「跟随系统」：设置页写明是因为减少透明度', followed, await status())
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-transparency', value: 'no-preference' }] })
    await waitFor(async () => (await base(page)).includes('/wallpaper/blur/'), 5000)
    const errors = page.console.filter((row) => row.type === 'error' || row.type === 'exception')
    check('控制台没有报错', errors.length === 0, errors.slice(0, 3).map((row) => row.text.slice(0, 120)).join(' | '))
    await page.close()

    // 低电量：Battery Status API 换成假的（电量 10%、没在充电）
    const low = await browser.newPage()
    await low.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve({ charging: false, level: 0.1, addEventListener() {}, removeEventListener() {} }) })` })
    await low.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await low.goto(server.url)
    await low.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000 })
    const lowFlat = await waitFor(async () => /^#[0-9a-f]{6}$/.test(await bodyVar(low, '--dsw-alias-bg-base')), 8000)
    await dismissOnboarding(low)
    await openPrismSettings(low)
    const lowReason = await low.evaluate(() => document.querySelector('[data-prism-power-status]')?.getAttribute('data-prism-power-status'))
    check('低电量且没充电：自动省电，设置页写明原因', lowFlat && lowReason === 'battery', lowReason)
    await low.close()

    // 侧栏「换肤」面板必须在最上层（桌面版实机上被会话列表盖住过）
    const quick = await openApp(browser, server.url, 'light')
    await dismissOnboarding(quick)
    const wide = await probeQuickPanel(quick)
    check('侧栏面板：宽窗口下在最上层', wide.ok, wide.detail)
    const trapped = await trapSidebar(quick)
    const covered = await probeQuickPanel(quick)
    check('侧栏面板：侧栏祖先带 transform、会话列表有层级时仍在最上层', covered.ok && covered.transformed > 0, `${trapped}；${covered.detail}`)
    await quick.goto(server.url)
    await quick.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000 })
    if (await openSidebarDrawer(quick)) {
      const drawer = await probeQuickPanel(quick)
      check('侧栏面板：窄窗口抽屉模式（宿主侧栏 z-index 71 + transform）下在最上层', drawer.ok && drawer.transformed > 0, drawer.detail)
    } else console.log('- 侧栏面板：这个宿主没有窄窗口抽屉模式，跳过')
    await quick.close()

    // 带壁纸重启：首屏就有壁纸
    await setState({ wallpaper: { kind: 'image', id: ids[0] } })
    await server.stop()
    server = await startServer(hostDir, home, port + 1)
    const fresh = await openApp(browser, server.url, 'dark')
    await sleep(1500)
    const report = await fresh.evaluate(() => ({ boot: globalThis.__DSH_PRISM_BOOT__?.at, paint: window.__prismPaint, frames: window.__prismFrames }))
    const firstPaint = report.paint['first-paint'] ?? report.paint['first-contentful-paint']
    const painted = report.frames.filter((frame) => frame.t >= firstPaint)
    check('带壁纸重启：首屏脚本先于第一次绘制', report.boot < firstPaint, `${report.boot?.toFixed(1)}ms < ${firstPaint?.toFixed(1)}ms`)
    check('带壁纸重启：绘制后每一帧的背景都是壁纸', painted.length > 0 && painted.every((frame) => frame.img.includes('/wallpaper/blur/')), `${painted.length} 帧`)
    await fresh.close()
  } finally {
    await browser.close()
    await server.stop()
    await new Promise((done) => remote.close(done))
    rmSync(work, { recursive: true, force: true })
    if (!args.keep) rmSync(home, { recursive: true, force: true })
  }
}

/** 在页面里改 React 受控输入框的值。 */
const typeInto = (page, selector, value) =>
  page.evaluate(
    (sel, text) => {
      const el = document.querySelector(sel)
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    selector,
    value,
  )
const clickSel = (page, selector) => page.evaluate((sel) => document.querySelector(sel).click(), selector)
/** 拦下载：记下文件名和 blob 地址，不真的弹下载。 */
const HOOK_DOWNLOADS = `(() => {
  window.__prismDownloads = []
  const original = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__prismDownloads.push({ name: this.download, href: this.href }); return }
    return original.call(this)
  }
})()`
const lastDownload = async (page) => {
  const item = await page.evaluate(() => window.__prismDownloads.at(-1) ?? null)
  if (item === null) return null
  const base64 = await page.evaluate(async (href) => {
    const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer())
    let text = ''
    for (const byte of bytes) text += String.fromCharCode(byte)
    return btoa(text)
  }, item.href)
  return { name: item.name, bytes: Buffer.from(base64, 'base64') }
}

async function runCustom(hostDir, port) {
  console.log(`\n== P3 深度自定义 ${hostDir}`)
  const home = makeHome('smoke-p3')
  installPlugin(hostDir, home)
  const work = join(home, 'work')
  mkdirSync(work, { recursive: true })
  const server = await startServer(hostDir, home, port)
  const browser = await launchChrome()
  const state = async () => (await apiState(server.origin)).doc?.keys ?? {}
  const value = async (key) => (await state())[key]?.v
  try {
    let page = await openApp(browser, server.url, 'light')
    await page.evaluate(HOOK_DOWNLOADS)
    await dismissOnboarding(page)
    await openPrismSettings(page)
    await clickSel(page, '[data-prism-theme="mist"]')
    const mist = generate(themeById('mist').seed)
    await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === mist['--dsw-alias-bg-base'].light)
    const studioBefore = page.requests.filter((row) => row.url.includes('client.custom.js')).length
    check('P3：打开设置页时不加载高级分块', studioBefore === 0, `请求 ${studioBefore} 次`)

    // 字体：写的是宿主自己的设置
    await clickSel(page, '[data-prism-font-text="serif"]')
    const serif = await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Source Han Serif SC'))
    const pressed = await page.evaluate(() => document.querySelector('[data-prism-font-text="serif"]').getAttribute('aria-pressed'))
    check('字体：选「衬线」后界面字体立刻变，按钮是选中态', serif && pressed === 'true', await page.evaluate(() => getComputedStyle(document.body).fontFamily.slice(0, 50)))
    await clickSel(page, '[data-prism-font-size="text"] button:last-of-type')
    const bigger = await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size').trim())) === '15px')
    check('字号：正文字号 +1 写进宿主设置（--dsh-content-font-size 15px）', bigger)
    await clickSel(page, '[data-prism-font-text="default"]')
    await clickSel(page, '[data-prism-font-size="text"] button:first-of-type')
    const restored = await waitFor(async () => !(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Source Han Serif SC'))
    check('字体：改回默认', restored)
    check('字体：棱镜的存档里没有另存一份字体', !('font' in (await state())))

    // 代码配色
    await clickSel(page, '[data-prism-code="github"]')
    const github = generate({ ...themeById('mist').seed, code: 'github' })
    const codeOk = await waitFor(async () => (await bodyVar(page, '--shiki-token-function')) === github['--shiki-token-function'].light)
    check('代码配色：选 GitHub 立刻生效、写进存档', codeOk && (await waitFor(async () => (await value('adjust'))?.code === 'github')), await bodyVar(page, '--shiki-token-function'))

    // 圆角（滑块：拖动预览，松手提交）
    await page.evaluate(() => {
      const range = document.querySelector('[data-prism-seed="radius"]')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '0.5')
      range.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(200)
    await page.evaluate(() => document.querySelector('[data-prism-seed="radius"]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true })))
    const radiusOk = await waitFor(async () => (await bodyVar(page, '--dsw-radius-md')) === '6px' && (await value('radius')) === 0.5)
    check('圆角：拖到 ×0.5，宿主圆角变量跟着缩、写进存档', radiusOk, await bodyVar(page, '--dsw-radius-md'))

    // 高级：变量搜索编辑
    await clickSel(page, '[data-prism-open-advanced]')
    await page.waitFor(`document.querySelector('[data-prism-var-search]') !== null`, { timeout: 15000, label: '高级分块' })
    check('高级：点开才加载分块', page.requests.filter((row) => row.url.includes('client.custom.js')).length === 1)
    const total = await page.evaluate(() => document.querySelector('[data-prism-advanced] .prism-status').textContent)
    await typeInto(page, '[data-prism-var-search]', 'alias-bg-base')
    await page.waitFor(`document.querySelector('[data-prism-var="--dsw-alias-bg-base"]') !== null`, { timeout: 5000, label: '搜到变量' })
    const source = await page.evaluate(() => document.querySelector('[data-prism-var="--dsw-alias-bg-base"] [data-prism-var-source]').dataset.prismVarSource)
    check('变量搜索：按名字搜到，来源标成「主题」', source === 'theme', `${total}；来源 ${source}`)
    await clickSel(page, '[data-prism-var="--dsw-alias-bg-base"]')
    await typeInto(page, '[data-prism-var-light]', '#fafafa')
    await clickSel(page, '[data-prism-var-save]')
    const edited = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === '#fafafa' && (await page.evaluate(() => document.querySelector('[data-prism-var="--dsw-alias-bg-base"] [data-prism-var-source]').dataset.prismVarSource)) === 'override')
    check('变量编辑：改了立刻生效，来源变成「高级覆盖」', edited)
    await waitFor(async () => (await value('overrides'))?.['--dsw-alias-bg-base']?.light === '#fafafa')
    await typeInto(page, '[data-prism-var-light]', 'red;}body{')
    await clickSel(page, '[data-prism-var-save]')
    await sleep(800)
    check('变量编辑：带 ; } 的值被拒绝', (await value('overrides'))?.['--dsw-alias-bg-base']?.light === '#fafafa' && (await bodyVar(page, '--dsw-alias-bg-base')) === '#fafafa')
    await clickSel(page, '[data-prism-var-reset]')
    const reset = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')) === mist['--dsw-alias-bg-base'].light)
    check('变量编辑：单个重置回主题值', reset)

    // 自定义 CSS
    const CUSTOM = '[data-prism-section]{outline:3px solid rgb(1, 2, 3)}'
    await typeInto(page, '[data-prism-css-input]', '@import "https://evil.example/x.css";')
    await clickSel(page, '[data-prism-css-save]')
    const blocked = await page.evaluate(() => document.querySelector('[data-prism-css-status]').dataset.prismCssStatus)
    check('自定义 CSS：@import 被拦下，不保存', blocked === 'import' && (await value('css')) === undefined, blocked)
    await typeInto(page, '[data-prism-css-input]', '.x{background:url(https://evil.example/a.png)}')
    await clickSel(page, '[data-prism-css-save]')
    check('自定义 CSS：外链 url() 被拦下', (await page.evaluate(() => document.querySelector('[data-prism-css-status]').dataset.prismCssStatus)) === 'remote-url')
    await typeInto(page, '[data-prism-css-input]', CUSTOM)
    await clickSel(page, '[data-prism-css-save]')
    const applied = await waitFor(async () => (await page.evaluate(() => getComputedStyle(document.querySelector('[data-prism-section]')).outlineColor)) === 'rgb(1, 2, 3)')
    check('自定义 CSS：保存后立刻生效', applied && (await waitFor(async () => (await value('css')) === CUSTOM)))
    const reloaded = await openApp(browser, server.url, 'light')
    const early = await reloaded.evaluate(() => [...document.querySelectorAll('style')].filter((tag) => tag.textContent.startsWith('/*prism-css*/')).length)
    check('自定义 CSS：重开页面首屏就带着（只有一个标签）', early === 1, `${early} 个`)
    await reloaded.close()

    // 你的修改：丢弃 / 换主题时清掉 / 存为我的主题 / 删除 / 恢复默认
    const cssTags = () => page.evaluate(() => [...document.querySelectorAll('style')].filter((tag) => tag.textContent.startsWith('/*prism-css*/')).length)
    const currentName = () => page.evaluate(() => document.querySelector('[data-prism-current-name]')?.textContent ?? '')
    const mark = () => page.evaluate(() => document.querySelector('[data-prism-current]')?.dataset.prismCurrent)
    const mistNames = Object.values(themeById('mist').name)
    check('当前主题条：显示主题名和「已修改」', (await waitFor(async () => (await mark()) === 'modified')) && mistNames.includes(await currentName()), await currentName())
    await clickSel(page, '[data-prism-discard]')
    const discarded = await waitFor(async () => (await value('css')) === '' && (await value('radius')) === null && (await value('adjust'))?.code === undefined && (await cssTags()) === 0)
    check('丢弃修改：CSS、圆角、代码配色都清掉，主题不动', discarded && (await value('theme')) === 'mist' && (await mark()) === 'clean')
    await clickSel(page, '[data-prism-action="undo"]')
    check('撤销：修改回来', await waitFor(async () => (await value('css')) === CUSTOM))
    await clickSel(page, '[data-prism-theme="none"]')
    check('选「宿主默认」：修改一起清掉，页面上不再有自定义 CSS', await waitFor(async () => (await value('theme')) === null && (await value('css')) === '' && (await cssTags()) === 0))
    await clickSel(page, '[data-prism-action="undo"]')
    check('撤销：回到原主题和修改', await waitFor(async () => (await value('theme')) === 'mist' && (await value('css')) === CUSTOM))
    await clickSel(page, '[data-prism-save-open]')
    await page.waitFor(`document.querySelector('[data-prism-save-name]') !== null`, { timeout: 5000, label: '主题名输入框' })
    await typeInto(page, '[data-prism-save-name]', '烟测主题')
    await clickSel(page, '[data-prism-save]')
    const saved = await waitFor(async () => (await value('library'))?.length === 1 && String(await value('theme')).startsWith('my-') && (await value('css')) === '')
    const mine = (await value('library'))?.[0]
    const outline = await page.evaluate(() => getComputedStyle(document.querySelector('[data-prism-section]')).outlineColor)
    check('存为我的主题：修改并进主题里，样子不变，显示新名字', saved && mine?.css === CUSTOM && outline === 'rgb(1, 2, 3)' && (await currentName()) === '烟测主题' && (await mark()) === 'clean', `${outline} ${await currentName()}`)
    const mineTheme = await value('theme')
    check('我的主题：出现在卡片里', await page.evaluate((id) => document.querySelector(`[data-prism-theme="${id}"]`) !== null, mineTheme))
    const again = await openApp(browser, server.url, 'light')
    const firstPaint = await again.evaluate(() => [...document.querySelectorAll('style')].filter((tag) => tag.textContent.startsWith('/*prism-css*/')).map((tag) => tag.textContent))
    check('我的主题：重开页面首屏就带着它自带的 CSS', firstPaint.length === 1 && firstPaint[0].includes(CUSTOM), `${firstPaint.length} 个`)
    await again.close()
    // 改名
    await clickSel(page, '[data-prism-rename-open]')
    await page.waitFor(`document.querySelector('[data-prism-save-name]') !== null`, { timeout: 5000, label: '改名输入框' })
    await typeInto(page, '[data-prism-save-name]', '烟测主题·改')
    await clickSel(page, '[data-prism-save]')
    check('我的主题：改名后列表和当前主题条都是新名字', await waitFor(async () => (await value('library'))?.[0]?.name === '烟测主题·改' && (await currentName()) === '烟测主题·改' && (await value('theme')) === mineTheme))
    // 悬停预览带上主题自带的 CSS：悬停在没有 CSS 的主题上，自定义 CSS 暂时撤掉；移开就回来
    await page.hover('[data-prism-theme="mist"]')
    const previewed = await waitFor(async () => (await cssTags()) === 0, 3000)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 })
    const back = await waitFor(async () => (await cssTags()) === 1, 3000)
    check('悬停预览：连主题自带的 CSS 一起预览，移开就恢复', previewed && back && (await value('theme')) === mineTheme)
    // 删除：点两次；删了可以撤销
    await clickSel(page, `[data-prism-delete-mine="${mine?.id}"]`)
    await sleep(200)
    check('删除我的主题：第一下只是让你确认', (await value('library'))?.length === 1)
    await clickSel(page, `[data-prism-delete-mine="${mine?.id}"]`)
    check('删除正在用的我的主题：回到宿主默认', await waitFor(async () => (await value('library'))?.length === 0 && (await value('theme')) === null && (await cssTags()) === 0))
    await page.waitFor(`document.querySelector('[data-prism-undo-delete]') !== null`, { timeout: 5000, label: '撤销删除' })
    await clickSel(page, '[data-prism-undo-delete]')
    check('撤销删除：放回列表，重新选上', await waitFor(async () => (await value('library'))?.length === 1 && (await value('theme')) === mineTheme && (await cssTags()) === 1))
    await clickSel(page, `[data-prism-delete-mine="${mine?.id}"]`)
    await sleep(200)
    await clickSel(page, `[data-prism-delete-mine="${mine?.id}"]`)
    await waitFor(async () => (await value('library'))?.length === 0 && (await value('theme')) === null)
    // 省电标记：主题 CSS 靠它停掉动画
    await clickSel(page, '[data-prism-power="on"]')
    const marked = await waitFor(async () => (await page.evaluate(() => document.body.getAttribute('data-prism-saving'))) === 'manual')
    await clickSel(page, '[data-prism-power="auto"]')
    const unmarked = await waitFor(async () => (await page.evaluate(() => document.body.hasAttribute('data-prism-saving'))) === false)
    check('省电时 body 上标出 data-prism-saving，关掉后去掉', marked && unmarked)
    await clickSel(page, '[data-prism-theme="mist"]')
    await typeInto(page, '[data-prism-css-input]', CUSTOM)
    await clickSel(page, '[data-prism-css-save]')
    await waitFor(async () => (await value('css')) === CUSTOM)
    await clickSel(page, '[data-prism-restore]')
    check('恢复默认：主题、修改、背景全部清掉', await waitFor(async () => (await value('theme')) === null && (await value('css')) === '' && (await value('wallpaper')) === null && (await cssTags()) === 0))
    await clickSel(page, '[data-prism-action="undo"]')
    check('恢复默认可以撤销', await waitFor(async () => (await value('theme')) === 'mist' && (await value('css')) === CUSTOM))
    await clickSel(page, '[data-prism-discard]')
    await clickSel(page, '[data-prism-theme="pine"]')

    // 导出 → 导入
    await clickSel(page, '[data-prism-open-transfer]')
    await page.waitFor(`document.querySelector('[data-prism-export-file]') !== null`, { timeout: 15000, label: '导入导出' })
    await clickSel(page, '[data-prism-export-file]')
    const exported = await lastDownload(page)
    const themeText = exported?.bytes.toString('utf8') ?? ''
    let parsed = null
    try {
      parsed = JSON.parse(themeText)
    } catch {}
    check('导出主题文件：提示只说「已开始下载」', (await page.evaluate(() => document.querySelector('[data-prism-import-status]')?.dataset.prismImportStatus)) === 'started')
    check('导出主题文件：种子 JSON，很小', parsed?.prism === 1 && parsed.seed.accent === themeById('pine').seed.accent && exported.bytes.length < 400, `${exported?.name} ${exported?.bytes.length} B`)
    await clickSel(page, '[data-prism-theme="sand"]')
    await typeInto(page, '[data-prism-import-input]', '{"prism":1,"seed":{"hue":1},"css":"@import \\"x\\""}')
    await clickSel(page, '[data-prism-import-check]')
    const rejected = await page.evaluate(() => document.querySelector('[data-prism-import-status]')?.dataset.prismImportStatus)
    check('导入：不合法的文件整份拒绝，什么都不改', rejected === 'error.bad-seed' && (await waitFor(async () => (await value('theme')) === 'sand')), rejected)
    await typeInto(page, '[data-prism-import-input]', themeText)
    await clickSel(page, '[data-prism-import-check]')
    await page.waitFor(`document.querySelector('[data-prism-import-apply]') !== null`, { timeout: 5000, label: '导入预览' })
    await clickSel(page, '[data-prism-import-apply]')
    const pine = generate(themeById('pine').seed)
    const imported = await waitFor(async () => String(await value('theme')).startsWith('my-') && (await bodyVar(page, '--dsw-alias-bg-base')) === pine['--dsw-alias-bg-base'].light)
    check('导入主题文件：配色和导出时一样', imported, await bodyVar(page, '--dsw-alias-bg-base'))
    check('导入主题文件：带名字进了「我的主题」', (await value('library'))?.some((pack) => pack.name === parsed?.name) && (await currentName()) === parsed?.name, `${parsed?.name} / ${await currentName()}`)
    await clickSel(page, '[data-prism-import-undo]')
    check('导入可以撤销', await waitFor(async () => (await value('theme')) === 'sand'))

    // dream-skin 主题包
    const nord = readFileSync(new URL('../test/fixtures/dream-packs/nord.dsh-theme.json', import.meta.url), 'utf8')
    await typeInto(page, '[data-prism-import-input]', nord)
    await clickSel(page, '[data-prism-import-check]')
    await page.waitFor(`document.querySelector('[data-prism-import-preview="pack"]') !== null`, { timeout: 5000, label: '主题包预览' })
    await clickSel(page, '[data-prism-import-apply]')
    const packOk = await waitFor(async () => String(await value('theme')).startsWith('my-') && (await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))))
    check('导入 dream-skin 主题包：换算成种子进「我的主题」，切到包的明暗（暗色）', packOk, await currentName())
    await clickSel(page, '[data-prism-action="scheme"]')

    // 分享链接
    await clickSel(page, '[data-prism-theme="ember"]')
    await clickSel(page, '[data-prism-export-share]')
    const link = await page.evaluate(() => document.querySelector('[data-prism-share-link]').value)
    const code = link.slice(link.indexOf('#') + 1)
    check('分享链接：很短', code.length <= 60, code)
    await clickSel(page, '[data-prism-theme="mist"]')
    const shared = await openApp(browser, `${server.url}#${code}`, 'light')
    const hashGone = await shared.evaluate(() => location.hash === '')
    await dismissOnboarding(shared)
    await openPrismSettings(shared)
    const offered = await shared.waitFor(`document.querySelector('[data-prism-import-preview="code"]') !== null`, { timeout: 15000, label: '分享预览' }).then(() => true, () => false)
    check('打开分享链接：地址栏去掉分享码，设置页直接给出导入预览', hashGone && offered && (await waitFor(async () => (await value('theme')) === 'mist')))
    await clickSel(shared, '[data-prism-import-apply]')
    const ember = generate(themeById('ember').seed)
    check('分享链接：确认后换上分享的配色', await waitFor(async () => (await bodyVar(shared, '--dsw-alias-bg-base')) === ember['--dsw-alias-bg-base'].light))
    await shared.close()

    // 导出成 skin-center 皮肤
    await clickSel(page, '[data-prism-export-skin]')
    const skin = await lastDownload(page)
    let skinOk = false
    let skinDetail = skin?.name ?? '没有下载'
    if (skin !== null) {
      const zipPath = join(work, skin.name)
      writeFileSync(zipPath, skin.bytes)
      try {
        execFileSync('unzip', ['-q', '-o', zipPath, '-d', join(work, 'skin')])
        const id = skin.name.replace(/\.zip$/, '')
        const manifest = JSON.parse(readFileSync(join(work, 'skin', id, 'skin.json'), 'utf8'))
        const css = readFileSync(join(work, 'skin', id, 'skin.css'), 'utf8')
        skinOk = manifest.skinManifestVersion === 2 && /^[a-z][a-z0-9-]{0,31}$/.test(manifest.id) && manifest.id === id && css.includes('--dsw-alias-bg-base') && css.includes('body[data-ds-dark-theme]') && !/url\(/.test(css)
        skinDetail = `${skin.name} ${skin.bytes.length} B，${manifest.id}`
      } catch (error) {
        skinDetail = String(error).slice(0, 120)
      }
    }
    check('导出 skin-center 皮肤：zip 里是合规的 skin.json + skin.css，不带 url', skinOk, skinDetail)
    check('导出 skin-center 皮肤：提示只说「已开始下载」', (await page.evaluate(() => document.querySelector('[data-prism-import-status]')?.dataset.prismImportStatus)) === 'started')

    // dream-skin 设置迁移：只读它的文件
    const picture = await paintWallpaper(page, 'valley')
    const dreamFile = join(home, 'dream-skin.json')
    const dreamBody = JSON.stringify({ 'dsh-dream-skin:skin': 'ember', 'dsh-dream-skin:accent': '#3366ff', 'dsh-dream-skin:wallpaper-kind': 'image', 'dsh-dream-skin:wallpaper': `data:image/jpeg;base64,${picture.toString('base64')}`, __schema: '1' })
    writeFileSync(dreamFile, dreamBody)
    await clickSel(page, '[data-prism-dream-scan]')
    await page.waitFor(`document.querySelector('[data-prism-dream="ready"]') !== null`, { timeout: 15000, label: '读取 dream-skin' })
    await clickSel(page, '[data-prism-dream-run]')
    await page.waitFor(`document.querySelector('[data-prism-dream-done]') !== null`, { timeout: 30000, label: '迁移完成' })
    await waitFor(async () => (await value('wallpaper'))?.kind === 'image')
    const wall = await value('wallpaper')
    const migratedTheme = await value('theme')
    const custom = (await value('library'))?.find((pack) => `my-${pack.id}` === migratedTheme)?.seed
    const fileId = wall?.kind === 'image' ? wall.id : null
    const fileOk = fileId !== null && (await fetch(`${server.origin}/prism-skin/api/wallpaper/file/${fileId}`)).ok
    check('dream-skin 迁移：主题换算成种子、强调色和图片壁纸都过来了', custom?.accent === '#3366ff' && fileOk, `${JSON.stringify(custom ?? {}).slice(0, 60)} / ${wall?.kind}`)
    check('dream-skin 迁移：它的设置文件一个字节都没变', readFileSync(dreamFile, 'utf8') === dreamBody)
    const analysed = await waitFor(async () => (await bodyVar(page, '--dsw-alias-bg-base')).includes('/wallpaper/blur/'), 20000)
    check('dream-skin 迁移：图片壁纸分析完后显示出来', analysed)

    // 侧栏面板底部：宿主没有给侧栏插件「打开设置并定位到分节」的接口，所以是说明文字，不能看着像链接
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
    await clickSel(page, '[data-prism-quick]')
    await page.waitFor(`document.querySelector('.prism-panel-foot') !== null`, { timeout: 15000, label: '侧栏面板' })
    const foot = await page.evaluate(() => {
      const el = document.querySelector('.prism-panel-foot')
      const style = getComputedStyle(el)
      return { tag: el.tagName, clickable: el.closest('a,button,[role=link],[role=button]') !== null, cursor: style.cursor, underline: style.textDecorationLine, text: el.textContent }
    })
    check('侧栏面板底部：普通说明文字，不是链接也不像链接', foot.tag === 'DIV' && !foot.clickable && foot.cursor === 'default' && foot.underline === 'none' && !foot.text.includes('→'), JSON.stringify(foot))
    const errors = page.console.filter((row) => row.type === 'error' || row.type === 'exception')
    check('P3：控制台没有报错', errors.length === 0, errors.slice(0, 3).map((row) => row.text.slice(0, 120)).join(' | '))
    await page.close()
  } finally {
    await browser.close()
    await server.stop()
    if (!args.keep) rmSync(home, { recursive: true, force: true })
  }
}

await buildAll()
let port = Number(args.port)
for (const host of args.host) {
  // --only p3：只跑 P3 那一段（调试用）
  if (args.only !== 'p3') {
    await runOn(resolve(host), port)
    await runWallpaper(resolve(host), port + 2)
  }
  await runCustom(resolve(host), port + 4)
  port += 10
}
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}（${results.length} 项）`)
process.exit(failed === 0 ? 0 : 1)
