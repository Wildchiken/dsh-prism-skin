#!/usr/bin/env node
/**
 * README 用的配图：横幅和十套主题一览，全部用引擎现算的颜色画成 SVG（不是截图）。
 *
 * 用法：node scripts/readme-art.mjs   → docs/assets/banner(.en).svg、themes(.en).svg
 *
 * 主题算法改了、加了新主题，重跑一遍就行。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate, THEMES } from '../src/engine/index.js'
import { ROOT } from './lib/host.mjs'

const OUT = join(ROOT, 'docs/assets')
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif`
const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 粗估文字宽度：汉字按 1 个字号，其余按 0.56 个字号。 */
const textWidth = (text, size) => [...text].reduce((sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.56), 0)

const COPY = {
  zh: {
    eyebrow: 'DEEPSEEK HARNESS  ·  换肤插件',
    title: ['棱镜', 'Prism'],
    line1: '一组种子，生成整套亮暗配色',
    line2: '文字对比度自动达标  ·  首屏不闪  ·  每一步可撤销',
    chips: [['10 套主题', 'mist'], ['壁纸与玻璃', 'seasalt'], ['我的主题', 'sakura'], ['示例：赛博朋克 HUD', 'ember']],
    name: (theme) => theme.name.zh,
  },
  en: {
    eyebrow: 'DEEPSEEK HARNESS  ·  THEME PLUGIN',
    title: ['Prism', '棱镜'],
    line1: 'A few seeds, a complete light and dark palette',
    line2: 'Contrast checked  ·  No flash on load  ·  Undo everything',
    chips: [['10 themes', 'mist'], ['Wallpaper & glass', 'seasalt'], ['My themes', 'sakura'], ['Example: Cyberpunk HUD', 'ember']],
    name: (theme) => theme.name.en,
  },
}

