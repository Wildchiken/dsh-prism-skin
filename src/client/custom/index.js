/**
 * 懒加载分块：高级（变量搜索编辑、自定义 CSS）和导入导出（主题文件、分享码、dream-skin 迁移、
 * 导出成 skin-center 皮肤）。设置页里点开这两组时才加载。
 *
 * 只有界面在这里；引擎、换算、校验都由设置页分块通过 `lib` 传进来，不在这里再打包一份。
 */
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { createShare, FILE_MAX_BYTES } from '../../shared/share.js'
import { skinCenterFiles, skinId, zip } from '../../shared/skin.js'
import { CUSTOM_DICT, CUSTOM_NS } from './dict.js'

/** 合起来的工具：设置页传进来的引擎函数、入口交出的存档函数、本分块自己的。 */
const useLib = (props) => useMemo(() => ({ ...props.lib, ...props.host.shared, ...createShare(props.host.shared), FILE_MAX_BYTES, skinCenterFiles, skinId, zip }), [props.lib, props.host])

const STYLE_ID = 'data-prism-custom'
const CSS = `
.prism-search{display:flex;gap:8px;align-items:center}
.prism-vars{display:flex;flex-direction:column;max-height:360px;overflow:auto;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm)}
.prism-var{display:grid;grid-template-columns:16px minmax(0,1.4fr) minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-height:32px;padding:4px 10px;border:0;border-bottom:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.prism-var:hover,.prism-var[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.prism-var-name,.prism-var-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code)}
.prism-var-value{color:var(--dsw-alias-label-secondary)}
.prism-var-dot{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l4)}
.prism-badge{padding:0 6px;border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;white-space:nowrap}
.prism-badge[data-source=override]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.prism-var-edit{display:flex;flex-direction:column;gap:8px;padding:10px;border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.prism-var-edit label{display:grid;grid-template-columns:44px 1fr;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.prism-code-input{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px}
.prism-css,.prism-import{flex:none;resize:vertical}
.prism-css{min-height:140px}
.prism-import{min-height:64px}
.prism-search .prism-input{flex:1 1 auto}
.prism-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.prism-row .prism-btn{border:.5px solid var(--dsw-alias-border-l4)}
.prism-status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.prism-status[data-bad]{color:var(--dsw-alias-state-error-primary)}
.prism-sub{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.prism-card-box{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.prism-preview{display:flex;align-items:center;gap:10px}
.prism-preview-swatch{flex:none;width:44px;height:28px;border-radius:var(--dsw-radius-sm);box-shadow:inset 0 0 0 .5px #0000002e}
.prism-list{margin:0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`

if (typeof document !== 'undefined' && document.querySelector(`style[${STYLE_ID}]`) === null) {
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ID, '')
  tag.textContent = CSS
  document.head.append(tag)
}

/** @type {WeakMap<object, (key: string, params?: object) => string>} */
const translators = new WeakMap()
function useT(host) {
  let t = translators.get(host)
  if (t === undefined) {
    host.registerLocale(CUSTOM_NS, CUSTOM_DICT)
    t = host.locale.bind(CUSTOM_NS)
    translators.set(host, t)
  }
  return t
}

/** 下载一个文件。 */
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** 页面上声明过的全部变量名（宿主的样式表、插件的样式标签），再并上引擎认识的。只在打开时扫一次。 */
function collectNames(lib) {
  const names = new Set([...lib.tokenNames(), ...Object.keys(lib.RADIUS_TOKENS)])
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules !== undefined && rule.style === undefined) visit(rule.cssRules)
      const style = rule.style
      if (style === undefined) continue
      for (let i = 0; i < style.length; i += 1) {
        const name = style[i]
        if (/^--(?:dsw|ds|dsh|shiki)-/.test(name)) names.add(name)
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules)
    } catch {
      // 跨源样式表读不了，跳过
    }
  }
  const inline = document.body.style
  for (let i = 0; i < inline.length; i += 1) if (/^--(?:dsw|ds|dsh|shiki)-/.test(inline[i])) names.add(inline[i])
  return [...names].sort()
}

