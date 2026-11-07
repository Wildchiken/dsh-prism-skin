/**
 * 客户端的设置中枢：内存里的存档、落盘、多标签同步。
 *
 * 不依赖 DOM 和宿主，依赖都从参数传进来，所以可以在 node 里测。
 * 原则：设置以 host 文件为准，localStorage 只做缓存（host 暂时连不上时先记着，
 * 下次连上再补写）；按键记时间戳，所以不怕乱序和重复。
 *
 * 「一层」指交给宿主的变量、减少透明度时的替换项和当前壁纸（见 shared/boot.js）。
 */
import { packLayer, unpackLayer } from '../shared/boot.js'
import { docValues, emptyDoc, mergeKeys, normalizeDoc, stampPatch } from '../shared/state.js'

const CACHE_KEY = 'dsh-prism-skin:doc'
const CHANNEL = 'dsh-prism-skin'
const API = '/prism-skin/api/state'
const SAVE_DELAY_MS = 180
const EMPTY_LAYER = Object.freeze({ tokens: null, opaque: null, wall: null })

/** @typedef {import('../shared/boot.js').Layer} Layer */

/**
 * @typedef {object} CoreDeps
 * @property {import('../shared/state.js').Doc | undefined} bootDoc 首屏注入的存档
 * @property {Layer} [bootLayer] 首屏注入的一层
 * @property {(layer: Layer, options?: {animate?: boolean}) => void} applyLayer 把这一层交给宿主
 * @property {(needs: {key: string, src: string}[]) => void} [onNeeds] host 说有图等着分析
 * @property {Pick<Storage, 'getItem' | 'setItem'> | undefined} [storage] localStorage
 * @property {((name: string) => Pick<BroadcastChannel, 'postMessage' | 'close'> & {onmessage: ((event: {data: any}) => void) | null}) | undefined} [channel] 建 BroadcastChannel
 * @property {typeof fetch} fetch fetch
 * @property {() => number} [now] 时钟
 * @property {string} [tabId] 标签页 id
 * @property {(callback: () => void, ms: number) => unknown} [setTimer] 定时器
 * @property {(timer: unknown) => void} [clearTimer] 取消定时器
 */

/**
 * @param {CoreDeps} deps 依赖
 * @returns {ReturnType<typeof buildCore>} 设置中枢
 */
export function createCore(deps) {
  return buildCore(deps)
}

