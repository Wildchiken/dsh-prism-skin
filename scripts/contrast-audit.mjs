#!/usr/bin/env node
/** 对比度审计：所有内置主题（亮暗）逐对检查，全过才退出 0。 */
import { audit, CODE_SCHEMES, generate, THEMES } from '../src/engine/index.js'

let failed = 0
let total = 0
let weakest = { wcag: Infinity }
for (const theme of THEMES) {
  const results = audit(generate(theme.seed))
  const bad = results.filter((row) => !row.pass)
  total += results.length
  failed += bad.length
  for (const row of results) if (row.wcag / row.minWcag < weakest.wcag / (weakest.minWcag ?? 1)) weakest = { ...row, theme: theme.id }
  console.log(`${bad.length === 0 ? '✓' : '✗'} ${theme.id.padEnd(10)} ${results.length} 对，未达标 ${bad.length}`)
  for (const row of bad.slice(0, 12)) {
    console.log(`    ${row.mode} ${row.text} on ${row.on}: WCAG ${row.wcag.toFixed(2)}/${row.minWcag} APCA ${row.apca.toFixed(1)}/${row.minApca}`)
  }
}
console.log(`合计 ${total} 对，未达标 ${failed}`)

// 代码配色方案：每套 × 每个主题，只看代码高亮那几对
let codePairs = 0
let codeFailed = 0
for (const scheme of CODE_SCHEMES) {
  let bad = 0
  for (const theme of THEMES) {
    const rows = audit(generate({ ...theme.seed, code: scheme.id })).filter((row) => row.text.startsWith('--shiki-'))
    codePairs += rows.length
    bad += rows.filter((row) => !row.pass).length
  }
  codeFailed += bad
  console.log(`${bad === 0 ? '✓' : '✗'} 代码 ${scheme.id.padEnd(10)} × ${THEMES.length} 套主题，未达标 ${bad}`)
}
console.log(`代码配色合计 ${codePairs} 对，未达标 ${codeFailed}`)
failed += codeFailed
process.exit(failed === 0 ? 0 : 1)
