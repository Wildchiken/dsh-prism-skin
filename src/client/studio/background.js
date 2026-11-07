/**
 * 设置页的「背景与玻璃」一组：选壁纸、一根玻璃感滑杆、从壁纸取色。
 * 图片的上传和分析在 `client.wall.js` 分块里，用到才加载。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { DEFAULT_GLASS, GRADIENTS, SOLIDS, stopsDerived } from '../../engine/index.js'

const KINDS = ['none', 'image', 'gradient', 'color', 'rotate', 'folder']
const INTERVALS = [60, 300, 900, 1800, 3600, 10800, 86400]

const kindOf = (wallpaper) => wallpaper?.kind ?? 'none'

/** 拖动玻璃感：拖动中只预览，松手才提交。 */
function GlassSlider({ control, t, useStore }) {
  const glass = useStore((state) => state.glass) ?? DEFAULT_GLASS
  const level = useStore((state) => state.glassLevel)
  const wallKind = useStore((state) => state.wallKind)
  const reduced = useStore((state) => state.reduced)
  const reason = useStore((state) => state.savingReason)
  const [draft, setDraft] = useState(undefined)
  const latest = useRef(glass)
  const frame = useRef(0)
  const dirty = useRef(false)
  const shown = draft ?? glass
  const disabled = wallKind === null || reduced
  const commit = () => {
    if (!dirty.current) return
    dirty.current = false
    cancelAnimationFrame(frame.current)
    control.commitGlass(latest.current)
    setDraft(undefined)
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => () => commitRef.current(), [])
  const onInput = (event) => {
    const next = Number(event.target.value)
    latest.current = next
    dirty.current = true
    setDraft(next)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => control.liveGlass(latest.current))
  }
  const percent = shown * 100
  const track = `linear-gradient(90deg,var(--dsw-alias-state-business-primary) ${percent}%,var(--dsw-alias-border-l3) ${percent}%)`
  const effective = level === null ? undefined : Number(level)
  const clamped = draft === undefined && effective !== undefined && effective < glass - 0.01
  return [
    h(
      'label',
      { key: 'slider', className: 'prism-slider prism-glass' },
      h('span', null, t('glass.label')),
      h('input', { type: 'range', className: 'prism-range', 'data-prism-glass': '', min: 0, max: 1, step: 0.01, value: shown, disabled, style: { '--prism-track': track }, onInput, onChange: () => {}, onPointerUp: commit, onKeyUp: commit, onBlur: commit }),
      h('span', { className: 'prism-value' }, `${Math.round(percent)}%`),
      h('span', null),
    ),
    reduced && wallKind !== null ? h('div', { key: 'reduced', className: 'prism-desc', 'data-prism-glass-reduced': '' }, t(`glass.saving.${reason ?? 'manual'}`)) : null,
    clamped && !reduced ? h('div', { key: 'clamped', className: 'prism-desc', 'data-prism-glass-clamped': '' }, t('glass.clamped', { value: Math.round(effective * 100) })) : null,
  ]
}

const POWER_MODES = ['auto', 'on', 'off']

/** 省电三档，和现在是否生效、因为什么。 */
function PowerRow({ control, t, useStore }) {
  const power = useStore((state) => state.power)
  const reason = useStore((state) => state.savingReason)
  const batterySupported = useStore((state) => state.batterySupported)
  return [
    h(
      'div',
      { key: 'row', className: 'prism-wall-row' },
      h('span', { className: 'prism-desc' }, t('power.label')),
      POWER_MODES.map((mode) => h('button', { key: mode, type: 'button', className: 'prism-chip', 'aria-pressed': power === mode, 'data-prism-power': mode, onClick: () => control.setPower(mode) }, t(`power.${mode}`))),
    ),
    h(
      'div',
      { key: 'status', className: 'prism-desc', 'data-prism-power-status': reason ?? 'off' },
      reason === null ? t(power === 'off' ? 'power.status.never' : batterySupported ? 'power.status.idle' : 'power.status.idleNoBattery') : t(`power.status.${reason}`),
    ),
  ]
}

const WALL_ERRORS = new Set(['not-an-image', 'too-large', 'bad-url', 'download-failed'])

/**
 * @param {{host: any, control: any, t: (key: string, params?: object) => string, useStore: any, locale: 'zh' | 'en'}} props 属性
 * @returns {import('react').ReactElement} 这一组
 */
