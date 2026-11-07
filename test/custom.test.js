import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { codeColor } from '../src/engine/code.js'
import { parseHex, toOklch } from '../src/engine/color.js'
import { DREAM_BUILTINS, fitSeed, gradientFromCss, opaqueColor, packToTheme, planDream } from '../src/engine/convert.js'
import { audit, CODE_SCHEMES, generate, RADIUS_TOKENS, radiusTokens, resolveLayer, THEMES } from '../src/engine/index.js'
import { readDreamImage, readDreamSettings } from '../src/host/dream.js'
import { bootRows, CSS_MARK } from '../src/shared/boot.js'
import { createShare, normalizeFont } from '../src/shared/share.js'
import { crc32, skinCenterFiles, skinId, zip } from '../src/shared/skin.js'
import * as state from '../src/shared/state.js'
import { checkCss, CSS_MAX_LENGTH, emptyDoc, layerChange, normalizeValues, undoChange } from '../src/shared/state.js'

const share = createShare(state)
const fixtures = new URL('./fixtures/dream-packs/', import.meta.url)
const packs = readdirSync(fixtures).map((name) => ({ name, data: JSON.parse(readFileSync(new URL(name, fixtures), 'utf8')) }))

test('代码配色：每套方案配每个主题，亮暗都过对比度门', () => {
  for (const scheme of CODE_SCHEMES) {
    for (const theme of THEMES) {
      const tokens = generate({ ...theme.seed, code: scheme.id })
      const shiki = audit(tokens).filter((row) => row.text.startsWith('--shiki-'))
      assert.ok(shiki.length > 0)
      assert.deepEqual(shiki.filter((row) => !row.pass), [], `${scheme.id} × ${theme.id}`)
    }
  }
})

test('代码配色：原色够清楚时原样用上，换方案确实换了颜色', () => {
  const abyss = THEMES.find((theme) => theme.id === 'abyss')
  const tokens = generate({ ...abyss.seed, code: 'github' })
  // 原色不够清楚时只动明度：色相还是 GitHub 的那个红
  const hueOf = (hex) => toOklch(parseHex(hex)).h
  assert.ok(Math.abs(hueOf(tokens['--shiki-token-keyword'].dark) - hueOf('#ff7b72')) < 6, tokens['--shiki-token-keyword'].dark)
  const mist = generate({ ...THEMES.find((theme) => theme.id === 'mist').seed, code: 'github' })
  assert.equal(mist['--shiki-token-function'].light, '#8250df')
  const monokai = generate({ ...abyss.seed, code: 'monokai' })
  assert.notEqual(monokai['--shiki-token-keyword'].dark, tokens['--shiki-token-keyword'].dark)
  assert.equal(codeColor('nope', '--shiki-token-keyword', true), undefined)
  assert.equal(codeColor('github', '--dsw-alias-bg-base', true), undefined)
  // 只有暗色的方案，亮色时也有值
  assert.ok(codeColor('dracula', '--shiki-token-string', false) !== undefined)
})

test('代码配色：存档里只认合法的 id，跟主题一起撤销', () => {
  assert.equal(state.normalizeSeed({ code: 'github' }).code, 'github')
  assert.equal(state.normalizeSeed({ code: 'Bad Id!' }).code, undefined)
})

test('圆角：只设圆角也会出变量，倍数按宿主档位缩放', () => {
  assert.deepEqual(radiusTokens(null), {})
  const layer = resolveLayer({ theme: null, custom: null, adjust: {}, overrides: {}, wallpaper: null, glass: null, radius: 0.5 }, null)
  assert.deepEqual(Object.keys(layer.tokens).sort(), Object.keys(RADIUS_TOKENS).sort())
  assert.equal(layer.tokens['--dsw-radius-md'].light, '6px')
  const none = resolveLayer({ theme: null, custom: null, adjust: {}, overrides: {}, wallpaper: null, glass: null, radius: null }, null)
  assert.equal(none.tokens, null)
  // 高级覆盖盖在圆角上面
  const both = resolveLayer({ theme: 'mist', custom: null, adjust: {}, overrides: { '--dsw-radius-md': { light: '3px', dark: '3px' } }, wallpaper: null, glass: null, radius: 2 }, null)
  assert.equal(both.tokens['--dsw-radius-md'].light, '3px')
  assert.equal(both.tokens['--dsw-radius-lg'].light, '32px')
})

