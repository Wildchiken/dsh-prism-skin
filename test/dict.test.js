import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CUSTOM_DICT } from '../src/client/custom/dict.js'
import { DICT } from '../src/client/studio/dict.js'

const CJK = /[　-鿿＀-￯]/
/** 像一整句英文：不含汉字，且有 4 个以上的英文单词。 */
const englishSentence = (text) => !CJK.test(text) && (text.match(/[A-Za-z]{2,}/g) ?? []).length >= 4

for (const [name, dict] of [['设置页', DICT], ['导入导出', CUSTOM_DICT]]) {
  test(`${name}文案：中英文的键一一对应，中文里没有整句英文`, () => {
    assert.deepEqual(Object.keys(dict.zh).sort(), Object.keys(dict.en).sort())
    const leaked = Object.entries(dict.zh).filter(([, text]) => englishSentence(text)).map(([key]) => key)
    assert.deepEqual(leaked, [])
  })
}
