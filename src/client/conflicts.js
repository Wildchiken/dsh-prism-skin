/**
 * 冲突检测：skin-center 和 claude-style 也会改配色。检测到时只提示，不去抢样式。
 *
 * 只盯 `<html>` 和 `<body>` 这两个元素自身的两个属性，不挂 subtree，
 * 宿主改行内样式不会触发回调。
 */

/** 其他换肤插件的标记（这些属性归它们所有，棱镜只读）。 */
export const CONFLICT_MARKS = [
  { id: 'skin-center', element: 'html', attribute: 'data-dsh-skin' },
  { id: 'claude-style', element: 'body', attribute: 'data-dsh-claude-style' },
]

const elementOf = (mark) => (mark.element === 'html' ? document.documentElement : document.body)

/** @returns {string[]} 当前检测到的插件 id */
export function detectConflicts() {
  if (typeof document === 'undefined') return []
  return CONFLICT_MARKS.filter((mark) => elementOf(mark)?.hasAttribute(mark.attribute)).map((mark) => mark.id)
}

/**
 * @param {(conflicts: string[]) => void} onChange 变化时回调
 * @returns {() => void} 停止观察
 */
export function watchConflicts(onChange) {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return () => {}
  let last = JSON.stringify(detectConflicts())
  const check = () => {
    const next = detectConflicts()
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    onChange(next)
  }
  const observer = new MutationObserver(check)
  for (const mark of CONFLICT_MARKS) {
    const element = elementOf(mark)
    if (element) observer.observe(element, { attributes: true, attributeFilter: [mark.attribute] })
  }
  check()
  return () => observer.disconnect()
}
