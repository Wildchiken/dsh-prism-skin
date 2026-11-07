import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { apply, currentWall } from '../src/host/index.js'
import { normalizeDerived, sniffImage, WallpaperStore } from '../src/host/wallpapers.js'
import { normalizeValues } from '../src/shared/state.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)])
const DERIVED = { base: '#112233', samples: ['#000000', '#FFFFFF'], palette: [{ hex: '#112233', l: 0.2, c: 0.03, h: 250, weight: 1 }], width: 384, height: 240, blur: JPEG.toString('base64') }

let home
let server
let port
let previous
let remote
let remotePort

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'prism-wall-'))
  previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let route
  apply({
    on: () => {},
    effect: (callback) => callback(),
    get: () => undefined,
    webServer: {
      register(definition) {
        route = definition
        return () => {}
      },
    },
  })
  server = createServer((req, res) => route.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  remote = createServer((req, res) => {
    if (req.url === '/a.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html>'.padEnd(64))
    if (req.url === '/huge') return res.writeHead(200).end(Buffer.alloc(21 * 1024 * 1024))
    return res.writeHead(404).end()
  })
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', resolve))
  remotePort = remote.address().port
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => remote.close(resolve))
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  rmSync(home, { recursive: true, force: true })
})

const api = (path, init) => fetch(`http://127.0.0.1:${port}/prism-skin/api/wallpaper${path}`, init)
const postJson = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const entry = (v) => ({ v, t: Date.now(), by: 'test' })
const setState = (patch) => fetch(`http://127.0.0.1:${port}/prism-skin/api/state`, { method: 'POST', body: JSON.stringify({ patch }) })
const getState = async () => (await fetch(`http://127.0.0.1:${port}/prism-skin/api/state`)).json()

test('只认文件头：改了扩展名的网页、脚本都不算图片', () => {
  assert.equal(sniffImage(PNG).type, 'image/png')
  assert.equal(sniffImage(JPEG).type, 'image/jpeg')
  assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)></svg>'.padEnd(64))), undefined)
  assert.equal(sniffImage(Buffer.from('<html>'.padEnd(64))), undefined)
})

