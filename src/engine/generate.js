/**
 * 配色引擎：种子 → 宿主全部颜色变量（亮暗各一份）。
 *
 * 做法是沿用宿主自己的设计意图，只换色：
 *   1. 按宿主色阶的明度阶梯，用种子的色相和彩度重新生成整套静态色；
 *   2. 用宿主的公式（`$static-…`、`color-mix(…)`）算出全部语义变量；
 *   3. 关键变量（强调色、主按钮、气泡、代码高亮……）走专门的配方；
 *   4. 对比度求解：文字色只动明度，直到它在所有会落到的背景上都达标。
 */
import { clamp, fromOklch, mixSrgb, over, parseHex, toHex, toOklch, withAlpha } from './color.js'
import { codeColor } from './code.js'
import { apca, wcag } from './contrast.js'
import { HOST_TOKEN_TABLE } from './host-tokens.js'
import { BASE_SEED } from './themes.js'

/** @typedef {import('./color.js').Rgba} Rgba */
/** @typedef {import('../shared/state.js').Seed} Seed */
/** @typedef {'light' | 'dark'} Mode */
/** @typedef {Record<string, {light: string, dark: string}>} TokenLayer */

/** @type {Map<string, {light: string, dark: string}>} */
const TABLE = new Map(
  HOST_TOKEN_TABLE.split('\n').map((line) => {
    const eq = line.indexOf('=')
    const [light, dark] = line.slice(eq + 1).split('|')
    return [line.slice(0, eq), { light, dark: dark ?? light }]
  }),
)

const WHITE = /** @type {Rgba} */ ({ r: 1, g: 1, b: 1, a: 1 })
const BLACK = /** @type {Rgba} */ ({ r: 0, g: 0, b: 0, a: 1 })
const CLEAR = /** @type {Rgba} */ ({ r: 0, g: 0, b: 0, a: 0 })

/** 暗色表面的明度上限：再亮的话白字也到不了 7:1。 */
const DARK_SURFACE_MAX = 0.44

const hueDelta = (from, to) => ((to - from + 540) % 360) - 180
const rotateToward = (hue, target, amount, limit) => (hue + clamp(hueDelta(hue, target) * amount, -limit, limit) + 360) % 360

/**
 * 文字可读性约束：前景、最低 WCAG、最低 APCA、会落到的背景。
 * 背景写成 `a/b` 表示 a（半透明）叠在 b 上。
 */
const MAIN = ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2', 'alias-bg-layer-3', 'alias-bg-module-platform', 'specific-sidebar-fill', 'specific-input-major', 'alias-markdown-code-block']
const HOVER = ['alias-interactive-bg-hover/alias-bg-base', 'alias-interactive-bg-hover/specific-sidebar-fill', 'alias-interactive-bg-active/alias-bg-base', 'alias-interactive-bg-hover/alias-bg-layer-1']
const MENU = ['specific-menu/alias-bg-base', 'specific-menu/alias-bg-layer-2']

