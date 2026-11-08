/**
 * 懒加载分块：配色引擎和全部设置界面。第一次打开设置页或侧栏面板时才加载。
 */
import { createElement as h, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BASE_SEED, CODE_SCHEMES, CUSTOM_THEME, effectiveCss, PACK_PREFIX, RADIUS_TOKENS, THEMES, completeSeed, generate, seedOf, tokenNames } from '../../engine/index.js'
import { packToTheme, planDream } from '../../engine/convert.js'
import { fromOklch, toHex } from '../../engine/color.js'
import { BackgroundGroup } from './background.js'
import { createController } from './controller.js'
import { DICT, STUDIO_NS } from './dict.js'
import { CSS } from './styles.js'

const STYLE_ID = 'data-prism-studio'

if (typeof document !== 'undefined' && document.querySelector(`style[${STYLE_ID}]`) === null) {
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ID, '')
  tag.textContent = CSS
  document.head.append(tag)
}

/** @type {WeakMap<object, {control: ReturnType<typeof createController>, t: (key: string, params?: object) => string}>} */
const bound = new WeakMap()

/** 每个 host 只初始化一次：注册词典、建操作集合。 */
function useStudio(host) {
  let entry = bound.get(host)
  if (entry === undefined) {
    host.registerLocale(STUDIO_NS, DICT)
    entry = { control: createController(host), t: host.locale.bind(STUDIO_NS) }
    bound.set(host, entry)
  }
  return entry
}

const SAFE_NAME = (theme, locale) => theme.name[locale] ?? theme.name.en

const localeOf = (host) => {
  try {
    return String(host.locale.getLocale().active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

/** 卡片要用的颜色：一套主题只算一次。 */
const paletteCache = new Map()
function paletteOf(key, seed, overrides) {
  let tokens = paletteCache.get(key)
  if (tokens === undefined) {
    // 「我的主题」自带的变量覆盖也算进去，卡片才像那套主题
    tokens = overrides === undefined ? generate(seed) : { ...generate(seed), ...overrides }
    paletteCache.set(key, tokens)
  }
  return tokens
}

function cardColors(key, seed, scheme, overrides) {
  const tokens = paletteOf(key, seed, overrides)
  const pick = (name) => tokens[`--dsw-${name}`][scheme]
  return {
    canvas: pick('alias-bg-base'),
    side: pick('specific-sidebar-fill'),
    bubble: pick('specific-bubble'),
    text: pick('alias-label-primary'),
    muted: pick('alias-label-tertiary'),
    faint: pick('alias-border-l4'),
    active: pick('specific-sidebar-nav-item-active'),
    accent: pick('alias-button-primary-fill'),
    accentText: pick('alias-state-business-primary'),
  }
}

/** 主题列表：宿主默认 + 内置 + 「我的主题」 + （正在用的）随机配色。 */
function useChoices(theme, custom, library, t, host) {
  return useMemo(() => {
    const locale = localeOf(host)
    const rows = [{ id: null, key: 'none', name: t('theme.none'), seed: BASE_SEED }]
    for (const item of THEMES) rows.push({ id: item.id, key: item.id, name: SAFE_NAME(item, locale), seed: item.seed })
    for (const pack of library) rows.push({ id: PACK_PREFIX + pack.id, key: `my:${pack.id}:${JSON.stringify([pack.seed, pack.overrides])}`, name: pack.name, seed: Object.keys(pack.seed).length > 0 ? pack.seed : BASE_SEED, overrides: pack.overrides, mine: pack.id })
    if (theme === CUSTOM_THEME && custom !== null) rows.push({ id: CUSTOM_THEME, key: `custom:${JSON.stringify(custom)}`, name: t('theme.custom'), seed: custom })
    return rows
  }, [theme, custom, library, t, host])
}

/**
 * 当前主题的名字；选中的「我的主题」被删掉了就算宿主默认。
 * @returns {string} 名字
 */
const currentName = (choices, theme, t) => choices.find((choice) => choice.id === theme)?.name ?? t('theme.none')

/** 有没有在主题上做过修改（微调、圆角、变量覆盖、CSS）。 */
function useModified(useStore) {
  const adjust = useStore((state) => state.adjust)
  const radius = useStore((state) => state.radius)
  const overrideCount = useStore((state) => state.overrideCount)
  const css = useStore((state) => state.css)
  return Object.keys(adjust).length > 0 || radius !== null || overrideCount > 0 || css !== ''
}

const ICON = {
  moon: 'M12.5 9.7A5.5 5.5 0 0 1 6.3 3.5a5.5 5.5 0 1 0 6.2 6.2Z',
  sun: 'M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0-3.2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1',
  dice: 'M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Zm1.6 3.1h.01M10.4 5.6h.01M8 8h.01M5.6 10.4h.01M10.4 10.4h.01',
  undo: 'M6 3.5 3 6.5l3 3M3.2 6.5H10a3 3 0 0 1 0 6H7.5',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  cross: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  warn: 'M8 2.8 14 13.2H2zM8 7v3M8 11.8h.01',
}

function Icon({ name, size = 14 }) {
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: ICON[name] }),
  )
}

