/**
 * dsh-prism-skin — 开机入口（硬门：压缩后 ≤ 25KB）。
 *
 * 这里只做四件事：把已保存的变量交给宿主、管设置存档和多标签同步、注册设置页和
 * 侧栏按钮的「空壳」、检测冲突。配色引擎和全部界面都在分块 `client.studio.js` 里，
 * 用户第一次打开时才加载。
 *
 * 宿主不隔离插件工厂，这里一处抛错整站都会挂，所以每个钩子都包 try/catch。
 */
import { installPress, PRESS_CSS } from './press.js'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { Component, createElement as h, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BOOT_GLOBAL, CSS_MARK, effectiveTokens, unpackTokens } from '../shared/boot.js'
import { nextChange } from '../shared/schedule.js'
import { checkCss, CSS_MAX_LENGTH, effectiveCss, layerChange, LIBRARY_LIMIT, normalizeMaterial, normalizeName, normalizeOverrides, normalizeSeed, undoChange } from '../shared/state.js'
import { createCore } from './core.js'
import { detectConflicts, watchConflicts } from './conflicts.js'

/* global __HOST_REQUIRE__ */

const SOURCE = 'dsh-prism-skin'
const PREVIEW_SOURCE = 'dsh-prism-skin:preview'
const NS = 'prism'
const STUDIO_CHUNK = './client.studio.js'
const WALL_CHUNK = './client.wall.js'
const CUSTOM_CHUNK = './client.custom.js'
/** 跟随系统时，没在充电且电量不高于这个比例就省电。 */
const LOW_BATTERY = 0.2

const ZH = {
  nav: '棱镜',
  'quick.label': '换肤',
  'state.loading': '加载中…',
  'state.failed': '界面加载失败，请刷新页面重试。',
}
const EN = {
  nav: 'Prism',
  'quick.label': 'Themes',
  'state.loading': 'Loading…',
  'state.failed': 'Could not load this panel. Reload the page to retry.',
}

const warn = (message, error) => {
  try {
    console.warn(`[dsh-prism-skin] ${message}`, error)
  } catch {
    // 连 console 都不可用就算了
  }
}

/** 取分块；失败时下次可以重试（只记住成功的结果）。 */
let studioPromise
const loadStudio = () => {
  studioPromise ??= __HOST_REQUIRE__.async(STUDIO_CHUNK).catch((error) => {
    studioPromise = undefined
    throw error
  })
  return studioPromise
}

/** 壁纸分块：同样只记住成功的结果。 */
let wallPromise
const loadWall = () => {
  wallPromise ??= __HOST_REQUIRE__.async(WALL_CHUNK).catch((error) => {
    wallPromise = undefined
    throw error
  })
  return wallPromise
}

/** 高级、导入导出的界面：用到才加载。 */
let customPromise
const loadCustom = () => {
  customPromise ??= __HOST_REQUIRE__.async(CUSTOM_CHUNK).catch((error) => {
    customPromise = undefined
    throw error
  })
  return customPromise
}

/**
 * 自定义 CSS：首屏注入的那个标签直接接管（以标记注释开头），之后只改它的内容。
 * 内容在存档清洗时已经检查过（没有 `<`、`@import`、外链 url）。
 */
let cssTag
function applyCss(css) {
  try {
    if (cssTag === undefined) {
      cssTag = [...document.getElementsByTagName('style')].find((tag) => tag.textContent.startsWith(CSS_MARK)) ?? null
    }
    if (css === '') {
      cssTag?.remove()
      cssTag = null
      return
    }
    if (cssTag === null || !cssTag.isConnected) {
      cssTag = document.createElement('style')
      cssTag.setAttribute('data-prism-css', '')
      document.head.append(cssTag)
    }
    if (cssTag.textContent !== CSS_MARK + css) cssTag.textContent = CSS_MARK + css
  } catch (error) {
    warn('应用自定义 CSS 失败：', error)
  }
}

