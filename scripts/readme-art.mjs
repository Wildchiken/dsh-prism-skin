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
    title: ['棱镜', 'Prism'],
    line1: 'DeepSeek Harness 换肤插件',
    line2: '一组种子生成整套亮暗配色，文字对比度自动达标',
    chips: ['10 套主题', '壁纸与玻璃', '我的主题', '每一步可撤销'],
    name: (theme) => theme.name.zh,
  },
  en: {
    title: ['Prism', '棱镜'],
    line1: 'A theme plugin for DeepSeek Harness',
    line2: 'A few seeds, a full light and dark palette, contrast checked',
    chips: ['10 themes', 'Wallpaper & glass', 'My themes', 'Undo everything'],
    name: (theme) => theme.name.en,
  },
}

/** 横幅：一束白光射进棱镜，散成十套主题的强调色。 */
function banner(copy) {
  const W = 1280
  const H = 360
  const prism = { top: [880, 92], left: [784, 262], right: [976, 262] }
  const entry = [826, 182]
  const exit = [934, 182]
  const accents = THEMES.map((theme) => theme.seed.accent)
  const defs = []
  const rays = []
  accents.forEach((color, i) => {
    const t = i / (accents.length - 1)
    const angle = (-24 + 48 * t) * (Math.PI / 180)
    const reach = W + 40 - exit[0]
    const y = exit[1] + Math.tan(angle) * reach
    const half = 7 + Math.abs(t - 0.5) * 6
    defs.push(`<linearGradient id="r${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset=".75" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`)
    rays.push(`<polygon points="${exit[0]},${exit[1] - 1.5} ${exit[0]},${exit[1] + 1.5} ${W + 40},${(y + half).toFixed(1)} ${W + 40},${(y - half).toFixed(1)}" fill="url(#r${i})"/>`)
  })
  let x = 88
  const chips = copy.chips.map((label) => {
    const w = Math.round(textWidth(label, 15) + 28)
    const out = `<g transform="translate(${x} 278)"><rect width="${w}" height="32" rx="16" fill="#ffffff" fill-opacity=".07" stroke="#ffffff" stroke-opacity=".16"/><text x="${w / 2}" y="21" text-anchor="middle" font-size="15" fill="#ffffff" fill-opacity=".86">${esc(label)}</text></g>`
    x += w + 10
    return out
  })
  const [main, side] = copy.title
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0c1020"/><stop offset=".55" stop-color="#141228"/><stop offset="1" stop-color="#1d1433"/></linearGradient>
<linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity=".95"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".16"/><stop offset="1" stop-color="#ffffff" stop-opacity=".04"/></linearGradient>
<radialGradient id="halo" cx=".7" cy=".5" r=".45"><stop offset="0" stop-color="#7b5ce0" stop-opacity=".22"/><stop offset="1" stop-color="#7b5ce0" stop-opacity="0"/></radialGradient>
<filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
<clipPath id="card"><rect width="${W}" height="${H}" rx="24"/></clipPath>
${defs.join('\n')}
</defs>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#halo)"/>
<g filter="url(#blur)" opacity=".75">${rays.join('')}</g>
<g>${rays.join('')}</g>
<polygon points="600,214 600,220 ${entry[0]},${entry[1] + 2} ${entry[0]},${entry[1] - 2}" fill="url(#beam)"/>
<polygon points="${prism.top} ${prism.right} ${prism.left}" fill="url(#glass)" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.5" stroke-linejoin="round"/>
<polyline points="${prism.top[0]},${prism.top[1] + 22} ${prism.left[0] + 24},${prism.left[1] - 10}" fill="none" stroke="#ffffff" stroke-opacity=".25" stroke-width="1"/>
<text x="88" y="148" fill="#ffffff"><tspan font-size="76" font-weight="700">${esc(main)}</tspan><tspan dx="18" font-size="42" font-weight="300" fill-opacity=".62">${esc(side)}</tspan></text>
<text x="90" y="198" font-size="26" fill="#ffffff" fill-opacity=".9">${esc(copy.line1)}</text>
<text x="90" y="238" font-size="19" fill="#ffffff" fill-opacity=".58">${esc(copy.line2)}</text>
${chips.join('\n')}
</g>
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