/** 明暗、随机、撤销：设置页和侧栏面板共用。 */
function ActionButtons({ control, t, useStore }) {
  const scheme = useStore((state) => state.scheme)
  const canUndo = useStore((state) => state.canUndo)
  const dark = scheme === 'dark'
  return [
    h('button', { key: 'scheme', type: 'button', className: 'prism-btn', 'data-prism-action': 'scheme', onClick: control.toggleScheme }, h(Icon, { name: dark ? 'sun' : 'moon' }), t(dark ? 'action.light' : 'action.dark')),
    h('button', { key: 'random', type: 'button', className: 'prism-btn', 'data-prism-action': 'random', onClick: control.randomize }, h(Icon, { name: 'dice' }), t('action.random')),
    h('button', { key: 'undo', type: 'button', className: 'prism-btn', 'data-prism-action': 'undo', disabled: !canUndo, onClick: control.undo }, h(Icon, { name: 'undo' }), t('action.undo')),
  ]
}

function Notes({ t, useStore }) {
  const conflicts = useStore((state) => state.conflicts)
  const saveFailed = useStore((state) => state.saveFailed)
  const notes = conflicts.map((id) => t(`conflict.${id}`))
  if (saveFailed) notes.push(t('save.failed'))
  return notes.map((text) => h('div', { key: text, className: 'prism-note', role: 'status', 'data-prism-note': '' }, h(Icon, { name: 'warn' }), h('span', null, text)))
}

/** 主题卡片：一个缩小的界面，用这套主题自己的颜色画。 */
function ThemeCard({ choice, selected, scheme, control, t, onDeleted }) {
  const card = PlainCard({ choice, selected, scheme, control })
  if (choice.mine === undefined) return card
  return h('div', { className: 'prism-card-wrap' }, card, h(DeleteMine, { id: choice.mine, name: choice.name, control, t, onDeleted }))
}

/** 删除「我的主题」：删了不能撤销，所以要点两次。 */
function DeleteMine({ id, name, control, t, onDeleted }) {
  const [armed, setArmed] = useState(false)
  return h(
    'button',
    {
      type: 'button',
      className: 'prism-card-del',
      'data-prism-delete-mine': id,
      'data-armed': armed ? '' : undefined,
      title: armed ? t('mine.confirm') : t('mine.delete', { name }),
      'aria-label': armed ? t('mine.confirm') : t('mine.delete', { name }),
      onClick: () => {
        if (!armed) return setArmed(true)
        const removed = control.deleteMine(id)
        if (removed !== undefined) onDeleted?.(removed)
      },
      onPointerLeave: () => setArmed(false),
      onBlur: () => setArmed(false),
    },
    armed ? t('mine.confirm') : h(Icon, { name: 'cross', size: 12 }),
  )
}

