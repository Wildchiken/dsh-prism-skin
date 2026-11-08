#!/usr/bin/env node
/**
 * 主题体检：在隔离的真宿主里装上主题，逐个画面（对话、展开的工具卡片、轨迹、插件、各个菜单、右侧栏、棱镜面板、设置每一页）
 * 亮暗各看一遍：
 * - 同一个元素在「有主题 / 没主题」下比较：折行变多、被截断、被切掉、主题下不见了、明显变小、新出现的重叠；
 * - 只看主题下：文字和占位文字的对比度、圆角是不是规定的几档（--radii）、子元素在圆角外露出来、图标有没有换全、字体有没有换（主题设了字体时）；
 * - 逐个可点的元素悬停（暗色画面），位置或尺寸会变的列出来——会变就会闪。
 * 对话用会调工具的假模型造（scripts/lib/mock-agent.mjs），工具卡片、文件差异、轨迹都有。宿主跑在临时目录，不联网。
 *
 * 用法：node scripts/audit-theme.mjs --host <装了 @deepseek-ai/dsh 的目录> --theme themes/material-3.json
 *   [--states chatEnd,traj,settings0]  只看这几个画面（名字见 scripts/lib/audit-states.mjs）
 *   [--radii 0,4,8,12,16,20,28]       规定的圆角档位，不给就不查
 *   [--no-hover]                       跳过悬停检查（快很多）
 *   [--icons]                          另出一张宿主图标「原图 / 主题下」对照表
 *   [--locale zh-CN]                   宿主界面语言（跟浏览器语言走），默认中文；en-US 看英文界面
 *   [--out .cache/audit] [--port 18767]
 * 结果：<out>/summary.md（汇总，也会打印出来）、<out>/<画面>.json、<out>/<画面>-dark.png / -light.png。
 * 有硬伤（主题下不见了、新出现的重叠、子元素露角、对比度不够、悬停会动）时退出码为 1。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { buildAll } from './build.mjs'
import { STATES } from './lib/audit-states.mjs'
import { launchChrome } from './lib/cdp.mjs'
import { dismissOnboarding, installPlugin, makeHome, ROOT, startServer } from './lib/host.mjs'
import { startAgentMock } from './lib/mock-agent.mjs'

const { values: args } = parseArgs({
  options: {
    host: { type: 'string' },
    theme: { type: 'string' },
    states: { type: 'string' },
    radii: { type: 'string' },
    'no-hover': { type: 'boolean', default: false },
    icons: { type: 'boolean', default: false },
    out: { type: 'string', default: join(ROOT, '.cache', 'audit') },
    port: { type: 'string', default: '18767' },
    locale: { type: 'string', default: 'zh-CN' },
  },
})
if (args.host === undefined || args.theme === undefined) {
  console.error('用法：node scripts/audit-theme.mjs --host <宿主目录> --theme <主题文件> [--states a,b] [--radii 0,4,8] [--no-hover] [--icons]')
  process.exit(2)
}

const HARD = new Set(['主题下不见了', '新出现的重叠', '子元素在圆角外露出来', '对比度不够', '占位文字对比度不够', '悬停会动'])
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const theme = JSON.parse(readFileSync(resolve(args.theme), 'utf8'))
const pageLib = readFileSync(join(ROOT, 'scripts', 'lib', 'audit-page.js'), 'utf8')
const only = args.states?.split(',').map((s) => s.trim())
const unknown = (only ?? []).filter((s) => !(s in STATES))
if (unknown.length) {
  console.error(`没有这些画面：${unknown.join(', ')}。可选：${Object.keys(STATES).join(', ')}`)
  process.exit(2)
}
// 主题设了字体，就查有没有地方没换过来（正文、代码两种都算对）
const firstFont = (name) => theme.overrides?.[name]?.light?.split(',')[0]?.replace(/["']/g, '').trim()
const fonts = ['--dsh-font-family-text', '--dsh-font-family-code'].map(firstFont).filter(Boolean)
const opts = { radii: args.radii?.split(',').map(Number) ?? [], fonts }
const out = resolve(args.out)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

await buildAll()
const port = Number(args.port)
const home = makeHome('audit')
installPlugin(resolve(args.host), home)
const mock = await startAgentMock(port + 1)
const server = await startServer(resolve(args.host), home, port, { DEEPSEEK_BASE_URL: mock.url, DEEPSEEK_API_KEY: 'mock-key' })
const browser = await launchChrome()
const results = []

/** 把主题放进「我的主题」并选中（和导入主题文件、点应用的效果一样）。 */
async function applyTheme() {
  const api = new URL('/prism-skin/api/state', server.url)
  const { doc } = await (await fetch(api)).json()
  const library = doc.keys.library?.v ?? []
  const id = 'audit'
  const keep = ['seed', 'radius', 'overrides', 'css', 'scheme', 'material']
  const pack = { id, name: theme.name ?? 'audit', ...Object.fromEntries(keep.filter((k) => theme[k] !== undefined).map((k) => [k, theme[k]])) }
  const next = { library: [...library.filter((p) => p.id !== id), pack], theme: `my-${id}`, custom: null, adjust: {}, overrides: {}, css: '', radius: null }
  const t = Date.now()
  const patch = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, { v, t, by: 'audit-theme' }]))
  const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) })
  if (!res.ok) throw new Error(`套用主题失败：${res.status}`)
}

