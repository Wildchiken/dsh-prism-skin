import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildAll, LIMITS } from '../scripts/build.mjs'
import { CONFLICT_MARKS } from '../src/client/conflicts.js'
import { CSS } from '../src/client/studio/styles.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let outdir
let result
let files

before(async () => {
  outdir = mkdtempSync(join(tmpdir(), 'prism-build-'))
  result = await buildAll(outdir)
  files = Object.fromEntries(readdirSync(outdir).map((name) => [name, readFileSync(join(outdir, name), 'utf8')]))
})
after(() => rmSync(outdir, { recursive: true, force: true }))

/** 假的 React：Component 要能被 extends，其余都是空函数。 */
const fakeReact = () => new Proxy({ Component: class {} }, { get: (target, key) => (key in target ? target[key] : () => undefined) })

/** 在假的模块加载器里执行一个客户端文件；document、BroadcastChannel 都不给，模拟最差的环境。 */
function loadInSandbox(text) {
  const registered = {}
  const window = { __ModuleLoader__: { load: (row) => (registered[row.chunk ?? 'entry'] = row) } }
  new Function('window', 'document', 'BroadcastChannel', text)(window, undefined, undefined)
  return registered
}

const clientFiles = () => Object.keys(files).filter((name) => name.startsWith('client'))

/** 递归列出 src/client 下的源码。 */
function clientSources(dir = join(root, 'src/client')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? clientSources(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []))
}

test('体积门：入口 ≤ 25KB，客户端合计 ≤ 150KB，单文件 < 262144 B', () => {
  assert.equal(LIMITS.entry, 25 * 1024)
  assert.equal(LIMITS.clientTotal, 150 * 1024)
  assert.equal(LIMITS.anyFile, 262144)
  assert.deepEqual(result.failures, [])
  assert.ok(result.entry <= LIMITS.entry, `入口 ${result.entry} B`)
  assert.ok(result.clientTotal <= LIMITS.clientTotal, `合计 ${result.clientTotal} B`)
  for (const [name, text] of Object.entries(files)) assert.ok(Buffer.byteLength(text) < LIMITS.anyFile, name)
})

test('入口不带配色引擎和界面（都在懒加载分块里）', () => {
  assert.ok(!files['client.js'].includes('alias-bg-base=$static'), '变量表不应在入口')
  assert.ok(!files['client.js'].includes('prism-gallery'), '界面样式不应在入口')
  assert.ok(files['client.studio.js'].includes('alias-bg-base=$static'))
})

test('文件形状符合宿主的模块加载约定', () => {
  assert.ok(files['client.js'].startsWith('window.__ModuleLoader__.load({id:"dsh-prism-skin",factory:(require)=>{'))
  assert.ok(files['client.js'].includes('.async("./client.studio.js")') || /async\([a-zA-Z_$]+\)/.test(files['client.js']))
  for (const name of clientFiles().filter((item) => item !== 'client.js')) {
    assert.match(name, /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/)
    assert.ok(files[name].startsWith(`window.__ModuleLoader__.load({id:"dsh-prism-skin",chunk:${JSON.stringify(name)},factory:(require)=>{`), name)
  }
})

test('客户端文件能在假的模块加载器里跑起来，导出宿主要的字段', () => {
  const required = []
  const seeds = {
    react: fakeReact(),
    '@deepseek-ai/dsh-client-store': { defineStore: () => ({}) },
  }
  const registered = loadInSandbox(files['client.js'])
  const require = (spec) => {
    required.push(spec)
    return seeds[spec] ?? {}
  }
  require.async = async () => ({})
  const exported = registered.entry.factory(require)
  assert.equal(exported.name, 'dsh-prism-skin')
  assert.deepEqual(exported.inject, ['slots', 'locale', 'theme'])
  assert.equal(typeof exported.apply, 'function')
  assert.ok(required.includes('react'))
  for (const spec of required) assert.ok(['react', '@deepseek-ai/dsh-client-store'].includes(spec), `入口只依赖 seed：${spec}`)
})

test('入口的钩子全部兜底：apply 抛错也不影响宿主', () => {
  const registered = loadInSandbox(files['client.js'])
  const require = (spec) => (spec === 'react' ? fakeReact() : { defineStore: () => ({}) })
  require.async = async () => ({})
  const { apply } = registered.entry.factory(require)
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.doesNotThrow(() => apply({}))
  } finally {
    console.warn = warn
  }
})

test('样式：没有实时模糊、没有 !important，选择器全是自己的 prism- 类', () => {
  assert.ok(!/backdrop-filter\s*:/.test(CSS))
  assert.ok(!CSS.includes('!important'))
  for (const name of clientFiles()) {
    assert.ok(!/[^-]backdrop-filter\s*:/.test(files[name]), `${name} 里有实时模糊`)
  }
  const selectors = [...CSS.matchAll(/(^|})([^{}]+)\{/g)].flatMap((match) => match[2].split(','))
  assert.ok(selectors.length > 20)
  for (const selector of selectors) assert.match(selector.trim(), /^\.prism-/, selector)
})

test('宿主哈希类名选择器 0 个；对宿主 DOM 只用白名单里的 data 属性', () => {
  const HASHED = /[._][A-Za-z0-9-]{5,6}_[a-zA-Z]+/
  const QUERY = /(?:querySelector(?:All)?|closest|matches)\??\.?\(\s*[`'"]([^`'"]+)[`'"]/g
  const ALLOWED = /^(?:\[data-prism-[a-z-]+\]|style\[data-prism-[a-z-]+\])$/
  for (const file of clientSources()) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(QUERY)) {
      const selector = match[1].replace('${STYLE_ID}', 'data-prism-studio')
      assert.ok(!HASHED.test(selector), `${file}: ${selector}`)
      assert.match(selector, ALLOWED, `${file}: ${selector}`)
    }
  }
  assert.ok(!HASHED.test(CSS), '样式里有哈希类名')
})

test('默认不挂 subtree MutationObserver', () => {
  for (const file of clientSources()) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    assert.ok(!/subtree\s*:/.test(text), file)
  }
  for (const name of clientFiles()) assert.ok(!/subtree\s*:\s*(!0|true)/.test(files[name]), name)
})

test('冲突检测只读，不写别的插件的属性', () => {
  assert.deepEqual(CONFLICT_MARKS.map((mark) => mark.attribute), ['data-dsh-skin', 'data-dsh-claude-style'])
  for (const file of clientSources()) {
    const text = readFileSync(file, 'utf8')
    assert.ok(!/setAttribute\([^)]*data-dsh-/.test(text), file)
    assert.ok(!/\.dataset\.dsh/.test(text), file)
  }
})

test('package.json：形状和兼容范围', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-prism-skin')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  // 每段都带预发布标签：按 node-semver 默认规则（第三方商店常用）也认实测过的 0.2.1-rc.5 和 0.2.2-rc.1，宿主自己本来就放行预发布
  assert.equal(pkg.engines.dsh, '>=0.2.1-rc.5 <0.2.2-0 || >=0.2.2-rc.1 <0.3.0-0')
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  assert.equal(pkg.repository.url, 'git+https://github.com/Wildchiken/dsh-prism-skin.git')
  for (const file of ['NOTICE', 'LICENSE', 'README.md', 'README.en.md', 'CHANGELOG.md']) assert.ok(pkg.files.includes(file), file)
  assert.ok(!pkg.files.some((file) => file.startsWith('docs') || file.startsWith('src') || file.startsWith('test')), '截图、源码、测试不进包')
  assert.ok(pkg.files.includes('lib/*.js'))
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], '运行时没有依赖')
})
