/**
 * 真宿主测试工具：在临时 DSH_HOME 里装插件、起服务、操作页面。
 * 绝不碰用户的 ~/.dsh：DSH_HOME 永远指向 ~/.dsh-prism-check* 这样的临时目录。
 */
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * 建一个放在家目录下的临时 DSH_HOME（放 /tmp 下宿主模块会解析失败）。
 * @param {string} [name] 目录名后缀
 * @returns {string} 路径
 */
export function makeHome(name = 'check') {
  const home = join(homedir(), `.dsh-prism-${name}`)
  if (home === join(homedir(), '.dsh')) throw new Error('拒绝使用真实配置目录')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  return home
}

/**
 * 打包并装进 profile。
 * @param {string} hostDir 装了 @deepseek-ai/dsh 的目录
 * @param {string} home DSH_HOME
 * @returns {string} tgz 路径
 */
export function installPlugin(hostDir, home) {
  const dist = mkdtempSync(join(tmpdir(), 'prism-pack-'))
  execFileSync('npm', ['pack', '--pack-destination', dist, '--silent'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
  const tgz = join(dist, readdirSync(dist).find((name) => name.endsWith('.tgz')))
  execFileSync(cli(hostDir), ['plugin', '--profile', 'web', 'add', tgz], { env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' })
  return tgz
}

/**
 * 把 lib/ 换进已装好的插件。先 mv 再复制：pnpm 可能硬链接到全局缓存，直接覆盖会改坏缓存。
 * @param {string} home DSH_HOME
 */
export function syncLib(home) {
  const target = join(home, 'profiles/web/node_modules/dsh-prism-skin/lib')
  if (!existsSync(target)) throw new Error('插件还没装')
  const parked = mkdtempSync(join(tmpdir(), 'prism-parked-'))
  for (const name of readdirSync(target)) renameSync(join(target, name), join(parked, name))
  for (const name of readdirSync(join(ROOT, 'lib'))) copyFileSync(join(ROOT, 'lib', name), join(target, name))
}

const cli = (hostDir) => join(hostDir, 'node_modules/.bin/dsh')

/**
 * 起服务，等到日志里出现带 token 的地址。
 * @param {string} hostDir 宿主目录
 * @param {string} home DSH_HOME
 * @param {number} port 端口
 * @param {NodeJS.ProcessEnv} [extraEnv] 额外的环境变量
 * @returns {Promise<{url: string, origin: string, stop: () => Promise<void>, log: () => string}>} 句柄
 */
export async function startServer(hostDir, home, port, extraEnv = {}) {
  // 默认给一个假 Key（指向本机不可达的地址）：没有凭据时宿主会弹「Get started」引导，挡住整个页面
  // 和真实环境完全隔开：宿主会把主目录、工作目录、时区、技能列表写进系统提示词（轨迹页能看到），
  // 截图和录屏不能带出这些，所以主目录、用户名、时区、工作目录都换成临时的
  const fakeHome = join(home, 'home')
  const work = join(home, 'work')
  mkdirSync(fakeHome, { recursive: true })
  mkdirSync(work, { recursive: true })
  const env = { ...process.env, DEEPSEEK_API_KEY: 'prism-test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9/anthropic', HOME: fakeHome, USER: 'demo', LOGNAME: 'demo', TZ: 'UTC', ...extraEnv, DSH_HOME: home }
  const child = spawn(cli(hostDir), ['--profile', 'web', '--port', String(port), '--no-open'], { env, cwd: work, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const onData = (chunk) => {
    log += chunk.toString()
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const deadline = Date.now() + 90000
  let match
  while ((match = /(http:\/\/\S+\?token=\S+)/.exec(log)) === null) {
    if (child.exitCode !== null) throw new Error(`服务退出了：${log.slice(-800)}`)
    if (Date.now() > deadline) throw new Error(`服务启动超时：${log.slice(-800)}`)
    await sleep(100)
  }
  const url = match[1]
  return {
    url,
    origin: new URL(url).origin,
    log: () => log,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      for (let i = 0; i < 60 && child.exitCode === null; i += 1) await sleep(100)
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}

/**
 * 点掉首次启动的提示（预览说明等），挡住截图也挡住点击。清不干净就报错，免得后面的点击悄悄落空。
 * @param {any} page 页面
 */
export async function dismissOnboarding(page) {
  const LABELS = ['Continue', '继续', 'Skip', '跳过', 'Confirm', '确认', 'Skip anyway']
  let quiet = 0
  for (let round = 0; round < 40; round += 1) {
    const state = await page.evaluate((labels) => {
      const dialogs = [...document.querySelectorAll('[role=dialog]')]
      if (dialogs.length === 0) return 'none'
      for (const dialog of dialogs) {
        const button = [...dialog.querySelectorAll('button')].find((item) => labels.includes(item.textContent.trim()))
        if (button !== undefined) {
          button.click()
          return `clicked:${button.textContent.trim()}`
        }
      }
      return 'stuck'
    }, LABELS)
    quiet = state === 'none' ? quiet + 1 : 0
    if (quiet >= 4) return
    await sleep(state === 'none' ? 250 : 350)
  }
  const left = await page.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((dialog) => `${dialog.textContent.slice(0, 40)}（按钮：${[...dialog.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/')}）`))
  throw new Error(`首次启动的弹窗关不掉：${left.join('；')}`)
}

/**
 * 打开设置 → 棱镜。
 * @param {any} page 页面
 */
export async function openPrismSettings(page) {
  // 找到就点、点到为止：元素可能在「等到」和「点击」之间重新渲染，所以两步合在一次求值里
  const clickWhen = (expression, label) => page.waitFor(`(() => { const el = ${expression}; if (!el) return false; el.click(); return true })()`, { timeout: 8000, label })
  // 页面刚加载完时点击可能落在还没挂好的元素上：4 秒没打开就按 Esc 从头再来
  for (let attempt = 1; ; attempt += 1) {
    try {
      if (await page.evaluate(() => document.querySelector('[data-prism-section]') !== null)) return
      await clickWhen(`document.querySelector('[data-slot="settings.launcher"] button')`, '账号菜单按钮')
      await clickWhen(`[...document.querySelectorAll('[role=menuitem],[role=menu] button')].find((b) => /^(Settings|设置)/.test(b.textContent.trim()))`, '设置菜单项')
      await clickWhen(`[...document.querySelectorAll('[role=dialog] button')].find((b) => /^(Prism|棱镜)$/.test(b.textContent.trim()))`, '设置导航')
      await page.waitFor(`document.querySelector('[data-prism-section]') !== null`, { timeout: 4000, label: '棱镜设置页' })
      return
    } catch (error) {
      if (attempt >= 3) throw error
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await new Promise((done) => setTimeout(done, 800))
    }
  }
}

/**
 * 打开侧栏「换肤」面板，检查它在最上层：主题圆点中心的命中测试要落在面板里。
 * 窄窗口下宿主侧栏是带 transform、z-index 71 的抽屉，面板如果留在侧栏里会被会话列表盖住。
 * @param {any} page 页面
 * @returns {Promise<{ok: boolean, detail: string}>} 结果
 */
export async function probeQuickPanel(page) {
  await page.evaluate(() => document.querySelector('[data-prism-quick]').click())
  await page.waitFor(`(() => { const p = document.querySelector('[data-prism-panel]'); return p !== null && getComputedStyle(p).visibility !== 'hidden' && p.querySelector('[data-prism-dot]') !== null })()`, { timeout: 15000, label: '侧栏面板' })
  await sleep(300)
  const result = await page.evaluate(() => {
    const panel = document.querySelector('[data-prism-panel]')
    const dots = [...panel.querySelectorAll('[data-prism-dot]')]
    const covered = dots.filter((dot) => {
      const r = dot.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit === null || !panel.contains(hit)
    })
    let transformed = 0
    for (let node = document.querySelector('[data-prism-quick]').parentElement; node !== null; node = node.parentElement) if (getComputedStyle(node).transform !== 'none') transformed += 1
    const r = panel.getBoundingClientRect()
    return { inBody: panel.parentElement === document.body, dots: dots.length, covered: covered.length, transformed, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }
  })
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await page.waitFor(`document.querySelector('[data-prism-panel]') === null`, { timeout: 5000, label: '面板关闭' })
  return { ok: result.dots > 0 && result.covered === 0 && result.inside, transformed: result.transformed, detail: `圆点 ${result.dots} 个，被盖住 ${result.covered} 个，挂在 body：${result.inBody}，按钮祖先带 transform：${result.transformed} 层，完整在窗口内：${result.inside}` }
}

/**
 * 把窗口改窄到抽屉模式并打开侧栏抽屉。
 * @param {any} page 页面
 * @returns {Promise<boolean>} 宿主有没有抽屉模式
 */
export async function openSidebarDrawer(page) {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 1, mobile: false })
  // 0.2.1 的宿主还没有抽屉模式
  if (!(await page.evaluate(() => document.querySelector('[data-sidebar-drawer]') !== null))) await sleep(1500)
  if (!(await page.evaluate(() => document.querySelector('[data-sidebar-drawer]') !== null))) return false
  await page.evaluate(() => {
    const labels = ['Open sidebar', '打开侧栏', '展开侧栏', '显示侧栏']
    const button = [...document.querySelectorAll('button')].find((item) => labels.includes(item.getAttribute('aria-label')) && item.getBoundingClientRect().width > 0)
    button?.click()
  })
  await page.waitFor(`(() => { const r = document.querySelector('[data-prism-quick]').getBoundingClientRect(); return r.left >= 0 && r.width > 0 })()`, { timeout: 10000, label: '抽屉展开' })
  await sleep(700)
  return true
}

/**
 * 人造「祖先带 transform、会话列表有层级」的场景（桌面版实机上面板被会话列表盖住的样子）：
 * 侧栏列加 transform（自成层叠上下文、也成了 fixed 的包含块），按钮上方那块侧栏内容设 z-index 40。
 * 面板留在侧栏里就会被盖住；挂到 body 上就不受影响。
 * @param {any} page 页面
 * @returns {Promise<string>} 动了哪些元素
 */
export async function trapSidebar(page) {
  return page.evaluate(() => {
    const quick = document.querySelector('[data-prism-quick]')
    const column = quick.closest('[class*="_sidebarCol"]') ?? quick.parentElement.parentElement
    column.style.transform = 'translate(0)'
    const r = quick.getBoundingClientRect()
    let over = document.elementFromPoint(r.left + 40, r.top - 80)
    while (over !== null && over.parentElement !== null && !over.parentElement.contains(quick)) over = over.parentElement
    if (over === null || over.contains(quick)) return `侧栏列 ${column.className.slice(0, 30)}；没找到按钮上方的内容`
    over.style.position = 'relative'
    over.style.zIndex = '40'
    over.style.background = 'var(--dsw-specific-sidebar-fill)'
    over.style.minHeight = '400px'
    return `侧栏列 ${column.className.slice(0, 30)}；上方内容 ${over.tagName.toLowerCase()}.${String(over.className).slice(0, 30)}`
  })
}
