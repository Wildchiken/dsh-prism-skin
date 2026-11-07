import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromOklch, mixSrgb, over, parseHex, toHex, toOklch } from '../src/engine/color.js'
import { apca, wcag } from '../src/engine/contrast.js'

test('十六进制读写：各种写法都能解析，无效输入返回 undefined', () => {
  assert.deepEqual(parseHex('#fff'), { r: 1, g: 1, b: 1, a: 1 })
  assert.equal(parseHex('#0000').a, 0)
  assert.equal(toHex(parseHex('#12345678')), '#12345678')
  assert.equal(toHex(parseHex('#abcdef')), '#abcdef')
  assert.equal(parseHex('red'), undefined)
  assert.equal(parseHex('#12'), undefined)
  assert.equal(parseHex(undefined), undefined)
})

test('OKLCH 往返不失真', () => {
  for (const hex of ['#4176e6', '#ec1313', '#22c55e', '#f59e0b', '#151517', '#f9fafb', '#808080']) {
    const k = toOklch(parseHex(hex))
    assert.equal(toHex(fromOklch(k.l, k.c, k.h)), hex)
  }
})

test('已知 OKLCH 数值', () => {
  const white = toOklch(parseHex('#ffffff'))
  assert.ok(Math.abs(white.l - 1) < 1e-3 && white.c < 1e-3)
  assert.ok(Math.abs(toOklch(parseHex('#000000')).l) < 1e-6)
})

test('超色域时保持明度和色相，只降彩度', () => {
  const k = toOklch(fromOklch(0.9, 0.4, 25))
  assert.ok(Math.abs(k.l - 0.9) < 0.005, `明度 ${k.l}`)
  assert.ok(Math.abs(k.h - 25) < 3, `色相 ${k.h}`)
  assert.ok(k.c < 0.4)
})

test('透明度合成和 color-mix 与浏览器一致', () => {
  const half = over({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 1, g: 1, b: 1, a: 1 })
  assert.ok(Math.abs(half.r - 0.5) < 1e-9 && half.a === 1)
  // color-mix(in srgb, #ff0000 40%, transparent) = 红色，透明度 0.4
  const mixed = mixSrgb({ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0, a: 0 }, 0.4)
  assert.ok(Math.abs(mixed.a - 0.4) < 1e-9)
  assert.ok(Math.abs(mixed.r - 1) < 1e-9)
})

test('WCAG 对比度的已知值', () => {
  const ratio = (a, b) => wcag(parseHex(a), parseHex(b))
  assert.ok(Math.abs(ratio('#000', '#fff') - 21) < 1e-6)
  assert.ok(Math.abs(ratio('#fff', '#fff') - 1) < 1e-6)
  assert.ok(Math.abs(ratio('#777', '#fff') - 4.48) < 0.01)
})

test('APCA 的已知值（官方测试数据）', () => {
  const lc = (text, back) => apca(parseHex(text), parseHex(back))
  assert.ok(Math.abs(lc('#000', '#fff') - 106.04) < 0.1, `黑字白底 ${lc('#000', '#fff')}`)
  assert.ok(Math.abs(lc('#fff', '#000') - 107.88) < 0.1, `白字黑底 ${lc('#fff', '#000')}`)
  assert.ok(Math.abs(lc('#888', '#fff') - 63.06) < 0.1, `灰字白底 ${lc('#888', '#fff')}`)
  assert.ok(Math.abs(lc('#fff', '#888') - 68.54) < 0.1, `白字灰底 ${lc('#fff', '#888')}`)
  assert.equal(lc('#fff', '#fff'), 0)
})