/** 发一条消息，等假模型把剧本走完（会真的调宿主的工具）。 */
async function seedConversation(page) {
  await page.goto(server.url)
  await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏' })
  await sleep(800)
  await dismissOnboarding(page)
  await page.evaluate(() => document.querySelector('[contenteditable=true]').focus())
  await page.send('Input.insertText', { text: '把对比度门槛抽成一个配置文件，改完跑一下检查。' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await page.waitFor(`document.body.innerText.includes('改好了')`, { timeout: 120000, label: '假模型的剧本走完' })
  await sleep(1500)
}

/** 当前画面体检：亮暗各一遍；暗色时做悬停检查。 */
async function auditState(page, name) {
  const result = { name, schemes: {} }
  for (const scheme of ['dark', 'light']) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    await sleep(600)
    await page.evaluate(pageLib)
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, `${name}-${scheme}.png`), Buffer.from(data, 'base64'))
    result.schemes[scheme] = await page.evaluate(`window.__audit.run(${JSON.stringify(opts)})`)
    if (scheme === 'dark' && !args['no-hover']) {
      const targets = await page.evaluate('window.__audit.hoverList()')
      const problems = []
      const mouse = (x, y) => page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      for (const target of targets) {
        await mouse(640, 2)
        await sleep(30)
        await page.evaluate(`window.__audit.hoverBefore(${target.i})`)
        await mouse(target.x, target.y)
        await sleep(60)
        const after = await page.evaluate(`window.__audit.hoverAfter(${target.i},${target.x},${target.y})`)
        if (after.moved.length || after.lost) problems.push(after)
      }
      await mouse(640, 2)
      result.hover = { checked: targets.length, problems }
    }
    await page.evaluate('window.__audit.still(false)')
  }
  writeFileSync(join(out, `${name}.json`), JSON.stringify(result, null, 1))
  return result
}

/** 宿主雪碧图里每个图标：原图一张、主题下一张，方便核对替换的图标含义对不对。 */
async function iconSheet(page) {
  await page.goto(server.url)
  await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏' })
  await sleep(800)
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll('symbol[id$=-regular]')].map((s) => s.id)
    const box = document.createElement('div')
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;color:#1a1b20;display:grid;grid-template-columns:repeat(7,1fr);align-content:start;gap:2px;padding:8px;font:11px/1.2 system-ui;overflow:hidden'
    box.innerHTML = ids.map((id) => `<div style="display:flex;align-items:center;gap:6px;height:30px;border:1px solid #eee;padding:0 4px"><svg width="20" height="20" style="flex:none"><use href="#${id}"/></svg><span>${id.replace('dsw-icon-', '').replace('-regular', '')}</span></div>`).join('')
    document.body.appendChild(box)
  })
  await sleep(300)
  const shot = async (file) => writeFileSync(join(out, file), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await shot('icons-on.png')
  await page.evaluate(pageLib)
  await page.evaluate('window.__audit.themeOff()')
  await sleep(300)
  await shot('icons-off.png')
}