function buildCore(deps) {
  const now = deps.now ?? Date.now
  const tabId = deps.tabId ?? `tab-${now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(/** @type {any} */ (timer)))
  const listeners = new Set()

  let doc = deps.bootDoc === undefined ? emptyDoc() : normalizeDoc(deps.bootDoc)
  /** @type {Layer} */
  let layer = deps.bootLayer ?? EMPTY_LAYER
  /** @type {Record<string, import('../shared/state.js').KeyEntry>} 等着写给 host 的键 */
  let pending = {}
  let timer
  let lastError = false
  let disposed = false
  let lastStamp = 0
  /** 问 host 时本地还有没写出去的改动，结果先不用；写完要再问一次。 */
  let stale = false

  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.warn('[dsh-prism-skin] 监听器出错：', error)
      }
    }
  }

  const cache = () => {
    try {
      deps.storage?.setItem(CACHE_KEY, JSON.stringify({ doc, pending }))
    } catch {
      // 配额满或隐私模式：缓存不是必需的
    }
  }

  const readCache = () => {
    try {
      const text = deps.storage?.getItem(CACHE_KEY)
      if (typeof text !== 'string') return undefined
      const parsed = JSON.parse(text)
      return { doc: normalizeDoc(parsed?.doc), pending: parsed?.pending ?? {} }
    } catch {
      return undefined
    }
  }

  const channel = (() => {
    try {
      return deps.channel?.(CHANNEL)
    } catch {
      return undefined
    }
  })()

  /** 从 host 重新取一次（别的窗口可能改过，轮播也可能到点了）。 */
  const pull = async (options) => {
    const response = await deps.fetch(API, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    const remote = normalizeDoc(body?.doc)
    const merged = mergeKeys(doc, remote.keys)
    const changed = merged.changed.length > 0
    doc = { ...merged.doc, rev: Math.max(merged.doc.rev, remote.rev) }
    // 本地还有没写出去的改动时，host 算出来的这层是旧的，别拿它盖掉眼前的结果
    const next = unpackLayer(body?.layer)
    const differs = JSON.stringify(next) !== JSON.stringify(layer)
    const moved = differs && Object.keys(pending).length === 0
    stale = differs && !moved
    if (moved) {
      layer = next
      deps.applyLayer(layer, options)
    }
    cache()
    if (changed || moved) notify()
    if (Array.isArray(body?.needs)) deps.onNeeds?.(body.needs)
    return changed || moved
  }

  const flush = async (options = {}) => {
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
    const patch = pending
    if (Object.keys(patch).length === 0) return
    pending = {}
    try {
      const response = await deps.fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
        keepalive: options.keepalive === true,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      // host 可能合并了别的窗口写的键：带回来的版本号以 host 为准
      const merged = mergeKeys(doc, normalizeDoc(body?.doc).keys)
      doc = { ...merged.doc, rev: Math.max(merged.doc.rev, normalizeDoc(body?.doc).rev) }
      lastError = false
      cache()
      if (merged.changed.length > 0 || stale) await pull()
      notify()
    } catch {
      // 留到下次补写。比本地新的键不会丢，因为合并时按时间戳算
      pending = { ...patch, ...pending }
      lastError = true
      cache()
      notify()
    }
  }

  const schedule = () => {
    if (timer !== undefined) clearTimer(timer)
    timer = setTimer(() => {
      timer = undefined
      void flush()
    }, SAVE_DELAY_MS)
  }

  if (channel !== undefined) {
    channel.onmessage = (event) => {
      const data = event?.data
      if (disposed || data === null || typeof data !== 'object' || data.from === tabId) return
      const merged = mergeKeys(doc, data.patch ?? {})
      if (merged.changed.length === 0) return
      doc = merged.doc
      // 只有这条消息的改动全部生效时，随消息带来的那一层才是当前结果；否则让 host 算
      if (merged.changed.length === Object.keys(data.patch ?? {}).length && data.layer !== undefined) {
        layer = unpackLayer(data.layer)
        deps.applyLayer(layer)
      } else {
        void pull().catch(() => {})
      }
      cache()
      notify()
    }
  }

  const core = {
    tabId,
    /** @returns {import('../shared/state.js').Values} 当前设置 */
    values: () => docValues(doc),
    /** @returns {import('../shared/state.js').Doc} 当前存档 */
    doc: () => doc,
    /** @returns {Layer} 当前这一层 */
    layer: () => layer,
    /** @returns {Layer['tokens']} 当前变量 */
    tokens: () => layer.tokens,
    /** @returns {boolean} 最近一次保存是否失败 */
    saveFailed: () => lastError,
    /** @param {() => void} listener 监听 @returns {() => void} 取消监听 */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * 提交一次改动：立刻生效、广播给其他标签页、稍后写 host。
     * @param {Partial<import('../shared/state.js').Values>} change 改动的键
     * @param {Layer} nextLayer 对应的一层
     */
    commit(change, nextLayer) {
      // 用户的操作要压过眼前看到的值：时间戳只增不减，同一毫秒连点两次也是后一次赢
      let t = Math.max(now(), lastStamp + 1)
      for (const key of Object.keys(change)) t = Math.max(t, (doc.keys[key]?.t ?? 0) + 1)
      lastStamp = t
      const patch = stampPatch(change, t, tabId)
      doc = mergeKeys(doc, patch).doc
      pending = { ...pending, ...patch }
      layer = nextLayer
      deps.applyLayer(layer)
      cache()
      try {
        channel?.postMessage({ from: tabId, patch, layer: packLayer(layer) })
      } catch {
        // 消息太大或通道已关：其他标签页回到前台时还会取一次
      }
      schedule()
      notify()
    },
    /** 启动时对账：Desktop 的首屏数据只在应用启动时算一次，刷新窗口后可能是旧的，所以总要问一次 host。 */
    async reconcile() {
      const unsaved = readCache()?.pending ?? {}
      if (Object.keys(unsaved).length > 0) {
        const merged = mergeKeys(doc, unsaved)
        const newer = {}
        for (const key of merged.changed) newer[key] = unsaved[key]
        if (merged.changed.length > 0) {
          doc = merged.doc
          pending = { ...newer, ...pending }
          await flush()
        }
      }
      await pull()
    },
    /**
     * 再问一次 host：窗口回到前台、轮播到点、壁纸分析完。
     * @param {{animate?: boolean}} [options] animate：这次变化要不要过渡动画
     * @returns {Promise<boolean>} 有没有变化
     */
    refresh: (options) => pull(options).catch(() => false),
    flush,
    dispose() {
      disposed = true
      if (timer !== undefined) clearTimer(timer)
      listeners.clear()
      try {
        channel?.close()
      } catch {
        // 已关闭
      }
    },
  }
  return core
}
