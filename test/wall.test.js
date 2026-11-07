import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boxBlur, analyze } from '../src/client/wall/process.js'
import { parseHex, toOklch } from '../src/engine/color.js'
import { auditSeed, BASE_SEED, colorWall, generate, GRADIENTS, gradientWall, imageWall, resolveLayer, seedFromWall, seedOf, SOLIDS, stopsDerived, THEMES, themeById } from '../src/engine/index.js'
import { effectiveTokens } from '../src/shared/boot.js'

function randomFrom(start) {
  let x = start
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

const hex = (rand) => `#${[0, 0, 0].map(() => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('')}`
const IMAGE = imageWall('/prism-skin/api/wallpaper/blur/abc.jpg', { base: '#556070', samples: ['#10202c', '#d8d0c0', '#556070'] })

test('玻璃：亮暗两种模式、各种壁纸和玻璃感，文字对比度全部达标', () => {
  const walls = [...GRADIENTS.map(gradientWall), ...SOLIDS.map(colorWall), IMAGE]
  for (const theme of THEMES) {
    for (const wall of walls) {
      for (const level of [0.3, 1]) assert.deepEqual(auditSeed(theme.seed, { level, wall }).filter((row) => !row.pass), [], `${theme.id} ${wall.kind} ${level}`)
    }
  }
})

test('玻璃：随机壁纸（含纯黑到纯白的极端）也全部达标', () => {
  const rand = randomFrom(20261106)
  for (let i = 0; i < 120; i += 1) {
    const samples = [hex(rand), hex(rand), i % 4 === 0 ? '#000000' : hex(rand), i % 4 === 0 ? '#ffffff' : hex(rand)]
    const seed = { ...THEMES[i % THEMES.length].seed, contrast: rand() * 2 - 1, depth: rand() * 2 - 1 }
    const wall = imageWall('/x.jpg', { base: samples[0], samples })
    assert.deepEqual(auditSeed(seed, { level: rand(), wall }).filter((row) => !row.pass), [], JSON.stringify({ seed, samples }))
  }
})

test('玻璃感太高时自动降下来；反差小的壁纸能照设定走', () => {
  const seed = themeById('mist').seed
  const easy = generate(seed, { level: 0.5, wall: gradientWall(GRADIENTS[4]) })
  assert.equal(easy['--prism-glass'].light, '0.50')
  const hard = generate(seed, { level: 1, wall: imageWall('/x.jpg', { base: '#000000', samples: ['#000000', '#ffffff'] }) })
  assert.ok(Number(hard['--prism-glass'].light) < 1)
  assert.ok(Number(hard['--prism-glass'].dark) < 1)
})

test('输出形状：大表面是视口固定的合成背景，卡片是半透明色，浮层保持不透明', () => {
  const tokens = generate(themeById('mist').seed, { level: 0.5, wall: IMAGE })
  for (const mode of ['light', 'dark']) {
    for (const name of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill']) {
      assert.match(tokens[name][mode], /url\("\/prism-skin\/api\/wallpaper\/blur\/abc\.jpg"\) center \/ cover no-repeat fixed,#[0-9a-f]{6}$/, name)
      assert.ok(!/[;{}<>\\]/.test(tokens[name][mode]))
    }
    // 输入框卡片在滚动容器里，不能用固定背景（滚动时会整块重画）
    assert.match(tokens['--dsw-specific-input-major'][mode], /^#[0-9a-f]{6}$/)
    assert.match(tokens['--dsw-alias-bg-layer-1'][mode], /^#[0-9a-f]{8}$/)
    assert.match(tokens['--dsw-specific-bubble'][mode], /^#[0-9a-f]{8}$/)
    for (const name of ['--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-markdown-code-block', '--dsw-alias-tooltip-bg', '--dsw-alias-toast-bg']) {
      assert.match(tokens[name][mode], /^#[0-9a-f]{6}$/, name)
    }
    assert.ok(parseHex(tokens['--dsw-specific-menu'][mode]).a > 0.9)
    assert.equal(tokens['--dsw-menu-backdrop-filter'][mode], 'none')
  }
  const docked = generate(themeById('mist').seed, { level: 0.5, wall: { ...IMAGE, dock: '#ff0000' } })
  assert.notEqual(docked['--dsw-specific-input-major'].dark, tokens['--dsw-specific-input-major'].dark, '输入框颜色跟着卡片位置的壁纸颜色走')
})

test('纯色壁纸不用合成背景：直接算成纯色，没有任何开销', () => {
  const tokens = generate(themeById('pine').seed, { level: 0.5, wall: colorWall('#20242e') })
  for (const mode of ['light', 'dark']) {
    for (const name of ['--dsw-alias-bg-base', '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-alias-bg-layer-1']) assert.match(tokens[name][mode], /^#[0-9a-f]{6}$/, name)
  }
  assert.notEqual(tokens['--dsw-alias-bg-base'].dark, generate(themeById('pine').seed)['--dsw-alias-bg-base'].dark)
})

test('玻璃感为 0：和没有壁纸时完全一样，不留合成背景', () => {
  const seed = themeById('sand').seed
  const layer = resolveLayer({ theme: 'sand', custom: null, adjust: {}, overrides: {}, wallpaper: { kind: 'image', id: 'a'.repeat(32) }, glass: 0 }, IMAGE)
  assert.deepEqual(layer.tokens, generate(seed))
  assert.equal(layer.opaque, null)
})

test('省电：替换项换掉所有玻璃表面，换完是按壁纸平均色算的不透明纯色，没有固定背景', () => {
  const values = { theme: 'iris', custom: null, adjust: {}, overrides: {}, wallpaper: { kind: 'image', id: 'a'.repeat(32) }, glass: 0.6 }
  const layer = resolveLayer(values, IMAGE)
  assert.ok(layer.opaque !== null)
  assert.ok(layer.tokens['--dsw-alias-bg-base'].light.includes('url('))
  const flat = effectiveTokens(layer, true)
  const expected = generate(themeById('iris').seed, { level: 0.6, wall: colorWall(IMAGE.base) })
  for (const name of Object.keys(expected)) assert.deepEqual(flat[name], expected[name], name)
  for (const [name, value] of Object.entries(flat)) {
    for (const mode of ['light', 'dark']) assert.ok(!/url\(|fixed/.test(value[mode]), `${name} 还有固定背景`)
  }
  assert.notDeepEqual(flat['--dsw-alias-bg-base'], generate(themeById('iris').seed)['--dsw-alias-bg-base'], '颜色来自壁纸，不是纯主题色')
  assert.deepEqual(auditSeed(themeById('iris').seed, { level: 0.6, wall: colorWall(IMAGE.base) }).filter((row) => !row.pass), [])
  assert.equal(effectiveTokens(layer, false), layer.tokens)
})

test('纯色壁纸本来就全是纯色，省电时没有要换的', () => {
  const values = { theme: 'iris', custom: null, adjust: {}, overrides: {}, wallpaper: { kind: 'color', color: '#223344' }, glass: 0.5 }
  assert.equal(resolveLayer(values, colorWall('#223344')).opaque, null)
})

test('壁纸还没分析好时先出不透明主题；不选主题但有壁纸时用基底种子', () => {
  const values = { theme: null, custom: null, adjust: {}, overrides: {}, wallpaper: { kind: 'image', id: 'a'.repeat(32) }, glass: null }
  assert.deepEqual(seedOf(values), BASE_SEED)
  assert.deepEqual(resolveLayer(values, null).tokens, generate(BASE_SEED))
  assert.equal(resolveLayer({ ...values, wallpaper: null }, null).tokens, null)
})

test('高级覆盖仍然盖在玻璃上面', () => {
  const pair = { light: '#111111', dark: '#eeeeee' }
  const layer = resolveLayer({ theme: 'mist', custom: null, adjust: {}, overrides: { '--dsw-alias-bg-base': pair }, wallpaper: { kind: 'image', id: 'a'.repeat(32) }, glass: 0.5 }, IMAGE)
  assert.deepEqual(layer.tokens['--dsw-alias-bg-base'], pair)
  assert.equal(layer.opaque['--dsw-alias-bg-base'], undefined)
})

test('渐变：中间比两端都暗的情况也采样到了', () => {
  const wall = gradientWall({ stops: ['#ff0000', '#00ff00'], angle: 90 })
  const luma = (value) => toOklch(parseHex(value)).l
  assert.ok(Math.min(...wall.samples.map(luma)) < Math.min(luma('#ff0000'), luma('#00ff00')))
  assert.match(wall.css, /^linear-gradient\(90deg,#ff0000 0%,#00ff00 100%\) fixed$/)
  // 90° 从左到右：卡片在 60% 处，偏绿一点
  const dock = parseHex(wall.dock)
  assert.ok(dock.g > dock.r, wall.dock)
})

test('取色：深色蓝图生成蓝调、偏深的种子；对比度由引擎保证', () => {
  const derived = { base: '#1c2a44', palette: [{ hex: '#1a2a4a', l: 0.3, c: 0.06, h: 260, weight: 0.7 }, { hex: '#d9702e', l: 0.66, c: 0.15, h: 50, weight: 0.1 }, { hex: '#222222', l: 0.25, c: 0, h: 0, weight: 0.2 }] }
  const seed = seedFromWall(derived)
  assert.ok(Math.abs(seed.hue - 260) < 1)
  assert.ok(seed.depth < 0)
  const accent = toOklch(parseHex(seed.accent))
  assert.ok(Math.abs(accent.h - 50) < 8, `强调色取最鲜艳的那种：${seed.accent}`)
  assert.deepEqual(auditSeed(seed).filter((row) => !row.pass), [])
})

test('取色：灰白的图也有合法结果；渐变和纯色走同一条路', () => {
  const seed = seedFromWall({ base: '#cccccc', palette: [{ hex: '#cccccc', l: 0.85, c: 0, h: 0, weight: 1 }] })
  assert.match(seed.accent, /^#[0-9a-f]{6}$/)
  assert.deepEqual(auditSeed(seed).filter((row) => !row.pass), [])
  const fromStops = seedFromWall(stopsDerived(GRADIENTS[0].stops))
  assert.match(fromStops.accent, /^#[0-9a-f]{6}$/)
})

/** 造一张左黑右白的图。 */
function splitImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = x < width / 2 ? 0 : 255
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  }
  return data
}

test('模糊：边界变柔和，边缘不发黑，透明度不动', () => {
  const data = splitImage(64, 16)
  boxBlur(data, 64, 16, 6)
  const at = (x, y = 8) => data[(y * 64 + x) * 4]
  assert.equal(at(0), 0, '最左边还是黑的')
  assert.ok(at(63) >= 254, '最右边还是白的，没有向边外渐暗')
  assert.ok(at(32) > 80 && at(32) < 180, `中间变成灰：${at(32)}`)
  assert.equal(data[3], 255)
})

test('分析：找到最暗和最亮的像素、平均色和主色', () => {
  const data = splitImage(40, 40)
  const stats = analyze(data, 40, 40)
  assert.deepEqual(stats.samples.slice(0, 2), ['#000000', '#ffffff'])
  assert.match(stats.dock, /^#[0-9a-f]{6}$/)
  assert.equal(analyze(data).dock, undefined)
  assert.match(stats.base, /^#(7f7f7f|808080)$/)
  assert.ok(stats.palette.length >= 2)
  assert.ok(Math.abs(stats.palette.reduce((sum, row) => sum + row.weight, 0) - 1) < 1e-9)
})