const LIST_LIMIT = 40
const looksColor = (value) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\(|color-mix\()/i.test(value.trim())

/** 一个变量的编辑框。 */
function VarEditor({ name, initial, overridden, control, lib, t }) {
  const [light, setLight] = useState(initial.light)
  const [dark, setDark] = useState(initial.dark)
  const [error, setError] = useState(false)
  const save = () => {
    const clean = lib.normalizeOverrides({ [name]: { light: light.trim(), dark: dark.trim() } })
    if (clean[name] === undefined) {
      setError(true)
      return
    }
    setError(false)
    control.setOverride(name, clean[name])
  }
  return h(
    'div',
    { className: 'prism-var-edit', 'data-prism-var-edit': name },
    h('label', null, t('var.light'), h('input', { className: 'prism-input prism-code-input', value: light, 'data-prism-var-light': '', onChange: (event) => setLight(event.target.value), spellCheck: false })),
    h('label', null, t('var.dark'), h('input', { className: 'prism-input prism-code-input', value: dark, 'data-prism-var-dark': '', onChange: (event) => setDark(event.target.value), spellCheck: false })),
    h(
      'div',
      { className: 'prism-row' },
      h('button', { type: 'button', className: 'prism-btn', 'data-prism-var-save': '', onClick: save }, t('var.save')),
      overridden ? h('button', { type: 'button', className: 'prism-btn', 'data-prism-var-reset': '', onClick: () => control.setOverride(name, null) }, t('var.reset')) : null,
      error ? h('span', { className: 'prism-status', 'data-bad': '' }, t('var.bad')) : null,
    ),
  )
}

/** 按名字搜宿主的变量，看当前值和来源，单个改、单个重置。 */
function VariableSearch({ host, control, lib, t, useStore }) {
  const overrides = useStore((state) => state.overrides)
  const radius = useStore((state) => state.radius)
  const scheme = useStore((state) => state.scheme)
  const names = useMemo(() => collectNames(lib), [lib])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const needle = query.trim().toLowerCase()
  const matches = names.filter((name) => needle === '' || name.toLowerCase().includes(needle))
  const layer = host.core.layer().tokens ?? {}
  const sourceOf = (name) => {
    if (overrides[name] !== undefined) return 'override'
    if (radius !== null && lib.RADIUS_TOKENS[name] !== undefined) return 'adjust'
    if (layer[name] !== undefined) return 'theme'
    return 'host'
  }
  const computed = getComputedStyle(document.body)
  return h(
    'div',
    { className: 'prism-sliders' },
    h(
      'div',
      { className: 'prism-search' },
      h('input', { className: 'prism-input', type: 'search', placeholder: t('var.search'), 'aria-label': t('var.search'), value: query, 'data-prism-var-search': '', onChange: (event) => setQuery(event.target.value), spellCheck: false }),
    ),
    h('div', { className: 'prism-status' }, t(matches.length > LIST_LIMIT ? 'var.countMore' : 'var.count', { count: matches.length, limit: LIST_LIMIT })),
    h(
      'div',
      { className: 'prism-vars', role: 'list' },
      matches.slice(0, LIST_LIMIT).map((name) => {
        const value = computed.getPropertyValue(name).trim()
        const source = sourceOf(name)
        const expanded = open === name
        const initial = overrides[name] ?? layer[name] ?? { light: value, dark: value }
        return [
          h(
            'button',
            { key: name, type: 'button', className: 'prism-var', role: 'listitem', 'aria-expanded': expanded, 'data-prism-var': name, onClick: () => setOpen(expanded ? null : name) },
            h('span', { className: 'prism-var-dot', style: looksColor(value) ? { background: value } : { background: 'transparent', boxShadow: 'none' } }),
            h('span', { className: 'prism-var-name', title: name }, name),
            h('span', { className: 'prism-var-value', title: value, 'data-prism-var-value': '' }, value === '' ? '—' : value),
            h('span', { className: 'prism-badge', 'data-source': source, 'data-prism-var-source': source }, t(`source.${source}`)),
          ),
          expanded ? h(VarEditor, { key: `${name}:edit:${scheme}:${JSON.stringify(initial)}`, name, initial, overridden: source === 'override', control, lib, t }) : null,
        ]
      }),
    ),
  )
}

/** 自定义 CSS：有大小上限，禁止 @import 和外链 url()。 */
function CssEditor({ control, lib, t, useStore }) {
  const saved = useStore((state) => state.css)
  const [draft, setDraft] = useState(saved)
  const [status, setStatus] = useState(null)
  useEffect(() => setDraft(saved), [saved])
  const save = () => {
    const result = control.setCss(draft)
    setStatus(result.ok ? 'saved' : result.code)
  }
  return h(
    'div',
    { className: 'prism-sliders' },
    h('div', { className: 'prism-sub' }, t('css.title')),
    h('div', { className: 'prism-desc' }, t('css.desc', { max: lib.CSS_MAX_LENGTH })),
    h('textarea', { className: 'prism-input prism-code-input prism-css', value: draft, maxLength: lib.CSS_MAX_LENGTH, spellCheck: false, 'aria-label': t('css.title'), 'data-prism-css-input': '', onChange: (event) => {
      setDraft(event.target.value)
      setStatus(null)
    } }),
    h(
      'div',
      { className: 'prism-row' },
      h('button', { type: 'button', className: 'prism-btn', disabled: draft === saved, 'data-prism-css-save': '', onClick: save }, t('css.save')),
      h('span', { className: 'prism-status', 'data-prism-css-status': status ?? '', ...(status !== null && status !== 'saved' ? { 'data-bad': '' } : {}) }, status === null ? `${draft.length} / ${lib.CSS_MAX_LENGTH}` : t(`css.${status}`)),
    ),
  )
}

/**
 * 高级：变量搜索编辑 + 自定义 CSS。
 * @param {any} props 设置页传来的 host、control、lib、useStore
 * @returns {import('react').ReactElement} 界面
 */
export function AdvancedPanel(props) {
  const t = useT(props.host)
  const lib = useLib(props)
  return h('div', { className: 'prism-sliders', 'data-prism-advanced': '' }, h(VariableSearch, { ...props, lib, t }), h(CssEditor, { ...props, lib, t }))
}

/** 导入前给用户看的摘要。 */
function ImportPreview({ parsed, lib, t, onApply, onCancel, scheme }) {
  const tokens = useMemo(() => lib.generate(parsed.file.seed), [lib, parsed])
  const mode = parsed.file.scheme ?? scheme
  const parts = []
  if (parsed.file.radius !== undefined) parts.push(t('import.has.radius'))
  if (parsed.file.overrides !== undefined && Object.keys(parsed.file.overrides).length > 0) parts.push(t('import.has.overrides', { count: Object.keys(parsed.file.overrides).length }))
  if (parsed.file.css !== undefined && parsed.file.css !== '') parts.push(t('import.has.css'))
  if (parsed.file.font !== undefined) parts.push(t('import.has.font'))
  if (parsed.file.scheme !== undefined) parts.push(t(`import.has.${parsed.file.scheme}`))
  return h(
    'div',
    { className: 'prism-card-box', 'data-prism-import-preview': parsed.kind },
    h(
      'div',
      { className: 'prism-preview' },
      h('span', { className: 'prism-preview-swatch', style: { background: `linear-gradient(135deg,${tokens['--dsw-alias-bg-base'][mode]} 0 55%,${tokens['--dsw-alias-button-primary-fill'][mode]} 55% 100%)` } }),
      h('div', { className: 'prism-sub' }, t(`import.kind.${parsed.kind}`, { name: parsed.file.name ?? '' })),
    ),
    parts.length > 0 ? h('div', { className: 'prism-desc' }, parts.join(' · ')) : null,
    parsed.kind === 'pack' ? h('div', { className: 'prism-desc' }, t('import.packNote')) : null,
    h('div', { className: 'prism-row' }, h('button', { type: 'button', className: 'prism-btn', 'data-prism-import-apply': '', onClick: onApply }, t('import.apply')), h('button', { type: 'button', className: 'prism-btn', onClick: onCancel }, t('import.cancel'))),
  )
}

/**
 * 解析导入的文本：主题文件、dream-skin 主题包、分享码或带分享码的链接。
 * @returns {{ok: true, kind: 'file' | 'pack' | 'code', file: object} | {ok: false, code: string}} 结果
 */
function parseImport(text, lib) {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, code: 'empty' }
  if (new TextEncoder().encode(trimmed).length > lib.FILE_MAX_BYTES) return { ok: false, code: 'too-large' }
  if (trimmed.startsWith('{')) {
    let data
    try {
      data = JSON.parse(trimmed)
    } catch {
      return { ok: false, code: 'bad-json' }
    }
    if (data?.format !== undefined) {
      const pack = lib.packToTheme(data)
      return pack.ok ? { ok: true, kind: 'pack', file: { name: pack.nameZh ?? pack.name, seed: pack.seed, scheme: pack.scheme } } : { ok: false, code: pack.code }
    }
    const result = lib.parseThemeFile(data)
    return result.ok ? { ok: true, kind: 'file', file: result.file } : { ok: false, code: result.code }
  }
  const shared = lib.decodeShare(trimmed)
  return shared.ok ? { ok: true, kind: 'code', file: { seed: shared.seed, ...(shared.radius === undefined ? {} : { radius: shared.radius }) } } : { ok: false, code: 'unknown' }
}

