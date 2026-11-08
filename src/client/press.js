/**
 * 按压位置，给主题做「从按下的地方扩散」的涟漪用。
 *
 * 主题在要出涟漪的元素上写 `--prism-ripple: 1`（棱镜已把它注册成不继承的属性，子元素不会误认）；
 * 按下时，棱镜在离按下点最近的这种元素上写 `--prism-x` / `--prism-y`：按下点相对元素左上角的距离（px）。
 * 主题的伪元素用 `left: var(--prism-x, 50%)` 这类写法，键盘触发时没有坐标就从中心开始。
 */

/** 注册 `--prism-ripple`：不继承，没写的元素读出来是空。 */
export const PRESS_CSS = '@property --prism-ripple{syntax:"*";inherits:false}'

/**
 * 从按下的元素往上找第一个声明了 `--prism-ripple` 的祖先（含自己）。
 * @param {any} target 按下的元素
 * @param {(el: any) => boolean} marked 判断元素有没有声明
 * @returns {any} 找到的元素；没有时 null
 */
export function pressHost(target, marked) {
  for (let el = target; el !== null && el !== undefined && el.nodeType === 1; el = el.parentElement) {
    if (marked(el)) return el
  }
  return null
}

/**
 * 装上按下监听（每个文档只装一次）。
 * @param {Document} doc 文档
 */
export function installPress(doc) {
  const root = doc.documentElement
  if (root.hasAttribute('data-prism-press')) return
  root.setAttribute('data-prism-press', '')
  const view = doc.defaultView
  doc.addEventListener('pointerdown', (event) => {
    if (view === null) return
    const host = pressHost(event.target, (el) => view.getComputedStyle(el).getPropertyValue('--prism-ripple').trim() !== '')
    if (host === null) return
    const rect = host.getBoundingClientRect()
    host.style.setProperty('--prism-x', `${Math.round(event.clientX - rect.left)}px`)
    host.style.setProperty('--prism-y', `${Math.round(event.clientY - rect.top)}px`)
  }, { capture: true, passive: true })
}