test('上传：存成内容哈希命名的文件，权限 0600，重复上传只留一份', async () => {
  const first = await (await api('/upload', { method: 'POST', body: PNG })).json()
  assert.match(first.id, /^[a-f0-9]{32}$/)
  const again = await (await api('/upload', { method: 'POST', body: PNG })).json()
  assert.equal(again.id, first.id)
  const dir = join(home, 'dsh-prism-skin', 'wallpapers')
  assert.deepEqual(readdirSync(dir), [`${first.id}.png`])
  assert.equal(statSync(join(dir, `${first.id}.png`)).mode & 0o777, 0o600)
  const served = await api(`/file/${first.id}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG)
})

test('上传：不是图片 415，超过 20MB 413', async () => {
  assert.equal((await api('/upload', { method: 'POST', body: 'not an image at all, just text padding here' })).status, 415)
  const huge = await api('/upload', { method: 'POST', body: Buffer.alloc(21 * 1024 * 1024) }).then((res) => res.status).catch(() => 413)
  assert.equal(huge, 413)
})

test('链接：host 代下载；非 http、网页、404、超大都拒绝', async () => {
  const base = `http://127.0.0.1:${remotePort}`
  const saved = await (await postJson('/fetch', { url: `${base}/a.png` })).json()
  assert.match(saved.id, /^[a-f0-9]{32}$/)
  assert.equal((await postJson('/fetch', { url: 'file:///etc/passwd' })).status, 400)
  assert.equal((await postJson('/fetch', { url: 'not a url' })).status, 400)
  assert.equal((await postJson('/fetch', { url: `${base}/page` })).status, 415)
  assert.equal((await postJson('/fetch', { url: `${base}/missing` })).status, 502)
  assert.equal((await postJson('/fetch', { url: `${base}/huge` })).status, 413)
})

test('分析结果：存下模糊图和统计，颜色统一小写；格式不对就拒绝', async () => {
  const id = 'a'.repeat(32)
  assert.equal((await postJson(`/derived/${id}`, DERIVED)).status, 200)
  const derived = await (await api(`/derived/${id}`)).json()
  assert.deepEqual(derived.samples, ['#000000', '#ffffff'])
  assert.equal(derived.blur, undefined, '图不进 JSON')
  const blur = await api(`/blur/${id}.jpg`)
  assert.equal(blur.status, 200)
  assert.match(blur.headers.get('cache-control'), /immutable/)
  assert.equal((await postJson('/derived/not-hex', DERIVED)).status, 400)
  assert.equal((await postJson(`/derived/${id}`, { ...DERIVED, base: 'url(x)' })).status, 400)
  assert.equal((await postJson(`/derived/${id}`, { ...DERIVED, blur: PNG.toString('base64') })).status, 400, '只收 JPEG')
  assert.equal((await api(`/blur/${'b'.repeat(32)}.jpg`)).status, 404)
})

test('normalizeDerived：样本里混进 CSS 会被滤掉，全滤掉就不收', () => {
  assert.deepEqual(normalizeDerived({ ...DERIVED, samples: ['#123456', 'red;}'] }).samples, ['#123456'])
  assert.equal(normalizeDerived({ ...DERIVED, samples: ['red;}'] }), undefined)
  assert.equal(normalizeDerived(null), undefined)
})

test('路径：id 里的目录穿越走不通', async () => {
  assert.equal((await api('/file/..%2F..%2Fetc%2Fpasswd')).status, 404)
  assert.equal((await api('/file/../../../../etc/passwd')).status, 404)
  assert.equal((await api('/nope/abc')).status, 404)
})

test('状态接口：图片分析好之前点名要分析，分析好之后合成玻璃', async () => {
  const { id } = await (await api('/upload', { method: 'POST', body: PNG })).json()
  await setState({ theme: entry('mist'), wallpaper: entry({ kind: 'image', id }) })
  const before = await getState()
  assert.deepEqual(before.needs, [{ key: id, src: `/prism-skin/api/wallpaper/file/${id}` }])
  assert.equal(before.layer.w, null)
  assert.match(before.layer.t['--dsw-alias-bg-base'][0], /^#/, '先出不透明主题')
  await postJson(`/derived/${id}`, DERIVED)
  const after = await getState()
  assert.deepEqual(after.needs, [])
  assert.equal(after.layer.w.key, id)
  assert.ok(after.layer.t['--dsw-alias-bg-base'][0].includes(`/blur/${id}.jpg`))
  assert.ok(after.layer.o['--dsw-alias-bg-base'][0].startsWith('#'), '带不透明替换项')
})

const values = (wallpaper) => normalizeValues({ wallpaper })

test('轮播：host 按时间表算出当前这张和下一张；没分析好的先用分析好的顶着', () => {
  const walls = new WallpaperStore(join(home, 'w'))
  const [a, b, c] = ['a', 'b', 'c'].map((ch) => ch.repeat(32))
  const spec = { kind: 'rotate', items: [{ id: a }, { id: b }, { id: c }], interval: 60, shuffle: false, epoch: 1000000 }
  walls.saveDerived(a, DERIVED)
  const first = currentWall(values(spec), walls, 1000000)
  assert.equal(first.wall.key, a)
  assert.deepEqual(first.needs.map((item) => item.key), [b], '提前分析下一张')
  const second = currentWall(values(spec), walls, 1000000 + 60000)
  assert.equal(second.wall.key, a, '这张没分析好，先顶着')
  assert.deepEqual(second.needs.map((item) => item.key), [b, c])
  walls.saveDerived(b, DERIVED)
  assert.equal(currentWall(values(spec), walls, 1000000 + 60000).wall.key, b)
})

test('文件夹：只列图片，不递归、不跟符号链接；只能读到列表里的文件', async () => {
  const folder = join(home, '图库')
  mkdirSync(join(folder, 'sub'), { recursive: true })
  writeFileSync(join(folder, 'img10.png'), PNG)
  writeFileSync(join(folder, 'img2.png'), PNG)
  writeFileSync(join(folder, 'notes.txt'), 'x')
  writeFileSync(join(folder, 'sub', 'deep.png'), PNG)
  writeFileSync(join(home, 'secret.png'), PNG)
  symlinkSync(join(home, 'secret.png'), join(folder, 'link.png'))
  const walls = new WallpaperStore(join(home, 'w'))
  assert.deepEqual(walls.folder(folder).map((item) => item.name), ['img2.png', 'img10.png'], '自然排序')
  assert.equal(walls.folderFile(folder, '../secret.png'), undefined)
  assert.equal(walls.folderFile(folder, 'link.png'), undefined)
  assert.deepEqual(new WallpaperStore(join(home, 'w')).folder(join(home, '没有这个文件夹')), [])

  assert.equal((await api('/folder/img2.png')).status, 404, '还没选这个文件夹时读不到')
  await setState({ wallpaper: entry({ kind: 'folder', path: folder, interval: 60, shuffle: false, epoch: Date.now() }) })
  assert.equal((await api('/folder/img2.png')).status, 200)
  assert.equal((await api('/folder/notes.txt')).status, 404)
  assert.equal((await api('/folder/..%2Fsecret.png')).status, 404)
  const state = await getState()
  assert.equal(state.needs.length, 2)
  assert.match(state.needs[0].src, /\/wallpaper\/folder\/img/)
  assert.equal(existsSync(join(home, 'dsh-prism-skin', 'wallpapers')), false, '文件夹里的图不复制')
})
