import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createCore } from '../src/client/core.js'
import { packLayer } from '../src/shared/boot.js'
import { emptyDoc, mergeKeys, stampPatch } from '../src/shared/state.js'

const tokensFor = (name) => ({ '--x': { light: `${name}-l`, dark: `${name}-d` } })
const layerFor = (name) => ({ tokens: tokensFor(name), opaque: null, wall: null })

/** 假的 host：和真实 host 一样按键合并。 */
function fakeHost(initial = emptyDoc()) {
  const host = {
    doc: initial,
    layer: packLayer({ tokens: null, opaque: null, wall: null }),
    needs: [],
    posts: [],
    down: false,
    fetch: async (_url, options) => {
      if (host.down) throw new Error('断网')
      if (options?.method === 'POST') {
        const { patch } = JSON.parse(options.body)
        host.posts.push({ patch, keepalive: options.keepalive })
        host.doc = mergeKeys(host.doc, patch).doc
        return { ok: true, json: async () => ({ ok: true, doc: host.doc }) }
      }
      return { ok: true, json: async () => ({ ok: true, doc: host.doc, layer: host.layer, needs: host.needs }) }
    },
  }
  return host
}

function fakeStorage() {
  const map = new Map()
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map }
}

/** 假的 BroadcastChannel：同一个 bus 上的通道互通。 */
function fakeBus() {
  const channels = new Set()
  const factory = () => {
    const channel = {
      onmessage: null,
      postMessage(data) {
        for (const other of channels) if (other !== channel) other.onmessage?.({ data: structuredClone(data) })
      },
      close() {
        channels.delete(channel)
      },
    }
    channels.add(channel)
    return channel
  }
  return factory
}

/** 手动推进的定时器。 */
function fakeTimers() {
  const pending = new Set()
  return {
    setTimer: (callback) => {
      const timer = { callback }
      pending.add(timer)
      return timer
    },
    clearTimer: (timer) => pending.delete(timer),
    run: async () => {
      for (const timer of [...pending]) {
        pending.delete(timer)
        await timer.callback()
      }
      await new Promise((resolve) => setImmediate(resolve))
    },
    count: () => pending.size,
  }
}

function makeCore(host, overrides = {}) {
  const applied = []
  const optionsSeen = []
  const timers = overrides.timers ?? fakeTimers()
  const core = createCore({
    bootDoc: host.doc,
    applyLayer: (layer, options) => {
      applied.push(layer.tokens)
      optionsSeen.push(options)
    },
    fetch: host.fetch,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    tabId: 'tab-a',
    now: () => overrides.clock?.() ?? 1000,
    ...overrides,
  })
  return { core, applied, timers, optionsSeen }
}

const commit = (core, change, name) => core.commit(change, layerFor(name))

test('提交：立刻生效，稍后才写 host，连续改动合并成一次写入', async () => {
  const host = fakeHost()
  const storage = fakeStorage()
  const { core, applied, timers } = makeCore(host, { storage })
  commit(core, { theme: 'mist' }, 'mist')
  commit(core, { theme: 'pine' }, 'pine')
  assert.equal(core.values().theme, 'pine')
  assert.deepEqual(applied.at(-1), tokensFor('pine'))
  assert.equal(host.posts.length, 0, '防抖期间不写')
  await timers.run()
  assert.equal(host.posts.length, 1)
  assert.equal(host.posts[0].patch.theme.v, 'pine')
  assert.equal(core.saveFailed(), false)
  assert.equal(JSON.parse(storage.map.get('dsh-prism-skin:doc')).doc.keys.theme.v, 'pine', 'localStorage 里有缓存')
})

test('同一毫秒里连续提交：后一次赢，撤销也不会被吞掉', () => {
  const { core } = makeCore(fakeHost(), { clock: () => 1000 })
  commit(core, { theme: 'mist' }, 'mist')
  commit(core, { theme: 'pine' }, 'pine')
  commit(core, { theme: 'mist' }, 'mist')
  assert.equal(core.values().theme, 'mist')
  assert.ok(core.doc().keys.theme.t > 1000)
})

test('本地时钟落后于存档里的时间戳时，本地操作照样生效', () => {
  const host = fakeHost(mergeKeys(emptyDoc(), stampPatch({ theme: 'pine' }, 99999, 'desktop')).doc)
  const { core } = makeCore(host, { clock: () => 1000 })
  commit(core, { theme: 'mist' }, 'mist')
  assert.equal(core.values().theme, 'mist')
})

