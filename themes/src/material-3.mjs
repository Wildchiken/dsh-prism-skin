// Material 3 主题的生成脚本：node themes/src/material-3.mjs [输出文件，默认 themes/material-3.json]
// 先跑一次 node themes/src/fetch-symbols.mjs 取图标。
//
// 数值都取自官方开源实现：
// - 配色：棱镜的 Material 动态取色（material-color-utilities），Tonal Spot、2021 规格，按当前强调色现算；
//   默认源色是安卓拿不到壁纸色时用的 GOOGLE_BLUE（AOSP frameworks/libs/systemui monet/ColorScheme.java）
// - 组件尺寸、圆角、状态层：material-web 的 tokens（md.comp.*、md.sys.shape、md.sys.state）
// - 侧栏和设置页的分段列表、开关图标：AOSP SettingsLib（安卓 16 设置页）
// - 动效：md.sys.motion 的弹簧参数，用 CSS linear() 采样
// - 图标：Material Symbols 圆角（google/material-design-icons，Apache-2.0），见 material-3-icons.mjs
// 没有阴影：浮层（输入框、菜单、面板、回到底部）用高一级的底色加 outline-variant 细线和下面分开。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compress, iconPath } from './icons.mjs'
import { ICONS, VB } from './material-3-icons.mjs'

const R0 = new URL('../../src/', import.meta.url).href
const state = await import(R0 + 'shared/state.js')
const { createShare } = await import(R0 + 'shared/share.js')
const { fitSeed } = await import(R0 + 'engine/convert.js')
const share = createShare(state)
const { materialRoles } = await import(R0 + 'engine/material.js')

// —— 颜色工具 ——
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0')
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** 状态层：在 base 上叠一层 over，不透明度 a（material-web 就是这样叠的） */
const blend = (base, over, a) => `#${rgb(base).map((c, i) => hex2(c * (1 - a) + rgb(over)[i] * a)).join('')}`
const alpha = (h, a) => `${h}${hex2(a * 255)}`
const pair = (f) => ({ light: f('light'), dark: f('dark') })
const same = (v) => ({ light: v, dark: v })

// md.sys.state（latest）
const HOVER = 0.08
const PRESS = 0.1

// —— 动效：弹簧采样成 linear() ——
/** stiffness / damping ratio（质量 1），采样到误差 0.1% 以内 */
function spring(k, zeta) {
  const w = Math.sqrt(k)
  const x = zeta < 1
    ? (t) => { const wd = w * Math.sqrt(1 - zeta * zeta); return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + (zeta * w / wd) * Math.sin(wd * t)) }
    : (t) => 1 - Math.exp(-w * t) * (1 + w * t)
  let end = 0.01
  while (end < 2) { let ok = true; for (let t = end; t < end + 0.3; t += 0.005) if (Math.abs(1 - x(t)) > 0.001) { ok = false; break } if (ok) break; end += 0.005 }
  const n = 14
  const pts = Array.from({ length: n + 1 }, (_, i) => +x((end * i) / n).toFixed(3))
  pts[n] = 1
  return { ms: Math.round(end * 1000), fn: `linear(${pts.join(',')})` }
}
const FAST = spring(1400, 0.9) // md.sys.motion.spring.fast.spatial：形状变化
const EFX = spring(3800, 1) // md.sys.motion.spring.fast.effects：颜色

const layer = (col, a) => { const m = `color-mix(in srgb,${col} ${a * 100}%,#0000)`; return `linear-gradient(${m},${m})` }
// 开关手柄里的图标：AOSP SettingsLib（安卓 16 设置页）settingslib_expressive_icon_check / _close，Apache-2.0
const icon = (d) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 960 960'%3E%3Cpath d='${d}'/%3E%3C/svg%3E")`
const CHECK = icon('M382,720L154,492L211,435L382,606L749,239L806,296L382,720Z')
const CLOSE = icon('M256,760L200,704L424,480L200,256L256,200L480,424L704,200L760,256L536,480L760,704L704,760L480,536L256,760Z')

