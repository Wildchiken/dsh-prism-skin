import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { defaultStatePath, StateStore } from '../src/host/store.js'
import { docValues } from '../src/shared/state.js'

let dir
let file
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'prism-store-'))
  file = join(dir, 'sub', 'state.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const entry = (v, t, by = 'a') => ({ v, t, by })

test('路径跟随 DSH_HOME，永远不是别的目录', () => {
  assert.equal(defaultStatePath({ DSH_HOME: '/x/y' }), '/x/y/dsh-prism-skin/state.json')
  assert.ok(defaultStatePath({}).endsWith('/.dsh/dsh-prism-skin/state.json'))
})

test('文件不存在时是空存档', () => {
  assert.equal(docValues(new StateStore(file).read()).theme, null)
})

test('写入：原子落盘、权限 0600、不留临时文件', () => {
  const store = new StateStore(file)
  const { changed } = store.merge({ theme: entry('mist', 1) })
  assert.deepEqual(changed, ['theme'])
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(join(dir, 'sub')).sort(), ['state.json'])
  assert.equal(docValues(new StateStore(file).read()).theme, 'mist', '换个实例（模拟重启）还能读到')
})

test('多实例写不同的键，互不覆盖（模拟多进程）', () => {
  const a = new StateStore(file)
  const b = new StateStore(file)
  a.merge({ theme: entry('mist', 1) })
  b.merge({ adjust: entry({ hue: 3 }, 2) })
  a.merge({ overrides: entry({}, 3) })
  const values = docValues(new StateStore(file).read())
  assert.equal(values.theme, 'mist')
  assert.deepEqual(values.adjust, { hue: 3 })
})

test('旧写入不会覆盖新写入，也不碰磁盘', () => {
  const store = new StateStore(file)
  store.merge({ theme: entry('pine', 10) })
  const before = readFileSync(file, 'utf8')
  const { changed } = store.merge({ theme: entry('mist', 5) })
  assert.deepEqual(changed, [])
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('文件损坏：当作空存档继续工作，坏文件留一份', () => {
  const store = new StateStore(file)
  store.merge({ theme: entry('mist', 1) })
  writeFileSync(file, '{ 坏掉了')
  assert.equal(docValues(store.read()).theme, null)
  assert.ok(readdirSync(join(dir, 'sub')).some((name) => name.includes('.corrupt-')))
  store.merge({ theme: entry('pine', 2) })
  assert.equal(docValues(store.read()).theme, 'pine')
})

test('看不懂的键写回时保留', () => {
  const store = new StateStore(file)
  store.merge({ theme: entry('mist', 1) })
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  raw.keys.future = { v: 42, t: 1 }
  writeFileSync(file, JSON.stringify(raw))
  store.merge({ theme: entry('pine', 2) })
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).keys.future.v, 42)
})

test('锁：释放后文件消失；持锁进程崩溃留下的旧锁会失效', () => {
  const store = new StateStore(file)
  store.merge({ theme: entry('mist', 1) })
  assert.equal(existsSync(`${file}.lock`), false)

  writeFileSync(`${file}.lock`, '')
  const old = new Date(Date.now() - 60000)
  utimesSync(`${file}.lock`, old, old)
  store.merge({ theme: entry('pine', 2) })
  assert.equal(docValues(store.read()).theme, 'pine')
  assert.equal(existsSync(`${file}.lock`), false)
})

test('锁被别的进程占着时等一会儿就继续，不报错', () => {
  const store = new StateStore(file)
  store.merge({ theme: entry('mist', 1) })
  writeFileSync(`${file}.lock`, '')
  const start = Date.now()
  store.merge({ theme: entry('pine', 2) })
  assert.ok(Date.now() - start < 2000)
  assert.equal(docValues(store.read()).theme, 'pine')
  rmSync(`${file}.lock`, { force: true })
})