test('监听器：提交后通知；单个监听器出错不影响别的', () => {
  const { core } = makeCore(fakeHost())
  const warn = console.warn
  console.warn = () => {}
  after(() => {
    console.warn = warn
  })
  const seen = []
  core.subscribe(() => {
    throw new Error('坏监听器')
  })
  const stop = core.subscribe(() => seen.push(core.values().theme))
  commit(core, { theme: 'mist' }, 'mist')
  assert.deepEqual(seen, ['mist'])
  stop()
  commit(core, { theme: 'pine' }, 'pine')
  assert.equal(seen.length, 1)
})

test('多标签：改动带着变量广播，对方立刻生效，不需要配色引擎', () => {
  const channel = fakeBus()
  const host = fakeHost()
  const a = makeCore(host, { channel, tabId: 'tab-a' })
  const b = makeCore(host, { channel, tabId: 'tab-b' })
  commit(a.core, { theme: 'mist' }, 'mist')
  assert.equal(b.core.values().theme, 'mist')
  assert.deepEqual(b.applied.at(-1), tokensFor('mist'))
  assert.deepEqual(b.core.tokens(), tokensFor('mist'))
})

test('多标签：两边改不同的键，互不覆盖', async () => {
  const channel = fakeBus()
  const host = fakeHost()
  let clock = 1000
  const a = makeCore(host, { channel, tabId: 'tab-a', clock: () => clock })
  const b = makeCore(host, { channel, tabId: 'tab-b', clock: () => clock })
  commit(a.core, { theme: 'mist' }, 'mist')
  clock = 2000
  commit(b.core, { adjust: { hue: 10 } }, 'both')
  assert.equal(a.core.values().theme, 'mist')
  assert.deepEqual(a.core.values().adjust, { hue: 10 })
  assert.equal(b.core.values().theme, 'mist')
  await a.timers.run()
  await b.timers.run()
  assert.equal(host.doc.keys.theme.v, 'mist')
  assert.deepEqual(host.doc.keys.adjust.v, { hue: 10 })
})

test('多标签：晚到的旧消息不会盖掉新值', () => {
  const channel = fakeBus()
  const host = fakeHost()
  const receiver = makeCore(host, { channel, tabId: 'tab-b', clock: () => 5000 })
  commit(receiver.core, { theme: 'pine' }, 'pine')
  const sender = channel()
  sender.postMessage({ from: 'tab-x', patch: stampPatch({ theme: 'mist' }, 1000, 'tab-x'), layer: packLayer(layerFor('mist')) })
  assert.equal(receiver.core.values().theme, 'pine')
  assert.deepEqual(receiver.core.tokens(), tokensFor('pine'))
})

test('多标签：只有部分键生效时不用消息里的变量，改由 host 重新算', async () => {
  const channel = fakeBus()
  const host = fakeHost()
  host.layer = packLayer(layerFor('from-host'))
  const receiver = makeCore(host, { channel, tabId: 'tab-b', clock: () => 5000 })
  commit(receiver.core, { theme: 'pine' }, 'pine')
  const sender = channel()
  sender.postMessage({
    from: 'tab-x',
    patch: { ...stampPatch({ theme: 'mist' }, 1000, 'tab-x'), ...stampPatch({ adjust: { hue: 1 } }, 9000, 'tab-x') },
    layer: packLayer(layerFor('mist')),
  })
  await receiver.timers.run()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(receiver.core.tokens(), tokensFor('from-host'))
})

test('host 连不上：先记在 localStorage，下次启动补写，新的键不丢', async () => {
  const host = fakeHost()
  const storage = fakeStorage()
  const first = makeCore(host, { storage })
  host.down = true
  commit(first.core, { theme: 'mist' }, 'mist')
  await first.timers.run()
  assert.equal(first.core.saveFailed(), true)
  assert.equal(host.doc.keys.theme, undefined)

  host.down = false
  host.layer = packLayer(layerFor('mist'))
  const second = makeCore(host, { storage, tabId: 'tab-c' })
  await second.core.reconcile()
  assert.equal(host.doc.keys.theme.v, 'mist', '补写成功')
  assert.equal(second.core.values().theme, 'mist')
  assert.deepEqual(second.core.tokens(), tokensFor('mist'))
})

test('host 上的键更新时，本地没写出去的旧键不会盖回去', async () => {
  const host = fakeHost()
  const storage = fakeStorage()
  const first = makeCore(host, { storage, clock: () => 1000 })
  host.down = true
  commit(first.core, { theme: 'old' }, 'old')
  await first.timers.run()
  host.down = false
  host.doc = mergeKeys(host.doc, stampPatch({ theme: 'newer' }, 9000, 'desktop')).doc
  const second = makeCore(host, { storage, tabId: 'tab-c' })
  await second.core.reconcile()
  assert.equal(second.core.values().theme, 'newer')
  assert.equal(host.doc.keys.theme.v, 'newer')
})