// —— 颜色：不写死，交给棱镜的 Material 动态取色按当前强调色现算 ——
const MATERIAL_BASE = { scheme: 'tonal', spec: '2021' }
// 默认源色：安卓拿不到壁纸色时用的 GOOGLE_BLUE（AOSP frameworks/libs/systemui monet/ColorScheme.java）；用户在棱镜里换强调色，整套跟着变
const ACCENT = '#1b6ef3'
const roles = {
  // 底色分三层：窗口/侧栏/设置页底色 → 一块块的列表项 → 内容窗格
  // 照 AOSP SettingsLib（安卓 16 设置页）：页面 colorBackground = surfaceContainer，列表项 = surfaceBright
  '--m3-bg': 'surfaceContainer',
  '--m3-tile': 'surfaceBright',
  '--m3-pane': 'surface',
  '--dsw-alias-bg-base': 'surface',
  '--dsw-specific-sidebar-fill': 'surfaceContainer',
  // 宿主自己的颜色变量 → M3 角色
  '--dsw-alias-bg-layer-1': 'surfaceContainerLow',
  '--dsw-alias-bg-layer-2': 'surfaceContainer',
  '--dsw-alias-bg-layer-3': 'surfaceContainerHigh',
  '--dsw-alias-bg-module-platform': 'surfaceContainerHigh',
  '--dsw-specific-input-major': 'surfaceContainerHigh',
  '--dsw-specific-menu': 'surfaceContainer',
  '--dsw-specific-bubble': 'primaryContainer',
  '--dsw-specific-bubble-highlight': 'secondaryContainer',
  '--dsw-specific-sidebar-nav-item-active': 'secondaryContainer',
  '--dsw-specific-sidebar-nav-item-active-accent': 'secondaryContainer',
  '--dsw-alias-markdown-code-block': 'surfaceContainer',
  '--shiki-background': 'surfaceContainer',
  '--dsw-alias-markdown-code-block-banner': 'surfaceContainer',
  '--dsw-alias-markdown-inline-code': 'surfaceContainerHigh',
  '--dsw-alias-markdown-tag': 'surfaceContainerHigh',
  '--dsw-alias-markdown-citation': 'surfaceContainerHigh',
  '--dsw-alias-label-primary': 'onSurface',
  '--shiki-foreground': 'onSurface',
  '--dsw-alias-label-secondary': 'onSurfaceVariant',
  '--dsw-alias-label-tertiary': 'onSurfaceVariant',
  // 占位文字、时间戳这类次要文字：outline 在 surface-container-high 上只有 3.7:1，正文要 4.5:1 以上，改用 on-surface-variant（M3 文本框的占位文字也是它）
  '--dsw-alias-label-caption': 'onSurfaceVariant',
  '--dsw-alias-link': 'primary',
  '--dsw-alias-button-primary-fill': 'primary',
  '--dsw-alias-label-primary-foreground': 'onPrimary',
  '--dsw-alias-state-error-primary': 'error',
  '--dsw-alias-border-l1': 'outlineVariant',
  '--dsw-alias-border-l2': 'outlineVariant',
  '--dsw-alias-border-l3': 'outlineVariant',
  '--dsw-alias-border-l4': 'outline',
  '--dsw-alias-tooltip-bg': 'inverseSurface',
  '--dsw-alias-toast-bg': 'inverseSurface',
  '--dsw-alias-toast-label': 'inverseOnSurface',
  '--dsw-alias-brand-primary': 'primary',
  '--dsw-alias-brand-text': 'primary',
  // 状态层（md.sys.state：悬停 8%、按下 10%、禁用容器 12%、禁用内容 38%）
  '--m3-hover': 'onSurface/8',
  '--m3-dis-bg': 'onSurface/12',
  '--m3-dis': 'onSurface/38',
  '--dsw-alias-button-primary-hover': 'primary+onPrimary/8',
  '--dsw-alias-interactive-bg-hover': 'onSurface/8',
  '--dsw-alias-interactive-bg-active': 'onSurface/10',
  '--dsw-alias-interactive-bg-hover-solid': 'surfaceContainer+onSurface/8',
  '--dsw-alias-turn-trigger-bg-hover': 'onSurface/8',
  '--dsw-alias-switch-thumb': 'outline',
  '--dsw-alias-bg-mask-1': 'scrim/32', // md.sys.color.scrim，32%
  '--dsw-focus-ring-color': 'secondary', // material-web 的焦点环：secondary、3px
  '--dsh-button-outline-color': 'outlineVariant',
  // 代码注释：亮色用 on-surface-variant（outline 在 surface-container 上不到 4.5:1），暗色用 outline
  '--shiki-token-comment': { light: 'onSurfaceVariant', dark: 'outline' },
}
// 常用角色的短名，省 CSS 字数
const SHORT = { p: 'primary', op: 'onPrimary', pc: 'primaryContainer', opc: 'onPrimaryContainer', sc: 'secondaryContainer', osc: 'onSecondaryContainer', tc: 'tertiaryContainer', otc: 'onTertiaryContainer', low: 'surfaceContainerLow', mid: 'surfaceContainer', high: 'surfaceContainerHigh', top: 'surfaceContainerHighest', os: 'onSurface', osv: 'onSurfaceVariant', o: 'outline', ov: 'outlineVariant' }
for (const [k, r] of Object.entries(SHORT)) roles[`--m3-${k}`] = r
const material = { ...MATERIAL_BASE, roles }

