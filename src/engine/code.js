/**
 * 代码配色方案：可以独立于主题选。
 *
 * 每套方案给出 8 个语法角色的原色（取自各方案公开的色值）。生成时用原色作起点，
 * 再走和其他文字一样的对比度求解：不够清楚就只动明度，所以换到任何主题的代码块底色上都达标。
 * 只有暗色版本的方案，亮色时把明度翻过来再求解。
 */
import { clamp, fromOklch, parseHex, toOklch } from './color.js'

/** 方案里的角色顺序：关键字、函数、常量、字符串、参数、链接、标点、注释。 */
const ROLES = ['keyword', 'function', 'constant', 'string', 'parameter', 'link', 'punctuation', 'comment']

/**
 * @typedef {object} CodeScheme
 * @property {string} id 方案 id
 * @property {string} name 显示名
 * @property {string[]} dark 暗色时的 8 个颜色
 * @property {string[]} [light] 亮色时的 8 个颜色；缺省按暗色翻转明度
 */

/** @type {CodeScheme[]} */
export const CODE_SCHEMES = [
  { id: 'github', name: 'GitHub', light: ['#cf222e', '#8250df', '#0550ae', '#0a3069', '#953800', '#0550ae', '#24292f', '#6e7781'], dark: ['#ff7b72', '#d2a8ff', '#79c0ff', '#a5d6ff', '#ffa657', '#79c0ff', '#c9d1d9', '#8b949e'] },
  { id: 'one', name: 'One', light: ['#a626a4', '#4078f2', '#986801', '#50a14f', '#e45649', '#0184bc', '#383a42', '#a0a1a7'], dark: ['#c678dd', '#61afef', '#d19a66', '#98c379', '#e06c75', '#56b6c2', '#abb2bf', '#7f848e'] },
  { id: 'solarized', name: 'Solarized', light: ['#859900', '#268bd2', '#cb4b16', '#2aa198', '#b58900', '#6c71c4', '#657b83', '#93a1a1'], dark: ['#859900', '#268bd2', '#cb4b16', '#2aa198', '#b58900', '#6c71c4', '#839496', '#586e75'] },
  { id: 'dracula', name: 'Dracula', dark: ['#ff79c6', '#50fa7b', '#bd93f9', '#f1fa8c', '#ffb86c', '#8be9fd', '#f8f8f2', '#6272a4'] },
  { id: 'monokai', name: 'Monokai', dark: ['#f92672', '#a6e22e', '#ae81ff', '#e6db74', '#fd971f', '#66d9ef', '#f8f8f2', '#75715e'] },
  { id: 'nord', name: 'Nord', dark: ['#81a1c1', '#88c0d0', '#b48ead', '#a3be8c', '#d08770', '#8fbcbb', '#eceff4', '#616e88'] },
]

/** @param {string | undefined} id 方案 id @returns {CodeScheme | undefined} 方案 */
export const codeSchemeById = (id) => CODE_SCHEMES.find((scheme) => scheme.id === id)

/** 暗色方案用到亮色上：明度翻过来，彩度略收。 */
const flip = (hex) => {
  const k = toOklch(/** @type {any} */ (parseHex(hex)))
  return fromOklch(clamp(1.32 - k.l, 0.3, 0.62), k.c * 0.92, k.h)
}

/**
 * 某个 shiki 变量在这套方案里的起始颜色。
 * @param {string | undefined} id 方案 id
 * @param {string} name 变量名（`--shiki-token-*`）
 * @param {boolean} dark 是否暗色
 * @returns {import('./color.js').Rgba | undefined} 颜色；不是方案管的变量或方案不存在时为 undefined
 */
export function codeColor(id, name, dark) {
  const scheme = codeSchemeById(id)
  if (scheme === undefined || !name.startsWith('--shiki-token-')) return undefined
  const role = name.slice('--shiki-token-'.length)
  // 字符串里的插值：和字符串同色系，稍微挪一点
  const index = ROLES.indexOf(role === 'string-expression' ? 'string' : role)
  if (index < 0) return undefined
  const hex = dark ? scheme.dark[index] : scheme.light?.[index]
  const base = hex === undefined ? flip(scheme.dark[index]) : /** @type {import('./color.js').Rgba} */ (parseHex(hex))
  if (role !== 'string-expression') return base
  const k = toOklch(base)
  return fromOklch(k.l + (dark ? 0.06 : -0.05), k.c, (k.h + 12) % 360)
}
