import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audit, BASE_SEED, colorWall, CUSTOM_THEME, generate, GRADIENTS, gradientWall, randomSeed, resolveTokens, seedOf, THEMES, themeById, tokenNames } from '../src/engine/index.js'
import { parseHex } from '../src/engine/color.js'
import { normalizeSeed } from '../src/shared/state.js'

/** 确定性伪随机：失败时能复现。 */
function randomFrom(start) {
  let x = start
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

const GRADIENT = /^--dsw-(gradient-|linear-)/
const NON_COLOR = new Set(['--dsw-menu-backdrop-filter'])

test('8–10 套主题：id 不重复，中英文名字都有', () => {
  assert.ok(THEMES.length >= 8 && THEMES.length <= 10, `${THEMES.length} 套`)
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length)
  for (const theme of THEMES) {
    assert.ok(theme.name.zh && theme.name.en, theme.id)
    assert.deepEqual(normalizeSeed(theme.seed), theme.seed, `${theme.id} 的种子合法`)
    assert.notEqual(theme.id, CUSTOM_THEME)
  }
})

test('每套主题覆盖全部颜色变量，亮暗成对', () => {
  const names = tokenNames()
  const count = (pattern) => names.filter((name) => pattern.test(name)).length
  assert.ok(names.length >= 224, `共 ${names.length} 个`)
  assert.equal(count(/^--dsw-static-/), 82)
  assert.ok(count(/^--dsw-alias-/) >= 107)
  assert.equal(count(/^--dsw-specific-/), 11)
  assert.equal(count(/^--dsw-alias-markdown-/), 8)
  assert.equal(count(/^--dsw-alias-(code|file)-diff-/), 8)
  assert.equal(count(/^--shiki-/), 11)
  for (const theme of THEMES) {
    const tokens = generate(theme.seed)
    for (const name of names) {
      const value = tokens[name]
      assert.ok(value, `${theme.id} 缺 ${name}`)
      assert.ok(typeof value.light === 'string' && typeof value.dark === 'string', `${theme.id} ${name} 没有成对`)
      if (!GRADIENT.test(name) && !NON_COLOR.has(name)) {
        assert.ok(parseHex(value.light), `${theme.id} ${name} 亮色值 ${value.light}`)
        assert.ok(parseHex(value.dark), `${theme.id} ${name} 暗色值 ${value.dark}`)
      }
    }
  }
})

test('渐变变量跟着主题走，不留下宿主的纯白', () => {
  const tokens = generate(themeById('sand').seed)
  assert.ok(tokens['--dsw-linear-gradient-think'].light.includes(tokens['--dsw-alias-bg-base'].light))
  assert.ok(tokens['--dsw-linear-gradient-think'].dark.includes(tokens['--dsw-alias-bg-base'].dark))
  assert.ok(!tokens['--dsw-gradient-onboarding-blue-stops'].light.includes('#3964fe'))
})

test('对比度审计：全部主题亮暗全过', () => {
  for (const theme of THEMES) {
    const rows = audit(generate(theme.seed))
    assert.ok(rows.length > 200, `${theme.id} 审计了 ${rows.length} 对`)
    const bad = rows.filter((row) => !row.pass)
    assert.deepEqual(bad, [], `${theme.id} 未达标`)
  }
})

test('怎么调都看得清：极端种子的对比度也全过', () => {
  const rand = randomFrom(20261106)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const hex = () => `#${[0, 0, 0].map(() => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('')}`
  for (let i = 0; i < 300; i += 1) {
    const seed = {
      hue: rand() * 360,
      chroma: pick([0, 0.5, 1, 1.5, rand() * 1.5]),
      neutral: pick([0, 0.5, 1, rand()]),
      contrast: pick([-1, 0, 1, rand() * 2 - 1]),
      depth: pick([-1, 0, 1, rand() * 2 - 1]),
      accent: pick([hex(), '#ffffff', '#000000', '#ffff00', '#808080', '#00ff00', '#ff0000', '#0000ff']),
      ink: rand() < 0.15,
    }
    const bad = audit(generate(seed)).filter((row) => !row.pass)
    assert.deepEqual(bad, [], `种子 ${JSON.stringify(seed)}`)
  }
})

test('同样的种子永远生成同样的结果', () => {
  const seed = themeById('iris').seed
  assert.deepEqual(generate(seed), generate({ ...seed }))
})

test('强调色：全部派生变量在亮暗两种模式下都重算', () => {
  const seed = themeById('mist').seed
  const a = generate({ ...seed, accent: '#d9502e' })
  const b = generate({ ...seed, accent: '#1f9a78' })
  const derived = [
    '--dsw-alias-state-business-primary',
    '--dsw-alias-state-business-tertiary',
    '--dsw-alias-brand-primary',
    '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-button-primary-hover',
    '--dsw-alias-button-info-fill',
    '--dsw-alias-button-info-hover',
    '--dsw-alias-link',
    '--dsw-specific-bubble',
    '--dsw-specific-bubble-highlight',
    '--dsw-specific-sidebar-nav-item-active-accent',
    '--dsw-alias-bg-document-selection',
    '--dsw-alias-label-deep-diving',
    '--dsw-static-deepseek-50',
    '--dsw-static-deepseek-500',
    '--dsw-static-blue-500',
    '--shiki-token-keyword',
    '--shiki-token-function',
    '--shiki-token-constant',
    '--shiki-token-link',
  ]
  for (const name of derived) {
    assert.notEqual(a[name].light, b[name].light, `${name} 亮色没变`)
    assert.notEqual(a[name].dark, b[name].dark, `${name} 暗色没变`)
  }
  // 亮暗不是同一个值（dream-skin 的教训）
  for (const name of ['--dsw-alias-state-business-primary', '--dsw-alias-link', '--dsw-specific-bubble']) {
    assert.notEqual(a[name].light, a[name].dark, `${name} 亮暗同值`)
  }
  // 主按钮文字随底色自动选深浅
  const yellow = generate({ ...seed, accent: '#f5d90a' })
  const blue = generate({ ...seed, accent: '#2a3fd6' })
  assert.notEqual(yellow['--dsw-alias-label-primary-foreground'].light, blue['--dsw-alias-label-primary-foreground'].light)
})