/** #rrggbb → 色相（度），用来把十套主题的强调色排成连续光谱。 */
function hueOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** 横幅：一束白光射进玻璃棱镜，散成由十套主题强调色排成的光谱。 */
function banner(copy) {
  const W = 1280
  const H = 400
  const top = [918, 74]
  const left = [796, 300]
  const right = [1040, 300]
  const entry = [850, 196]
  const exit = [986, 196]
  // 按色相排，冷色在上、暖色在下，像真的色散
  const spectrum = THEMES.map((theme) => theme.seed.accent).sort((a, b) => ((hueOf(b) + 60) % 360) - ((hueOf(a) + 60) % 360))
  const defs = []
  const wedges = []
  const cores = []
  const spread = 40
  const reach = W + 60
  spectrum.forEach((color, i) => {
    const a0 = (-spread / 2 + (spread * i) / spectrum.length) * (Math.PI / 180)
    const a1 = (-spread / 2 + (spread * (i + 1)) / spectrum.length) * (Math.PI / 180)
    const am = (a0 + a1) / 2
    const y = (angle) => (exit[1] + Math.tan(angle) * (reach - exit[0])).toFixed(1)
    defs.push(`<linearGradient id="w${i}" x1="${exit[0]}" y1="0" x2="${reach}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset=".45" stop-color="${color}" stop-opacity=".55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`)
    wedges.push(`<polygon points="${exit[0]},${exit[1]} ${reach},${y(a0 - 0.002)} ${reach},${y(a1 + 0.002)}" fill="url(#w${i})"/>`)
    cores.push(`<line x1="${exit[0]}" y1="${exit[1]}" x2="${reach}" y2="${y(am)}" stroke="${color}" stroke-width="1.2" stroke-opacity=".9"/>`)
  })
  let x = 92
  const accent = (id) => THEMES.find((theme) => theme.id === id).seed.accent
  const chips = copy.chips.map(([label, id]) => {
    const w = Math.round(textWidth(label, 14) + 44)
    const out = `<g transform="translate(${x} 318)"><rect width="${w}" height="32" rx="16" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".13"/><circle cx="16" cy="16" r="4" fill="${accent(id)}"/><circle cx="16" cy="16" r="7" fill="${accent(id)}" fill-opacity=".22"/><text x="29" y="21" font-size="14" fill="#ffffff" fill-opacity=".84">${esc(label)}</text></g>`
    x += w + 10
    return out
  })
  const [main, side] = copy.title
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<defs>
<radialGradient id="bg" cx=".72" cy=".42" r=".95"><stop offset="0" stop-color="#191632"/><stop offset=".55" stop-color="#0d0d1c"/><stop offset="1" stop-color="#06070d"/></radialGradient>
<radialGradient id="g1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(960 150) scale(470 300)"><stop offset="0" stop-color="#7b5ce0" stop-opacity=".32"/><stop offset="1" stop-color="#7b5ce0" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1180 380) scale(380 220)"><stop offset="0" stop-color="#22a7c9" stop-opacity=".16"/><stop offset="1" stop-color="#22a7c9" stop-opacity="0"/></radialGradient>
<radialGradient id="g3" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(140 420) scale(420 260)"><stop offset="0" stop-color="#d6557f" stop-opacity=".12"/><stop offset="1" stop-color="#d6557f" stop-opacity="0"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
<linearGradient id="title" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfc7ff"/></linearGradient>
<linearGradient id="beam" x1="640" y1="0" x2="${entry[0]}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".7" stop-color="#ffffff" stop-opacity=".75"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
<linearGradient id="inner" x1="${entry[0]}" y1="0" x2="${exit[0]}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset="1" stop-color="#e9e3ff" stop-opacity=".95"/></linearGradient>
<linearGradient id="glass" x1="0" y1="${top[1]}" x2="0" y2="${left[1]}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity=".2"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".07"/><stop offset="1" stop-color="#ffffff" stop-opacity=".03"/></linearGradient>
<linearGradient id="edge" x1="0" y1="${top[1]}" x2="0" y2="${left[1]}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset="1" stop-color="#ffffff" stop-opacity=".28"/></linearGradient>
<radialGradient id="bloom" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${exit[0]} ${exit[1]}) scale(38)"><stop offset="0" stop-color="#ffffff" stop-opacity=".42"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="haze" x="-5%" y="-50%" width="110%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .055 0"/></filter>
<clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>
${defs.join('\n')}
</defs>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#g1)"/>
<rect width="${W}" height="${H}" fill="url(#g2)"/>
<rect width="${W}" height="${H}" fill="url(#g3)"/>
<g filter="url(#soft)" opacity=".9">${wedges.join('')}</g>
<g filter="url(#haze)" opacity=".85">${wedges.join('')}</g>
<g opacity=".55">${cores.join('')}</g>
<polygon points="640,${entry[1] + 20} 640,${entry[1] + 27} ${entry[0]},${entry[1] + 2} ${entry[0]},${entry[1] - 2}" fill="#ffffff" opacity=".35" filter="url(#haze)"/>
<polygon points="640,${entry[1] + 22} 640,${entry[1] + 25} ${entry[0]},${entry[1] + 1} ${entry[0]},${entry[1] - 1}" fill="url(#beam)"/>
<polygon points="${top} ${right} ${left}" fill="url(#glass)"/>
<polygon points="${entry[0]},${entry[1] - 2} ${exit[0]},${exit[1] - 5} ${exit[0]},${exit[1] + 5} ${entry[0]},${entry[1] + 2}" fill="url(#inner)" opacity=".55"/>
<polygon points="${top} ${right} ${left}" fill="none" stroke="url(#edge)" stroke-width="1.6" stroke-linejoin="round"/>
<line x1="${top[0] - 6}" y1="${top[1] + 24}" x2="${left[0] + 30}" y2="${left[1] - 14}" stroke="#ffffff" stroke-opacity=".35" stroke-width="1"/>
<line x1="${top[0] + 10}" y1="${top[1] + 40}" x2="${right[0] - 36}" y2="${right[1] - 20}" stroke="#ffffff" stroke-opacity=".12" stroke-width="1"/>
<rect x="${exit[0] - 38}" y="${exit[1] - 38}" width="76" height="76" fill="url(#bloom)"/>
<rect width="${W}" height="${H}" filter="url(#grain)"/>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<text x="94" y="112" font-size="13" letter-spacing="3.2" fill="#ffffff" fill-opacity=".5">${esc(copy.eyebrow)}</text>
<text x="90" y="200" fill="url(#title)"><tspan font-size="88" font-weight="800" letter-spacing="2">${esc(main)}</tspan><tspan dx="22" font-size="44" font-weight="300" fill="#ffffff" fill-opacity=".5" letter-spacing="1">${esc(side)}</tspan></text>
<text x="93" y="250" font-size="24" fill="#ffffff" fill-opacity=".92">${esc(copy.line1)}</text>
<text x="93" y="284" font-size="16" fill="#ffffff" fill-opacity=".5" letter-spacing=".3">${esc(copy.line2)}</text>
${chips.join('\n')}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="23.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
</svg>
`
}

/** 一张迷你界面：侧栏、气泡、几行字、代码块、发送按钮。 */
function miniUi(tokens, mode, w, h) {
  const c = (name) => tokens[`--dsw-${name}`][mode]
  const side = Math.round(w * 0.27)
  return [
    `<rect width="${w}" height="${h}" fill="${c('alias-bg-base')}"/>`,
    `<rect width="${side}" height="${h}" fill="${c('specific-sidebar-fill')}"/>`,
    `<rect x="10" y="18" width="${side - 20}" height="9" rx="4" fill="${c('specific-sidebar-nav-item-active')}"/>`,
    `<rect x="10" y="38" width="${side - 26}" height="5" rx="2.5" fill="${c('alias-border-l4')}"/>`,
    `<rect x="10" y="52" width="${side - 32}" height="5" rx="2.5" fill="${c('alias-border-l4')}"/>`,
    `<rect x="${w - 112}" y="16" width="96" height="22" rx="9" fill="${c('specific-bubble')}"/>`,
    `<rect x="${side + 16}" y="54" width="${w - side - 40}" height="6" rx="3" fill="${c('alias-label-primary')}"/>`,
    `<rect x="${side + 16}" y="68" width="${Math.round((w - side) * 0.55)}" height="6" rx="3" fill="${c('alias-label-tertiary')}"/>`,
    `<rect x="${side + 16}" y="82" width="${Math.round((w - side) * 0.68)}" height="6" rx="3" fill="${c('alias-label-tertiary')}"/>`,
    `<rect x="${side + 16}" y="98" width="${w - side - 32}" height="26" rx="6" fill="${c('specific-bubble')}"/>`,
    `<circle cx="${w - 22}" cy="${h - 16}" r="8" fill="${c('alias-button-primary-fill')}"/>`,
  ].join('')
}

/** 十套主题一览：每张卡沿斜线一半亮色、一半暗色。 */
function gallery(copy) {
  const cols = 5
  const w = 232
  const h = 150
  const gapX = 30
  const rowH = h + 46
  const rows = Math.ceil(THEMES.length / cols)
  const W = cols * w + (cols - 1) * gapX
  const H = rows * rowH - 16
  const cards = THEMES.map((theme, i) => {
    const tokens = generate(theme.seed)
    const x = (i % cols) * (w + gapX)
    const y = Math.floor(i / cols) * rowH
    const id = `c${i}`
    return `<g transform="translate(${x} ${y})">
<clipPath id="${id}"><rect width="${w}" height="${h}" rx="14"/></clipPath>
<clipPath id="${id}d"><polygon points="${Math.round(w * 0.62)},0 ${w},0 ${w},${h} ${Math.round(w * 0.36)},${h}"/></clipPath>
<g clip-path="url(#${id})">${miniUi(tokens, 'light', w, h)}<g clip-path="url(#${id}d)">${miniUi(tokens, 'dark', w, h)}</g></g>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="13.5" fill="none" stroke="#8a8f98" stroke-opacity=".35"/>
<circle cx="8" cy="${h + 23}" r="5" fill="${theme.seed.accent}"/>
<text x="20" y="${h + 28}" font-size="16" fill="#8a8f98">${esc(copy.name(theme))}</text>
</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
${cards.join('\n')}
</svg>
`
}

mkdirSync(OUT, { recursive: true })
for (const [lang, copy] of Object.entries(COPY)) {
  const suffix = lang === 'zh' ? '' : '.en'
  writeFileSync(join(OUT, `banner${suffix}.svg`), banner(copy))
  writeFileSync(join(OUT, `themes${suffix}.svg`), gallery(copy))
}
console.log('已生成 docs/assets/banner(.en).svg、themes(.en).svg')
