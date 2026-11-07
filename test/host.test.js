import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import vm from 'node:vm'
import { generate, themeById } from '../src/engine/index.js'
import { apply, inject, isTrustedRequest, name, sanitizePatch } from '../src/host/index.js'
import { BOOT_GLOBAL, bootRows, bootStyleText, packTokens, unpackTokens } from '../src/shared/boot.js'

let home
let server
let port
let previousHome
let injectListeners

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'prism-host-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  injectListeners = []
  let route
  const ctx = {
    on: (event, listener) => {
      if (event === 'webserver/index-inject') injectListeners.push(listener)
    },
    effect: (callback) => callback(),
    get: (key) => (key === 'webStartup' ? { trustedHosts: ['app.example.test:8443'] } : undefined),
    webServer: {
      register(definition) {
        route = definition
        return () => {}
      },
    },
  }
  apply(ctx)
  assert.equal(route.kind, 'prefix')
  server = createServer((req, res) => {
    if (route.path === new URL(req.url, 'http://x').pathname.slice(0, route.path.length)) return route.handler(req, res)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

const api = (path = '/prism-skin/api/state', init = {}) => fetch(`http://127.0.0.1:${port}${path}`, init)
const post = (body, headers = {}) => api('/prism-skin/api/state', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const entry = (v, t = Date.now()) => ({ v, t, by: 'test' })
const collectRows = () => {
  const table = []
  for (const listener of injectListeners) listener(table)
  return table
}

test('插件元信息', () => {
  assert.equal(name, 'dsh-prism-skin')
  assert.deepEqual(inject, ['webServer'])
})

test('读写设置：写入后 host 算好变量返回', async () => {
  const empty = await (await api()).json()
  assert.equal(empty.ok, true)
  assert.equal(empty.layer.t, null)

  const written = await (await post({ patch: { theme: entry('sand') } })).json()
  assert.deepEqual(written.changed, ['theme'])

  const after = await (await api()).json()
  assert.equal(after.doc.keys.theme.v, 'sand')
  assert.deepEqual(unpackTokens(after.layer.t), generate(themeById('sand').seed))
})

test('接口：未知路径 404、方法不对 405、坏 JSON 400、超大请求 413', async () => {
  assert.equal((await api('/prism-skin/api/other')).status, 404)
  assert.equal((await api('/prism-skin/api/state', { method: 'DELETE' })).status, 405)
  assert.equal((await post('{ 坏')).status, 400)
  const huge = await post({ patch: { theme: entry('x'.repeat(600 * 1024)) } }).then((res) => res.status).catch(() => 413)
  assert.equal(huge, 413)
})

test('写入时清洗：只接受认识的键，值不合法就落回默认', async () => {
  await post({ patch: { theme: entry('../../evil'), adjust: entry({ hue: 9999, junk: 1 }), secret: entry('x'), overrides: entry({ '--a': { light: '#000;}', dark: '#fff' } }) } })
  const { doc } = await (await api()).json()
  assert.equal(doc.keys.theme.v, null)
  assert.deepEqual(doc.keys.adjust.v, { hue: 360 })
  assert.deepEqual(doc.keys.overrides.v, {})
  assert.equal(doc.keys.secret, undefined)
})

test('sanitizePatch：没有时间戳的键丢弃，写入方截断', () => {
  assert.deepEqual(sanitizePatch(null), {})
  assert.deepEqual(sanitizePatch({ theme: { v: 'mist' } }), {})
  const clean = sanitizePatch({ theme: { v: 'mist', t: 1, by: 'x'.repeat(200) } })
  assert.equal(clean.theme.by.length, 64)
})

test('信任判断：只放行本机或受信地址上的同源请求', () => {
  const trusted = ['app.example.test:8443', 'lan.example.test']
  const check = (headers) => isTrustedRequest({ headers }, trusted)
  assert.equal(check({ host: '127.0.0.1:9000' }), true)
  assert.equal(check({ host: 'localhost:9000', origin: 'http://localhost:9000' }), true)
  assert.equal(check({ host: '[::1]:9000' }), true)
  assert.equal(check({ host: 'app.example.test:8443', origin: 'https://app.example.test:8443' }), true)
  assert.equal(check({ host: 'lan.example.test:1234' }), true, '受信地址没写端口时不限端口')

  assert.equal(check({}), false, '没有 Host')
  assert.equal(check({ host: 'evil.test' }), false, '陌生 Host（DNS 重绑定）')
  assert.equal(check({ host: 'app.example.test:9999' }), false, '受信地址写了端口就要匹配')
  assert.equal(check({ host: '127.0.0.1:9000', origin: 'http://evil.test' }), false, '跨站来源')
  assert.equal(check({ host: '127.0.0.1:9000', origin: 'null' }), false, '不透明来源')
  assert.equal(check({ host: '127.0.0.1:9000', 'sec-fetch-site': 'cross-site' }), false)
})

test('跨站请求被接口拒绝', async () => {
  const res = await post({ patch: { theme: entry('mist') } }, { origin: 'http://evil.test' })
  assert.equal(res.status, 403)
  assert.equal((await (await api()).json()).doc.keys.theme, undefined)
})

test('首屏注入：没设主题时不写变量，设了主题时在 head 放亮暗两份样式', async () => {
  const before = collectRows()
  assert.deepEqual(before.map((row) => row.kind), ['style', 'global', 'script'])
  assert.equal(before.find((row) => row.kind === 'global').value.tokens, undefined)

  await post({ patch: { theme: entry('pine') } })
  const rows = collectRows()
  assert.deepEqual(rows.map((row) => row.kind), ['style', 'style', 'global', 'script'])
  const payload = rows.find((row) => row.kind === 'global')
  assert.equal(payload.name, BOOT_GLOBAL)
  assert.equal(payload.value.doc.keys.theme.v, 'pine')
  assert.equal(rows[1].text, bootStyleText(generate(themeById('pine').seed)))
  assert.equal(rows.find((row) => row.kind === 'script').placement, 'body')
})

test('首屏注入：样式里的值来自引擎和清洗过的覆盖，跳不出声明，也闭合不了标签', async () => {
  await post({ patch: { overrides: entry({ '--dsw-alias-link': { light: 'url(x)', dark: '</style><script>' }, '--ok': { light: 'url(a:b)', dark: 'red' } }) } })
  const rows = collectRows()
  for (const row of rows) {
    if (row.kind === 'style') assert.ok(!row.text.includes('</style') && !row.text.includes('<'))
    if (row.kind === 'script') assert.ok(!row.text.includes('</script'))
  }
  assert.ok(rows.some((row) => row.kind === 'style' && row.text.includes('--ok:url(a:b);')))
})

test('「我的主题」：写入时清洗，首屏带上主题自带的 CSS，用户的接在后面', async () => {
  const pack = { id: 'hud001', name: 'HUD', seed: themeById('pine').seed, css: 'body{color:red}', junk: 1 }
  await post({ patch: { library: entry([pack, { id: 'X', name: 'bad' }]), theme: entry('my-hud001'), css: entry('a{color:blue}') } })
  const { doc } = await (await api()).json()
  assert.deepEqual(doc.keys.library.v, [{ id: 'hud001', name: 'HUD', seed: themeById('pine').seed, css: 'body{color:red}' }])
  const rows = collectRows()
  assert.ok(rows.some((row) => row.kind === 'style' && row.text.endsWith('body{color:red}\na{color:blue}')))
  assert.equal(rows.find((row) => row.kind === 'global').value.doc.keys.theme.v, 'my-hud001')
})

test('首屏注入：读不了设置时不影响页面渲染', () => {
  rmSync(join(home, 'dsh-prism-skin'), { recursive: true, force: true })
  mkdirSync(join(home, 'dsh-prism-skin', 'state.json'), { recursive: true })
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.deepEqual(collectRows(), [])
  } finally {
    console.warn = warn
  }
})

test('接口出错时返回 500，不把路径之类的内部信息带出去', async () => {
  rmSync(join(home, 'dsh-prism-skin'), { recursive: true, force: true })
  mkdirSync(join(home, 'dsh-prism-skin', 'state.json'), { recursive: true })
  const error = console.error
  console.error = () => {}
  try {
    const res = await api()
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.ok(!text.includes(home))
  } finally {
    console.error = error
  }
})

/** 在假 DOM 里执行首屏样式 + 首屏脚本。 */
function runBoot({ dark, source = 'system', systemDark = false, tokens, opaque = null, reduce = false, power, global = {} }) {
  const inline = new Map()
  const attributes = new Set(dark ? ['data-ds-dark-theme'] : [])
  const rootAttributes = new Set(source === null ? [] : ['data-ds-theme-source'])
  const doc = power === undefined ? {} : { keys: { power: { v: power, t: 1 } } }
  const rows = bootRows({ doc, version: 'x', layer: { tokens, opaque, wall: null } })
  const styles = rows.filter((row) => row.kind === 'style').map((row) => ({
    textContent: row.text,
    parentNode: { removeChild: (element) => (element.removed = true) },
  }))
  const sandbox = {
    document: {
      getElementsByTagName: (name) => (name === 'style' ? styles : []),
      body: { hasAttribute: (key) => attributes.has(key), style: { setProperty: (key, value) => inline.set(key, value) } },
      documentElement: { hasAttribute: (key) => rootAttributes.has(key) },
    },
    matchMedia: (text) => ({ matches: text.includes('transparency') ? reduce : systemDark }),
    performance: { now: () => 1 },
  }
  sandbox.globalThis = sandbox
  Object.assign(global, rows.find((row) => row.kind === 'global').value)
  sandbox[BOOT_GLOBAL] = global
  vm.runInNewContext(rows.find((row) => row.kind === 'script').text, sandbox)
  return { inline, global, styles }
}

test('首屏脚本：按宿主定好的明暗写行内变量，删掉首屏样式，把变量留给客户端', () => {
  const tokens = { '--a': { light: '#111', dark: '#222' }, '--g': { light: 'linear-gradient(180deg, #fff 20.19%, #fff0 100%)', dark: 'url(a:b)' } }
  const light = runBoot({ dark: false, tokens })
  assert.equal(light.inline.get('--a'), '#111')
  assert.equal(light.inline.get('--g'), 'linear-gradient(180deg, #fff 20.19%, #fff0 100%)')
  assert.deepEqual(unpackTokens(light.global.tokens), tokens)
  assert.equal(light.styles[1].removed, true, '首屏样式删掉了')
  assert.equal(light.styles[0].removed, undefined, '背景规则留着')
  assert.equal(runBoot({ dark: true, tokens }).inline.get('--g'), 'url(a:b)')
})

test('首屏脚本：宿主脚本还没跑时退回系统偏好', () => {
  const tokens = { '--a': { light: '#111', dark: '#222' } }
  assert.equal(runBoot({ dark: false, source: null, systemDark: true, tokens }).inline.get('--a'), '#222')
  assert.equal(runBoot({ dark: false, source: null, systemDark: false, tokens }).inline.get('--a'), '#111')
  // 宿主已经决定是亮色时，不因为系统是暗色而改变
  assert.equal(runBoot({ dark: false, source: 'light', systemDark: true, tokens }).inline.get('--a'), '#111')
})

test('首屏脚本：系统开了减少透明度时直接用不透明的那份', () => {
  const tokens = { '--a': { light: 'url(x) fixed', dark: 'url(y) fixed' }, '--b': { light: '#111', dark: '#222' } }
  const opaque = { '--a': { light: '#aaa', dark: '#bbb' } }
  assert.equal(runBoot({ dark: true, tokens, opaque }).inline.get('--a'), 'url(y) fixed')
  const reduced = runBoot({ dark: true, tokens, opaque, reduce: true })
  assert.equal(reduced.inline.get('--a'), '#bbb')
  assert.equal(reduced.inline.get('--b'), '#222')
})

test('首屏脚本：省电三档——开就换纯色，关就算系统减少透明度也不换', () => {
  const tokens = { '--a': { light: 'url(x) fixed', dark: 'url(y) fixed' } }
  const opaque = { '--a': { light: '#aaa', dark: '#bbb' } }
  assert.equal(runBoot({ dark: true, tokens, opaque, power: 'on' }).inline.get('--a'), '#bbb')
  assert.equal(runBoot({ dark: true, tokens, opaque, power: 'off', reduce: true }).inline.get('--a'), 'url(y) fixed')
  assert.equal(runBoot({ dark: true, tokens, opaque, power: 'auto', reduce: true }).inline.get('--a'), '#bbb')
})

test('首屏脚本：没有变量时什么都不做', () => {
  const result = runBoot({ dark: true, tokens: null })
  assert.equal(result.inline.size, 0)
  assert.equal(result.global.tokens, undefined)
})

test('首屏脚本：引擎生成的整套变量往返不丢', () => {
  const tokens = generate(themeById('ember').seed)
  const { inline, global } = runBoot({ dark: true, tokens })
  assert.deepEqual(unpackTokens(global.tokens), tokens)
  assert.equal(inline.size, Object.keys(tokens).length)
})

test('紧凑形式往返不丢东西', () => {
  const tokens = generate(themeById('iris').seed)
  assert.deepEqual(unpackTokens(JSON.parse(JSON.stringify(packTokens(tokens)))), tokens)
  assert.equal(packTokens(null), null)
  assert.equal(unpackTokens(undefined), null)
})