/** 链接里带的分享码（`#prism1.…`）：取出来交给设置页确认，地址栏里去掉，刷新不会重复提示。 */
function takeSharedCode() {
  try {
    const hash = location.hash
    if (!/^#prism1\.[0-9a-z.-]{10,80}$/i.test(hash)) return null
    history.replaceState(history.state, '', location.pathname + location.search)
    return hash.slice(1)
  } catch {
    return null
  }
}

const LazySection = lazy(() => loadStudio().then((module) => ({ default: module.Section })))
const LazyQuick = lazy(() => loadStudio().then((module) => ({ default: module.QuickPanel })))

/** 分块加载失败或渲染出错时只影响自己这一块，不把整个宿主带倒。 */
class Guard extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    warn('界面出错：', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** 设置页的空壳。 */
function SectionSeat(props) {
  const failed = h('p', { style: { color: 'var(--dsw-alias-state-error-primary)', padding: 16 } }, props.t('state.failed'))
  const loading = h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', padding: 16 } }, props.t('state.loading'))
  return h(Guard, { fallback: failed }, h(Suspense, { fallback: loading }, h(LazySection, props)))
}

/** 调色板图标（原来的三角形看着像警告标志）。 */
const PRISM_ICON = h(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
  h('path', { d: 'M8 2a6 6 0 1 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.4-.2-.7-.4-1-.2-.3-.4-.5-.4-.9 0-.7.6-1.2 1.3-1.2h1.3A2.8 2.8 0 0 0 14 6.9C14 4.1 11.3 2 8 2Z', stroke: 'currentColor', strokeWidth: 1.25, strokeLinejoin: 'round' }),
  h('circle', { cx: 5, cy: 7.2, r: 0.9, fill: 'currentColor' }),
  h('circle', { cx: 7.3, cy: 4.9, r: 0.9, fill: 'currentColor' }),
  h('circle', { cx: 10.4, cy: 5.6, r: 0.9, fill: 'currentColor' }),
)

/** 侧栏按钮的样式，尺寸和宿主的侧栏行一致。 */
const QUICK_CSS = '.prism-quick{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% - 4px);min-height:36px;margin:0 2px;padding:7px 8px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:22px;text-align:left;cursor:pointer}.prism-quick:hover,.prism-quick[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.prism-quick:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}.prism-quick[data-rail]{width:36px;height:36px;margin:0;padding:0;justify-content:center}'

if (typeof document !== 'undefined' && document.querySelector('style[data-prism-quick-css]') === null) {
  const tag = document.createElement('style')
  tag.setAttribute('data-prism-quick-css', '')
  tag.textContent = QUICK_CSS + PRESS_CSS
  document.head.append(tag)
}
if (typeof document !== 'undefined') installPress(document)

/** 侧栏按钮：只有它在开机时就渲染，面板要点开才加载。 */
function QuickSeat(props) {
  const { wide, t, useStore } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  const conflicted = useStore((state) => state.conflicts.length > 0)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      const root = rootRef.current
      if (root !== null && !root.contains(event.target) && !event.target?.closest?.('[data-prism-panel]')) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const label = t('quick.label')
  const prefetch = () => void loadStudio().catch(() => {})
  return h(
    'div',
    { ref: rootRef, style: { flex: wide ? '1 1 auto' : 'none', minWidth: 0, display: 'flex', justifyContent: 'center' } },
    h(
      'button',
      {
        type: 'button',
        'data-prism-quick': '',
        'aria-label': label,
        'aria-expanded': open,
        title: wide ? undefined : label,
        className: 'prism-quick',
        ...(wide ? null : { 'data-rail': '' }),
        onClick: () => setOpen((value) => !value),
        onPointerEnter: prefetch,
        onFocus: prefetch,
      },
      PRISM_ICON,
      wide ? h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label) : null,
      conflicted ? h('span', { 'aria-hidden': true, style: { flex: 'none', width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-state-warn-primary)' } }) : null,
    ),
    open
      ? h(
          Guard,
          { fallback: null },
          h(Suspense, { fallback: null }, h(LazyQuick, { ...props, anchor: rootRef, onClose: close })),
        )
      : null,
  )
}

/** 界面用的 store：派生状态（能不能撤销、有没有冲突……）都放这里，设置框开着时才会跟着刷新。 */
const uiStore = defineStore({
  init: () => ({
    theme: null,
    custom: null,
    adjust: {},
    overrideCount: 0,
    canUndo: false,
    scheme: 'light',
    conflicts: [],
    saveFailed: false,
    wallpaper: null,
    glass: null,
    glassLevel: null,
    wallKind: null,
    reduced: false,
    savingReason: null,
    power: 'auto',
    batterySupported: false,
    radius: null,
    css: '',
    overrides: {},
    library: [],
    fonts: null,
    incoming: null,
  }),
  actions: {
    sync(draft, next) {
      Object.assign(draft, next)
    },
  },
})

/** 插件名。 */
export const name = 'dsh-prism-skin'
/** 需要的宿主服务。 */
export const inject = ['slots', 'locale', 'theme']

/**
 * 客户端入口。
 * @param {any} ctx cordis 上下文
 */
export function apply(ctx) {
  try {
    start(ctx)
  } catch (error) {
    warn('启动失败，本次按宿主默认配色运行：', error)
  }
}

function start(ctx) {
  const boot = globalThis[BOOT_GLOBAL]
  const bootLayer = { tokens: unpackTokens(boot?.tokens), opaque: unpackTokens(boot?.layer?.o), wall: boot?.layer?.w ?? null }
  let disposeLayer
  let disposePreview

  const applyTokens = (tokens) => {
    try {
      if (tokens === null) {
        disposeLayer?.()
        disposeLayer = undefined
      } else {
        disposeLayer = ctx.theme.overrideTokens(SOURCE, tokens)
      }
    } catch (error) {
      warn('写入变量失败：', error)
    }
  }

  const preview = (tokens) => {
    try {
      if (tokens === null) {
        disposePreview?.()
        disposePreview = undefined
      } else {
        disposePreview = ctx.theme.overrideTokens(PREVIEW_SOURCE, tokens)
      }
    } catch (error) {
      warn('预览失败：', error)
    }
  }

  const query = (text) => (typeof matchMedia === 'function' ? matchMedia(text) : undefined)
  const reduceQuery = query('(prefers-reduced-transparency: reduce)')
  const motionQuery = query('(prefers-reduced-motion: reduce)')
  /** 电量：Chromium（含 Desktop）有 Battery Status API；没有的浏览器当作插着电。 */
  let battery
  const lowBattery = () => battery !== undefined && !battery.charging && battery.level <= LOW_BATTERY
  /**
   * 省电是否生效、因为什么。三档：跟随系统（减少透明度或低电量）/ 开 / 关。
   * @returns {'manual' | 'transparency' | 'battery' | null} 原因；不省电时为 null
   */
  const savingReason = () => {
    const power = core.values().power
    if (power === 'on') return 'manual'
    if (power === 'off') return null
    if (reduceQuery?.matches === true) return 'transparency'
    return lowBattery() ? 'battery' : null
  }
  const reduced = () => savingReason() !== null

  /** 省电时在 body 上标出原因（`data-prism-saving`），主题自带的 CSS 可以据此停掉动画。 */
  const markSaving = () => {
    const reason = savingReason()
    if (reason === null) document.body?.removeAttribute('data-prism-saving')
    else document.body?.setAttribute('data-prism-saving', reason)
  }

  /** 把一层交给宿主。轮播换图时用系统的视图过渡淡入，只在换图那一下占 GPU。 */
  const applyLayer = (layer, options) => {
    markSaving()
    const write = () => applyTokens(effectiveTokens(layer, reduced()))
    if (options?.animate === true && !reduced() && motionQuery?.matches !== true && document.visibilityState === 'visible' && typeof document.startViewTransition === 'function') {
      try {
        document.startViewTransition(write)
        return
      } catch {
        // 不支持就直接换
      }
    }
    write()
  }

  /** 每张图每次会话只试一次，分析失败不会没完没了地重试。 */
  const attempted = new Set()
  const onNeeds = (needs) => {
    const fresh = needs.filter((item) => !attempted.has(item.key))
    if (fresh.length === 0) return
    for (const item of fresh) attempted.add(item.key)
    loadWall()
      .then((wall) => wall.processNeeds(fresh))
      .then((done) => (done > 0 ? core.refresh() : false))
      .catch((error) => warn('壁纸分析失败：', error))
  }

  const core = createCore({
    bootDoc: boot?.doc,
    bootLayer,
    applyLayer,
    onNeeds,
    storage: (() => {
      try {
        return globalThis.localStorage
      } catch {
        return undefined
      }
    })(),
    channel: typeof BroadcastChannel === 'function' ? (channelName) => new BroadcastChannel(channelName) : undefined,
    fetch: (...args) => globalThis.fetch(...args),
  })

  // 先把变量交给宿主：宿主接手时写入的和首屏脚本是同一批，不会跳变
  if (bootLayer.tokens !== null) applyLayer(bootLayer)

  let conflicts = detectConflicts()
  let incoming = takeSharedCode()
  /** 宿主自己的字体设置（「通用」里那一份）。棱镜的字体界面直接读写它，不另存一份。 */
  const fonts = () => {
    try {
      const theme = ctx.theme.getTheme()
      return { families: theme.fontFamilies ?? null, sizes: theme.fontSizes ?? null }
    } catch {
      return null
    }
  }
  applyCss(effectiveCss(core.values()))
  ctx.effect(() => core.subscribe(() => applyCss(effectiveCss(core.values()))), 'dsh-prism-skin:css')
  /** @type {Set<{sync: (next: object) => void}>} */
  const storeActions = new Set()
  const scheme = () => ctx.theme.getTheme().active.colorScheme

  const snapshot = () => {
    const values = core.values()
    return {
      theme: values.theme,
      custom: values.custom,
      adjust: values.adjust,
      overrideCount: Object.keys(values.overrides).length,
      canUndo: values.history.length > 0,
      scheme: scheme(),
      conflicts,
      saveFailed: core.saveFailed(),
      wallpaper: values.wallpaper,
      glass: values.glass,
      glassLevel: core.tokens()?.['--prism-glass']?.[scheme()] ?? null,
      wallKind: core.layer().wall?.kind ?? null,
      reduced: reduced(),
      savingReason: savingReason(),
      power: values.power,
      batterySupported: battery !== undefined,
      radius: values.radius,
      css: values.css,
      overrides: values.overrides,
      library: values.library,
      fonts: fonts(),
      incoming,
    }
  }
  const pushSnapshot = () => {
    try {
      const next = snapshot()
      for (const actions of storeActions) actions.sync(next)
    } catch (error) {
      warn('刷新界面状态失败：', error)
    }
  }

  ctx.effect(() => core.subscribe(pushSnapshot), 'dsh-prism-skin:store')
  // theme/change 是同步事件，这里只读明暗；读合成后的 tokens 会把旧值灌回来
  ctx.on('theme/change', pushSnapshot)

  ctx.effect(
    () =>
      watchConflicts((next) => {
        conflicts = next
        pushSnapshot()
      }),
    'dsh-prism-skin:conflicts',
  )

  /** 轮播：到点问 host 该显示哪张。窗口隐藏时不走定时器，回到前台再对一次。 */
  let rotationTimer
  const scheduleRotation = () => {
    clearTimeout(rotationTimer)
    rotationTimer = undefined
    const spec = core.values().wallpaper
    if ((spec?.kind !== 'rotate' && spec?.kind !== 'folder') || document.visibilityState === 'hidden') return
    const wait = Math.max(1000, nextChange(spec, Date.now()) - Date.now() + 50)
    rotationTimer = setTimeout(() => {
      core.refresh({ animate: true }).finally(scheduleRotation)
    }, wait)
  }
  ctx.effect(() => core.subscribe(scheduleRotation), 'dsh-prism-skin:rotation')

  // 省电档位可能是别的窗口改的（同步或对账带过来），这时这一层没变，但要换成另一套变量
  let lastSaving = reduced()
  markSaving()
  ctx.effect(
    () =>
      core.subscribe(() => {
        const saving = reduced()
        if (saving === lastSaving) return
        lastSaving = saving
        applyLayer(core.layer())
      }),
    'dsh-prism-skin:power',
  )

  const onReduceChange = () => {
    applyLayer(core.layer())
    pushSnapshot()
  }
  const onPageHide = () => void core.flush({ keepalive: true })
  const onVisible = () => {
    if (document.visibilityState === 'visible') void core.refresh()
    scheduleRotation()
  }
  // 电池状态变化时重新判断（只在跟随系统时有影响）
  if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
    navigator
      .getBattery()
      .then((manager) => {
        battery = manager
        manager.addEventListener?.('chargingchange', onReduceChange)
        manager.addEventListener?.('levelchange', onReduceChange)
        ctx.effect(() => () => {
          manager.removeEventListener?.('chargingchange', onReduceChange)
          manager.removeEventListener?.('levelchange', onReduceChange)
        }, 'dsh-prism-skin:battery')
        onReduceChange()
      })
      .catch(() => {})
  }

  ctx.effect(() => {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisible)
    reduceQuery?.addEventListener?.('change', onReduceChange)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisible)
      reduceQuery?.removeEventListener?.('change', onReduceChange)
      clearTimeout(rotationTimer)
      void core.flush({ keepalive: true })
      core.dispose()
      disposePreview?.()
      disposeLayer?.()
    }
  }, 'dsh-prism-skin:lifecycle')

  core.reconcile().catch((error) => warn('同步设置失败，先用现有配色：', error)).finally(scheduleRotation)

  ctx.effect(() => {
    try {
      return ctx.locale.register(NS, { zh: ZH, en: EN })
    } catch (error) {
      warn('注册词典失败：', error)
      return () => {}
    }
  }, 'dsh-prism-skin:locale')

  const host = {
    core,
    preview,
    locale: ctx.locale,
    registerLocale: (ns, dicts) => ctx.effect(() => ctx.locale.register(ns, dicts), `dsh-prism-skin:${ns}`),
    setMainLayer: applyTokens,
    scheme,
    setScheme: (value) => ctx.theme.setTheme(value),
    loadStudio,
    loadWall,
    loadCustom,
    // 分块共用的存档函数：入口里本来就有，交出去，分块不用各打包一份
    shared: { checkCss, CSS_MAX_LENGTH, layerChange, undoChange, normalizeOverrides, normalizeSeed, normalizeMaterial, effectiveTokens, normalizeName, LIBRARY_LIMIT },
    setFont: (role, kind, value) => {
      if (kind === 'size') ctx.theme.setFontSize(role, value)
      else ctx.theme.setFontFamily(role, value)
    },
    dismissIncoming: () => {
      incoming = null
      pushSnapshot()
    },
    reduced,
    // Desktop 有自己的原生选择框；网页版走宿主服务（本机弹系统框，远程访问时不可用）
    pickDirectory: () => globalThis.__DSH_DIRECTORY_PICKER__?.pick?.() ?? ctx.get('uiWorkspace')?.pickDirectory?.(),
  }
  const injected = (actions) => {
    storeActions.add(actions)
    pushSnapshot()
    return { host }
  }
  const label = () => {
    try {
      return ctx.locale.bind(NS)('nav')
    } catch {
      return ZH.nav
    }
  }

  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: 'prism-skin', order: 12, label, locale: NS, store: uiStore, inject: injected }, SectionSeat),
      ),
    'dsh-prism-skin:section',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'prism-skin', order: 40, locale: NS, store: uiStore, inject: injected }, QuickSeat),
      ),
    'dsh-prism-skin:quick',
  )
}
