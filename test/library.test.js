import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveLayer, seedOf } from '../src/engine/index.js'
import { effectiveCss, layerChange, LIBRARY_LIMIT, normalizeLibrary, normalizeName, normalizeValues, packOf, undoChange } from '../src/shared/state.js'

const SEED = { hue: 18, chroma: 1.4, neutral: 1, contrast: 0.3, depth: -0.9, accent: '#ff5a4f' }
const PACK = { id: 'abc123', name: '赤红 HUD', seed: SEED, radius: 0, overrides: { '--dsw-alias-link': { light: '#000000', dark: '#5ef6ff' } }, css: 'body{color:red}', scheme: 'dark' }

test('「我的主题」：丢掉坏条目和重复 id，坏 CSS 只丢 CSS，最多 LIBRARY_LIMIT 个', () => {
  const library = normalizeLibrary([
    PACK,
    { ...PACK, name: '重复' },
    { ...PACK, id: 'BAD!' },
    { ...PACK, id: 'noname', name: '   ' },
    { ...PACK, id: 'hostpal', seed: {} },
    { ...PACK, id: 'badcss', css: '@import "x"' },
  ])
  assert.deepEqual(library.map((pack) => pack.id), ['abc123', 'hostpal', 'badcss'])
  assert.deepEqual(library[1].seed, {})
  assert.equal(library[2].css, undefined)
  assert.equal(library[0].scheme, 'dark')
  const many = Array.from({ length: LIBRARY_LIMIT + 10 }, (_, i) => ({ ...PACK, id: `p${String(i).padStart(4, '0')}` }))
  assert.equal(normalizeLibrary(many).length, LIBRARY_LIMIT)
  assert.deepEqual(normalizeLibrary('nope'), [])
})

test('主题名：去掉控制字符和首尾空白，截到 60 字', () => {
  assert.equal(normalizeName('  赤红\u0000 HUD\n '), '赤红 HUD')
  assert.equal([...normalizeName('长'.repeat(80))].length, 60)
  assert.equal(normalizeName(42), '')
})

test('选中「我的主题」：种子、覆盖、圆角、CSS 都按主题来，用户的修改再盖上去', () => {
  const values = normalizeValues({ theme: 'my-abc123', library: [PACK], overrides: { '--dsw-alias-link': { light: '#111111', dark: '#222222' } }, css: 'a{color:blue}' })
  assert.equal(packOf(values)?.name, '赤红 HUD')
  assert.equal(seedOf(values)?.hue, 18)
  const { tokens } = resolveLayer(values, null)
  assert.equal(tokens?.['--dsw-alias-link'].dark, '#222222')
  assert.equal(tokens?.['--dsw-radius-md'].dark, '0px')
  assert.equal(effectiveCss(values), 'body{color:red}\na{color:blue}')
  assert.equal(resolveLayer({ ...values, radius: 1 }, null).tokens?.['--dsw-radius-md'].dark, '12px')
  const own = normalizeValues({ theme: 'my-abc123', library: [PACK] })
  assert.equal(resolveLayer(own, null).tokens?.['--dsw-alias-link'].dark, '#5ef6ff')
  assert.equal(effectiveCss(own), 'body{color:red}')
})

test('选中的「我的主题」被删了：等于宿主默认，不报错', () => {
  const values = normalizeValues({ theme: 'my-gone99', library: [PACK] })
  assert.equal(packOf(values), undefined)
  assert.equal(resolveLayer(values, null).tokens, null)
  assert.equal(effectiveCss(values), '')
})

test('「我的主题」不进撤销历史：撤销换主题，主题还留在列表里', () => {
  const values = normalizeValues({ library: [PACK] })
  const change = layerChange(values, { theme: 'my-abc123' })
  assert.equal(change.theme, 'my-abc123')
  assert.equal('library' in (change.history?.at(-1) ?? {}), false)
  const after = normalizeValues({ ...values, ...change })
  const undo = undoChange(after)
  assert.equal(undo?.theme, null)
  assert.equal(undo !== undefined && 'library' in undo, false)
  assert.equal(normalizeValues({ ...after, ...undo }).library.length, 1)
})

test('种子为空的「我的主题」（在宿主默认上存下的）：配色沿用宿主，只叠上它自带的覆盖和 CSS', () => {
  const values = normalizeValues({ theme: 'my-host01', library: [{ id: 'host01', name: '只有 CSS', seed: {}, css: 'a{color:red}', overrides: { '--x': { light: '#000000', dark: '#ffffff' } } }] })
  assert.equal(seedOf(values), undefined)
  assert.deepEqual(resolveLayer(values, null).tokens, { '--x': { light: '#000000', dark: '#ffffff' } })
  assert.equal(effectiveCss(values), 'a{color:red}')
})