/** @type {([string, number, number, string[]] | [string, number, number, string[], 'hover'])[]} */
export const LEGIBILITY = [
  ['alias-label-primary', 7, 75, [...MAIN, ...MENU, 'specific-bubble', 'specific-bubble-highlight', 'specific-tip', 'specific-selector', 'alias-button-floating-fill', 'alias-button-elevated-fill', 'alias-interactive-bg-hover-solid', 'alias-markdown-inline-code', 'alias-markdown-tag', 'alias-file-diff-added-bg', 'alias-file-diff-deleted-bg', 'alias-code-diff-added/alias-markdown-code-block', 'alias-code-diff-deleted/alias-markdown-code-block', 'specific-sidebar-nav-item-active', 'specific-sidebar-nav-item-active-accent']],
  ['alias-label-primary', 4.5, 60, ['alias-bg-overlay']],
  ['alias-label-secondary', 4.5, 60, [...MAIN, ...MENU, 'alias-state-warn-tertiary', 'specific-sidebar-nav-item-active']],
  ['alias-label-tertiary', 4.5, 50, [...MAIN, ...MENU, 'alias-button-ghost-active-fill']],
  ['alias-label-caption', 3, 38, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2', 'alias-bg-module-platform', 'alias-markdown-code-block-banner', 'specific-sidebar-fill']],
  ['alias-label-primary-foreground', 4.5, 60, ['alias-button-primary-fill', 'alias-button-primary-hover']],
  ['alias-label-primary-inverted', 4.5, 60, ['alias-button-contrast-fill']],
  ['alias-label-primary-bluish', 4.5, 60, ['alias-state-business-tertiary']],
  ['alias-label-primary-dimmed', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'specific-menu/alias-bg-base']],
  ['alias-menu-icon', 4.5, 55, ['specific-menu/alias-bg-base', 'specific-menu/alias-bg-layer-2', 'alias-bg-layer-2']],
  ['alias-label-document-preview', 4.5, 60, ['alias-bg-document-preview']],
  ['alias-link', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2', 'alias-markdown-code-block', 'specific-bubble']],
  ['alias-brand-primary', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2']],
  ['alias-brand-primary-new-colorprimary-new-color', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2']],
  ['alias-button-info-fill', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'specific-sidebar-nav-item-active-accent']],
  ['alias-state-business-primary', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-layer-2', 'alias-state-business-tertiary']],
  ['alias-state-error-primary', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-code-diff-deleted/alias-markdown-code-block']],
  ['alias-state-success-primary', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-state-success-tertiary', 'alias-code-diff-added/alias-markdown-code-block']],
  ['alias-state-warn-label', 4.5, 60, ['alias-bg-base', 'alias-bg-layer-1', 'alias-bg-module-platform', 'alias-state-warn-tertiary']],
  ['alias-state-warn-primary', 3, 45, ['alias-bg-base', 'alias-bg-layer-1', 'alias-state-warn-tertiary']],
  ['alias-state-done-primary', 3, 45, ['alias-bg-base', 'alias-bg-layer-1']],
  ['alias-toast-label', 4.5, 60, ['alias-toast-bg']],
  ['alias-file-diff-added-marker', 3, 40, ['alias-file-diff-added-gutter', 'alias-file-diff-added-bg']],
  ['alias-file-diff-deleted-marker', 3, 40, ['alias-file-diff-deleted-gutter', 'alias-file-diff-deleted-bg']],
  ['--shiki-token-keyword', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-function', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-constant', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-string', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-string-expression', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-parameter', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-link', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-punctuation', 4.5, 55, ['alias-markdown-code-block']],
  ['--shiki-token-comment', 3.2, 42, ['alias-markdown-code-block']],
  // 悬停、按下状态：文字一律 4.5，APCA 按各自普通字号的标准。
  // 求解时先把悬停背景调淡来满足，调到下限还不够才动文字（见 Palette.solve）
  ['alias-label-primary', 4.5, 60, HOVER, 'hover'],
  ['alias-label-secondary', 4.5, 60, HOVER, 'hover'],
  ['alias-label-tertiary', 4.5, 50, HOVER, 'hover'],
  ['alias-label-caption', 4.5, 60, ['alias-interactive-bg-hover/alias-bg-base'], 'hover'],
  ['alias-state-business-primary', 4.5, 60, ['alias-interactive-bg-hover/alias-bg-base'], 'hover'],
  ['alias-state-error-primary', 4.5, 60, ['alias-interactive-bg-hover-danger/alias-bg-base'], 'hover'],
]

/** 悬停、按下的半透明背景。达不到对比度时按比例调淡，最淡调到原来的 60%（再淡就看不出悬停了），还不够再微调文字。 */
const HOVER_OVERLAYS = ['alias-interactive-bg-hover', 'alias-interactive-bg-active', 'alias-interactive-bg-hover-danger']
const HOVER_MIN_FACTOR = 0.6

/**
 * 玻璃表面。root 直接盖在壁纸上；on 表示盖在哪个表面上。
 * k 是玻璃感拉满时能透出去的比例：alpha = 1 - k * 玻璃感。
 * root 输出成「视口固定的合成背景」：看上去半透明，实际不透明，
 * 所以多层嵌套不会叠出色带，粘性元素也能挡住下面滚动的内容。
 * 其余的是普通半透明颜色，它们只会出现在合成背景上面。
 * 菜单、弹窗（layer-2）、提示框、代码块保持不透明：它们浮在界面内容上，透了就看不清。
 */
const GLASS = {
  'alias-bg-base': { root: true, k: 0.76 },
  'specific-sidebar-fill': { root: true, k: 0.6 },
  // 输入框卡片在滚动容器里：用固定背景的话 Chrome 每次滚动都要重画它和整个文档层（实测重绘 127 次/秒）。
  // 所以它是不透明的纯色：底色叠在「卡片所在位置的壁纸颜色」上，看上去和合成背景几乎一样。
  'specific-input-major': { on: 'alias-bg-base', flat: true, k: 0.6 },
  'alias-bg-layer-1': { on: 'alias-bg-base', k: 0.5 },
  'specific-bubble': { on: 'alias-bg-base', k: 0.5 },
  'specific-bubble-highlight': { on: 'alias-bg-base', k: 0.4 },
  'specific-sidebar-nav-item-active': { on: 'specific-sidebar-fill', k: 0.45 },
}

/** 同一个变量的约束放在一起，按 LEGIBILITY 里第一次出现的顺序求解。 */
const LEGIBILITY_BY_TOKEN = (() => {
  /** @type {Map<string, (typeof LEGIBILITY)[number][]>} */
  const groups = new Map()
  for (const row of LEGIBILITY) {
    const list = groups.get(row[0]) ?? []
    list.push(row)
    groups.set(row[0], list)
  }
  return groups
})()

/** 求解时多留一点余量，防止取整后掉到门槛下面。 */
const MARGIN_WCAG = 1.015
const MARGIN_APCA = 0.8

const opaqueOn = (color, back) => (color.a >= 1 ? color : over(color, back))

/**
 * @typedef {{backs: Rgba[], minWcag: number, minApca: number}} Constraint 一组背景和门槛
 */

/** @returns {boolean} 前景在每组约束的所有背景上是否都达标（含余量） */
function passes(color, constraints) {
  return constraints.every(({ backs, minWcag, minApca }) =>
    backs.every((back) => {
      const front = opaqueOn(color, back)
      return wcag(front, back) >= minWcag * MARGIN_WCAG && apca(front, back) >= minApca + MARGIN_APCA
    }),
  )
}

/** @returns {number} 最差一对相对门槛的比例，越大越好 */
function worstScore(color, constraints) {
  let worst = Infinity
  for (const { backs, minWcag, minApca } of constraints) {
    for (const back of backs) {
      const front = opaqueOn(color, back)
      worst = Math.min(worst, wcag(front, back) / minWcag, apca(front, back) / minApca)
    }
  }
  return worst
}

/**
 * 只动明度，找离起点最近、同时满足全部约束的颜色；哪个方向都达不到时返回最接近的。
 * @param {Rgba} start 起点
 * @param {Constraint[]} constraints 约束
 * @returns {Rgba} 求解结果
 */
function searchLightness(start, constraints) {
  const k = toOklch(start)
  const all = constraints.flatMap((constraint) => constraint.backs)
  const average = all.reduce((sum, back) => sum + toOklch(back).l, 0) / all.length
  const first = average >= 0.5 ? -1 : 1
  let best = start
  let bestScore = worstScore(start, constraints)
  for (const direction of [first, -first]) {
    const at = (move) => fromOklch(k.l + direction * move, k.c, k.h, start.a)
    const limit = direction < 0 ? k.l : 1 - k.l
    if (passes(at(limit), constraints)) {
      let lo = 0
      let hi = limit
      for (let i = 0; i < 9; i += 1) {
        const mid = (lo + hi) / 2
        if (passes(at(mid), constraints)) hi = mid
        else lo = mid
      }
      return at(hi)
    }
    for (let move = limit / 8; move <= limit + 1e-6; move += limit / 8) {
      const candidate = at(move)
      const score = worstScore(candidate, constraints)
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
  }
  return best
}

/** 背景去重，亮色模式下好几层表面常常是同一个颜色。 */
function uniqueColors(colors) {
  const seen = new Map()
  for (const color of colors) seen.set(`${color.r},${color.g},${color.b}`, color)
  return [...seen.values()]
}

/**
 * 补全种子。
 * @param {Partial<Seed>} [partial] 部分种子
 * @returns {Seed} 完整种子
 */
export function completeSeed(partial) {
  return { ...BASE_SEED, ...partial }
}

/** 一种明暗模式下的生成过程。 */
class Palette {
  /**
   * @param {Seed} seed 完整种子
   * @param {Mode} mode 明暗
   * @param {GlassModel | null} [glass] 玻璃参数
   */
  constructor(seed, mode, glass = null) {
    this.glass = glass !== null && glass.level > 0 ? glass : null
    this.seed = seed
    this.mode = mode
    this.dark = mode === 'dark'
    const accent = toOklch(parseHex(seed.accent))
    this.accent = { l: accent.l, c: accent.c * seed.chroma, h: accent.h }
    /** @type {Map<string, Rgba>} 求解后的固定值 */
    this.fixed = new Map()
    /** @type {Map<string, Rgba | string>} */
    this.memo = new Map()
    /** @type {Map<string, Rgba>} 静态色只依赖种子，不随求解变化 */
    this.statics = new Map()
    this.resolving = new Set()
  }

  /** 宿主色阶某一档的明度 → 这个主题里的明度。 */
  neutralL(hostL) {
    const { contrast, depth, neutral } = this.seed
    const up = Math.max(contrast, 0)
    const down = Math.max(-contrast, 0)
    if (this.dark) {
      const spread = 1 + 0.22 * up - 0.12 * down + 0.08 * neutral
      const canvas = 0.197 + 0.05 * depth + 0.01 * neutral
      const surface = clamp(canvas + (hostL - 0.197) * spread, 0.1, DARK_SURFACE_MAX)
      const ink = clamp(hostL + 0.012 + 0.03 * contrast, 0, 1)
      return hostL <= 0.42 ? surface : hostL >= 0.62 ? ink : surface + ((hostL - 0.42) / 0.2) * (ink - surface)
    }
    const spread = 1.12 + 0.3 * up - 0.12 * down + 0.15 * neutral
    const paper = clamp(0.004 + 0.012 * neutral - 0.03 * depth, 0, 0.06)
    const surface = clamp(1 - paper - (1 - hostL) * spread, 0.5, 1)
    const ink = clamp(hostL - 0.015 - 0.035 * contrast, 0.08, 1)
    return hostL >= 0.86 ? surface : hostL <= 0.72 ? ink : ink + ((hostL - 0.72) / 0.14) * (surface - ink)
  }

  /** 中性色：宿主明度 + 种子色相和染色强度。 */
  neutralColor(hostL, strength = 1, alpha = 1) {
    const { neutral, hue } = this.seed
    const l = this.neutralL(hostL)
    const surfaceC = this.dark ? 0.036 : 0.026
    const inkC = this.dark ? 0.022 : 0.036
    const surfaceBand = this.dark ? hostL <= 0.42 : hostL >= 0.86
    const c = neutral * strength * (surfaceBand ? surfaceC : inkC)
    return fromOklch(l, c, hue, alpha)
  }

  /** 强调色阶的一档。 */
  accentStep(hostL, relative, alpha = 1) {
    const { l, c, h } = this.accent
    const weight = clamp(1 - Math.abs(hostL - 0.6) / 0.42, 0, 1)
    return fromOklch(hostL + (l - 0.6) * 0.65 * weight, c * relative, h, alpha)
  }

  /** 状态色：保留语义色相，向主题色相轻微靠拢。 */
  stateColor(k, alpha = 1) {
    const hue = rotateToward(k.h, this.seed.hue, 0.1, 10)
    return fromOklch(k.l, k.c * (0.55 + 0.4 * this.seed.chroma), hue, alpha)
  }

  /** 静态色：按家族重新生成。 */
  staticColor(name, literal) {
    const parsed = parseHex(literal)
    const k = toOklch(parsed)
    const family = /^static-([a-z]+(?:-bluish)?)-/.exec(name)?.[1]
    switch (family) {
      case 'neutral-bluish':
        return this.neutralColor(k.l, 1, parsed.a)
      case 'neutral':
        return this.neutralColor(k.l, 0.55, parsed.a)
      case 'deepseek':
        return this.accentStep(k.l, k.c / 0.186, parsed.a)
      case 'blue':
        return this.accentStep(k.l, k.c / 0.215, parsed.a)
      default:
        return this.stateColor(k, parsed.a)
    }
  }

  /** 公式里直接写死的颜色：透明黑白换成带主题色的墨，彩色转到主题的色相上。 */
  literal(hex, name) {
    const parsed = parseHex(hex)
    if (parsed === undefined) throw new Error(`无法解析颜色 ${hex}（${name}）`)
    const k = toOklch(parsed)
    if (name.includes('-diff-')) return this.stateColor(k, parsed.a)
    if (k.c < 0.03) {
      if (parsed.a < 1 && k.l < 0.6) {
        const boost = 1 + 0.45 * this.seed.contrast
        const isMask = name.includes('-mask-')
        return fromOklch(0.16 + 0.1 * k.l, this.seed.neutral * 0.03, this.seed.hue, clamp(parsed.a * (isMask ? 1 : boost), 0, 1))
      }
      if (parsed.a < 1 && k.l >= 0.6) {
        const boost = 1 + 0.45 * this.seed.contrast
        return fromOklch(0.97, this.seed.neutral * 0.018, this.seed.hue, clamp(parsed.a * boost, 0, 1))
      }
      return this.neutralColor(k.l, 1, parsed.a)
    }
    if (k.h >= 230 && k.h <= 305) {
      const scale = this.accent.c / 0.186
      return fromOklch(k.l, k.c * clamp(scale, 0, 1.35), (this.accent.h + (k.h - 263) * 0.4 + 360) % 360, parsed.a)
    }
    return this.stateColor(k, parsed.a)
  }

  /** 求值一条公式。 */
  evaluate(expr, name) {
    const text = expr.trim()
    if (text.startsWith('$')) return this.color(text.slice(1))
    if (text.startsWith('#')) return this.literal(text, name)
    if (text === 'transparent') return CLEAR
    if (text === 'white') return WHITE
    if (text === 'black') return BLACK
    const mix = /^color-mix\(in srgb,\s*(.+?)(?:\s+([\d.]+)%)?,\s*(.+?)(?:\s+([\d.]+)%)?\)$/.exec(text)
    if (mix === null) throw new Error(`无法求值公式 ${text}（${name}）`)
    const p = mix[2] !== undefined ? Number(mix[2]) / 100 : mix[4] !== undefined ? 1 - Number(mix[4]) / 100 : 0.5
    return mixSrgb(this.evaluate(mix[1], name), this.evaluate(mix[3], name), p)
  }

  /** 取一个变量的颜色（求解结果 > 配方 > 公式）。 */
  color(name) {
    const fixed = this.fixed.get(name)
    if (fixed !== undefined) return fixed
    const cached = this.memo.get(name)
    if (cached !== undefined) return cached
    if (this.resolving.has(name)) throw new Error(`变量循环引用：${name}`)
    this.resolving.add(name)
    const value = this.recipe(name) ?? this.fromTable(name)
    this.resolving.delete(name)
    this.memo.set(name, value)
    return value
  }

  fromTable(name) {
    const entry = TABLE.get(name)
    if (entry === undefined) throw new Error(`未知变量 ${name}`)
    const expr = entry[this.mode]
    if (!name.startsWith('static-')) return this.evaluate(expr, name)
    let color = this.statics.get(name)
    if (color === undefined) {
      color = this.staticColor(name, expr)
      this.statics.set(name, color)
    }
    return color
  }

  /** 用在表面上的强调色文字：明度落在容易达标的区间。 */
  accentText() {
    const { l, c, h } = this.accent
    return this.dark ? fromOklch(clamp(l + 0.12, 0.72, 0.84), c, h) : fromOklch(clamp(l - 0.04, 0.44, 0.56), c, h)
  }

  /** 主按钮底色：尽量保持强调色本身的明度，只在压不住文字时才调。 */
  accentFill() {
    const { l, c, h } = this.accent
    const base = this.dark ? clamp(l + 0.04, 0.5, 0.86) : clamp(l, 0.42, 0.86)
    const lightOn = this.onLight()
    const darkOn = this.onDark()
    let best = fromOklch(base, c, h)
    let bestMove = Infinity
    for (const [on, direction] of [[lightOn, -1], [darkOn, 1]]) {
      for (let move = 0; move <= 0.6; move += 0.01) {
        const candidate = fromOklch(base + direction * move, c, h)
        if (wcag(on, candidate) >= 4.6 && apca(on, candidate) >= 61) {
          if (move < bestMove) {
            best = candidate
            bestMove = move
          }
          break
        }
      }
    }
    return best
  }

  onLight() {
    return fromOklch(0.985, this.seed.neutral * 0.012, this.seed.hue)
  }

  onDark() {
    return fromOklch(0.2, this.seed.neutral * 0.03, this.seed.hue)
  }

  /** 这个底色上用浅字还是深字。 */
  foregroundFor(fill) {
    const score = (on) => Math.min(wcag(on, fill) / 4.5, apca(on, fill) / 60)
    return score(this.onLight()) >= score(this.onDark()) ? 'light' : 'dark'
  }

  /** 把强调色按比例混进不透明的底色。暗色里压住明度上限，正文永远看得清。 */
  tinted(base, amount) {
    const mixed = mixSrgb(this.accentTone(), this.color(base), amount)
    if (!this.dark) return mixed
    const k = toOklch(mixed)
    return k.l <= DARK_SURFACE_MAX ? mixed : fromOklch(DARK_SURFACE_MAX, k.c, k.h)
  }

  accentTone() {
    const { l, c, h } = this.accent
    return fromOklch(this.dark ? clamp(l + 0.1, 0.62, 0.8) : clamp(l, 0.5, 0.7), c, h)
  }

  /** 不走宿主公式的配方。 */
  recipe(name) {
    if (this.seed.code !== undefined && name.startsWith('--shiki-token-')) {
      const scheme = codeColor(this.seed.code, name, this.dark)
      if (scheme !== undefined) return scheme
    }
    const { seed } = this
    switch (name) {
      case 'alias-button-primary-fill':
        return seed.ink ? this.color('alias-label-primary') : this.accentFill()
      case 'alias-button-primary-hover': {
        const fill = this.color('alias-button-primary-fill')
        const k = toOklch(fill)
        if (seed.ink) return fromOklch(k.l + (k.l > 0.5 ? -0.1 : 0.1), k.c, k.h)
        // 悬停时往离文字更远的方向走，文字一定还看得清
        return fromOklch(k.l + (this.foregroundFor(fill) === 'light' ? -0.05 : 0.05), k.c, k.h)
      }
      case 'alias-label-primary-foreground':
        return this.foregroundFor(this.color('alias-button-primary-fill')) === 'light' ? this.onLight() : this.onDark()
      case 'alias-brand-primary':
      case 'alias-brand-text':
        return seed.ink ? this.color('alias-label-primary') : this.accentText()
      case 'alias-brand-primary-invert':
        return this.color('alias-label-primary-foreground')
      case 'alias-brand-primary-new-colorprimary-new-color':
      case 'alias-state-business-primary':
      case 'alias-link':
      case 'alias-button-info-fill':
        return this.accentText()
      case 'alias-button-info-hover': {
        const k = toOklch(this.accentText())
        return fromOklch(k.l + (this.dark ? 0.05 : -0.05), k.c, k.h)
      }
      case 'alias-state-business-tertiary':
        return this.tinted('alias-bg-base', this.dark ? 0.2 : 0.13)
      case 'specific-bubble':
        return this.tinted(this.dark ? 'alias-bg-layer-2' : 'alias-bg-base', this.dark ? 0.1 : 0.09)
      case 'specific-bubble-highlight':
        return this.tinted(this.dark ? 'alias-bg-layer-2' : 'alias-bg-base', this.dark ? 0.2 : 0.18)
      case 'specific-sidebar-nav-item-active-accent':
        return this.tinted('specific-sidebar-fill', this.dark ? 0.18 : 0.14)
      case 'menu-surface-fill':
      case 'specific-menu':
        return withAlpha(this.color(this.dark ? 'alias-bg-layer-3' : 'alias-bg-base'), 0.96)
      case 'alias-menu-group-header-fill':
        return withAlpha(this.color(this.dark ? 'alias-bg-layer-3' : 'alias-bg-base'), 0.96)
      case 'alias-bg-mask-drop':
        return withAlpha(this.color(this.dark ? 'alias-bg-layer-1' : 'alias-bg-base'), 0.7)
      case '--shiki-token-keyword':
        return this.shiki(0, 0.17)
      case '--shiki-token-function':
        return this.shiki(55, 0.14)
      case '--shiki-token-constant':
        return this.shiki(-60, 0.14)
      case '--shiki-token-link':
        return this.shiki(18, 0.14)
      case '--shiki-token-string':
        return this.shikiAway(150, 0.14, 0)
      case '--shiki-token-string-expression':
        return this.shikiAway(150, 0.12, 0.05)
      case '--shiki-token-parameter':
        return this.shikiAway(55, 0.14, 0)
      case '--shiki-token-comment':
        return fromOklch(this.dark ? 0.66 : 0.58, seed.neutral * 0.03, seed.hue)
      case '--shiki-token-punctuation':
        return fromOklch(this.dark ? 0.78 : 0.45, seed.neutral * 0.03, seed.hue)
      default:
        return undefined
    }
  }

  shiki(offset, chroma, shift = 0) {
    const scale = clamp(0.55 + 0.45 * this.seed.chroma, 0, 1.2)
    return fromOklch((this.dark ? 0.78 : 0.5) + shift * (this.dark ? 1 : -1), chroma * scale, (this.accent.h + offset + 360) % 360)
  }

  /** 语义色相（字符串偏绿、参数偏橙），和强调色撞色时避开。 */
  shikiAway(hue, chroma, shift) {
    const distance = Math.abs(hueDelta(hue, this.accent.h))
    const target = distance < 45 ? hue + (hueDelta(this.accent.h, hue) >= 0 ? 1 : -1) * (45 - distance) : hue
    return this.shiki(hueDelta(this.accent.h, target), chroma, shift)
  }

  /** 玻璃表面在这一层的半透明颜色。 */
  glassTint(name) {
    return withAlpha(this.color(name), 1 - GLASS[name].k * this.glass.level)
  }

  /** 玻璃表面实际可能呈现的颜色：它自己叠在下层上，最下面是壁纸的明暗极值。 */
  glassBacks(name) {
    const spec = GLASS[name]
    const tint = this.glassTint(name)
    const under = spec.root ? this.glass.wall.samples : this.glassBacks(spec.on)
    return under.map((back) => over(tint, back))
  }

  /** 把 `a/b` 形式的背景合成为不透明颜色；玻璃表面会有多个可能的颜色。 */
  backdrop(spec) {
    const [top, bottom] = spec.split('/')
    if (bottom !== undefined) {
      const color = this.color(top)
      return this.backdrop(bottom).map((base) => over(color, base))
    }
    if (this.glass !== null && GLASS[top] !== undefined) return this.glassBacks(top)
    const color = this.color(top)
    return color.a >= 1 ? [color] : this.backdrop('alias-bg-base').map((base) => over(color, base))
  }

  /** 把几行约束变成求解用的形式。 */
  constraintsOf(rows) {
    return rows.map(([, minWcag, minApca, backgrounds]) => ({ backs: uniqueColors(backgrounds.flatMap((spec) => this.backdrop(spec))), minWcag, minApca }))
  }

  /**
   * 对比度求解，分三步：
   *   1. 文字只对常规背景求解：只动明度，沿离背景更远的方向二分，够了就停；
   *   2. 悬停、按下的背景不够清楚时，把这层半透明背景调淡，不动文字；
   *   3. 背景调到下限还不够（只有门槛比常规背景高的说明文字会走到这一步），再动文字。
   * 同一个变量的几条约束合在一起解，后一条不会把前一条刚满足的结果挪坏。
   */
  solve() {
    const solveText = (name, rows) => {
      const start = this.color(name)
      const constraints = this.constraintsOf(rows)
      if (passes(start, constraints)) return
      this.fixed.set(name, searchLightness(start, constraints))
      this.memo.clear()
    }
    for (const [name, rows] of LEGIBILITY_BY_TOKEN) solveText(name, rows.filter((row) => row[4] !== 'hover'))
    const hoverRows = LEGIBILITY.filter((row) => row[4] === 'hover')
    const rowOk = (row, overlay) => {
      const specs = row[3].filter((spec) => spec.startsWith(`${overlay}/`))
      return specs.length === 0 || passes(this.color(row[0]), this.constraintsOf([[row[0], row[1], row[2], specs]]))
    }
    for (const overlay of HOVER_OVERLAYS) {
      const original = this.color(overlay)
      // 背景完全透明也不够的（门槛比常规背景高的文字），调背景没用，留给第三步调文字
      this.fixed.set(overlay, withAlpha(original, 0))
      this.memo.clear()
      const fixable = hoverRows.filter((row) => rowOk(row, overlay))
      this.fixed.delete(overlay)
      this.memo.clear()
      for (let factor = 0.95; !fixable.every((row) => rowOk(row, overlay)) && factor >= HOVER_MIN_FACTOR - 1e-9; factor -= 0.05) {
        this.fixed.set(overlay, withAlpha(original, original.a * factor))
        this.memo.clear()
      }
    }
    for (const [name, rows] of LEGIBILITY_BY_TOKEN) {
      if (rows.some((row) => row[4] === 'hover')) solveText(name, rows)
    }
  }

  /** 走完全流程，返回全部变量的字符串值。 */
  build() {
    this.solve()
    /** @type {Map<string, string>} */
    const out = new Map()
    for (const name of TABLE.keys()) {
      const css = name.startsWith('--') ? name : `--dsw-${name}`
      out.set(css, this.tokenValue(name))
    }
    out.set('--dsw-menu-backdrop-filter', 'none')
    if (this.glass !== null) out.set('--prism-glass', this.glass.level.toFixed(2))
    return out
  }

  /** 每一对前景/背景的最差结果（玻璃表面取所有可能颜色里最差的）。 */
  rows() {
    const out = []
    for (const [text, minWcag, minApca, backgrounds] of LEGIBILITY) {
      const fg = this.color(text)
      for (const spec of backgrounds) {
        let w = Infinity
        let a = Infinity
        for (const back of this.backdrop(spec)) {
          const front = opaqueOn(fg, back)
          w = Math.min(w, wcag(front, back))
          a = Math.min(a, apca(front, back))
        }
        out.push({ mode: this.mode, text, on: spec, wcag: w, apca: a, minWcag, minApca, pass: w >= minWcag && a >= minApca })
      }
    }
    return out
  }

  /** 玻璃表面输出成什么 CSS 值。 */
  glassValue(name) {
    const spec = GLASS[name]
    const { wall } = this.glass
    if (wall.kind === 'color') return toHex(this.glassBacks(name)[0])
    if (spec.flat) {
      let color = wall.dock
      const chain = []
      for (let at = name; at !== undefined; at = GLASS[at].on) chain.unshift(at)
      for (const at of chain) color = over(this.glassTint(at), color)
      return toHex(color)
    }
    if (!spec.root) return toHex(this.glassTint(name))
    const layers = []
    for (let at = name; at !== undefined; at = GLASS[at].on) {
      const hex = toHex(this.glassTint(at))
      layers.push(`linear-gradient(${hex},${hex})`)
    }
    return `${layers.join(',')},${wall.css},${toHex(wall.base)}`
  }

  /** 渐变类变量返回 CSS 字符串，其他返回十六进制。 */
  tokenValue(name) {
    const entry = TABLE.get(name)
    const expr = entry[this.mode]
    if (this.glass !== null && GLASS[name] !== undefined) return this.glassValue(name)
    if (this.glass !== null && (name === 'linear-gradient-think' || name === 'linear-think-select') && this.glass.wall.kind !== 'color') return 'none'
    if (name.startsWith('gradient-')) {
      return expr.replace(/#[0-9a-f]{3,8}/gi, (hex) => toHex(this.literal(hex, name)))
    }
    if (name === 'linear-gradient-think' || name === 'linear-think-select') {
      const from = name === 'linear-gradient-think' ? this.color('alias-bg-base') : this.color(this.dark ? 'alias-bg-layer-1' : 'alias-bg-module-platform')
      return `linear-gradient(180deg, ${toHex(from)} 20.19%, ${toHex(withAlpha(from, 0))} 100%)`
    }
    return toHex(this.color(name))
  }
}

/**
 * @typedef {object} Wall 壁纸的引擎视图。
 * @property {'image' | 'gradient' | 'color'} kind 种类
 * @property {string} [css] 背景层（图片和渐变），每层都带 fixed
 * @property {string} base 底色 `#rrggbb`：图片加载出来之前显示它
 * @property {string} [dock] 输入框卡片所在位置（底部偏中）的壁纸颜色，缺省用 base
 * @property {string[]} samples 壁纸上的代表颜色，至少含最暗和最亮的像素
 */

/**
 * @typedef {{level: number, wall: {kind: Wall['kind'], css?: string, base: Rgba, dock: Rgba, samples: Rgba[]}}} GlassModel
 */

/**
 * @param {{level: number, wall: Wall} | null | undefined} input 玻璃参数
 * @returns {GlassModel | null} 解析好的参数；无效时为 null
 */
function glassModel(input) {
  if (input === null || input === undefined || input.wall === null || input.wall === undefined) return null
  const base = parseHex(input.wall.base)
  const dock = parseHex(input.wall.dock ?? input.wall.base) ?? base
  const samples = [...(input.wall.samples ?? []).map(parseHex).filter((color) => color !== undefined), dock]
  if (base === undefined || samples.length === 1) return null
  return { level: clamp(input.level, 0, 1), wall: { kind: input.wall.kind, css: input.wall.css, base, dock, samples } }
}

/** 档位逐步降低的步长。 */
const LEVEL_STEP = 0.05

/**
 * 生成一种明暗模式。玻璃感太高、文字怎么调都不够清楚时，逐步降低玻璃感，直到全部达标。
 * @returns {{palette: Palette, out: Map<string, string>}} 结果
 */
function buildMode(seed, mode, glass) {
  if (glass === null) {
    const palette = new Palette(seed, mode)
    return { palette, out: palette.build() }
  }
  for (let level = glass.level; ; level = Math.max(0, level - LEVEL_STEP)) {
    const palette = new Palette(seed, mode, { ...glass, level })
    const out = palette.build()
    if (level === 0 || palette.rows().every((row) => row.pass)) return { palette, out }
  }
}

/**
 * 从种子生成全部变量。
 * @param {Partial<Seed>} [seedInput] 种子，缺的字段用基底补上
 * @param {{level: number, wall: Wall} | null} [glassInput] 玻璃参数：玻璃感 0–1 和壁纸
 * @returns {TokenLayer} `变量名 → {light, dark}`，可以直接交给 `overrideTokens`
 */
export function generate(seedInput, glassInput) {
  const seed = completeSeed(seedInput)
  const glass = glassModel(glassInput)
  const light = buildMode(seed, 'light', glass).out
  const dark = buildMode(seed, 'dark', glass).out
  /** @type {TokenLayer} */
  const tokens = {}
  for (const [name, value] of light) tokens[name] = { light: value, dark: dark.get(name) ?? value }
  for (const [name, value] of dark) tokens[name] ??= { light: value, dark: value }
  return tokens
}

/**
 * 带玻璃时的对比度审计：壁纸上最暗、最亮的地方都算一遍，取最差的。
 * @param {Partial<Seed>} [seedInput] 种子
 * @param {{level: number, wall: Wall} | null} [glassInput] 玻璃参数
 * @returns {ReturnType<Palette['rows']>} 每一对前景/背景的结果
 */
export function auditSeed(seedInput, glassInput) {
  const seed = completeSeed(seedInput)
  const glass = glassModel(glassInput)
  return ['light', 'dark'].flatMap((mode) => buildMode(seed, mode, glass).palette.rows())
}

/**
 * 审计一层变量的对比度。
 * @param {TokenLayer} tokens 变量
 * @returns {{mode: Mode, text: string, on: string, wcag: number, apca: number, minWcag: number, minApca: number, pass: boolean}[]} 每一对前景/背景的结果
 */
export function audit(tokens) {
  const results = []
  const css = (name) => (name.startsWith('--') ? name : `--dsw-${name}`)
  for (const mode of /** @type {Mode[]} */ (['light', 'dark'])) {
    // 高级覆盖可能写了十六进制以外的值（渐变、var()），这种没法算，跳过
    const get = (name) => parseHex(tokens[css(name)]?.[mode])
    for (const [text, minWcag, minApca, backgrounds] of LEGIBILITY) {
      const fg = get(text)
      if (fg === undefined) continue
      for (const spec of backgrounds) {
        const [top, bottom] = spec.split('/')
        const layer = get(top)
        const base = bottom === undefined ? get('alias-bg-base') : get(bottom)
        if (layer === undefined || base === undefined) continue
        const back = bottom !== undefined || layer.a < 1 ? over(layer, base) : layer
        const front = fg.a >= 1 ? fg : over(fg, back)
        const w = wcag(front, back)
        const a = apca(front, back)
        results.push({ mode, text, on: spec, wcag: w, apca: a, minWcag, minApca, pass: w >= minWcag && a >= minApca })
      }
    }
  }
  return results
}

/** @returns {string[]} 引擎覆盖的全部变量名 */
export const tokenNames = () => [...TABLE.keys()].map((name) => (name.startsWith('--') ? name : `--dsw-${name}`))

/**
 * 种子在某个明暗下的画布底色（不做对比度求解，很快）。给「从别家主题换算种子」时反复试用。
 * @param {Partial<Seed>} seedInput 种子
 * @param {Mode} mode 明暗
 * @returns {Rgba} 底色
 */
export const canvasOf = (seedInput, mode) => /** @type {Rgba} */ (new Palette(completeSeed(seedInput), mode).color('alias-bg-base'))