test('存档：圆角夹在 0–2，自定义 CSS 不合规就丢掉，两者都能撤销', () => {
  assert.equal(normalizeValues({ radius: 5 }).radius, 2)
  assert.equal(normalizeValues({ radius: 'x' }).radius, null)
  assert.equal(normalizeValues({ css: '@import "x.css";' }).css, '')
  assert.equal(normalizeValues({ css: 'body{color:red}' }).css, 'body{color:red}')
  const values = normalizeValues({})
  const change = layerChange(values, { radius: 1.5, css: 'a{}' })
  assert.equal(change.radius, 1.5)
  assert.equal(change.css, 'a{}')
  const after = normalizeValues({ ...values, ...change })
  const undo = undoChange(after)
  assert.equal(undo.radius, null)
  assert.equal(undo.css, '')
})

test('自定义 CSS 检查：禁 @import 和外链 url，放行 data:', () => {
  const ok = (css) => assert.equal(checkCss(css).ok, true, css)
  const bad = (css, code) => assert.deepEqual(checkCss(css), { ok: false, code }, css)
  ok('')
  ok('.x{color:var(--dsw-alias-label-primary)}')
  ok('.x{background:url(data:image/png;base64,AAAA)}')
  ok(".x{background:url('data:image/svg+xml,%3Csvg%3E')}")
  bad('@import url(data:text/css,x);', 'import')
  bad('@IMPORT "a.css";', 'import')
  bad('.x{background:url(https://evil.example/a.png)}', 'remote-url')
  bad('.x{background:url( "//evil.example/a.png")}', 'remote-url')
  bad('.x{background:URL(/prism-skin/api/x)}', 'remote-url')
  bad('.x{background:image-set("a.png" 1x)}', 'remote-url')
  bad('@font-face{font-family:x;src:url(https://a/b.woff2)}', 'remote-url')
  bad('</style><script>', 'bad-char')
  bad('.x{content:"\\40 import"}', 'bad-char')
  bad('a'.repeat(CSS_MAX_LENGTH + 1), 'too-long')
})

test('首屏注入：自定义 CSS 带标记注释，没有就不注入', () => {
  const layer = { tokens: null, opaque: null, wall: null }
  const without = bootRows({ doc: emptyDoc(), version: 't', layer })
  assert.equal(without.filter((row) => row.kind === 'style' && row.text.startsWith(CSS_MARK)).length, 0)
  const rows = bootRows({ doc: emptyDoc(), version: 't', layer, css: '.x{color:red}' })
  assert.deepEqual(rows.filter((row) => row.kind === 'style' && row.text.startsWith(CSS_MARK)).map((row) => row.text), [`${CSS_MARK}.x{color:red}`])
})

test('分享码：短，来回不丢信息，也认整条链接', () => {
  for (const theme of THEMES) {
    const seed = { ...generateSeed(theme.seed) }
    const code = share.encodeShare(seed, 1.25)
    assert.ok(code.length <= 60, code)
    const back = share.decodeShare(`https://example.test/app#${code}`)
    assert.equal(back.ok, true, code)
    assert.equal(back.seed.accent, seed.accent)
    assert.equal(back.seed.hue, Math.round(seed.hue))
    assert.equal(back.radius, 1.25)
  }
  const withCode = share.encodeShare({ hue: 10, chroma: 1, neutral: 0.5, contrast: -0.2, depth: 0.3, accent: '#123abc', ink: true, code: 'nord' })
  assert.deepEqual(share.decodeShare(withCode), { ok: true, seed: { hue: 10, chroma: 1, neutral: 0.5, contrast: -0.2, depth: 0.3, accent: '#123abc', ink: true, code: 'nord' } })
  for (const junk of ['', 'prism1.', 'prism1.1.2.3', 'prism1.400.95.40.0.-10.4b78e6.0', 'prism1.1.2.3.4.5.zzzzzz.0', 'prism1.1.2.3.4.5.123456.0.BAD!']) assert.equal(share.decodeShare(junk).ok, false, junk)
})

function generateSeed(seed) {
  return { hue: 0, chroma: 1, neutral: 0.5, contrast: 0, depth: 0, accent: '#4b78e6', ...seed }
}