const DREAM_PREFIX = 'dsh-dream-skin:'

/** 读 dream-skin 的设置：host 上的文件为准，同源的 localStorage 补缺。只读。 */
async function readDream() {
  const response = await fetch('/prism-skin/api/dream-skin').then((r) => r.json()).catch(() => null)
  const keys = { ...(response?.keys ?? {}) }
  let localImage
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(DREAM_PREFIX)) continue
      const name = key.slice(DREAM_PREFIX.length)
      const value = localStorage.getItem(key)
      if (value === null) continue
      if (name === 'wallpaper') {
        if (value.startsWith('data:image/')) localImage = value
      } else if (keys[name] === undefined) keys[name] = value
    }
  } catch {
    // 读不了 localStorage 就只用文件
  }
  return { keys, fileImage: response?.image !== undefined, localImage, tooLarge: response?.tooLarge === true }
}

const postJson = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json())

/** 按计划把图片存进棱镜，返回壁纸设置。 */
async function fetchWallpaper(plan, localImage) {
  const step = plan.fetch
  if (step === null) return plan.wallpaper
  if (step.kind === 'dream-image') {
    const saved = await postJson('/prism-skin/api/dream-skin/wallpaper')
    return saved?.ok ? { kind: 'image', id: saved.id } : null
  }
  if (step.kind === 'local-image') {
    const blob = await fetch(localImage).then((r) => r.blob())
    const saved = await fetch('/prism-skin/api/wallpaper/upload', { method: 'POST', body: blob }).then((r) => r.json())
    return saved?.ok ? { kind: 'image', id: saved.id } : null
  }
  if (step.kind === 'url') {
    const saved = await postJson('/prism-skin/api/wallpaper/fetch', { url: step.url })
    return saved?.ok ? { kind: 'image', id: saved.id, src: step.url } : null
  }
  const items = []
  for (const url of step.urls) {
    const saved = await postJson('/prism-skin/api/wallpaper/fetch', { url }).catch(() => null)
    if (saved?.ok) items.push({ id: saved.id, src: url })
  }
  return items.length === 0 ? null : { kind: 'rotate', items, interval: step.interval, shuffle: step.shuffle, epoch: Date.now() }
}