test('色相、中性色调、明暗都真的起作用', () => {
  const base = { ...BASE_SEED, neutral: 0.6 }
  const base0 = generate(base)
  const surface = '--dsw-alias-bg-base'
  assert.notEqual(generate({ ...base, hue: 40 })[surface].dark, base0[surface].dark)
  assert.notEqual(generate({ ...base, neutral: 0 })[surface].dark, base0[surface].dark)
  assert.notEqual(generate({ ...base, depth: -0.8 })[surface].dark, base0[surface].dark)
  // 中性色调为 0 时表面是纯灰
  const gray = parseHex(generate({ ...base, neutral: 0 })[surface].dark)
  assert.ok(Math.abs(gray.r - gray.g) < 0.01 && Math.abs(gray.g - gray.b) < 0.01)
})

test('三层合成：主题 → 我的调整 → 高级覆盖', () => {
  const none = { theme: null, custom: null, adjust: {}, overrides: {} }
  assert.equal(resolveTokens(none), null, '什么都没设时完全沿用宿主')

  const themed = resolveTokens({ ...none, theme: 'pine' })
  assert.deepEqual(themed, generate(themeById('pine').seed))

  const adjusted = resolveTokens({ ...none, theme: 'pine', adjust: { accent: '#d9502e' } })
  assert.deepEqual(adjusted, generate({ ...themeById('pine').seed, accent: '#d9502e' }))

  const pair = { light: '#111111', dark: '#eeeeee' }
  const covered = resolveTokens({ ...none, theme: 'pine', adjust: { accent: '#d9502e' }, overrides: { '--dsw-alias-link': pair } })
  assert.deepEqual(covered['--dsw-alias-link'], pair)
  assert.equal(covered['--dsw-alias-bg-base'].light, adjusted['--dsw-alias-bg-base'].light)

  const onlyOverride = resolveTokens({ ...none, overrides: { '--dsw-alias-link': pair } })
  assert.deepEqual(onlyOverride, { '--dsw-alias-link': pair }, '只有覆盖时不生成主题')

  const adjustOnly = resolveTokens({ ...none, adjust: { contrast: 0.5 } })
  assert.deepEqual(adjustOnly, generate({ ...BASE_SEED, contrast: 0.5 }))

  const custom = { hue: 12, neutral: 0.3, accent: '#123456' }
  assert.deepEqual(seedOf({ ...none, theme: CUSTOM_THEME, custom, adjust: { depth: 0.2 } }), { ...custom, depth: 0.2 })
  assert.equal(seedOf({ ...none, theme: 'no-such-theme' }), undefined)
})

test('随机种子：字段合法、对比度达标', () => {
  const rand = randomFrom(42)
  for (let i = 0; i < 60; i += 1) {
    const seed = randomSeed(rand)
    assert.deepEqual(normalizeSeed(seed), seed)
    assert.deepEqual(audit(generate(seed)).filter((row) => !row.pass), [])
  }
})

test('审计遇到无法解析的覆盖值时跳过，不会抛错', () => {
  const tokens = { ...generate(BASE_SEED), '--dsw-alias-label-primary': { light: 'var(--x)', dark: 'red' } }
  const rows = audit(tokens)
  assert.ok(rows.every((row) => row.text !== 'alias-label-primary'))
})

test('悬停、按下状态：所有文字门槛都是 4.5，每套主题亮暗共 258 组', async () => {
  const { LEGIBILITY } = await import('../src/engine/generate.js')
  const hover = LEGIBILITY.filter((row) => row[3].some((spec) => spec.startsWith('alias-interactive-')))
  assert.ok(hover.length >= 6)
  for (const row of hover) assert.ok(row[1] >= 4.5, `${row[0]} 在悬停背景上只要求 ${row[1]}`)
  assert.ok(hover.some((row) => row[0] === 'alias-label-caption'), '说明文字那组在')
  for (const theme of THEMES) assert.equal(audit(generate(theme.seed)).length, 258, theme.id)
})

test('悬停背景达不到时先调淡，最多淡到原来的 60%，不会淡到看不见', () => {
  const alpha = (hex) => parseHex(hex).a
  for (const theme of THEMES) {
    for (const wall of [gradientWall(GRADIENTS[1]), colorWall('#1e2f2a')]) {
      const glass = generate(theme.seed, { level: 0.5, wall })
      const plain = generate(theme.seed)
      for (const name of ['--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active']) {
        for (const mode of ['light', 'dark']) assert.ok(alpha(glass[name][mode]) >= alpha(plain[name][mode]) * 0.58, `${theme.id} ${name} ${mode}`)
      }
    }
  }
})