// —— 覆盖项：颜色以外的（不占 CSS 的 8192 字） ——
const overrides = {
  '--m3-fs': same(FAST.fn),
  '--m3-fe': same(EFX.fn),
  '--m3-sh': same(layer('currentColor', HOVER)),
  // 常用过渡：形状走 fast-spatial 弹簧，颜色和阴影走 fast-effects 弹簧
  '--m3-t': same(`border-radius ${FAST.ms}ms var(--m3-fs),background-color ${EFX.ms}ms var(--m3-fe),color ${EFX.ms}ms var(--m3-fe),box-shadow ${EFX.ms}ms var(--m3-fe)`),
  // 字体：英文 Google Sans Flex、中文 Noto Sans SC、代码 Google Sans Code（都是 OFL 开源字体，需要本机装了；没装就落回宿主默认字体）
  '--dsh-font-family-text': same('"Google Sans Flex","Noto Sans SC"'),
  '--dsh-font-family-code': same('"Google Sans Code"'),
  // 正文标题用 M3 字阶：h1 = headline-small 24/32 400，h2 = title-large 22/28 400，h3 = title-medium 16/24 500
  '--dsw-font-markdown-h1': same('400 24px/32px var(--dsw-font-family)'),
  '--dsw-font-markdown-h2': same('400 22px/28px var(--dsw-font-family)'),
  '--dsw-font-markdown-h3': same('500 16px/24px var(--dsw-font-family)'),
  // 不要阴影：宿主自己的几级阴影也清掉，层次只靠底色深浅
  '--dsw-shadow-lv1': same('none'), '--dsw-shadow-lv1-blur': same('none'), '--dsw-shadow-lv2': same('none'), '--dsw-shadow-lv3': same('none'),
  '--dsw-focus-ring-width': same('3px'),
  // 宿主默认把所有圆角画成超椭圆（superellipse(1.5)，苹果那种方圆角）；Material 3 用正圆弧，全圆的药丸两头也要是半圆
  '--dsw-corner-shape': same('round'),
  '--m3-check': same(CHECK),
  '--m3-close': same(CLOSE),
}

// —— 图标：宿主雪碧图里的 symbol（16×16）→ 官方 Material Symbols 圆角（google/material-design-icons，Apache-2.0）——
// 用 CSS 的 d 属性直接换掉 symbol 里第一条路径，所有引用它的地方一起变。
// 路径从 960 网格缩到 96 网格取整（16px 显示时一格 1/6 像素，看不出差别）；棱镜 0.7 起单个变量最多 1024 字
Object.values(ICONS).forEach((name, i) => {
  const v = `path("${compress(iconPath(name), 96)}")`
  if (v.length > 1024) throw new Error(`图标 ${name} 太长：${v.length}`)
  overrides[`--i${i}`] = same(v)
})
// 按图标名匹配：名字两头带连字符（-like-outline- 不会碰到 dislike），两种粗细都换。
// 名字互相包含的（clock / alarm-clock、folder-open / folder-open-outline），在图标表里具体的写在后面，同优先级后写的赢
const ICON = (k) => `[id*=-${k}-]`

