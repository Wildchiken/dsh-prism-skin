// 主题体检的页面端函数（scripts/audit-theme.mjs 读成字符串放进页面执行），装到 window.__audit。
// 只量不改：临时关掉主题（停用主题样式表、拿掉 body 上的变量）量一遍，马上还原。
// run() 返回的问题类型：
//   有无主题对比：折行变多、横向被截断、纵向被切掉、主题下不见了、明显变小、新出现的重叠
//   只看主题下：对比度不够、占位文字对比度不够、圆角不在规定档位、子元素在圆角外露出来、图标没换、字体没换
(() => {
  const HASH = /^_?[A-Za-z0-9-]{6}(?=_)/
  const keyOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')
    const parts = cls.split(/\s+/).filter(Boolean).map((c) => c.replace(HASH, '')).slice(0, 3)
    const role = el.getAttribute('role')
    return el.tagName.toLowerCase() + parts.map((p) => '.' + p).join('') + (role ? `[${role}]` : '')
  }
  const ownText = (el) => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim() }
  const label = (el) => (ownText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)
  const desc = (el) => keyOf(el) + (label(el) ? ` “${label(el)}”` : '')
  const shown = (el, r) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const rgba = (s) => {
    if (cache.has(s)) return cache.get(s)
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data
    const v = [d[0], d[1], d[2], d[3] / 255]
    cache.set(s, v); return v
  }
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  /** 元素背后的实际底色（逐层叠半透明）；遇到图片返回 null。 */
  const bgOf = (el) => {
    const layers = []
    let op = 1
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      op *= Number(cs.opacity)
      if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break }
    }
    let base = rgba(getComputedStyle(document.documentElement).backgroundColor)
    if (base[3] < 0.999) base = [255, 255, 255, 1]
    for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; base = [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1] }
    return { bg: base, op }
  }
  const contrastOf = (el, colorStr) => {
    const b = bgOf(el); if (b === null) return null
    const [r, g, bl, a] = rgba(colorStr); const al = a * b.op
    const fg = [r * al + b.bg[0] * (1 - al), g * al + b.bg[1] * (1 - al), bl * al + b.bg[2] * (1 - al)]
    return Math.round(ratio(fg, b.bg) * 100) / 100
  }
  const linesOf = (el) => {
    const tops = []
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.nodeValue.trim()) continue
      const rg = document.createRange(); rg.selectNodeContents(n)
      for (const q of rg.getClientRects()) if (q.width > 1) tops.push(Math.round(q.top))
    }
    tops.sort((a, b) => a - b)
    let n = 0, last = -1e9
    for (const t of tops) if (t - last > 3) { n++; last = t }
    return n
  }
  const FLOW = new Set(['static', 'relative', 'sticky'])
  const ids = new WeakMap(); let seq = 0
  const reg = new Map()
  const idOf = (el) => { if (!ids.has(el)) { ids.set(el, ++seq); reg.set(seq, el) } return ids.get(el) }

  const snap = () => {
    const m = new Map()
    const icons = new Map()
    const overlaps = new Set()
    for (const el of document.body.querySelectorAll('*')) {
      const tag = el.tagName
      if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(tag)) continue
      if (tag !== 'svg' && el.closest('svg')) {
        if (tag === 'use') {
          const href = el.getAttribute('href') || el.getAttribute('xlink:href') || ''
          if (href.startsWith('#') && !icons.has(href)) {
            const p = document.getElementById(href.slice(1))?.querySelector('path')
            const host = el.closest('svg')
            icons.set(href, { d: p ? getComputedStyle(p).d.slice(0, 60) : '', vis: host ? shown(host, host.getBoundingClientRect()) : false, where: host?.parentElement ? desc(host.parentElement) : '' })
          }
        }
        continue
      }
      const r = el.getBoundingClientRect()
      const vis = shown(el, r)
      if (!vis && r.width === 0 && r.height === 0) { m.set(el, { vis: false, r: [0, 0, 0, 0] }); continue }
      const cs = getComputedStyle(el)
      const t = ownText(el)
      const live = r.width > 0 && r.height > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      const row = { vis, live, inline: cs.display === 'inline', r: [r.x, r.y, r.width, r.height], text: t }
      if (live && t) row.lines = linesOf(el)
      if (vis && t) {
        const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight)
        row.large = size >= 24 || (size >= 18.66 && weight >= 700)
        row.cr = contrastOf(el, cs.color)
        row.fam = cs.fontFamily
        row.disabled = el.closest('[disabled],[aria-disabled="true"]') !== null
      }
      if (vis && (tag === 'INPUT' || tag === 'TEXTAREA') && el.placeholder && !el.value) {
        row.ph = contrastOf(el, getComputedStyle(el, '::placeholder').color)
      }
      if (live) {
        row.ox = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(cs.overflowX)
        row.oy = cs.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2 && !/auto|scroll/.test(cs.overflowY)
        // 行内元素（display: inline）跨行时外框是整行宽，不算重叠；只看块级、行内块、弹性盒这些成块的
        const kids = tag === 'svg' ? [] : [...el.children].filter((k) => { const kc = getComputedStyle(k); return FLOW.has(kc.position) && kc.display !== 'contents' && kc.display !== 'inline' && kc.float === 'none' })
        if (kids.length >= 2 && kids.length <= 40) {
          const rs = kids.map((k) => { const q = k.getBoundingClientRect(); return shown(k, q) ? q : null })
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i], b = rs[j]; if (!a || !b) continue
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (w > 2 && h > 2) overlaps.add(`${idOf(kids[i])}-${idOf(kids[j])}`)
          }
        }
      }
      m.set(el, row)
    }
    return { m, icons, overlaps }
  }

  /** 只在主题开着时查：圆角是不是规定的几档（radii 为空时不查）；圆角容器里的子元素有没有在角上露出来。 */
  const shapes = (allowed = []) => {
    const out = []
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg')) continue
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8 || !shown(el, r)) continue
      const cs = getComputedStyle(el)
      const boxed = rgba(cs.backgroundColor)[3] > 0.03 || (parseFloat(cs.borderTopWidth) > 0 && rgba(cs.borderTopColor)[3] > 0.1) || (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' && rgba(cs.outlineColor)[3] > 0.1)
      if (!boxed) continue
      const half = Math.min(r.width, r.height) / 2 - 0.5
      const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map((v) => parseFloat(v) || 0)
      const odd = radii.filter((v) => v > 2.5 && v < half && !allowed.some((a) => Math.abs(a - v) < 0.6))
      if (allowed.length && odd.length) out.push({ type: '圆角不在规定档位', el: desc(el), val: radii.join('/'), size: `${Math.round(r.width)}x${Math.round(r.height)}` })
      // 角上露出来：父元素有圆角、没裁剪；子元素有底色，贴着父元素的角，自己的圆角更小
      if (Math.max(...radii) > 2 && cs.overflow === 'visible') {
        for (const k of el.children) {
          const kr = k.getBoundingClientRect(); if (!shown(k, kr)) continue
          const kc = getComputedStyle(k)
          if (rgba(kc.backgroundColor)[3] < 0.05 || kc.backgroundColor === cs.backgroundColor) continue
          const kRad = [kc.borderTopLeftRadius, kc.borderTopRightRadius, kc.borderBottomRightRadius, kc.borderBottomLeftRadius].map((v) => parseFloat(v) || 0)
          const near = (a, b) => Math.abs(a - b) <= 1.5
          const corners = [[near(kr.left, r.left) && near(kr.top, r.top)], [near(kr.right, r.right) && near(kr.top, r.top)], [near(kr.right, r.right) && near(kr.bottom, r.bottom)], [near(kr.left, r.left) && near(kr.bottom, r.bottom)]]
          corners.forEach(([hit], i) => { if (hit && radii[i] > 2 && kRad[i] < radii[i] - 1.5) out.push({ type: '子元素在圆角外露出来', el: desc(el), val: `父 ${radii[i]} / 子 ${kRad[i]}（角 ${i}）`, kid: desc(k) }) })
        }
      }
    }
    return out
  }

  const still = (on) => {
    let s = document.getElementById('__audit-still')
    if (on && !s) { s = document.createElement('style'); s.id = '__audit-still'; s.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;caret-color:transparent!important}'; document.head.appendChild(s) }
    if (!on && s) s.remove()
  }
  let saved = null
  const themeOff = () => {
    // 棱镜放主题 CSS 的样式表带 data-prism-css；主题的变量写在 body 的行内样式上
    const styles = [...document.querySelectorAll('style[data-prism-css]')].filter((s) => !s.disabled)
    saved = { styles, body: document.body.getAttribute('style'), root: document.documentElement.getAttribute('style') }
    styles.forEach((s) => { s.disabled = true })
    document.body.removeAttribute('style')
    return styles.length
  }
  const themeOn = () => {
    if (!saved) return
    saved.styles.forEach((s) => { s.disabled = false })
    if (saved.body !== null) document.body.setAttribute('style', saved.body)
    saved = null
  }

  /** @param {{radii?: number[], fonts?: string[]}} [opts] radii 规定的圆角档位；fonts 主题该用的字体（取第一个字体名比较） */
  const run = (opts = {}) => {
    still(true)
    const on = snap()
    const shapeOut = shapes(opts.radii)
    const n = themeOff()
    const off = snap()
    themeOn()
    const out = [...shapeOut]
    const push = (type, el, extra) => out.push({ type, el: desc(el), ...extra })
    for (const [el, a] of on.m) {
      const b = off.m.get(el)
      if (a.vis && a.text && a.cr != null) {
        const need = a.large ? 3 : 4.5
        if (a.cr < need) push(a.disabled ? '对比度不够（禁用态）' : '对比度不够', el, { val: `${a.cr}（要 ${need}）`, base: b?.cr ?? null })
      }
      if (a.ph != null && a.ph < 4.5) push('占位文字对比度不够', el, { val: a.ph, base: b?.ph ?? null })
      if (!b) continue
      if (a.live && b.live && a.text && a.lines > b.lines && b.lines > 0) push('折行变多', el, { val: `${b.lines} → ${a.lines} 行`, w: `${Math.round(b.r[2])} → ${Math.round(a.r[2])}` })
      if (a.live && a.ox && !b.ox) push('横向被截断', el, { val: `宽 ${Math.round(a.r[2])}` })
      if (a.live && a.oy && !b.oy) push('纵向被切掉', el, { val: `高 ${Math.round(a.r[3])}` })
      if (b.live && b.r[2] >= 8 && b.r[3] >= 8 && (!a.live || a.r[2] < 4 || a.r[3] < 4)) push('主题下不见了', el, { val: `原 ${Math.round(b.r[2])}x${Math.round(b.r[3])} → ${a.live ? Math.round(a.r[2]) + 'x' + Math.round(a.r[3]) : '隐藏'}` })
      if (a.live && b.live && a.text && !a.inline && !b.inline && (a.r[2] < b.r[2] * 0.6 || a.r[3] < b.r[3] * 0.6) && b.r[2] > 20) push('明显变小', el, { val: `${Math.round(b.r[2])}x${Math.round(b.r[3])} → ${Math.round(a.r[2])}x${Math.round(a.r[3])}` })
    }
    for (const k of on.overlaps) if (!off.overlaps.has(k)) out.push({ type: '新出现的重叠', el: k })
    // 图标：主题换了一部分图标时，才把没换到的列出来（主题根本不换图标就不报）
    const unreplaced = []
    let replaced = 0
    for (const [href, a] of on.icons) { const b = off.icons.get(href); if (!a.vis || !b) continue; if (a.d === b.d) unreplaced.push(`${href.replace('#dsw-icon-', '')}（${a.where}）`); else replaced++ }
    if (replaced > 0 && unreplaced.length) out.push({ type: '图标没换', el: unreplaced.join('；') })
    if (opts.fonts?.length) {
      const want = opts.fonts.map((f) => f.replace(/["']/g, '').trim())
      const fams = new Map()
      for (const [el, a] of on.m) { if (!a.vis || !a.fam) continue; const f = a.fam.split(',')[0].replace(/["']/g, '').trim(); if (!want.includes(f) && !fams.has(f)) fams.set(f, desc(el)) }
      for (const [f, ex] of fams) out.push({ type: '字体没换', el: ex, val: f })
    }
    // 去重：同类型 + 同元素描述只留一条，记次数
    const seen = new Map()
    for (const f of out) { const k = f.type + '|' + f.el + '|' + (f.kid ?? ''); if (seen.has(k)) seen.get(k).n++; else seen.set(k, { ...f, n: 1 }) }
    // overlap 的 id 转回描述
    const list = [...seen.values()].map((f) => f.type === '新出现的重叠' ? { ...f, el: f.el.split('-').map((i) => { const e = reg.get(Number(i)); return e ? desc(e) : '?' }).join(' ✕ ') } : f)
    return { styles: n, count: on.m.size, findings: list }
  }

  // 悬停：挑可交互元素，每类最多 2 个
  let hoverEls = []
  const hoverList = () => {
    const sel = 'button,a[href],[role=button],[role=tab],[role=menuitem],[role=option],[role=treeitem],[role=switch],[role=row],[role=link],summary,[class*=Row],[class*=row_],[class*=_item]'
    const per = new Map(); hoverEls = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect(); if (!shown(el, r) || r.width < 6 || r.height < 6) continue
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue
      const hit = document.elementFromPoint(x, y); if (!hit || !(el === hit || el.contains(hit))) continue
      const k = keyOf(el); const c = per.get(k) ?? 0; if (c >= 2) continue
      per.set(k, c + 1); hoverEls.push(el)
    }
    return hoverEls.map((el, i) => { const r = el.getBoundingClientRect(); return { i, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), el: desc(el) } })
  }
  // 悬停前后比较同一批元素的布局盒（offset*，不受 transform 影响：放大一点的悬停效果不会挤动别人，不算）；
  // 悬停时新插进来的元素（提示气泡）不在这批里，也不算
  const LABELS = ['自己', '父元素', '前一个', '后一个', '祖父元素']
  const box = (e) => (e.isConnected ? [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight].join(',') : '已移除')
  let before = null
  const hoverBefore = (i) => {
    const el = hoverEls[i]
    const list = [el, el.parentElement, el.previousElementSibling, el.nextElementSibling, el.parentElement?.parentElement]
    before = list.map((e) => (e ? { e, b: box(e) } : null))
    return true
  }
  const hoverAfter = (i, x, y) => {
    const el = hoverEls[i]
    const moved = before.map((it, j) => (it && box(it.e) !== it.b ? `${LABELS[j]} ${it.b} → ${box(it.e)}` : null)).filter(Boolean)
    const hit = document.elementFromPoint(x, y)
    const lost = !hit || !(el === hit || el.contains(hit) || hit.closest('[role=tooltip]'))
    return { moved, lost, el: desc(el), hit: hit ? desc(hit) : null }
  }

  window.__audit = { run, still, themeOff, themeOn, hoverList, hoverBefore, hoverAfter, desc }
  return 'ready'
})()
