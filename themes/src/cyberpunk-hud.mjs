// 赛博朋克 HUD 主题的生成脚本：node themes/src/cyberpunk-hud.mjs [输出文件，默认 themes/cyberpunk-hud.json]
// 宿主组件改成 HUD 框体（切角、四角括号、扫描线），红黑底、青色标题、黄色强调；只设计了暗色。
// 动画在 cyberpunk-hud-anim.css，只在 :not([data-prism-saving]) 时跑（棱镜省电时停下）。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const R0 = new URL('../../src/', import.meta.url).href
const state = await import(R0 + 'shared/state.js')
const { createShare } = await import(R0 + 'shared/share.js')
const { generate, audit } = await import(R0 + 'engine/generate.js')
const share = createShare(state)
const seed = { hue: 18, chroma: 1.4, neutral: 1, contrast: 0.3, depth: -0.9, accent: '#ff5a4f', code: 'monokai' }
const base = generate(seed)
const dark = (name, value) => [name, { light: base[name].light, dark: value }]
const overrides = Object.fromEntries([
  dark('--dsw-alias-label-primary', '#ff9c8f'),
  dark('--dsw-alias-label-secondary', '#ef8073'),
  dark('--dsw-alias-label-tertiary', '#e8806f'),
  dark('--dsw-alias-label-caption', '#d27063'),
  dark('--dsw-alias-link', '#5ef6ff'),
  dark('--dsw-specific-bubble', '#1f0809'),
  dark('--dsw-specific-bubble-highlight', '#2a0b0d'),
  dark('--dsw-alias-button-elevated-fill', '#1f0809'),
  dark('--dsw-specific-sidebar-nav-item-active', '#3a0f14'),
  dark('--dsw-alias-button-ghost-active-fill', '#2e0d10'),
  dark('--dsw-alias-bg-overlay', 'rgba(6,1,2,.8)'),
  dark('--dsw-alias-bg-layer-2', '#260f10'),
  dark('--dsw-alias-bg-layer-3', '#2e1516'),
  dark('--dsw-alias-bg-module-platform', '#2e1516'),
  dark('--dsw-specific-input-major', '#260f10'),
  dark('--dsw-specific-tip', '#2e1516'),
  dark('--dsw-specific-selector', '#2e1516'),
  dark('--dsw-alias-button-floating-fill', '#260f10'),
  dark('--dsw-alias-interactive-bg-hover-solid', '#2e1516'),
  dark('--dsw-alias-markdown-tag', '#260f10'),
  dark('--dsw-specific-sidebar-nav-item-active-accent', '#3a1416'),
  dark('--dsw-alias-file-diff-added-bg', '#132313'),
  dark('--dsw-alias-file-diff-deleted-bg', '#2c1210'),
  dark('--dsw-specific-menu', '#2a1213f5'),
  dark('--dsw-alias-border-l1', 'rgba(255,90,79,.22)'),
  dark('--dsw-alias-border-l2', 'rgba(255,90,79,.34)'),
  dark('--dsw-alias-border-l3', 'rgba(255,90,79,.48)'),
])
// 颜色一律写成带透明度的 8 位十六进制，比 rgba() 短一半
const hx = (base) => (a) => base + Math.round(a * 255).toString(16).padStart(2, '0')
const RED = '#ff5a4f', CY = '#5ef6ff', YE = '#fcee0a', INK = '#140405'
const red = hx(RED), cy = hx(CY), ye = hx(YE)
const ANG = { tl: 135, tr: 225, br: 315, bl: 45 }
// 切角：clip-path 切掉的角补一道斜线（渐变画），颜色走 --hc
const cut = (corners, c) => {
  const has = (k) => corners.includes(k)
  const pts = [has('tl') ? `0 ${c}px,${c}px 0` : '0 0', has('tr') ? `calc(100% - ${c}px) 0,100% ${c}px` : '100% 0', has('br') ? `100% calc(100% - ${c}px),calc(100% - ${c}px) 100%` : '100% 100%', has('bl') ? `${c}px 100%,0 calc(100% - ${c}px)` : '0 100%']
  const s = (c / Math.SQRT2 + 1.3).toFixed(1)
  return { clip: `clip-path:polygon(${pts.join(',')})`, grads: corners.map((k) => `linear-gradient(${ANG[k]}deg,var(--hc) 0 ${s}px,#0000 0)`).join(',') }
}
// 四角括号（不裁切，里面的弹出菜单不会被切掉）
const L = 'linear-gradient(var(--hc),var(--hc))'
const brackets = (len, w) => ['0 0', '100% 0', '0 100%', '100% 100%'].map((p) => `${L} ${p}/${len}px ${w}px no-repeat,${L} ${p}/${w}px ${len}px no-repeat`).join(',')
const ns = cut(['br'], 10), row = cut(['br'], 8), grp = cut(['tl'], 8), bub = cut(['tr'], 10), code = cut(['tr', 'bl'], 14), send = cut(['br'], 7)
const B = (k, fill) => `background:${k.grads},${fill}`
const I = '' // 外层用 :not(#_) 抬到 ID 级优先级，宿主的类选择器压不过，不再需要 !important
const F = 'font-family:var(--hf)'
const SEL = ':is([role=treeitem][aria-selected=true],[class*=_navCell][aria-current=true])'
// 规则都嵌在 [data-ds-dark-theme]（body）里：亮色模式不受影响，也省掉几十次重复前缀
const nest = [
  `--hc:${RED};accent-color:${RED};`,
  // 滚动条：一条细红线当轨道，滑块是一段粗红条
  `::-webkit-scrollbar{width:7px;height:7px}`,
  `::-webkit-scrollbar-thumb{background:${RED};border-radius:0}`,
  `::-webkit-scrollbar-track:vertical{background:linear-gradient(90deg,#0000 3px,${red(.35)} 0 4px,#0000 0)}`,
  `::-webkit-scrollbar-track:horizontal{background:linear-gradient(#0000 3px,${red(.35)} 0 4px,#0000 0)}`,
  `[data-platform=darwin] & [class*=_sidebarCol],[class*=_sidebarCol]{background:#0d0405!important;box-shadow:inset -1px 0 ${red(.7)},inset -14px 0 26px -16px ${red(.55)}!important}`,
  `[data-slot=main]{background-image:linear-gradient(${red(.045)} 1px,#0000 1px),linear-gradient(90deg,${red(.045)} 1px,#0000 1px);background-size:28px 28px}`,
  `:is([class*=_sidebarCol],[role=tab],[class*=_panelRow],[class*=_newSession],[class*=_language],th,[class*=_endInfo],[data-composer-card] button,[class*=_navCell]){${F}}`,
  `:is([role=tab],[class*=_panelRow],[class*=_sectionLabel],[class*=_sectionTitle],[class*=_groupTitle],[class*=_newSession],[class*=_language],th,[class*=_projectRow],[class*=_navCell]){text-transform:uppercase;letter-spacing:.08em}`,
  `button[class*=_newSession]{${B(ns, red(.1))};box-shadow:inset 0 0 0 1px ${red(.8)}${I};color:${RED}${I};border-radius:0${I};${ns.clip}}`,
  `button[class*=_newSession]:hover{background:${RED}${I};color:${INK}${I}}`,
  `button[class*=_newSession] *{color:inherit${I};background:none${I}}`,
  `:is([class*=_panelRow],[role=treeitem],[class*=_navCell]){border-radius:0${I}}`,
  `:is([class*=_panelRow],[role=treeitem],[class*=_navCell]):hover{background:${red(.1)}${I};box-shadow:inset 2px 0 ${RED}${I}}`,
  // 分组行：像日志里的分组标题，红框 + 左上切角
  `[class*=_projectRow]{${B(grp, red(.07))};box-shadow:inset 0 0 0 1px ${red(.4)}${I};${grp.clip}}`,
  // 选中行：整块红底深色字（日志、资料库列表的选中样式）
  `${SEL}{background:${RED}${I};color:${INK}${I};box-shadow:none${I};${row.clip}}`,
  `${SEL} *{color:inherit${I}}`,
  `:is([class*=_sectionLabel],[class*=_sectionTitle],[class*=_groupTitle]){color:${YE}${I};text-shadow:0 0 8px ${ye(.45)}}`,
  `[class*=_sectionLabel]::before{content:"// "}`,
  // 顶部标签：纯文字，当前的变青加下划线
  `[role=tab]{border-radius:0${I};background:none${I};color:${red(.9)}${I}}`, // 0.8 只有 4.41:1，0.9 过 4.5
  `[role=tab][aria-selected=true]{color:${CY}${I};box-shadow:inset 0 -2px ${CY};text-shadow:0 0 8px ${cy(.6)}}`,
  `[data-slot="conversation.header"]>header{box-shadow:0 1px ${red(.5)};background:repeating-linear-gradient(90deg,${red(.6)} 0 1px,#0000 1px 10px) bottom/100% 4px no-repeat}`,
  `[data-composer-card=true]{background:${brackets(16, 2)},#0e0405${I};box-shadow:inset 0 0 0 1px ${red(.4)},inset 0 0 30px ${red(.08)}${I};border-radius:0${I}}`,
  `[data-composer-card=true]:focus-within{--hc:${CY};box-shadow:inset 0 0 0 1px ${cy(.45)},inset 0 0 30px ${cy(.08)}${I}}`,
  `[data-composer-card=true] [class*=_primary]{background:${YE}${I};color:${INK}${I};border-radius:0${I};${send.clip}}`,
  // 弹出菜单、弹窗：红框；设置窗加四角括号
  `:is([role=listbox],[role=menu],[role=dialog][aria-modal]){box-shadow:0 0 0 1px ${red(.55)},0 0 28px ${red(.22)}${I};border-radius:0${I}}`,
  `[role=dialog][aria-modal]{background-image:${brackets(18, 2)}${I}}`,
  // 菜单里的当前项：对话选项那种黄色高亮条
  `:is([role=menuitem]:is(:hover,:focus),[role=option][aria-selected=true]){background:${ye(.13)}${I};box-shadow:inset 3px 0 ${YE};color:${YE}${I}}`,
  `:is([role=menuitem]:is(:hover,:focus),[role=option][aria-selected=true]) *{color:inherit${I}}`,
  // 开关：方的，开是青、关是红
  `[role=switch],[role=switch] *{border-radius:0${I}}`,
  `[role=switch]{background:${red(.4)}${I}}`,
  `[role=switch][aria-checked=true]{background:${CY}${I}}`,
  `[data-message-bubble]{${B(bub, red(.09))};box-shadow:inset 0 0 0 1px ${red(.55)},inset -3px 0 ${CY}${I};border-radius:0${I};${bub.clip}}`,
  `.md-code-block{${B(code, '#0c0304')};box-shadow:inset 0 0 0 1px ${red(.6)},inset 0 0 22px ${red(.08)}${I};border-radius:0${I};${code.clip}}`,
  `[data-code-block-banner]{background:${red(.14)}${I};border-bottom:1px solid ${red(.45)}}`,
  `[class*=_language]{color:${YE}${I};letter-spacing:.14em}`,
  `.md-code-block pre{background:#0000${I}}`,
  `:is(h1,h2,h3,h4){color:${CY}${I};text-transform:uppercase;letter-spacing:.06em;${F};border-bottom:1px solid ${red(.5)};padding-bottom:.15em;text-shadow:0 0 10px ${cy(.45)}}`,
  `:is(strong,b){color:${CY}${I}}`,
  `:not(pre)>code{color:${YE}${I};background:${ye(.07)}${I};box-shadow:inset 0 0 0 1px ${ye(.35)};border-radius:0${I}}`,
  `& hr{border:0;height:1px;background:${RED};box-shadow:0 0 8px ${RED}}`,
  `& blockquote{border-left:2px solid ${RED}${I};background:${red(.06)}}`,
  `& li::marker{color:${RED}}`,
  `& th{color:${YE}${I};background:${red(.12)}}`,
  `:is(td,th){border-color:${red(.35)}${I}}`,
  `:is(input,textarea):focus{box-shadow:0 0 0 1px ${CY},0 0 12px ${cy(.4)}${I}}`,
  `&::before{content:"";position:fixed;inset:5px;pointer-events:none;z-index:2147483000;background:${brackets(24, 3)}}`,
  `&::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:2147482999;background:repeating-linear-gradient(#00000024 0 1px,#0000 1px 3px),radial-gradient(#0000 60%,${red(.12)})}`,
  `html:has(&)::after{content:"PRISM // HUD // LINK OK";position:fixed;right:26px;bottom:6px;font:600 9px/1 var(--hf);letter-spacing:.22em;color:${red(.6)};pointer-events:none;z-index:2147483000}`,
]
const css = [
  `::selection{background:${cy(.35)};color:#fff}`,
  `*{caret-color:${CY}}`,
  `:root{--hf:"Avenir Next Condensed","PingFang SC",sans-serif}`,
  `[data-ds-dark-theme]:not(#_){${nest.join('')}}`,
]
// 亮色没有专门设计（框体规则只在暗色下生效）：宿主轨迹页「助手」标签的颜色是几种色混出来的，亮色下只有 3.2:1，改用正文色
css.push('body:not([data-ds-dark-theme]) [class*=_kindTag][data-role-kind=message]{color:var(--dsw-alias-label-primary)}')
css.push(fs.readFileSync(new URL('./cyberpunk-hud-anim.css', import.meta.url), 'utf8').replace(/\s*\n\s*/g, ''))
const text = css.join('')
const check = state.checkCss(text)
const file = { name: '赛博朋克 HUD', seed, scheme: 'dark', radius: 0, overrides, css: text }
const serialized = share.serializeTheme(file)
const parsed = share.parseThemeFile(JSON.parse(serialized))
const tokens = generate(seed)
for (const [k, v] of Object.entries(overrides)) tokens[k] = v
const rows = audit(tokens).filter((r) => r.mode === 'dark' || r.mode === undefined)
const wfail = rows.filter((r) => r.wcag < r.minWcag)
console.log('CSS', text.length, '/', state.CSS_MAX_LENGTH, '，检查', check.ok ? '通过' : JSON.stringify(check))
console.log('导入校验', parsed && parsed.ok !== false ? '通过' : JSON.stringify(parsed).slice(0, 200))
console.log('暗色对比度', rows.length, '组；WCAG 不达标', wfail.length, wfail.slice(0, 6).map((r) => `${r.text} on ${r.on} ${r.wcag.toFixed(2)}/${r.minWcag}`).join(' | '))
const prim = rows.filter((r) => /label-primary/.test(r.text)).sort((a, b) => a.wcag - b.wcag)[0]
console.log('正文最弱', prim && `${prim.on} WCAG ${prim.wcag.toFixed(2)} APCA ${prim.apca.toFixed(0)}`)
const out = process.argv[2] ?? fileURLToPath(new URL('../cyberpunk-hud.json', import.meta.url))
fs.writeFileSync(out, `${serialized}\n`)
console.log('写入', out)