test('写入失败后恢复：再保存一次就清掉错误状态，失败的键一起写', async () => {
  const host = fakeHost()
  const { core, timers } = makeCore(host)
  host.down = true
  commit(core, { theme: 'mist' }, 'mist')
  await timers.run()
  assert.equal(core.saveFailed(), true)
  host.down = false
  commit(core, { adjust: { hue: 1 } }, 'both')
  await timers.run()
  assert.equal(core.saveFailed(), false)
  assert.equal(host.doc.keys.theme.v, 'mist')
  assert.deepEqual(host.doc.keys.adjust.v, { hue: 1 })
})

test('host 点名要分析的图时交给 onNeeds；轮播到点的刷新带动画选项', async () => {
  const host = fakeHost()
  host.needs = [{ key: 'abc', src: '/x' }]
  const seen = []
  const { core, optionsSeen } = makeCore(host, { onNeeds: (needs) => seen.push(needs) })
  await core.refresh()
  assert.deepEqual(seen, [[{ key: 'abc', src: '/x' }]])
  host.layer = packLayer(layerFor('next'))
  await core.refresh({ animate: true })
  assert.deepEqual(optionsSeen.at(-1), { animate: true })
})

test('本地还有没写出去的改动时，host 的旧结果不会盖掉眼前的主题', async () => {
  const host = fakeHost()
  const { core, applied } = makeCore(host)
  commit(core, { theme: 'mist' }, 'mist')
  await core.refresh()
  assert.deepEqual(applied.at(-1), tokensFor('mist'))
  assert.deepEqual(core.tokens(), tokensFor('mist'))
})

test('首屏数据是旧的（Desktop 只在启动时算一次）：启动时也会向 host 对账', async () => {
  const host = fakeHost(mergeKeys(emptyDoc(), stampPatch({ theme: 'new' }, 9000, 'x')).doc)
  host.layer = packLayer(layerFor('new'))
  const { core, applied } = makeCore(host, { bootDoc: mergeKeys(emptyDoc(), stampPatch({ theme: 'old' }, 1000, 'x')).doc, bootLayer: layerFor('old') })
  await core.reconcile()
  assert.equal(core.values().theme, 'new')
  assert.deepEqual(applied.at(-1), tokensFor('new'))
})

test('没有首屏数据时从 host 取', async () => {
  const host = fakeHost(mergeKeys(emptyDoc(), stampPatch({ theme: 'mist' }, 1, 'x')).doc)
  host.layer = packLayer(layerFor('mist'))
  const { core, applied } = makeCore(host, { bootDoc: undefined })
  assert.equal(core.values().theme, null)
  await core.reconcile()
  assert.equal(core.values().theme, 'mist')
  assert.deepEqual(applied.at(-1), tokensFor('mist'))
})

test('窗口回到前台：别的窗口改过就更新，没改过就不动', async () => {
  const host = fakeHost()
  const { core, applied } = makeCore(host)
  await core.refresh()
  assert.equal(applied.length, 0, '没有变化不写变量')
  host.doc = mergeKeys(host.doc, stampPatch({ theme: 'mist' }, 9000, 'desktop')).doc
  host.layer = packLayer(layerFor('mist'))
  await core.refresh()
  assert.equal(core.values().theme, 'mist')
  assert.deepEqual(applied.at(-1), tokensFor('mist'))
})

test('窗口回到前台时 host 连不上：不抛错', async () => {
  const host = fakeHost()
  const { core } = makeCore(host)
  host.down = true
  assert.equal(await core.refresh(), false)
})

test('页面关闭时立刻写，并带 keepalive', async () => {
  const host = fakeHost()
  const { core, timers } = makeCore(host)
  commit(core, { theme: 'mist' }, 'mist')
  await core.flush({ keepalive: true })
  assert.equal(host.posts[0].keepalive, true)
  assert.equal(timers.count(), 0, '防抖定时器已取消')
})

test('localStorage 或 BroadcastChannel 不可用时照常工作', async () => {
  const host = fakeHost()
  const storage = {
    getItem() {
      throw new Error('隐私模式')
    },
    setItem() {
      throw new Error('配额满')
    },
  }
  const { core, timers } = makeCore(host, {
    storage,
    channel: () => {
      throw new Error('不支持')
    },
  })
  commit(core, { theme: 'mist' }, 'mist')
  await timers.run()
  await core.reconcile()
  assert.equal(host.doc.keys.theme.v, 'mist')
})