// —— 组件 ——
const c = (k) => `var(--m3-${k})`
const SH = 'var(--m3-sh)'
const T = 'var(--m3-t)'
// 圆角层级（同心：外层 20，嵌套一层减 4）。数值都在 M3 形状刻度里（md.sys.shape：4 / 12 / 16 / 20 / 28 / full）
// 28：最上层的大件（输入框、对话框）
// 20：外层容器（内容窗格、侧栏/设置分组、菜单、棱镜面板、消息气泡、新对话按钮）
// 16：嵌套一层的卡片（代码块、表格）和分组里选中的那一块
// 12：悬停时的形变
//  8：按钮按下时的形变（md.comp.button 的 pressed-container-shape）
//  4：分组内部相邻块之间的内角、行内代码、提示
// full：按钮、chip、分段按钮、开关、色块、圆形图标按钮
const RAD = { xl: 28, l: 20, m: 16, s: 12, xs: 4, full: 9999 }
const px = (k) => `${RAD[k]}px`
// 侧栏里的一块块（分段列表项）
const SEG = ':is([class*=_panelRow],[class*=_projectRow],[class*=_sessionRow],.prism-quick,:where([class*=_sidebarCol]) button[class*=_trigger])'
const SEG_ON = ':is([class*=_sessionRow][class*=_selected],[role=treeitem][aria-selected=true])'
const R = ':is([class$=_row],[class*="_row "])'
const ROW = `[role=dialog] ${R}`
const NAVC = '[class*=_navCell]'
const NAVC_ON = `:is(${NAVC}[class*=_active],${NAVC}[aria-current=true])`
const SW = '[role=switch][class*=_switch]'
const BTN = 'button[class*=_button_]'
const FAB = 'button[class*=_newSession]:not([class*=_collapsed] *)'

