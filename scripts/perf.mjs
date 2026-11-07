#!/usr/bin/env node
/**
 * 空闲和滚动时的渲染开销（无头浏览器 + Metal，不占屏幕、不弹窗）。
 *
 * 每个场景统计：
 *   - 空闲 N 秒内合成了多少帧、重绘了多少次（静止的页面应该接近 0）；
 *   - 这段时间主线程忙了多久；
 *   - 浏览器进程占 GPU 的比例（方法同 gpu-sample.mjs：读 accumulatedGPUTime）；
 *   - 连续滚动时的上述数字（合成背景的代价主要在这里）。
 *
 * 局限：无头模式不经过窗口合成，测不到 WindowServer。窗口级的数字要在真窗口前台用
 * gpu-sample.mjs 测。
 *
 * 用法：node scripts/perf.mjs --origin <服务地址> --url <带 token 的地址> --scenario 名字=JSON补丁 ...
 *       node scripts/perf.mjs --url <地址> --label dream-skin   （不改设置，只测当前状态）
 */
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { launchChrome } from './lib/cdp.mjs'

const { values: args } = parseArgs({ options: { url: { type: 'string' }, origin: { type: 'string' }, scenario: { type: 'string', multiple: true, default: [] }, label: { type: 'string' }, idle: { type: 'string', default: '40' }, scroll: { type: 'string', default: '15' } } })
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function gpuTotal(match) {
  const text = execFileSync('ioreg', ['-c', 'AGXDeviceUserClient', '-r', '-d', '1', '-w', '0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  let sum = 0
  for (const block of text.split(/\n(?=\+-o )/)) {
    const creator = /"IOUserClientCreator" = "pid \d+, ([^"]+)"/.exec(block)?.[1]
    if (creator === undefined || !match.test(creator)) continue
    for (const row of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) sum += Number(row[1])
  }
  return sum
}

/** 录一段时间：帧数、重绘数、主线程时间、GPU 比例。 */
async function record(page, seconds, during) {
  const events = {}
  const spent = {}
  const onData = ({ value }) => {
    for (const event of value) if (event.ph === 'X' && typeof event.dur === 'number' && event.cat?.includes('devtools.timeline')) spent[event.name] = (spent[event.name] ?? 0) + event.dur
    for (const event of value) if (['DrawFrame', 'Paint', 'UpdateLayoutTree', 'Commit', 'BeginFrame', 'ActivateLayerTree'].includes(event.name) && (event.ph === 'X' || event.ph === 'B' || event.ph === 'I')) events[event.name] = (events[event.name] ?? 0) + 1
  }
  page.listeners.set('Tracing.dataCollected', [onData])
  const metric = async (name) => (await page.send('Performance.getMetrics')).metrics.find((row) => row.name === name)?.value ?? 0
  await page.send('Tracing.start', { categories: 'cc,viz,devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
  const task0 = await metric('TaskDuration')
  const gpu0 = gpuTotal(/chrome-headless-shell/)
  const t0 = process.hrtime.bigint()
  await during?.()
  await sleep(seconds * 1000)
  const elapsed = Number(process.hrtime.bigint() - t0)
  const gpu = ((gpuTotal(/chrome-headless-shell/) - gpu0) / elapsed) * 100
  const task = (await metric('TaskDuration')) - task0
  const done = new Promise((resolve) => page.listeners.set('Tracing.tracingComplete', [resolve]))
  await page.send('Tracing.end')
  await done
  if (process.env.PRISM_PERF_DEBUG) console.log(events)
  if (process.env.PRISM_PERF_BREAKDOWN) console.log(Object.entries(spent).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, us]) => `${name} ${(us / 1000 / (elapsed / 1e9)).toFixed(1)}ms/s`).join('，'))
  const per = (n) => (((n ?? 0) / (elapsed / 1e9))).toFixed(2)
  return { fps: per(events.DrawFrame), paints: per(events.Paint), mainThread: `${((task / (elapsed / 1e9)) * 100).toFixed(2)}%`, gpu: `${gpu.toFixed(2)}%` }
}

const browser = await launchChrome(['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-gpu'])
try {
  const page = await browser.newPage()
  await page.send('Performance.enable')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await page.goto(args.url)
  await page.waitFor(`document.body.innerText.length > 50`, { timeout: 60000 })
  await sleep(4000)
  for (let i = 0; i < 8; i += 1) {
    await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => ['Continue', '继续', 'Skip', '跳过'].includes(b.textContent.trim()))?.click())
    await sleep(300)
  }
  await page.evaluate(() => [...document.querySelectorAll('button,a,[role=button],[role=treeitem],[role=link]')].find((el) => /段示例|示例回复/.test(el.textContent))?.click())
  await sleep(1500)
  const scenarios = args.scenario.length > 0 ? args.scenario.map((row) => [row.slice(0, row.indexOf('=')), JSON.parse(row.slice(row.indexOf('=') + 1))]) : [[args.label ?? '当前状态', null]]
  const url = await page.evaluate(() => location.href)
  for (const [name, patch] of scenarios) {
    if (patch !== null) {
      await fetch(`${args.origin}/prism-skin/api/state`, { method: 'POST', body: JSON.stringify({ patch: Object.fromEntries(Object.entries(patch).map(([key, v]) => [key, { v, t: Date.now(), by: 'perf' }])) }) })
      await page.goto(url)
      await page.waitFor(`document.body.innerText.includes('示例回复')`, { timeout: 60000 })
      await sleep(5000)
    }
    const idle = await record(page, Number(args.idle))
    const scroll = await record(page, Number(args.scroll), () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll('*')].filter((node) => node.scrollHeight > node.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)).sort((a, b) => b.clientHeight - a.clientHeight)[0]
        if (el === undefined) return
        let direction = 1
        const step = () => {
          el.scrollTop += direction * 6
          if (el.scrollTop <= 0 || el.scrollTop + el.clientHeight >= el.scrollHeight - 1) direction *= -1
          window.__prismScroll = requestAnimationFrame(step)
        }
        step()
      }),
    )
    await page.evaluate(() => cancelAnimationFrame(window.__prismScroll))
    console.log(`${name}\t空闲：${idle.fps} 帧/秒，重绘 ${idle.paints} 次/秒，主线程 ${idle.mainThread}，GPU ${idle.gpu}\t滚动：${scroll.fps} 帧/秒，重绘 ${scroll.paints} 次/秒，主线程 ${scroll.mainThread}，GPU ${scroll.gpu}`)
  }
} finally {
  await browser.close()
}