function PlainCard({ choice, selected, scheme, control }) {
  const colors = cardColors(choice.key, choice.seed, scheme, choice.overrides)
  const line = (width, color) => h('div', { className: 'prism-line', style: { width, background: color } })
  return h(
    'button',
    {
      type: 'button',
      className: 'prism-card',
      'aria-pressed': selected,
      'data-prism-theme': choice.id ?? 'none',
      onClick: () => control.pickTheme(choice.id),
    },
    h(
      'div',
      { className: 'prism-mini', style: { background: colors.canvas } },
      h(
        'div',
        { className: 'prism-mini-side', style: { background: colors.side } },
        h('div', { className: 'prism-line', style: { width: '100%', height: 7, borderRadius: 3, background: colors.active } }),
        line('78%', colors.faint),
        line('60%', colors.faint),
      ),
      h(
        'div',
        { className: 'prism-mini-main' },
        h('div', { className: 'prism-mini-bubble', style: { background: colors.bubble } }),
        line('86%', colors.text),
        line('62%', colors.muted),
        line('74%', colors.muted),
        h('div', { className: 'prism-mini-send', style: { background: colors.accent } }),
      ),
    ),
    h('div', { className: 'prism-card-name' }, h('span', null, choice.name), selected ? h(Icon, { name: 'check', size: 12 }) : null),
  )
}

/** 设置页顶上：现在用的是哪套、有没有改过，以及丢弃修改 / 存为我的主题 / 恢复默认。 */
function CurrentBar({ control, t, useStore, name, mineId }) {
  const theme = useStore((state) => state.theme)
  const wallpaper = useStore((state) => state.wallpaper)
  const glass = useStore((state) => state.glass)
  const modified = useModified(useStore)
  const pristine = theme === null && !modified && wallpaper === null && glass === null
  const [draft, setDraft] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [status, setStatus] = useState(null)
  const save = () => {
    const result = renaming ? control.renameMine(mineId, draft ?? '') : control.saveAsMine(draft ?? '')
    setStatus(result === true ? (renaming ? 'renamed' : 'saved') : `error.${result}`)
    if (result === true) setDraft(null)
  }
  const open = (rename) => {
    setStatus(null)
    setRenaming(rename)
    setDraft(rename || mineId !== undefined ? name : t('save.defaultName', { name }))
  }
  return h(
    'div',
    { className: 'prism-current', 'data-prism-current': modified ? 'modified' : 'clean' },
    h('div', null, h('small', null, t('current.label')), h('b', { 'data-prism-current-name': '' }, name), modified ? h('small', null, t('theme.modified')) : null),
    draft === null
      ? h(
          'div',
          { className: 'prism-row' },
          h('button', { type: 'button', className: 'prism-btn', 'data-prism-discard': '', disabled: !modified, title: t('discard.hint'), onClick: control.discardChanges }, t('action.discard')),
          h('button', { type: 'button', className: 'prism-btn', 'data-prism-save-open': '', onClick: () => open(false) }, t('action.saveMine')),
          mineId === undefined ? null : h('button', { type: 'button', className: 'prism-btn', 'data-prism-rename-open': '', onClick: () => open(true) }, t('action.rename')),
          h('button', { type: 'button', className: 'prism-btn', 'data-prism-restore': '', disabled: pristine, title: t('restore.hint'), onClick: control.restoreDefaults }, t('action.restore')),
        )
      : h(
          'div',
          { className: 'prism-row' },
          h('input', {
            className: 'prism-input prism-save-name',
            value: draft,
            maxLength: 60,
            autoFocus: true,
            'aria-label': t('save.name'),
            'data-prism-save-name': '',
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') save()
              else if (event.key === 'Escape') setDraft(null)
            },
          }),
          h('button', { type: 'button', className: 'prism-btn', 'data-prism-save': '', disabled: draft.trim() === '', onClick: save }, t('action.save')),
          h('button', { type: 'button', className: 'prism-btn', onClick: () => setDraft(null) }, t('action.cancel')),
        ),
    status === null ? null : h('div', { className: 'prism-desc', 'data-prism-save-status': status, ...(status.startsWith('error.') ? { 'data-bad': '' } : {}) }, t(`save.${status}`)),
  )
}