/** 汇总：同一类问题在各画面合并，记下出现在哪些画面、亮暗的值。 */
function summarize() {
  const agg = new Map()
  const hover = []
  for (const r of results) {
    for (const [scheme, s] of Object.entries(r.schemes)) {
      for (const f of s.findings) {
        const parts = f.type === '图标没换' ? f.el.split('；').map((el) => ({ ...f, el })) : [f]
        for (const x of parts) {
          const key = `${x.type}|${x.type === '图标没换' ? x.el.split('（')[0] : x.el}|${x.kid ?? ''}`
          if (!agg.has(key)) agg.set(key, { ...x, where: new Set(), vals: new Set() })
          const a = agg.get(key)
          a.where.add(r.name)
          if (x.val != null) a.vals.add(`${scheme === 'dark' ? '暗' : '亮'} ${x.val}${x.base != null ? `（无主题时 ${x.base}）` : ''}`)
        }
      }
    }
    for (const p of r.hover?.problems ?? []) hover.push({ state: r.name, ...p })
  }
  const lines = [`# 主题体检：${theme.name ?? args.theme}（${args.locale}）`, '', `画面 ${results.length} 个：${results.map((r) => r.name).join('、')}`]
  const byType = new Map()
  for (const a of agg.values()) byType.set(a.type, [...(byType.get(a.type) ?? []), a])
  if (hover.length) byType.set('悬停会动', hover.map((h) => ({ el: `[${h.state}] ${h.el}`, vals: new Set([h.lost ? `鼠标下换成了 ${h.hit}` : h.moved.join('；')]), where: new Set([h.state]) })))
  let hard = 0
  for (const [type, list] of byType) {
    if (HARD.has(type)) hard += list.length
    lines.push('', `## ${HARD.has(type) ? '✗' : '·'} ${type}（${list.length}）`)
    for (const a of list) {
      const where = [...a.where]
      lines.push(`- ${a.el}${a.kid ? ` → ${a.kid}` : ''}${a.vals?.size ? ` | ${[...a.vals].slice(0, 2).join('；')}` : ''} | ${where.slice(0, 4).join('、')}${where.length > 4 ? ` 等 ${where.length} 处` : ''}`)
    }
  }
  if (byType.size === 0) lines.push('', '没发现问题。')
  lines.push('', hard ? `硬伤 ${hard} 条（✗），要修。` : '没有硬伤；「·」开头的是提示，逐条看是不是可以接受（比如字体比宿主宽，说明多折一行）。')
  return { text: lines.join('\n'), hard }
}

let page
let summary
try {
  await applyTheme()
  page = await browser.newPage()
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false })
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
  // 宿主界面语言跟浏览器语言走
  await page.send('Emulation.setLocaleOverride', { locale: args.locale })
  await page.send('Network.setUserAgentOverride', { userAgent: await page.evaluate(() => navigator.userAgent), acceptLanguage: args.locale })
  await seedConversation(page)
  for (const [name, nav] of Object.entries(STATES)) {
    if (only && !only.includes(name)) continue
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await page.goto(server.url)
    await page.waitFor(`document.querySelector('[data-prism-quick]') !== null`, { timeout: 60000, label: '侧栏' })
    await sleep(900)
    const ok = await page.evaluate(nav).catch((error) => { console.log(`${name}：导航出错 ${error.message.slice(0, 100)}`); return 0 })
    if (ok === 0) continue
    await sleep(500)
    const r = await auditState(page, name)
    results.push(r)
    console.log(`${name}：暗 ${r.schemes.dark.findings.length} 条 / 亮 ${r.schemes.light.findings.length} 条${r.hover ? ` / 悬停 ${r.hover.problems.length}/${r.hover.checked}` : ''}`)
  }
  if (args.icons) await iconSheet(page)
  summary = summarize()
  writeFileSync(join(out, 'summary.md'), `${summary.text}\n`)
} finally {
  await browser.close()
  await server.stop()
  await mock.close()
  rmSync(home, { recursive: true, force: true })
}
console.log(`\n${summary.text}\n\n结果在 ${out}`)
process.exitCode = summary.hard ? 1 : 0
process.exit()