export function BackgroundGroup({ host, control, t, useStore, locale }) {
  const wallpaper = useStore((state) => state.wallpaper)
  const wallKind = useStore((state) => state.wallKind)
  const [tab, setTab] = useState(kindOf(wallpaper))
  const [busy, setBusy] = useState(undefined)
  const [error, setError] = useState(undefined)
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [urls, setUrls] = useState(wallpaper?.kind === 'rotate' ? wallpaper.items.map((item) => item.src ?? '').filter(Boolean).join('\n') : '')
  const [interval, setIntervalValue] = useState(wallpaper?.interval ?? 900)
  const [shuffle, setShuffle] = useState(wallpaper?.shuffle === true)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => setTab(kindOf(wallpaper)), [wallpaper?.kind])

  const guard = async (label, work) => {
    setBusy(label)
    setError(undefined)
    try {
      return await work()
    } catch (failure) {
      console.warn('[dsh-prism-skin] 壁纸处理失败：', failure)
      setError(t(WALL_ERRORS.has(failure?.code) ? `wall.error.${failure.code}` : 'wall.error.generic'))
      return undefined
    } finally {
      setBusy(undefined)
    }
  }

  const useFile = (file) =>
    guard(t('wall.processing'), async () => {
      const wall = await host.loadWall()
      const { id, derived } = await wall.addFile(file)
      control.setWallpaperImage({ kind: 'image', id }, derived)
    })

  const useUrl = () => {
    const link = url.trim()
    if (link === '') return undefined
    return guard(t('wall.processing'), async () => {
      const wall = await host.loadWall()
      const { id, derived } = await wall.addUrl(link)
      control.setWallpaperImage({ kind: 'image', id, src: link }, derived)
      setUrl('')
    })
  }

  const useRotation = () => {
    const links = [...new Set(urls.split('\n').map((line) => line.trim()).filter(Boolean))]
    if (links.length === 0) return undefined
    return guard(t('wall.processing'), async () => {
      const wall = await host.loadWall()
      const items = []
      for (const [index, link] of links.entries()) {
        setBusy(t('wall.progress', { index: index + 1, total: links.length }))
        try {
          const { id } = await wall.addUrl(link)
          items.push({ id, src: link })
        } catch (failure) {
          console.warn('[dsh-prism-skin] 跳过这张：', link, failure)
        }
      }
      if (items.length === 0) throw Object.assign(new Error('全部失败'), { code: 'download-failed' })
      if (items.length < links.length) setError(t('wall.partial', { failed: links.length - items.length }))
      control.setWallpaper({ kind: 'rotate', items, interval, shuffle, epoch: Date.now() })
    })
  }

  const useFolder = (folder) => control.setWallpaper({ kind: 'folder', path: folder, interval, shuffle, epoch: Date.now() })

  const pickFolder = () =>
    guard(t('wall.processing'), async () => {
      const picked = await host.pickDirectory()
      if (typeof picked === 'string' && picked !== '') useFolder(picked)
    })

  const extract = () =>
    guard(t('wall.processing'), async () => {
      if (wallpaper?.kind === 'gradient') return control.useWallColors(stopsDerived(wallpaper.stops))
      if (wallpaper?.kind === 'color') return control.useWallColors(stopsDerived([wallpaper.color]))
      const wall = await host.loadWall()
      return control.useWallColors(await wall.readDerived(host.core.layer().wall.key))
    })

  const timing = () =>
    h(
      'div',
      { className: 'prism-wall-row' },
      h('span', { className: 'prism-desc' }, t('wall.interval')),
      h('select', { className: 'prism-select', value: interval, onChange: (event) => setIntervalValue(Number(event.target.value)) }, INTERVALS.map((value) => h('option', { key: value, value }, t(`wall.every.${value}`)))),
      h('label', { className: 'prism-check' }, h('input', { type: 'checkbox', checked: shuffle, onChange: (event) => setShuffle(event.target.checked) }), t('wall.shuffle')),
    )

  const panel = () => {
    switch (tab) {
      case 'image':
        return [
          h(
            'div',
            {
              key: 'drop',
              className: 'prism-drop',
              'data-active': dragging ? '' : undefined,
              onClick: () => fileRef.current?.click(),
              onDragOver: (event) => {
                event.preventDefault()
                setDragging(true)
              },
              onDragLeave: () => setDragging(false),
              onDrop: (event) => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer?.files?.[0]
                if (file !== undefined) void useFile(file)
              },
            },
            t('wall.drop'),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/*',
              hidden: true,
              'data-prism-wall-file': '',
              onChange: (event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void useFile(file)
                event.target.value = ''
              },
            }),
          ),
          h(
            'div',
            { key: 'url', className: 'prism-wall-row' },
            h('input', { type: 'url', className: 'prism-input', 'data-prism-wall-url': '', placeholder: t('wall.urlHint'), value: url, onChange: (event) => setUrl(event.target.value), onKeyDown: (event) => event.key === 'Enter' && void useUrl() }),
            h('button', { type: 'button', className: 'prism-btn', 'data-prism-wall-url-apply': '', disabled: url.trim() === '', onClick: useUrl }, t('wall.apply')),
          ),
        ]
      case 'gradient':
        return h(
          'div',
          { className: 'prism-swatches' },
          GRADIENTS.map((item) =>
            h('button', {
              key: item.id,
              type: 'button',
              className: 'prism-wall-swatch',
              title: item.name[locale],
              'aria-label': item.name[locale],
              'aria-pressed': wallpaper?.kind === 'gradient' && wallpaper.stops.join() === item.stops.join(),
              'data-prism-gradient': item.id,
              style: { background: `linear-gradient(${item.angle}deg,${item.stops.join(',')})` },
              onClick: () => control.setWallpaper({ kind: 'gradient', stops: item.stops, angle: item.angle }),
            }),
          ),
        )
      case 'color':
        return h(
          'div',
          { className: 'prism-swatches' },
          SOLIDS.map((color) => h('button', { key: color, type: 'button', className: 'prism-wall-swatch', 'aria-label': color, 'aria-pressed': wallpaper?.kind === 'color' && wallpaper.color === color, 'data-prism-solid': color, style: { background: color }, onClick: () => control.setWallpaper({ kind: 'color', color }) })),
          h('label', { className: 'prism-color', title: t('wall.customColor') }, h('input', { type: 'color', 'aria-label': t('wall.customColor'), value: wallpaper?.kind === 'color' ? wallpaper.color : '#20242e', onChange: (event) => control.setWallpaper({ kind: 'color', color: event.target.value }) })),
        )
      case 'rotate':
        return [
          h('textarea', { key: 'urls', className: 'prism-input prism-urls', rows: 4, 'data-prism-rotate-urls': '', placeholder: t('wall.urlsHint'), value: urls, onChange: (event) => setUrls(event.target.value) }),
          h('div', { key: 'timing' }, timing()),
          h('div', { key: 'apply', className: 'prism-wall-row' }, h('button', { type: 'button', className: 'prism-btn', 'data-prism-rotate-apply': '', disabled: urls.trim() === '', onClick: useRotation }, t('wall.apply'))),
        ]
      case 'folder':
        return [
          h('div', { key: 'timing' }, timing()),
          h('div', { key: 'pick', className: 'prism-wall-row' }, h('button', { type: 'button', className: 'prism-btn', 'data-prism-folder-pick': '', onClick: pickFolder }, t('wall.pickFolder')), wallpaper?.kind === 'folder' ? h('span', { className: 'prism-desc prism-path', 'data-prism-folder-current': '', title: wallpaper.path }, wallpaper.path) : null),
          h(
            'div',
            { key: 'path', className: 'prism-wall-row' },
            h('input', { type: 'text', className: 'prism-input', 'data-prism-folder-path': '', placeholder: t('wall.pathHint'), value: path, onChange: (event) => setPath(event.target.value) }),
            h('button', { type: 'button', className: 'prism-btn', disabled: !/^(\/|[A-Za-z]:[\\/])/.test(path.trim()), onClick: () => useFolder(path.trim()) }, t('wall.apply')),
          ),
        ]
      default:
        return null
    }
  }

  return h(
    'div',
    { className: 'prism-group', 'data-prism-background': '' },
    h('div', { className: 'prism-head' }, h('div', { className: 'prism-title' }, t('title.background')), h('button', { type: 'button', className: 'prism-btn', 'data-prism-extract': '', disabled: wallKind === null || busy !== undefined, onClick: extract }, t('wall.extract'))),
    h(
      'div',
      { className: 'prism-swatches' },
      KINDS.map((kind) =>
        h(
          'button',
          {
            key: kind,
            type: 'button',
            className: 'prism-chip',
            'aria-pressed': tab === kind,
            'data-prism-wall-kind': kind,
            onClick: () => {
              setTab(kind)
              setError(undefined)
              if (kind === 'none') control.setWallpaper(null)
            },
          },
          t(`wall.kind.${kind}`),
        ),
      ),
    ),
    panel(),
    busy !== undefined ? h('div', { className: 'prism-desc', 'data-prism-wall-busy': '' }, busy) : null,
    error !== undefined ? h('div', { className: 'prism-note', role: 'status', 'data-prism-wall-error': '' }, h('span', null, error)) : null,
    h(GlassSlider, { control, t, useStore }),
    h(PowerRow, { control, t, useStore }),
  )
}