const ACCENTS = ['#4b78e6', '#7b5ce0', '#b84fc4', '#d6557f', '#d9502e', '#c88a2e', '#6d9a2c', '#1f9a78', '#0f93a8', '#5f6b7a']

/** 取色器：拖动中只预览；React 的 onChange 每次输入都触发，提交要听原生 change（关闭取色器时才有）。 */
function CustomAccent({ control, t, value }) {
  const ref = useRef(null)
  useEffect(() => {
    const input = ref.current
    const onChange = () => control.commitAdjust('accent', input.value)
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [control])
  return h(
    'label',
    { className: 'prism-color', title: t('accent.custom') },
    h('input', { ref, type: 'color', 'aria-label': t('accent.custom'), defaultValue: value, key: value, onInput: (event) => control.liveAdjust('accent', event.target.value) }),
  )
}

function AccentRow({ control, t, adjust, seed }) {
  const custom = adjust.accent
  return h(
    'div',
    { className: 'prism-swatches' },
    h('button', { type: 'button', className: 'prism-chip', 'aria-pressed': custom === undefined, 'data-prism-accent': 'follow', onClick: () => control.clearAdjust('accent') }, t('accent.follow')),
    ACCENTS.map((color) => h('button', { key: color, type: 'button', className: 'prism-swatch', 'aria-label': color, 'aria-pressed': custom === color, 'data-prism-accent': color, style: { background: color }, onClick: () => control.commitAdjust('accent', color) })),
    h(CustomAccent, { control, t, value: custom ?? seed.accent }),
  )
}

const HUE_TRACK = `linear-gradient(90deg,${[0, 45, 90, 135, 180, 225, 270, 315, 360].map((hue) => toHex(fromOklch(0.72, 0.13, hue))).join(',')})`

/** 圆角滑块：1 是宿主原样。 */
const RADIUS_SPEC = (control) => ({ field: 'radius', label: 'seed.radius', min: 0, max: 2, step: 0.05, format: (v) => `×${v.toFixed(2)}`, live: control.liveRadius, commit: control.commitRadius, clear: () => control.commitRadius(null) })

const FIELDS = [
  { field: 'hue', label: 'seed.hue', min: 0, max: 360, step: 1, track: HUE_TRACK, format: (v) => `${Math.round(v)}°` },
  { field: 'chroma', label: 'seed.chroma', min: 0, max: 1.5, step: 0.01, format: (v) => v.toFixed(2) },
  { field: 'neutral', label: 'seed.neutral', min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2) },
  { field: 'contrast', label: 'seed.contrast', min: -1, max: 1, step: 0.01, format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) },
  { field: 'depth', label: 'seed.depth', min: -1, max: 1, step: 0.01, format: (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) },
]

/**
 * 一行滑块。拖动中只预览，松手才提交；键盘连按时停下半秒再提交，合成一步撤销。
 * 正负两侧的滑块（对比度、明暗）从中间往两边填色。
 */