/** dream-skin 迁移。 */
function DreamMigration({ control, lib, t }) {
  const [state, setState] = useState({ phase: 'idle' })
  const scan = async () => {
    setState({ phase: 'reading' })
    const dream = await readDream()
    const plan = lib.planDream(dream.keys, { fileImage: dream.fileImage, localImage: dream.localImage !== undefined })
    const empty = plan.theme === null && plan.wallpaper === null && plan.fetch === null
    setState({ phase: empty ? 'none' : 'ready', plan, localImage: dream.localImage, tooLarge: dream.tooLarge })
  }
  const run = async () => {
    const { plan, localImage } = state
    setState({ ...state, phase: 'running' })
    let wallpaper = null
    try {
      wallpaper = await fetchWallpaper(plan, localImage)
    } catch {
      wallpaper = null
    }
    const wallFailed = plan.fetch !== null && wallpaper === null
    let ok = true
    if (plan.theme !== null) ok = control.importTheme({ seed: plan.theme.seed, scheme: plan.theme.scheme }, wallpaper === null ? {} : { wallpaper })
    else if (wallpaper !== null) control.setWallpaper(wallpaper)
    setState({ phase: ok ? 'done' : 'failed', plan, wallFailed })
  }
  const plan = state.plan
  const lines = []
  if (plan !== undefined) {
    if (plan.theme !== null) lines.push(t('dream.theme', { name: plan.theme.name }))
    const wallKind = plan.fetch?.kind ?? plan.wallpaper?.kind
    if (wallKind !== undefined) lines.push(t(`dream.wall.${wallKind}`))
    for (const item of plan.skipped) lines.push(t(`dream.skip.${item}`))
  }
  return h(
    'div',
    { className: 'prism-card-box', 'data-prism-dream': state.phase },
    h('div', { className: 'prism-sub' }, t('dream.title')),
    h('div', { className: 'prism-desc' }, t('dream.desc')),
    lines.length > 0 ? h('ul', { className: 'prism-list' }, lines.map((line) => h('li', { key: line }, line))) : null,
    state.phase === 'none' ? h('div', { className: 'prism-status' }, t(state.tooLarge ? 'dream.tooLarge' : 'dream.none')) : null,
    state.phase === 'done' ? h('div', { className: 'prism-status', 'data-prism-dream-done': '' }, t(state.wallFailed ? 'dream.doneNoWall' : 'dream.done')) : null,
    state.phase === 'failed' ? h('div', { className: 'prism-status', 'data-bad': '' }, t('dream.failed')) : null,
    h(
      'div',
      { className: 'prism-row' },
      state.phase === 'ready'
        ? h('button', { type: 'button', className: 'prism-btn', 'data-prism-dream-run': '', onClick: () => void run() }, t('dream.run'))
        : h('button', { type: 'button', className: 'prism-btn', disabled: state.phase === 'reading' || state.phase === 'running', 'data-prism-dream-scan': '', onClick: () => void scan() }, t(state.phase === 'reading' || state.phase === 'running' ? 'dream.working' : 'dream.scan')),
      state.phase === 'done' ? h('button', { type: 'button', className: 'prism-btn', onClick: control.undo }, t('import.undo')) : null,
    ),
  )
}