// 图标规则要放在最外层：<use> 的副本在影子树里，带 body 祖先的选择器匹配不到它
const top = [
  // 图标：只换映射到的 symbol；手机上的 Material Symbols 是实心填充
  // 宿主图标除了树形连接线全部换掉，所以统一处理，不再逐个列
  `symbol[id^=dsw-icon-]:not([id*=tree-corner]){&>*{display:none}&>path:first-of-type{display:inline;opacity:1;fill:currentColor;stroke:none;fill-rule:nonzero;transform:translate(0,16px) scale(.16667)}}`,
  // d 要直接写在路径上：<use> 的副本从 use 那一路继承变量，读不到 symbol 上设的
  ...Object.keys(ICONS).map((k, i) => `${ICON(k)}>path{d:var(--i${i})}`),
  // 缩放写在和上面统一规则同样优先级的选择器里（排在后面才能盖过它）
  ...Object.entries(VB).map(([k, vb]) => `symbol:not([id*=tree-corner])${ICON(k)}>path:first-of-type{transform:translate(0,${vb}px) scale(${+(vb / 96).toFixed(5)})}`),
]
const nest = [
  // 按压涟漪：从按下的位置扩散（棱镜在声明了 --prism-ripple 的元素上写 --prism-x/--prism-y；键盘触发没有坐标就从中心），
  // 圆的直径是元素宽的 3.2 倍，从任何角落出发都能盖满；按住时停在 pressed 10%，松手 300ms 淡出
  `:is(${SEG},${NAVC},button:is([class*=_newSession],[class*=_button_]),[data-composer-card] button,[role=menuitem],[role=option]){--prism-ripple:1;contain:paint;overflow:hidden;isolation:isolate;` +
    `&::before{content:"";position:absolute;z-index:-1;left:var(--prism-x,50%);top:var(--prism-y,50%);width:320%;aspect-ratio:1;margin:-160% 0 0 -160%;border-radius:50%;background:currentColor;opacity:0;transform:scale(0);transition:opacity .3s,transform 0s .3s;pointer-events:none}` +
    `&:active::before{opacity:.1;transform:none;transition:transform .4s cubic-bezier(.4,0,.2,1)}}`,
  // 窗格布局：窗口底色 + 圆角内容窗格（corner-large 16）
  `[class*=_frame]:has(>[class*=_sidebarCol]){background:${c('bg')}}`,
  `[data-platform=darwin] & [class*=_sidebarCol],[class*=_sidebarCol]{background:${c('bg')}!important;border-color:transparent}`,
  `[class*=_centerCol]{background:${c('pane')};border-radius:${px('l')};margin:8px 8px 8px 0}`,
  // 侧栏 = 安卓 16 设置页那样的分组列表：surfaceBright 色块、段间 2px、组的首尾圆角 20（容器裁出来）、中间 4；
  // 项 56 高、body-large 16；悬停变 12、按下变 16（md.comp.list 的 Expressive 形状），选中 secondary-container
  `[class*=_panelList]{border-radius:${px('l')};overflow:hidden}`,
  `[class*=_groupSection]{border-radius:${px('xs')};overflow:hidden;&+&{margin-top:2px}&:not([class*=_groupSection]+*){border-top-left-radius:${px('l')};border-top-right-radius:${px('l')}}&:not(:has(+[class*=_groupSection])){border-bottom-left-radius:${px('l')};border-bottom-right-radius:${px('l')}}}`,
  // 工作区列表是滚动容器，宿主给滚动条固定留了位置，里面的卡片会比上下两组窄：不留位置、不显示滚动条（安卓只在滚动时出指示条）
  `[class*=_sidebarCol] [class*=_list]{scrollbar-gutter:auto;scrollbar-width:none;&:has(>[class*=_groupSection]){padding-right:6px}}`,
  `${SEG}{min-height:48px;padding-inline:16px;border:0;gap:12px;background:${c('tile')};border-radius:4px;color:${c('os')};font-size:15px;font-weight:400;transition:${T};` +
    `&>:is(svg,[class*=_panelGlyph],[class*=_slot]){flex:none;width:20px;justify-content:center}&>[class*=_title]{margin-left:0}& svg{color:${c('osv')};width:20px;height:20px}&:hover{background:${SH} ${c('tile')};border-radius:${px('s')}}&:active{border-radius:${px('m')}}}`,
  `.prism-quick.prism-quick{width:100%;margin:0;border-radius:${px('l')}}:where([class*=_sidebarCol]) button[class*=_trigger]{border-radius:${px('l')}}`,
  `${SEG_ON}{&,&:hover{background:${c('sc')};color:${c('osc')};border-radius:${px('m')};font-weight:500}& svg{color:${c('osc')}}}`,
  // 分组标题：primary、14（SettingsLib 的 preferenceCategoryTitleTextColor）
  `[class*=_sectionLabel]{color:${c('p')};font-size:14px;font-weight:500}`,
  // 新建会话 = 扩展 FAB：56 高、corner-large 16、左 16 右 20、间距 12、primary-container、level 3（悬停 level 4）
  `${FAB}{container-type:normal;height:56px;width:auto;align-self:flex-start;padding:0 20px 0 16px;border:0;border-radius:${px('l')};background:${c('pc')};color:${c('opc')};box-shadow:none;font-size:14px;font-weight:500;letter-spacing:.1px;transition:${T};` +
    `&:hover{background:${SH} ${c('pc')}}& *{background:none!important}` +
    `& [class*=_newSessionLabelMask]{flex:none}& [class*=_newSessionContent]{width:auto;gap:12px}& [class*=_newSessionShortcut]{display:none}}`,
  // 顶栏标题：title-large 22/28
  `[class*=_crumbCurrent]{font-size:22px;line-height:28px;font-weight:400;max-width:min(560px,50vw)}`,
  // 宿主写死等宽字体的地方（工具名、卡片 id）也用 Google Sans Code；_cardId 要精确匹配，[class*=_cardId] 会连 _cardIdentity（名字那一行）一起改成等宽
  `:is([class*=_toolCallNameTypeface],[class$=_cardId],[class*="_cardId "]){font-family:var(--dsh-font-family-code)}`,
  // 文件图标块：宿主 10，归到 12
  `:is([class$=_tile],[class*="_tile "]){border-radius:${px('s')}}`,
  // 轨迹的类型标签：按 Material 的容器色配对（容器 / on-容器，对比度都在 7 以上）；工具保留宿主的琥珀色
  `[class*=_kindTag][data-role-kind]{border-radius:${px('xs')};&[data-role-kind=system]{background:${c('top')};color:${c('osv')}}&[data-role-kind=user]{background:${c('pc')};color:${c('opc')}}&[data-role-kind=context]{background:${c('sc')};color:${c('osc')}}&[data-role-kind=message]{background:${c('tc')};color:${c('otc')}}}`,
  // 主标签页：title-small，选中 primary，指示器 3px、上圆角 3
  `[role=tablist]{gap:0;border-radius:9999px;overflow:hidden;outline:1px solid ${c('o')}}`,
  // 顶栏下面不要分隔线（M3 顶部应用栏没有）
  `[class*=_header]:has([role=tablist]){border:0}`,
  `[role=tab]{height:32px;margin:0;padding:0 16px;display:flex;align-items:center;gap:8px;color:${c('os')};font-size:14px;font-weight:500;letter-spacing:.1px;transition:${T};` +
    `&+&{border-left:1px solid ${c('o')}}&::after{display:none}&:hover{background-image:${SH}}` +
    `&[aria-selected=true]{background-color:${c('sc')};color:${c('osc')};&::before{content:"";width:18px;height:18px;background:currentColor;mask:var(--m3-check) center/contain no-repeat}}}`,
  // 输入框 = 停靠式搜索视图（surface-container-high、28）；发送 = 实心图标按钮 40（按下变 8）；附件 = 标准图标按钮；选项 = 辅助 chip（32、8、1px outline-variant）
  `[data-composer-card=true]{background:${c('high')};border:0;box-shadow:none;border-radius:${px('xl')};outline:1px solid ${c('ov')};outline-offset:-1px;` +
    `& :is([class*=_primary],[class*=_add]){width:40px;height:40px;border-radius:${px('full')};transition:${T};&:active:not(:disabled){border-radius:8px}}` +
    `& [class*=_primary]{background:${c('p')};color:${c('op')};&:hover:not(:disabled){background-image:${SH}}&:disabled{background:${c('dis-bg')};color:${c('dis')}}}` +
    `& [class*=_add]{background:none;color:${c('osv')};&:hover{background:${c('hover')}}}` +
    `& button[class*=_trigger]{height:32px;border-radius:9999px;background:none;color:${c('os')};font-weight:500;letter-spacing:.1px;&:hover{background:${c('hover')}}}}`,
  // 按钮：corner-full，按下变 8；实心 primary，描边 1px outline-variant
  `${BTN}{border-radius:9999px;font-weight:500;letter-spacing:.1px;transition:${T};` +
    `&:active:not(:disabled){border-radius:8px}&:not(:empty){&[class*=_md_]{height:40px;padding:0 16px;font-size:14px}&[class*=_sm_]{height:32px;padding:0 12px;font-size:13px}&[aria-label]:has(>svg:only-child){width:32px;height:32px;padding:0}}` +
    `&[class*=_primary_]:hover:not(:disabled){background-image:${SH}}&[class*=_outline_]{color:${c('osv')}}}`,
  // 开关：轨道 52×32、2px 描边；手柄带图标时 24（打开是对勾、关上是叉，照 SettingsLib），按下 28；悬停一圈 40 的状态层
  `${SW}{width:52px;height:32px;padding:0;display:flex;align-items:center;border:2px solid ${c('o')};background:${c('top')};transition:${T},border-color ${EFX.ms}ms;` +
    `&>[class*=_thumb]{position:relative;width:24px;height:24px;margin-left:2px;transform:none;background:${c('o')};transition:all ${FAST.ms}ms var(--m3-fs)}` +
    `&>[class*=_thumb]::after{content:"";position:absolute;inset:4px;background:${c('top')};mask:var(--m3-close) center/contain no-repeat}` +
        `&[aria-checked=true]{background:${c('p')};border-color:${c('p')};&>[class*=_thumb]{transform:translate(20px);background:${c('op')}}&>[class*=_thumb]::after{background:${c('p')};mask-image:var(--m3-check)}}` +
    `&:hover>[class*=_thumb]{background:${c('osv')}}&[aria-checked=true]:hover>[class*=_thumb]{background:${c('pc')}}` +
    `&:active>[class*=_thumb]{width:28px;height:28px;margin-left:0}}`,
  // 菜单（Expressive 标准配色）：容器 corner-large 16、level 2；项 44 高、4，首尾和选中 12，选中 tertiary-container
  // 浮层（菜单、棱镜面板）：没有阴影，就用最高一级的底色加一条 outline-variant 细线和下面分开（输入框本身是 surface-container-high）
  `:is([role=menu],[role=listbox],.prism-panel){border-radius:${px('l')};padding:4px;background:${c('top')};box-shadow:none;border:0;outline:1px solid ${c('ov')};outline-offset:-1px}`,
  `:is([role=menuitem],[role=option]){min-height:44px;border-radius:4px;color:${c('os')};font-weight:500;letter-spacing:.1px;transition:${T};` +
    `&:first-child{border-radius:${px('m')} ${px('m')} ${px('xs')} ${px('xs')}}&:last-child{border-radius:${px('xs')} ${px('xs')} ${px('m')} ${px('m')}}&:is(:hover,:focus-visible){background:${c('hover')}}}`,
  `:is([role=option][aria-selected=true],[role=menuitemradio][aria-checked=true]){background:${c('sc')};color:${c('osc')};border-radius:${px('m')}}`,
  // 棱镜自己的面板：内边距照它原来的，里面的按钮和「跟随主题」改成全圆
  `.prism-panel{padding:12px;& :is(.prism-panel-actions button,.prism-chip){border-radius:${px('full')}}& .prism-chip{border:1px solid ${c('ov')};&[aria-pressed=true]{border-color:transparent;background:${c('sc')};color:${c('osc')}}}}`,
  // 设置对话框：corner-extra-large 28、level 3、底色 surfaceContainer；标题 headline-medium 28/36
  `[role=dialog][aria-modal]{border-radius:${px('xl')};background:${c('bg')};box-shadow:none;border:0;& [class*=_navTitle]{font-size:28px;line-height:36px;font-weight:400}}`,
  // 设置页左侧导航：药丸指示器 secondary-container、label-large，选中 700
  `${NAVC}{min-height:48px;border-radius:9999px;color:${c('osv')};font-weight:500;letter-spacing:.1px;transition:${T};&:hover{background:${SH};color:${c('os')}}}`,
  `${NAVC_ON}{&,&:hover{background:${c('sc')};color:${c('osc')};font-weight:700}}`,
  // 设置页的每一行 = SettingsLib 的圆角背景：surfaceBright、段间 2px、组首尾 20、中间 4
  // 连续的几行算一组：组里第一行上边 20、最后一行下边 20 并空出 16（settingslib_round_background_top/_bottom）
  `${ROW}{background:${c('tile')};border:0;border-radius:4px;padding:16px;margin-bottom:2px;` +
    `&:not(${R} + *){border-top-left-radius:${px('l')};border-top-right-radius:${px('l')}}&:not(:has(+ ${R})){border-bottom-left-radius:${px('l')};border-bottom-right-radius:${px('l')};margin-bottom:16px}}`,
  // 设置页里的下拉框和数字框：和其他按钮一样全圆
  `[role=dialog] :is([class*=_selector],[class*=_stepper]){border-radius:${px('full')}}`,
  `[role=dialog] [class*=_group]{border:0;&>[class*=_title]{color:${c('p')};font-size:14px;font-weight:500}}`,
  // 外观（亮/暗/跟随系统）三张卡片：和分组行同一写法，块间 2px，整排外角 20、内角 4，选中填 secondary-container
  `[class*=_cubeRow]{gap:2px;& [class*=_themeCube]{border:0;border-radius:${px('xs')};background:${c('tile')};&:first-child{border-radius:${px('l')} ${px('xs')} ${px('xs')} ${px('l')}}&:last-child{border-radius:${px('xs')} ${px('l')} ${px('l')} ${px('xs')}}&:hover{background:${SH} ${c('tile')}}&[class*=_selected]{background:${c('sc')};color:${c('osc')}}}}`,
  `button[class*=_toBottom]{width:40px;height:40px;border-radius:${px('full')};background:${c('top')};color:${c('osv')};box-shadow:none;outline:1px solid ${c('ov')};outline-offset:-1px;&:hover{background-image:${SH}}}`,
  // 用户消息：primary-container，发送方那个角 4
  `[data-message-bubble]{background:${c('pc')};color:${c('opc')};border-radius:${px('l')} ${px('l')} ${px('xs')} ${px('l')}}`,
  // 代码块 = 卡片 corner-medium 12；行内代码 corner-extra-small 4
  `.md-code-block{background:${c('mid')};border:0;border-radius:${px('m')};box-shadow:none}`,
  `[class*=_bannerWrap]{background:${c('mid')};border-radius:${px('m')} ${px('m')} 0 0}`,
  `:not(pre)>code{background:${c('high')};border:0;border-radius:${px('xs')};padding:.1em .35em}`,
  `[role=tooltip]{border-radius:${px('xs')}}`,
  `::selection{background:color-mix(in srgb,${c('p')} 30%,transparent)}`,
  // 表格 = 描边卡片：1px outline-variant、corner-medium 12
  `& table{border-collapse:separate;border-spacing:0;border-radius:${px('m')};overflow:hidden;box-shadow:inset 0 0 0 1px ${c('ov')}}`,
  `& th{background:${c('mid')}}`,
  `& :is(th,td){border-color:${c('ov')};&:first-child{padding-left:16px}&:last-child{padding-right:16px}}`,
  // 滚动条
  `::-webkit-scrollbar{width:8px;height:8px}`,
  `::-webkit-scrollbar-thumb{background:${c('ov')};border-radius:9999px;border:2px solid transparent;background-clip:padding-box}`,
]
const css = `${top.join('')}body:not(#_){${nest.join('')}}`

