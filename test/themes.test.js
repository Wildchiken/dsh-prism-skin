import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { materialTokens } from '../src/engine/index.js'
import { createShare } from '../src/shared/share.js'
import * as state from '../src/shared/state.js'
import { compress } from '../themes/src/icons.mjs'

const share = createShare(state)
const load = (name) => JSON.parse(readFileSync(new URL(`../themes/${name}`, import.meta.url), 'utf8'))

for (const name of ['cyberpunk-hud.json', 'material-3.json']) {
  test(`示例主题 ${name}：导入校验通过，变量覆盖、CSS、Material 规则一条不丢`, () => {
    const raw = load(name)
    const parsed = share.parseThemeFile(raw)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.deepEqual(Object.keys(parsed.file.overrides ?? {}), Object.keys(raw.overrides ?? {}))
    assert.equal(parsed.file.css ?? '', raw.css ?? '')
    assert.equal(state.checkCss(raw.css ?? '').ok, true)
    if (raw.material !== undefined) {
      assert.deepEqual(Object.keys(parsed.file.material?.roles ?? {}), Object.keys(raw.material.roles))
      // 每条角色都能按强调色算出来
      const tokens = materialTokens(parsed.file.material, raw.seed.accent)
      assert.deepEqual(Object.keys(tokens).sort(), Object.keys(raw.material.roles).sort())
    }
  })
}

test('Material 3 主题：换掉的图标路径都放得进单个变量（1024 字），宿主图标按名字两头带连字符匹配', () => {
  const raw = load('material-3.json')
  const icons = Object.entries(raw.overrides).filter(([k]) => /^--i\d+$/.test(k))
  assert.ok(icons.length >= 90)
  for (const [, v] of icons) assert.ok(v.light.startsWith('path("') && v.light.length <= 1024)
  assert.match(raw.css, /\[id\*=-like-outline-\]>path\{d:var\(--i\d+\)\}/)
})

test('图标路径压缩：960 网格缩到 96 取整；闭合后相对坐标从子路径起点接着算', () => {
  assert.equal(compress('M100-100h200v-200h-200z m400 0h100v-100h-100z', 96), 'm10-10h20v-20h-20zm40 0h10v-10h-10z')
  // 相对坐标按取整后的点写回（1.4、2.8、4.2 取整成 1、3、4），不会越走越偏；moveto 后面的点就是 lineto，不用再写 l
  assert.equal(compress('M0 0l14 0 14 0 14 0', 96), 'm0 0 1 0 2 0 1 0')
})
