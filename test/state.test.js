import assert from 'node:assert/strict'
import { test } from 'node:test'
import { docValues, emptyDoc, HISTORY_LIMIT, layerChange, mergeKeys, normalizeDoc, normalizeOverrides, normalizeSeed, normalizeValues, snapshotLayers, stampPatch, undoChange } from '../src/shared/state.js'

const entry = (v, t, by = 'a') => ({ v, t, by })

test('按键合并：不同的键互不覆盖，同一键时间新的赢', () => {
  let { doc } = mergeKeys(emptyDoc(), { theme: entry('mist', 10), adjust: entry({ hue: 1 }, 10) })
  assert.equal(doc.rev, 1)
  // 另一个标签页只改 adjust，时间更晚
  ;({ doc } = mergeKeys(doc, { adjust: entry({ hue: 2 }, 20, 'b') }))
  assert.equal(docValues(doc).theme, 'mist')
  assert.deepEqual(docValues(doc).adjust, { hue: 2 })
  // 旧消息晚到：不生效，版本号也不变
  const late = mergeKeys(doc, { adjust: entry({ hue: 3 }, 15) })
  assert.deepEqual(late.changed, [])
  assert.equal(late.doc, doc)
})

test('同一时刻写同一个键：无论到达顺序，所有副本结果一致', () => {
  const a = entry('mist', 100, 'tab-a')
  const b = entry('pine', 100, 'tab-b')
  const one = mergeKeys(mergeKeys(emptyDoc(), { theme: a }).doc, { theme: b }).doc
  const two = mergeKeys(mergeKeys(emptyDoc(), { theme: b }).doc, { theme: a }).doc
  assert.equal(docValues(one).theme, docValues(two).theme)
})

test('重复投递是幂等的', () => {
  const patch = { theme: entry('mist', 10) }
  const first = mergeKeys(emptyDoc(), patch).doc
  const second = mergeKeys(first, patch)
  assert.deepEqual(second.changed, [])
  assert.equal(second.doc.rev, first.rev)
})

test('看不懂的键和更高的结构版本原样保留', () => {
  const doc = normalizeDoc({ schema: 9, rev: 3, keys: { future: { v: { a: 1 }, t: 5, by: 'new' }, theme: { v: 'mist', t: 5 } } })
  assert.equal(doc.schema, 9)
  const merged = mergeKeys(doc, { theme: entry('pine', 6) }).doc
  assert.deepEqual(merged.keys.future, { v: { a: 1 }, t: 5, by: 'new' })
  assert.equal(merged.schema, 9)
})

test('存档损坏时当作空存档，不抛错', () => {
  for (const raw of [null, 'x', 1, [], { keys: 'x' }, { keys: { theme: 1 } }, { keys: { theme: { v: 'mist' } } }]) {
    assert.deepEqual(docValues(normalizeDoc(raw)).theme, null)
  }
})

test('种子清洗：越界夹紧，类型不对丢弃', () => {
  assert.deepEqual(normalizeSeed({ hue: 999, chroma: -1, neutral: 0.5, contrast: 2, depth: Number.NaN, accent: 'red', ink: 'yes', extra: 1 }), { hue: 360, chroma: 0, neutral: 0.5, contrast: 1 })
  assert.deepEqual(normalizeSeed({ accent: '#ABCDEF', ink: true }), { accent: '#abcdef', ink: true })
  assert.deepEqual(normalizeSeed(null), {})
})

test('高级覆盖清洗：拒绝能跳出声明的值和奇怪的变量名', () => {
  const clean = normalizeOverrides({
    '--dsw-alias-link': { light: '#111', dark: '#222' },
    '--ok-gradient': { light: 'linear-gradient(90deg, #000, #fff)', dark: 'none' },
    'not-a-var': { light: '#111', dark: '#222' },
    '--evil': { light: '#111;}body{display:none', dark: '#222' },
    '--evil2': { light: '</style>', dark: '#222' },
    '--half': { light: '#111' },
    '--bare': '#111',
  })
  assert.deepEqual(Object.keys(clean), ['--dsw-alias-link', '--ok-gradient'])
})

test('高级覆盖清洗：单个值最多 1024 字（放得下复杂图标的路径），再长就丢', () => {
  const path = (n) => `path("M${'1 2'.repeat(n)}")`
  const clean = normalizeOverrides({ '--icon-ok': { light: path(330), dark: path(330) }, '--icon-long': { light: path(400), dark: path(400) } })
  assert.ok(path(330).length <= 1024 && path(400).length > 1024)
  assert.deepEqual(Object.keys(clean), ['--icon-ok'])
})

test('主题 id 清洗', () => {
  assert.equal(normalizeValues({ theme: 'mist' }).theme, 'mist')
  assert.equal(normalizeValues({ theme: '../evil' }).theme, null)
  assert.equal(normalizeValues({ theme: 5 }).theme, null)
})