// —— 种子：让宿主没被覆盖到的地方也落在同一色相上 ——
// 种子：强调色就是 Material 的源色（用户在棱镜里换强调色 = 换源色）；其余参数让棱镜自己生成的部分落在同一色相上
const { normalizeMaterial } = await import(R0 + 'shared/material.js')
const S = materialRoles(ACCENT, normalizeMaterial(material))
const fitted = fitSeed({ base: S.surface.dark, accent: ACCENT, scheme: 'dark' })
const { seed, error } = { seed: { ...fitted.seed, accent: ACCENT }, error: fitted.error }
const file = { name: 'Material 3', seed, radius: 1, overrides, material, css }
const text = share.serializeTheme(file)
const parsed = share.parseThemeFile(JSON.parse(text))
const check = state.checkCss(css)
const lost = Object.keys(overrides).filter((k) => !(parsed.ok && parsed.file?.overrides?.[k]))
console.log('弹簧', `fast-spatial ${FAST.ms}ms`, `fast-effects ${EFX.ms}ms`, '| 种子误差', error.toFixed(4))
console.log('CSS', css.length, '/', state.CSS_MAX_LENGTH, '，检查', check.ok ? '通过' : JSON.stringify(check), '| 覆盖项', Object.keys(overrides).length, lost.length ? `（被丢掉：${lost.join(' ')}）` : '')
console.log('导入校验', parsed.ok ? '通过' : JSON.stringify(parsed))
const out = process.argv[2] ?? fileURLToPath(new URL('../material-3.json', import.meta.url))
fs.writeFileSync(out, `${text}\n`)
console.log('写入', out)