function SeedSlider({ spec, value, adjusted, control, t }) {
  const [draft, setDraft] = useState(undefined)
  const frame = useRef(0)
  const keyTimer = useRef(undefined)
  const latest = useRef(value)
  const dirty = useRef(false)
  const shown = draft ?? value
  const commit = () => {
    clearTimeout(keyTimer.current)
    keyTimer.current = undefined
    if (!dirty.current) return
    dirty.current = false
    cancelAnimationFrame(frame.current)
    ;(spec.commit ?? ((v) => control.commitAdjust(spec.field, v)))(latest.current)
    setDraft(undefined)
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  // 卸载时（比如关掉设置）把还没提交的改动提交掉，不留下只有预览的半截状态
  useEffect(() => () => commitRef.current(), [])
  const percent = ((shown - spec.min) / (spec.max - spec.min)) * 100
  const origin = spec.min < 0 ? 50 : 0
  const lo = Math.min(origin, percent)
  const hi = Math.max(origin, percent)
  const track = spec.track ?? `linear-gradient(90deg,var(--dsw-alias-border-l3) ${lo}%,var(--dsw-alias-state-business-primary) ${lo}%,var(--dsw-alias-state-business-primary) ${hi}%,var(--dsw-alias-border-l3) ${hi}%)`
  const onInput = (event) => {
    const next = Number(event.target.value)
    latest.current = next
    dirty.current = true
    setDraft(next)
    // 一帧最多重算一次，拖得再快也不卡
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => (spec.live ?? ((v) => control.liveAdjust(spec.field, v)))(latest.current))
  }
  const onKeyUp = () => {
    if (!dirty.current) return
    clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => commitRef.current(), 500)
  }
  return h(
    'label',
    { className: 'prism-slider' },
    h('span', null, t(spec.label)),
    h('input', {
      type: 'range',
      className: 'prism-range',
      'data-prism-seed': spec.field,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value: shown,
      style: { '--prism-track': track },
      onInput,
      onChange: () => {},
      onPointerUp: commit,
      onKeyUp,
      onBlur: commit,
    }),
    h('span', { className: 'prism-value' }, spec.format(shown)),
    adjusted
      ? h('button', { type: 'button', className: 'prism-clear', title: t('seed.resetField'), 'aria-label': t('seed.resetField'), onClick: (event) => {
          event.preventDefault()
          ;(spec.clear ?? (() => control.clearAdjust(spec.field)))()
        } }, h(Icon, { name: 'cross', size: 12 }))
      : h('span', null),
  )
}

/** 给高级、导入导出分块用的函数：它们只有界面，引擎和校验从这里拿，不重复打包。 */
const LIB = { tokenNames, RADIUS_TOKENS, generate, completeSeed, seedOf, effectiveCss, packToTheme, planDream }

/** 分块的加载函数由宿主能力给出；lazy 组件只建一次。 */
let customLoader
const LazyAdvanced = lazy(() => customLoader().then((module) => ({ default: module.AdvancedPanel })))
const LazyTransfer = lazy(() => customLoader().then((module) => ({ default: module.TransferPanel })))

