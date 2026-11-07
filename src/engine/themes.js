/**
 * 内置主题。主题只是一组种子，配色全部由引擎生成。
 * 这里不放任何十六进制成品色，改算法所有主题一起变好。
 */

/**
 * @typedef {object} ThemeDef
 * @property {string} id 主题 id
 * @property {{zh: string, en: string}} name 名字
 * @property {import('../shared/state.js').Seed} seed 种子
 */

/** @type {ThemeDef[]} */
export const THEMES = [
  { id: 'mist', name: { zh: '晨雾', en: 'Mist' }, seed: { hue: 245, chroma: 1, neutral: 0.42, contrast: 0, depth: 0, accent: '#4b78e6' } },
  { id: 'pine', name: { zh: '松烟', en: 'Pine' }, seed: { hue: 165, chroma: 0.95, neutral: 0.5, contrast: 0, depth: -0.1, accent: '#1f9a78' } },
  { id: 'sand', name: { zh: '暖砂', en: 'Sand' }, seed: { hue: 78, chroma: 0.95, neutral: 0.55, contrast: 0, depth: -0.2, accent: '#c8693a' } },
  { id: 'sakura', name: { zh: '晚樱', en: 'Sakura' }, seed: { hue: 355, chroma: 0.95, neutral: 0.45, contrast: 0, depth: 0, accent: '#d6557f' } },
  { id: 'abyss', name: { zh: '深海', en: 'Abyss' }, seed: { hue: 225, chroma: 1.05, neutral: 0.8, contrast: 0.1, depth: -0.35, accent: '#22a7c9' } },
  { id: 'iris', name: { zh: '鸢尾', en: 'Iris' }, seed: { hue: 290, chroma: 1, neutral: 0.55, contrast: 0, depth: -0.1, accent: '#7b5ce0' } },
  { id: 'graphite', name: { zh: '石墨', en: 'Graphite' }, seed: { hue: 260, chroma: 0.9, neutral: 0.04, contrast: 0.25, depth: -0.1, accent: '#3f7fd8', ink: true } },
  { id: 'seasalt', name: { zh: '海盐', en: 'Sea Salt' }, seed: { hue: 200, chroma: 0.95, neutral: 0.5, contrast: 0, depth: 0.15, accent: '#0f93a8' } },
  { id: 'ember', name: { zh: '余烬', en: 'Ember' }, seed: { hue: 40, chroma: 1.05, neutral: 0.55, contrast: 0.05, depth: -0.25, accent: '#d9502e' } },
  { id: 'matcha', name: { zh: '抹茶', en: 'Matcha' }, seed: { hue: 118, chroma: 0.9, neutral: 0.5, contrast: 0, depth: -0.05, accent: '#6d9a2c' } },
]

/** 没选主题但有「我的调整」时的基底种子：接近宿主默认配色。 */
export const BASE_SEED = Object.freeze({ hue: 262, chroma: 1, neutral: 0.12, contrast: 0, depth: 0, accent: '#4176e6' })

/**
 * @param {string | null | undefined} id 主题 id
 * @returns {ThemeDef | undefined} 主题定义
 */
export const themeById = (id) => THEMES.find((theme) => theme.id === id)