test('撤销：逐步退回，历史有上限', () => {
  let values = normalizeValues({})
  const apply = (next) => {
    values = normalizeValues({ ...values, ...layerChange(values, next) })
  }
  apply({ theme: 'mist' })
  apply({ theme: 'pine', adjust: { hue: 10 } })
  apply({ overrides: { '--a': { light: '#000', dark: '#fff' } } })
  assert.equal(values.history.length, 3)

  values = normalizeValues({ ...values, ...undoChange(values) })
  assert.deepEqual(values.overrides, {})
  assert.equal(values.theme, 'pine')
  values = normalizeValues({ ...values, ...undoChange(values) })
  assert.equal(values.theme, 'mist')
  assert.deepEqual(values.adjust, {})
  values = normalizeValues({ ...values, ...undoChange(values) })
  assert.equal(values.theme, null)
  assert.equal(undoChange(values), undefined, '到底了')

  for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) apply({ adjust: { hue: i } })
  assert.equal(values.history.length, HISTORY_LIMIT)
})

test('没有变化时不写任何东西，也不多记一步撤销', () => {
  const values = normalizeValues({ theme: 'mist' })
  assert.deepEqual(layerChange(values, { theme: 'mist' }), {})
  assert.deepEqual(layerChange(values, snapshotLayers(values)), {})
})

test('stampPatch 给每个键盖时间戳', () => {
  assert.deepEqual(stampPatch({ theme: 'mist', adjust: {} }, 5, 'tab'), { theme: { v: 'mist', t: 5, by: 'tab' }, adjust: { v: {}, t: 5, by: 'tab' } })
})

test('壁纸清洗：只留严格格式，进不了 CSS 片段', () => {
  const clean = (wallpaper) => normalizeValues({ wallpaper }).wallpaper
  assert.deepEqual(clean({ kind: 'image', id: 'a'.repeat(32), src: 'https://x.test/a.jpg' }), { kind: 'image', id: 'a'.repeat(32), src: 'https://x.test/a.jpg' })
  assert.equal(clean({ kind: 'image', id: '../../etc/passwd' }), null)
  assert.deepEqual(clean({ kind: 'image', id: 'a'.repeat(32), src: 'javascript:alert(1)' }), { kind: 'image', id: 'a'.repeat(32) })
  assert.deepEqual(clean({ kind: 'image', id: 'a'.repeat(32), src: 'https://x.test/a.jpg)}body{' }), { kind: 'image', id: 'a'.repeat(32) })
  assert.deepEqual(clean({ kind: 'gradient', stops: ['#112233', '#AABBCC'], angle: 400 }), { kind: 'gradient', stops: ['#112233', '#aabbcc'], angle: 360 })
  assert.equal(clean({ kind: 'gradient', stops: ['red;}', '#112233'] }), null)
  assert.deepEqual(clean({ kind: 'color', color: '#ABCDEF' }), { kind: 'color', color: '#abcdef' })
  assert.equal(clean({ kind: 'color', color: 'url(x)' }), null)
  assert.equal(clean({ kind: 'nope' }), null)
  assert.equal(clean('x'), null)
  const rotate = clean({ kind: 'rotate', items: [{ id: 'b'.repeat(32) }, { id: 'bad' }], interval: 1, shuffle: true, epoch: 5.5 })
  assert.deepEqual(rotate, { kind: 'rotate', items: [{ id: 'b'.repeat(32) }], interval: 10, shuffle: true, epoch: 5 })
  assert.equal(clean({ kind: 'rotate', items: [{ id: 'bad' }] }), null)
  assert.equal(clean({ kind: 'folder', path: 'relative/dir' }), null)
  assert.equal(clean({ kind: 'folder', path: '/a\0b' }), null)
  assert.equal(clean({ kind: 'folder', path: '/Users/x/图' }).path, '/Users/x/图')
})

test('省电三档：只认 auto / on / off，默认跟随系统，能撤销', () => {
  assert.equal(normalizeValues({}).power, 'auto')
  assert.equal(normalizeValues({ power: 'on' }).power, 'on')
  assert.equal(normalizeValues({ power: 'maybe' }).power, 'auto')
  let values = normalizeValues({})
  values = normalizeValues({ ...values, ...layerChange(values, { power: 'off' }) })
  assert.equal(values.power, 'off')
  values = normalizeValues({ ...values, ...undoChange(values) })
  assert.equal(values.power, 'auto')
})

test('玻璃感夹在 0–1；壁纸和玻璃感都能撤销', () => {
  assert.equal(normalizeValues({ glass: 2 }).glass, 1)
  assert.equal(normalizeValues({ glass: 'x' }).glass, null)
  let values = normalizeValues({})
  values = normalizeValues({ ...values, ...layerChange(values, { wallpaper: { kind: 'color', color: '#112233' }, glass: 0.7 }) })
  assert.equal(values.glass, 0.7)
  values = normalizeValues({ ...values, ...undoChange(values) })
  assert.equal(values.wallpaper, null)
  assert.equal(values.glass, null)
})