test('主题文件：很小，来回一致；任何一项不合法就整份拒绝', () => {
  const seed = generateSeed(THEMES[0].seed)
  const text = share.serializeTheme({ name: 'Mist', seed })
  assert.ok(Buffer.byteLength(text) < 300, `${Buffer.byteLength(text)} B`)
  const back = share.parseThemeFile(JSON.parse(text))
  assert.equal(back.ok, true)
  assert.equal(back.file.seed.accent, seed.accent)
  const full = share.serializeTheme({ seed, radius: 0.5, overrides: { '--dsw-alias-bg-base': { light: '#ffffff', dark: '#000000' } }, css: '.x{color:red}', font: { text: 'Inter', size: 15 } })
  const parsed = share.parseThemeFile(JSON.parse(full))
  assert.deepEqual({ radius: parsed.file.radius, css: parsed.file.css, font: parsed.file.font }, { radius: 0.5, css: '.x{color:red}', font: { text: 'Inter', size: 15 } })
  const reject = (patch, code) => assert.deepEqual(share.parseThemeFile({ ...JSON.parse(full), ...patch }), { ok: false, code }, JSON.stringify(patch))
  reject({ prism: 2 }, 'not-theme')
  reject({ seed: { hue: 1 } }, 'bad-seed')
  reject({ radius: 9 }, 'bad-seed')
  reject({ css: '@import "x";' }, 'bad-css')
  reject({ overrides: { '--a': { light: 'red;}', dark: 'x' } } }, 'bad-overrides')
  reject({ font: { text: 'url(x)' } }, 'bad-font')
  assert.deepEqual(normalizeFont({ text: 'A, B', size: 30, codeSize: 12 }), { text: 'A, B', codeSize: 12 })
})

test('dream-skin 主题包：样本都能换算，底色接近、对比度全过', () => {
  assert.ok(packs.length >= 3)
  for (const { name, data } of packs) {
    const result = packToTheme(data)
    assert.equal(result.ok, true, name)
    const scheme = data.manifest.colorScheme
    const tokens = generate(result.seed)
    assert.deepEqual(audit(tokens).filter((row) => !row.pass), [], name)
    const want = opaqueColor(data.manifest.tokens['--dsw-alias-bg-base'], scheme)
    const { error } = fitSeed({ base: want, accent: result.seed.accent, scheme })
    assert.ok(error < 0.08, `${name} 色差 ${error}`)
    assert.equal(result.scheme, scheme)
  }
  assert.deepEqual(packToTheme({ format: 'other' }), { ok: false, code: 'not-pack' })
  assert.deepEqual(packToTheme({ format: 'dsh-dream-skin/pack', manifest: { tokens: {} } }), { ok: false, code: 'bad-pack' })
})

test('dream-skin 内置主题：换算后底色几乎一样', () => {
  for (const [id, [scheme, base, accent]] of Object.entries(DREAM_BUILTINS)) {
    const { error } = fitSeed({ base, accent, scheme })
    assert.ok(error < 0.02, `${id} ${error}`)
  }
})

test('颜色解析：rgba 叠在白/黑上变成不透明', () => {
  assert.equal(opaqueColor('#abc', 'light'), '#aabbcc')
  assert.equal(opaqueColor('rgba(255, 0, 0, 0.5)', 'light'), '#ff8080')
  assert.equal(opaqueColor('rgba(255, 0, 0, 0.5)', 'dark'), '#800000')
  assert.equal(opaqueColor('red', 'light'), undefined)
})

test('dream-skin 设置迁移：主题、强调色、各种壁纸', () => {
  const builtin = planDream({ skin: 'ember', accent: '#ff0000', 'wallpaper-kind': 'gradient', 'wallpaper-gradient': 'linear-gradient(135deg, #112233 0%, rgba(68, 85, 102, 1) 100%)' })
  assert.equal(builtin.theme.scheme, 'dark')
  assert.equal(builtin.theme.seed.accent, '#ff0000')
  assert.deepEqual(builtin.wallpaper, { kind: 'gradient', stops: ['#112233', '#445566'], angle: 135 })
  const packList = JSON.stringify([packs[0].data])
  const pack = planDream({ skin: `dream-pack:${packs[0].data.manifest.id}`, packs: packList, accent: 'system' })
  assert.equal(pack.theme.scheme, packs[0].data.manifest.colorScheme)
  assert.deepEqual(planDream({ skin: 'dream-pack:missing', packs: packList }).skipped, ['pack'])
  const folder = planDream({ 'wallpaper-folder': '/Users/x/Pictures', 'wallpaper-rotation': JSON.stringify({ on: 1, mode: 'random', minutes: 30, source: 'folder' }) })
  assert.deepEqual(folder.wallpaper, { kind: 'folder', path: '/Users/x/Pictures', interval: 1800, shuffle: true, epoch: 0 })
  const links = planDream({ 'wallpaper-rotation': JSON.stringify({ on: true, minutes: 5, urls: ['https://a.test/1.jpg', 'ftp://x', 'http://b.test/2.png'] }) })
  assert.deepEqual(links.fetch, { kind: 'urls', urls: ['https://a.test/1.jpg', 'http://b.test/2.png'], interval: 300, shuffle: false })
  assert.deepEqual(planDream({ 'wallpaper-kind': 'url', 'wallpaper-url': 'https://a.test/x.jpg' }).fetch, { kind: 'url', url: 'https://a.test/x.jpg' })
  assert.deepEqual(planDream({}, { fileImage: true }).fetch, { kind: 'dream-image' })
  assert.deepEqual(planDream({}, { localImage: true }).fetch, { kind: 'local-image' })
  const empty = planDream({})
  assert.deepEqual(empty, { theme: null, wallpaper: null, fetch: null, skipped: [] })
  assert.equal(gradientFromCss('linear-gradient(red, blue)'), null)
})