/** 字体预设：只写字体名，宿主会加引号、把自带的字体栈接在后面兜底。 */
const TEXT_FONTS = [
  { id: 'default', value: '' },
  { id: 'serif', value: 'Source Han Serif SC, Noto Serif SC, Songti SC, STSong, serif' },
  { id: 'rounded', value: 'ui-rounded, SF Pro Rounded, HarmonyOS Sans SC' },
  { id: 'system', value: 'system-ui' },
]
const CODE_FONTS = ['', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'Menlo']
const SIZE_RANGE = { text: [10, 22, 14], code: [10, 16, 11] }
const sameFonts = (a, b) => (a ?? '').replace(/"/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase() === b.replace(/\s*,\s*/g, ',').trim().toLowerCase()

function SizeStepper({ role, value, host, t }) {
  const [lo, hi, fallback] = SIZE_RANGE[role]
  const current = value ?? fallback
  return h(
    'div',
    { className: 'prism-stepper', 'data-prism-font-size': role },
    h('span', null, t(`font.size.${role}`)),
    h('button', { type: 'button', className: 'prism-btn', disabled: current <= lo, 'aria-label': t('font.smaller'), onClick: () => host.setFont(role, 'size', current - 1) }, '−'),
    h('span', { className: 'prism-value', 'data-prism-font-size-value': '' }, `${current}px`),
    h('button', { type: 'button', className: 'prism-btn', disabled: current >= hi, 'aria-label': t('font.larger'), onClick: () => host.setFont(role, 'size', current + 1) }, '+'),
  )
}

/** 字体：直接读写宿主「通用」里的字体设置，和那边是同一份。 */
function FontGroup({ host, t, useStore }) {
  const fonts = useStore((state) => state.fonts)
  if (fonts === null || fonts.families === null) return null
  const set = (role, value) => host.setFont(role, 'family', value)
  return h(
    'div',
    { className: 'prism-group', 'data-prism-fonts': '' },
    h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.font'))),
    h('div', { className: 'prism-desc' }, t('font.desc')),
    h(
      'div',
      { className: 'prism-swatches' },
      h('span', { className: 'prism-label' }, t('font.text')),
      TEXT_FONTS.map((item) => h('button', { key: item.id, type: 'button', className: 'prism-chip', 'aria-pressed': sameFonts(fonts.families.text, item.value), 'data-prism-font-text': item.id, style: item.value === '' ? undefined : { fontFamily: item.value }, onClick: () => set('text', item.value) }, t(`font.text.${item.id}`))),
    ),
    h(
      'div',
      { className: 'prism-swatches' },
      h('span', { className: 'prism-label' }, t('font.code')),
      CODE_FONTS.map((name) => h('button', { key: name || 'default', type: 'button', className: 'prism-chip', 'aria-pressed': sameFonts(fonts.families.code, name), 'data-prism-font-code': name || 'default', style: name === '' ? undefined : { fontFamily: `"${name}", monospace` }, onClick: () => set('code', name) }, name === '' ? t('font.text.default') : name)),
    ),
    fonts.sizes === null ? null : h('div', { className: 'prism-wall-row' }, h(SizeStepper, { role: 'text', value: fonts.sizes.text, host, t }), h(SizeStepper, { role: 'code', value: fonts.sizes.code, host, t })),
  )
}

/** 代码配色：可以独立于主题选一套经典方案，对比度照样自动达标。 */
function CodeGroup({ control, t, adjust }) {
  const current = adjust.code ?? null
  const chip = (id, label) => h('button', { key: id ?? 'follow', type: 'button', className: 'prism-chip', 'aria-pressed': current === id, 'data-prism-code': id ?? 'follow', onClick: () => control.setCode(id) }, label)
  const tok = (name, text) => h('span', { style: { color: `var(--shiki-token-${name})` } }, text)
  return h(
    'div',
    { className: 'prism-group', 'data-prism-code-group': '' },
    h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.code'))),
    h('div', { className: 'prism-swatches' }, chip(null, t('code.follow')), CODE_SCHEMES.map((scheme) => chip(scheme.id, scheme.name))),
    h(
      'pre',
      { className: 'prism-code-sample', 'aria-hidden': true },
      tok('comment', t('code.sampleComment')),
      '\n',
      tok('keyword', 'export function '),
      tok('function', 'greet'),
      tok('punctuation', '('),
      tok('parameter', 'name'),
      tok('punctuation', ') {'),
      '\n  ',
      tok('keyword', 'return '),
      tok('string', '`Hello, '),
      tok('string-expression', '${name}'),
      tok('string', '`'),
      tok('punctuation', ' + '),
      tok('constant', '42'),
      '\n',
      tok('punctuation', '}'),
    ),
    h('div', { className: 'prism-desc' }, t('code.desc')),
  )
}

/** 可以收起的一组，点开才加载分块。 */
function LazyGroup({ title, desc, open, onToggle, reset, children, id, t }) {
  return h(
    'div',
    { className: 'prism-group', [`data-prism-${id}-group`]: '' },
    h(
      'div',
      { className: 'prism-head' },
      h('div', { className: 'prism-title' }, title),
      reset,
      h('button', { type: 'button', className: 'prism-btn', 'aria-expanded': open, [`data-prism-open-${id}`]: '', onClick: onToggle }, t(open ? 'action.collapse' : 'action.expand')),
    ),
    h('div', { className: 'prism-desc' }, desc),
    open ? h(Suspense, { fallback: h('div', { className: 'prism-desc' }, t('state.loading')) }, children) : null,
  )
}

/**
 * 设置页。
 * @param {any} props slot 传来的 props（host、useStore）
 * @returns {import('react').ReactElement} 设置页
 */
export function Section(props) {
  const { host, useStore } = props
  const { control, t } = useStudio(host)
  const theme = useStore((state) => state.theme)
  const custom = useStore((state) => state.custom)
  const adjust = useStore((state) => state.adjust)
  const scheme = useStore((state) => state.scheme)
  const overrideCount = useStore((state) => state.overrideCount)
  const radius = useStore((state) => state.radius)
  const css = useStore((state) => state.css)
  const incoming = useStore((state) => state.incoming)
  const library = useStore((state) => state.library)
  const choices = useChoices(theme, custom, library, t, host)
  const [openAdvanced, setOpenAdvanced] = useState(false)
  const [openTransfer, setOpenTransfer] = useState(false)
  customLoader = host.loadCustom
  // 链接里带来分享码时直接展开导入导出
  useEffect(() => {
    if (incoming !== null) setOpenTransfer(true)
  }, [incoming])
  const themeName = currentName(choices, theme, t)
  const mineId = choices.find((choice) => choice.id === theme && choice.mine !== undefined)?.mine
  const [deleted, setDeleted] = useState(null)
  useEffect(() => {
    if (deleted === null) return undefined
    const timer = setTimeout(() => setDeleted(null), 8000)
    return () => clearTimeout(timer)
  }, [deleted])
  const panelProps = { host, control, useStore, lib: LIB, themeName, themeKey: theme ?? 'host' }
  const seed = completeSeed(control.currentSeed())
  const report = control.auditSummary()

  // 离开设置页时不留下任何预览
  useEffect(() => control.clearPreview, [control])

  return h(
    'div',
    { className: 'prism-section', 'data-prism-section': '' },
    h(Notes, { t, useStore }),
    h(CurrentBar, { control, t, useStore, name: themeName, mineId }),
    h(
      'div',
      { className: 'prism-group' },
      h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.theme')), h(ActionButtons, { control, t, useStore })),
      h(
        'div',
        { className: 'prism-gallery' },
        choices.map((choice) => h(ThemeCard, { key: choice.key, choice, selected: theme === choice.id, scheme, control, t, onDeleted: setDeleted })),
      ),
      deleted === null
        ? null
        : h(
            'div',
            { className: 'prism-row prism-deleted', role: 'status', 'data-prism-deleted': deleted.pack.id },
            h('span', null, t('mine.deleted', { name: deleted.pack.name })),
            h('button', { type: 'button', className: 'prism-btn', 'data-prism-undo-delete': '', onClick: () => { control.restoreMine(deleted); setDeleted(null) } }, t('action.undo')),
          ),
    ),
    h(
      'div',
      { className: 'prism-group' },
      h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.accent'))),
      h(AccentRow, { control, t, adjust, seed }),
    ),
    h(BackgroundGroup, { host, control, t, useStore, locale: localeOf(host) }),
    h(FontGroup, { host, t, useStore }),
    h(CodeGroup, { control, t, adjust }),
    h(
      'div',
      { className: 'prism-group' },
      h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.adjust'))),
      h('div', { className: 'prism-desc' }, t('adjust.desc')),
      h(
        'div',
        { className: 'prism-sliders' },
        FIELDS.map((spec) => h(SeedSlider, { key: spec.field, spec, value: seed[spec.field], adjusted: adjust[spec.field] !== undefined, control, t })),
        h(SeedSlider, { key: 'radius', spec: RADIUS_SPEC(control), value: radius ?? 1, adjusted: radius !== null, control, t }),
      ),
      h('div', { className: 'prism-desc' }, t('radius.desc')),
    ),
    h(
      LazyGroup,
      {
        id: 'advanced',
        t,
        title: t('title.overrides'),
        desc: overrideCount > 0 || css !== '' ? t('overrides.desc', { count: overrideCount, css: css === '' ? t('overrides.noCss') : t('overrides.hasCss') }) : t('overrides.empty'),
        open: openAdvanced,
        onToggle: () => setOpenAdvanced((value) => !value),
        reset: null,
      },
      h(LazyAdvanced, panelProps),
    ),
    h(LazyGroup, { id: 'transfer', t, title: t('title.transfer'), desc: t('transfer.desc'), open: openTransfer, onToggle: () => setOpenTransfer((value) => !value), reset: null }, h(LazyTransfer, panelProps)),
    report !== null
      ? h(
          'div',
          { className: 'prism-group' },
          h(
            'div',
            { className: 'prism-audit', 'data-prism-audit': '', ...(report.failed > 0 ? { 'data-bad': '' } : null) },
            h(Icon, { name: report.failed > 0 ? 'warn' : 'check' }),
            t(report.failed > 0 ? 'audit.bad' : 'audit.ok', { pairs: report.pairs, failed: report.failed }),
          ),
        )
      : null,
  )
}

/** 面板宽度，和样式表里的 `.prism-panel{width}` 一致。 */
const PANEL_WIDTH = 292

/**
 * 侧栏面板。
 * @param {any} props slot props，外加 anchor 和 onClose
 * @returns {import('react').ReactElement} 面板
 */
export function QuickPanel(props) {
  const { host, useStore, anchor, onClose } = props
  const { control, t } = useStudio(host)
  const theme = useStore((state) => state.theme)
  const custom = useStore((state) => state.custom)
  const scheme = useStore((state) => state.scheme)
  const library = useStore((state) => state.library)
  const adjust = useStore((state) => state.adjust)
  const modified = useModified(useStore)
  const choices = useChoices(theme, custom, library, t, host)
  const [hovered, setHovered] = useState(undefined)
  // 带 Material 动态取色的主题：整套配色从强调色算出来，面板里直接给一排强调色
  const dynamic = library.some((pack) => PACK_PREFIX + pack.id === theme && pack.material !== undefined)
  const [place, setPlace] = useState(undefined)

  // 面板挂在 body 上（见下面的 createPortal），位置按按钮实时算：
  // 窄窗口下宿主侧栏是带 transform 的抽屉（z-index 71），面板留在侧栏里会被会话列表盖住。
  useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const node = anchor.current
      const rect = node?.getBoundingClientRect()
      if (rect === undefined) return
      // 侧栏收起（按钮不在屏幕上或看不见）就关掉，免得面板悬在空处
      if (!node.isConnected || rect.width === 0 || rect.right <= 0 || getComputedStyle(node).visibility === 'hidden') {
        onClose?.()
        return
      }
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8))
      const next = { left, bottom: window.innerHeight - rect.top + 8 }
      setPlace((prev) => (prev !== undefined && prev.left === next.left && prev.bottom === next.bottom ? prev : next))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('transitionend', schedule, true)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    if (observer !== null && anchor.current) {
      observer.observe(anchor.current)
      observer.observe(document.body)
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('transitionend', schedule, true)
      observer?.disconnect()
    }
  }, [anchor, onClose])

  useEffect(() => control.clearPreview, [control])

  const label = hovered ?? (modified ? `${currentName(choices, theme, t)} · ${t('theme.modified')}` : currentName(choices, theme, t))
  const panel = h(
    'section',
    { className: 'prism-panel', 'data-prism-panel': '', style: place ?? { visibility: 'hidden' } },
    h('div', { className: 'prism-panel-actions' }, h(ActionButtons, { control, t, useStore })),
    h(
      'div',
      { className: 'prism-dots' },
      choices.map((choice) => {
        const colors = cardColors(choice.key, choice.seed, scheme, choice.overrides)
        return h('button', {
          key: choice.key,
          type: 'button',
          className: 'prism-dot',
          title: choice.name,
          'aria-label': choice.name,
          'aria-pressed': theme === choice.id,
          'data-prism-dot': choice.id ?? 'none',
          style: { background: `linear-gradient(135deg,${colors.canvas} 0 50%,${colors.accent} 50% 100%)` },
          onClick: () => control.pickTheme(choice.id),
          // 悬停只显示名字，不预览：预览会换掉整套界面（字体、图标、尺寸），鼠标下面的东西跟着动，来回闪
          onPointerEnter: () => setHovered(choice.name),
          onPointerLeave: () => setHovered(undefined),
        })
      }),
    ),
    h('div', { className: 'prism-panel-name', 'data-prism-panel-name': '' }, label),
    dynamic ? h('div', { 'data-prism-panel-accent': '' }, h(AccentRow, { control, t, adjust, seed: completeSeed(control.currentSeed()) })) : null,
    h(Notes, { t, useStore }),
    h('div', { className: 'prism-panel-foot' }, t('quick.more')),
  )
  return createPortal(panel, document.body)
}