/**
 * 导入导出：主题文件、分享码、dream-skin 迁移、导出成 skin-center 皮肤。
 * @param {any} props 设置页传来的 host、control、lib、useStore、themeName
 * @returns {import('react').ReactElement} 界面
 */
export function TransferPanel(props) {
  const { host, control, useStore, themeName, themeKey } = props
  const t = useT(host)
  const lib = useLib(props)
  const incoming = useStore((state) => state.incoming)
  const scheme = useStore((state) => state.scheme)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState(null)
  const [status, setStatus] = useState(null)
  const [share, setShare] = useState(null)
  const fileRef = useRef(null)

  // 链接里带来的分享码：直接给出预览，等用户确认
  useEffect(() => {
    if (incoming === null) return
    const result = parseImport(incoming, lib)
    if (result.ok) setParsed(result)
    host.dismissIncoming()
  }, [incoming, lib, host])

  const check = (value) => {
    const result = parseImport(value, lib)
    if (result.ok) {
      setParsed(result)
      setStatus(null)
    } else {
      setParsed(null)
      setStatus(`error.${result.code}`)
    }
  }
  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    if (file.size > lib.FILE_MAX_BYTES) {
      setStatus('error.too-large')
      return
    }
    const content = await file.text()
    setText(content)
    check(content)
  }
  const apply = () => {
    const ok = control.importTheme(parsed.file)
    setParsed(null)
    setText('')
    setStatus(ok ? 'imported' : 'error.apply')
  }
  const exportFile = () => {
    const file = control.exportTheme()
    download(`${lib.skinId(themeKey).replace(/^prism-/, 'prism-theme-')}.json`, lib.serializeTheme({ name: themeName, ...file }), 'application/json')
    setStatus('started')
  }
  const makeShare = () => {
    const file = control.exportTheme()
    const code = lib.encodeShare(file.seed, file.radius ?? null)
    setShare({ code, link: `${location.origin}${location.pathname}#${code}` })
  }
  const exportSkin = () => {
    const values = host.core.values()
    const layer = host.core.layer()
    const tokens = lib.effectiveTokens(layer, true) ?? {}
    const id = lib.skinId(themeKey)
    const files = lib.skinCenterFiles({ id, name: `棱镜 · ${themeName}`, nameEn: `Prism · ${themeName}`, accent: lib.completeSeed(lib.seedOf(values)).accent, version: '1.0.0', tokens, css: values.css })
    download(`${id}.zip`, lib.zip([{ name: `${id}/skin.json`, text: files.json }, { name: `${id}/skin.css`, text: files.css }]), 'application/zip')
    setStatus('started')
  }
  const copy = (value) => {
    navigator.clipboard?.writeText(value).then(() => setStatus('copied'), () => setStatus(null))
  }

  return h(
    'div',
    { className: 'prism-sliders', 'data-prism-transfer': '' },
    h('div', { className: 'prism-sub' }, t('export.title')),
    h(
      'div',
      { className: 'prism-row' },
      h('button', { type: 'button', className: 'prism-btn', 'data-prism-export-file': '', onClick: exportFile }, t('export.file')),
      h('button', { type: 'button', className: 'prism-btn', 'data-prism-export-share': '', onClick: makeShare }, t('export.share')),
      h('button', { type: 'button', className: 'prism-btn', 'data-prism-export-skin': '', onClick: exportSkin }, t('export.skin')),
    ),
    share !== null
      ? h(
          'div',
          { className: 'prism-row' },
          h('input', { className: 'prism-input prism-code-input', readOnly: true, value: share.link, 'aria-label': t('export.share'), 'data-prism-share-link': share.code, onFocus: (event) => event.target.select() }),
          h('button', { type: 'button', className: 'prism-btn', onClick: () => copy(share.link) }, t('export.copy')),
        )
      : null,
    h('div', { className: 'prism-desc' }, t('export.skinNote')),
    h('div', { className: 'prism-sub' }, t('import.title')),
    h('textarea', { className: 'prism-input prism-code-input prism-import', rows: 3, value: text, placeholder: t('import.placeholder'), 'aria-label': t('import.title'), 'data-prism-import-input': '', spellCheck: false, onChange: (event) => {
      setText(event.target.value)
      setStatus(null)
    } }),
    h(
      'div',
      { className: 'prism-row' },
      h('button', { type: 'button', className: 'prism-btn', disabled: text.trim() === '', 'data-prism-import-check': '', onClick: () => check(text) }, t('import.check')),
      h('button', { type: 'button', className: 'prism-btn', onClick: () => fileRef.current?.click() }, t('import.file')),
      h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', hidden: true, 'data-prism-import-file': '', onChange: (event) => void onFile(event) }),
      status !== null ? h('span', { className: 'prism-status', 'data-prism-import-status': status, ...(status.startsWith('error.') ? { 'data-bad': '' } : {}) }, t(status)) : null,
      status === 'imported' ? h('button', { type: 'button', className: 'prism-btn', 'data-prism-import-undo': '', onClick: () => {
        control.undo()
        setStatus(null)
      } }, t('import.undo')) : null,
    ),
    parsed !== null ? h(ImportPreview, { parsed, lib, t, scheme, onApply: apply, onCancel: () => setParsed(null) }) : null,
    h(DreamMigration, { control, lib, t }),
  )
}