test('dream-skin 设置文件：只读迁移要的键，图片只回标记，原文件不动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-dream-'))
  try {
    const file = join(dir, 'dream-skin.json')
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const body = JSON.stringify({ 'dsh-dream-skin:skin': 'ember', 'dsh-dream-skin:favorites': '["x"]', 'dsh-dream-skin:wallpaper': `data:image/png;base64,${png.toString('base64')}`, __schema: '1' })
    writeFileSync(file, body)
    const result = readDreamSettings(file)
    assert.deepEqual(result.keys, { skin: 'ember' })
    assert.ok(result.image.bytes > 0)
    assert.deepEqual(readDreamImage(file), png)
    assert.equal(readFileSync(file, 'utf8'), body)
    assert.deepEqual(readDreamSettings(join(dir, 'missing.json')), { found: false, keys: {} })
    writeFileSync(file, 'not json')
    assert.equal(readDreamSettings(file).found, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导出 skin-center 皮肤：清单字段合规，CSS 不带 url，zip 能解开', () => {
  assert.equal(skinId('晨雾 Mist!'), 'prism-mist')
  assert.equal(skinId('中文'), 'prism')
  assert.match(skinId('a'.repeat(80)), /^[a-z][a-z0-9-]{0,31}$/)
  const tokens = { ...generate(THEMES[0].seed), '--dsw-alias-bg-base': { light: 'url(/x) fixed', dark: '#000' }, '--prism-glass': { light: '0.5', dark: '0.5' } }
  const files = skinCenterFiles({ id: 'prism-mist', name: '棱镜 · 晨雾', nameEn: 'Prism · Mist', accent: '#4b78e6', version: '1.0.0', tokens, css: '.x{color:red}' })
  const manifest = JSON.parse(files.json)
  for (const key of ['skinManifestVersion', 'id', 'name', 'nameEn', 'version', 'author', 'contributes']) assert.ok(key in manifest, key)
  assert.equal(manifest.skinManifestVersion, 2)
  assert.equal(manifest.contributes.stylesheet, 'skin.css')
  assert.doesNotMatch(files.css, /url\(/)
  assert.doesNotMatch(files.css, /--prism-glass/)
  assert.match(files.css, /:root \{\n {2}--dsw-/)
  assert.match(files.css, /body\[data-ds-dark-theme\] \{/)
  assert.match(files.css, /\.x\{color:red\}/)
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  const dir = mkdtempSync(join(tmpdir(), 'prism-zip-'))
  try {
    const path = join(dir, 'skin.zip')
    writeFileSync(path, zip([{ name: 'prism-mist/skin.json', text: files.json }, { name: 'prism-mist/skin.css', text: files.css }]))
    execFileSync('unzip', ['-q', '-t', path])
    execFileSync('unzip', ['-q', path, '-d', dir])
    assert.equal(readFileSync(join(dir, 'prism-mist/skin.css'), 'utf8'), files.css)
    assert.equal(readFileSync(join(dir, 'prism-mist/skin.json'), 'utf8'), files.json)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('导出提示不断言文件已经存好（网页拿不到「存储为」里有没有点取消）', async () => {
  const { CUSTOM_DICT } = await import('../src/client/custom/dict.js')
  const { DICT } = await import('../src/client/studio/dict.js')
  for (const lang of ['zh', 'en']) {
    const texts = Object.values(CUSTOM_DICT[lang]).join('\n')
    assert.doesNotMatch(texts, /下载里|在「下载」|in your downloads|is in your/i, lang)
    assert.ok(CUSTOM_DICT[lang].started, lang)
    // 面板底部是说明文字，不写成「设置 → 棱镜」那种像导航链接的样子
    assert.doesNotMatch(DICT[lang]['quick.more'], /→/, lang)
  }
})
