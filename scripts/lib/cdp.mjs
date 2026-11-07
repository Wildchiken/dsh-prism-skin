/**
 * 极简的 Chrome 驱动：只用 node 自带的 WebSocket 和 fetch，不引入 playwright。
 * 真宿主冒烟和截图用。浏览器路径取自 PRISM_CHROME，否则找 Playwright 缓存里的 headless shell。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @returns {string} 浏览器可执行文件 */
export function findChrome() {
  const fromEnv = process.env.PRISM_CHROME
  if (fromEnv !== undefined && existsSync(fromEnv)) return fromEnv
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache).filter((name) => name.startsWith('chromium')).sort().reverse()) {
      for (const candidate of [
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ]) {
        const path = join(cache, entry, candidate)
        if (existsSync(path)) return path
      }
    }
  }
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(system)) return system
  throw new Error('找不到 Chrome：请设置 PRISM_CHROME')
}

/** 一个标签页。 */
class Page {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.requests = []
    this.console = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error !== undefined) entry?.reject(new Error(`${entry.method}: ${message.error.message}`))
        else entry?.resolve(message.result)
        return
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
    })
  }

  /** @returns {Promise<any>} CDP 调用结果 */
  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? []
    list.push(listener)
    this.listeners.set(method, list)
  }

  async enable() {
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable'), this.send('Network.enable'), this.send('Log.enable')])
    this.on('Network.requestWillBeSent', ({ request, requestId, timestamp }) => {
      this.requests.push({ requestId, url: request.url, method: request.method, timestamp })
    })
    this.on('Network.responseReceived', ({ requestId, response }) => {
      const row = this.requests.find((item) => item.requestId === requestId)
      if (row !== undefined) row.status = response.status
    })
    this.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
      const row = this.requests.find((item) => item.requestId === requestId)
      if (row !== undefined) row.bytes = encodedDataLength
    })
    this.on('Runtime.consoleAPICalled', ({ type, args }) => {
      this.console.push({ type, text: args.map((arg) => arg.value ?? arg.description ?? '').join(' ') })
    })
    this.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      this.console.push({ type: 'exception', text: exceptionDetails.exception?.description ?? exceptionDetails.text })
    })
  }

  /**
   * 在页面里求值。
   * @param {string | Function} expression 表达式，或者（序列化后执行的）函数
   * @param {...any} args 传给函数的参数
   * @returns {Promise<any>} 返回值
   */
  async evaluate(expression, ...args) {
    const code = typeof expression === 'function' ? `(${expression})(...${JSON.stringify(args)})` : expression
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true })
    if (exceptionDetails !== undefined) throw new Error(`页面脚本出错：${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    return result.value
  }

  /** 等到表达式为真。 */
  async waitFor(expression, { timeout = 30000, interval = 100, label } = {}) {
    const deadline = Date.now() + timeout
    for (;;) {
      const value = await this.evaluate(expression).catch(() => undefined)
      if (value) return value
      if (Date.now() > deadline) throw new Error(`等待超时：${label ?? expression}`)
      await sleep(interval)
    }
  }

  async goto(url) {
    await this.send('Page.navigate', { url })
  }

  /** 设置视口和配色偏好。 */
  async viewport({ width, height, colorScheme }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
    if (colorScheme !== undefined) {
      await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] })
    }
  }

  /** 截图写到文件。 */
  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
  }

  /**
   * 找元素中心点，并确认那个点上真的是它（不是正在淡出的遮罩之类）。命中不了就等一会儿再试。
   * @returns {Promise<{x: number, y: number}>} 视口坐标
   */
  async target(selector, timeout = 5000) {
    const deadline = Date.now() + timeout
    for (;;) {
      const box = await this.evaluate((sel) => {
        const element = document.querySelector(sel)
        if (element === null) return { missing: true }
        element.scrollIntoView({ block: 'center', inline: 'center' })
        const rect = element.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const hit = document.elementFromPoint(x, y)
        return { x, y, ok: hit !== null && (hit === element || element.contains(hit)), hit: hit?.tagName }
      }, selector)
      if (box.ok) return box
      if (Date.now() > deadline) throw new Error(box.missing ? `找不到元素：${selector}` : `${selector} 被别的元素（${box.hit}）挡住了`)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /** 真实的鼠标点击（走浏览器事件流，不是 element.click()）。 */
  async click(selector) {
    const { x, y } = await this.target(selector)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  /** 把鼠标移到元素上。 */
  async hover(selector) {
    const { x, y } = await this.target(selector)
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  }

  close() {
    this.socket.close()
  }
}

/**
 * 启动无头浏览器。
 * @param {string[]} [extraArgs] 额外的命令行参数
 * @returns {Promise<{newPage: () => Promise<Page>, close: () => Promise<void>}>} 浏览器句柄
 */
export async function launchChrome(extraArgs = []) {
  const profile = mkdtempSync(join(tmpdir(), 'prism-chrome-'))
  const proc = spawn(findChrome(), ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...extraArgs, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    let log = ''
    const timer = setTimeout(() => reject(new Error(`浏览器启动超时：${log.slice(0, 500)}`)), 20000)
    proc.stderr.on('data', (chunk) => {
      log += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log)
      if (match !== null) {
        clearTimeout(timer)
        resolve(new URL(match[1]))
      }
    })
    proc.on('exit', (code) => reject(new Error(`浏览器退出（${code}）：${log.slice(0, 500)}`)))
  })
  const base = `http://${endpoint.host}`
  return {
    async newPage() {
      const response = await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })
      const target = await response.json()
      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', reject, { once: true })
      })
      const page = new Page(socket)
      await page.enable()
      return page
    },
    async close() {
      proc.kill('SIGKILL')
      await sleep(100)
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
