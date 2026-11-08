import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materialRoles, materialTokens, resolveLayer } from '../src/engine/index.js'
import { normalizeMaterial, parseRoleExpr } from '../src/shared/material.js'
import { createShare } from '../src/shared/share.js'
import * as state from '../src/shared/state.js'

const SEED = { hue: 290, chroma: 1, neutral: 0.5, contrast: 0, depth: 0, accent: '#6750a4' }
const MATERIAL = { scheme: 'tonal', spec: '2021', roles: { '--dsw-alias-bg-base': 'surface', '--dsw-alias-link': 'primary', '--x-hover': 'onSurface/8', '--x-solid': { light: 'surfaceContainer+onSurface/8', dark: 'surface' } } }
const PACK = { id: 'm3test', name: 'M3', seed: SEED, material: MATERIAL, overrides: { '--x-font': { light: 'serif', dark: 'serif' } } }

test('官方算法：源色 #6750A4 的 Tonal Spot（2021 规格）就是 M3 基准配色', () => {
  const roles = materialRoles('#6750a4', normalizeMaterial(MATERIAL))
  assert.deepEqual(roles.primary, { light: '#65558f', dark: '#cfbdfe' })
  assert.deepEqual(roles.surface, { light: '#fdf7ff', dark: '#141218' })
  assert.deepEqual(roles.surfaceContainer, { light: '#f2ecf4', dark: '#211f24' })
  assert.deepEqual(roles.onSurface, { light: '#1d1b20', dark: '#e6e0e9' })
})

test('角色写法：角色、带不透明度、叠色；不认识的角色和缺不透明度的叠色都不收', () => {
  assert.deepEqual(parseRoleExpr('primary'), { base: 'primary' })
  assert.deepEqual(parseRoleExpr('onSurface/8'), { base: 'onSurface', alpha: 8 })
  assert.deepEqual(parseRoleExpr('surface+onSurface/10'), { base: 'surface', over: 'onSurface', alpha: 10 })
  assert.equal(parseRoleExpr('surface+onSurface'), undefined)
  assert.equal(parseRoleExpr('notARole'), undefined)
  assert.equal(parseRoleExpr('primary/101'), undefined)
  assert.equal(parseRoleExpr('#ffffff'), undefined)
})

test('清洗：默认 tonal + 2025；坏角色丢掉；方案不认识整段不收', () => {
  const clean = normalizeMaterial({ roles: { '--a': 'primary', '--b': 'nope', bad: 'primary' } })
  assert.deepEqual(clean, { scheme: 'tonal', spec: '2025', roles: { '--a': { light: 'primary', dark: 'primary' } } })
  assert.equal(normalizeMaterial({ scheme: 'neon', roles: { '--a': 'primary' } }), undefined)
  assert.equal(normalizeMaterial({ roles: {} }), undefined)
  assert.equal(normalizeMaterial({ neutral: 'neon', roles: { '--a': 'primary' } }), undefined)
  assert.deepEqual(normalizeMaterial({ scheme: 'vibrant', neutral: 'tonal', containers: 'tonal', roles: { '--a': 'primary' } })?.containers, 'tonal')
})

test('变量：按写法算出颜色；不透明度写成 8 位 hex，叠色得到不透明的颜色', () => {
  const tokens = materialTokens(normalizeMaterial(MATERIAL), '#6750a4')
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: '#fdf7ff', dark: '#141218' })
  assert.equal(tokens['--x-hover'].light, '#1d1b2014')
  assert.match(tokens['--x-solid'].light, /^#[0-9a-f]{6}$/)
  assert.notEqual(tokens['--x-solid'].light, '#f2ecf4')
  assert.equal(tokens['--x-solid'].dark, '#141218')
})

test('中性色和容器色可以换方案：Vibrant 的主色配 Tonal Spot 的底色', () => {
  const vibrant = materialRoles('#6750a4', normalizeMaterial({ scheme: 'vibrant', roles: { '--a': 'primary' } }))
  const mixed = materialRoles('#6750a4', normalizeMaterial({ scheme: 'vibrant', neutral: 'tonal', containers: 'tonal', roles: { '--a': 'primary' } }))
  const tonal = materialRoles('#6750a4', normalizeMaterial({ scheme: 'tonal', roles: { '--a': 'primary' } }))
  assert.equal(mixed.primary.light, vibrant.primary.light)
  assert.notEqual(mixed.surfaceContainer.light, vibrant.surfaceContainer.light)
  assert.equal(mixed.primaryContainer.light, tonal.primaryContainer.light)
})

test('选中带 Material 规则的「我的主题」：按当前强调色现算，换强调色整套跟着变；主题覆盖和用户覆盖依次盖上去', () => {
  const values = state.normalizeValues({ theme: 'my-m3test', library: [PACK] })
  const first = resolveLayer(values, null).tokens
  assert.equal(first?.['--dsw-alias-bg-base'].light, '#fdf7ff')
  assert.equal(first?.['--x-font'].light, 'serif')
  const blue = resolveLayer({ ...values, adjust: { accent: '#4285f4' } }, null).tokens
  assert.notEqual(blue?.['--dsw-alias-link'].light, first?.['--dsw-alias-link'].light)
  const own = resolveLayer({ ...values, overrides: { '--dsw-alias-link': { light: '#000000', dark: '#ffffff' } } }, null).tokens
  assert.equal(own?.['--dsw-alias-link'].light, '#000000')
})

test('主题包和主题文件：Material 规则存得下、导得出、读得回；规则里有坏条目整份拒绝', () => {
  const [pack] = state.normalizeLibrary([PACK])
  assert.equal(pack.material?.roles['--x-hover'].dark, 'onSurface/8')
  const share = createShare(state)
  const text = share.serializeTheme({ name: 'M3', seed: SEED, material: pack.material })
  const parsed = share.parseThemeFile(JSON.parse(text))
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.ok && parsed.file.material, pack.material)
  const bad = share.parseThemeFile({ ...JSON.parse(text), material: { roles: { '--a': 'primary', '--b': 'nope' } } })
  assert.deepEqual(bad, { ok: false, code: 'bad-overrides' })
})
