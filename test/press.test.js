import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRESS_CSS, pressHost } from '../src/client/press.js'

const node = (name, parent = null) => ({ nodeType: 1, name, parentElement: parent })

test('按压位置：从按下的元素往上找第一个声明了 --prism-ripple 的', () => {
  const body = node('body')
  const row = node('row', body)
  const label = node('label', row)
  const icon = node('icon', label)
  const marked = (el) => el.name === 'row'
  assert.equal(pressHost(icon, marked)?.name, 'row')
  assert.equal(pressHost(row, marked)?.name, 'row')
  assert.equal(pressHost(body, marked), null)
  assert.equal(pressHost(null, marked), null)
})

test('按压位置：--prism-ripple 注册成不继承，写法里没有会被 CSS 检查拦下的字符', () => {
  assert.match(PRESS_CSS, /@property --prism-ripple\{syntax:"\*";inherits:false\}/)
  assert.doesNotMatch(PRESS_CSS, /[<\\]/)
})
