#!/usr/bin/env node
/**
 * 按进程测 GPU 占用（macOS，不需要 sudo）：读 ioreg 里每个进程的 accumulatedGPUTime，
 * 隔一段时间读两次，差值除以时长，就是这个进程占 GPU 的比例。
 *
 * 用法：node scripts/gpu-sample.mjs [标签] [秒数，默认 40]
 */
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

/** @returns {Map<string, number>} 进程名 → 累计 GPU 时间（纳秒） */
function read() {
  const text = execFileSync('ioreg', ['-c', 'AGXDeviceUserClient', '-r', '-d', '1', '-w', '0'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const totals = new Map()
  for (const block of text.split(/\n(?=\+-o )/)) {
    const creator = /"IOUserClientCreator" = "pid \d+, ([^"]+)"/.exec(block)?.[1]
    if (creator === undefined) continue
    let sum = 0
    for (const match of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) sum += Number(match[1])
    totals.set(creator, (totals.get(creator) ?? 0) + sum)
  }
  return totals
}

const label = process.argv[2] ?? '采样'
const seconds = Number(process.argv[3] ?? 40)
const start = read()
const t0 = process.hrtime.bigint()
await sleep(seconds * 1000)
const end = read()
const elapsed = Number(process.hrtime.bigint() - t0)
const rows = [...end].map(([name, value]) => [name, ((value - (start.get(name) ?? 0)) / elapsed) * 100]).filter(([, percent]) => percent >= 0.02).sort((a, b) => b[1] - a[1])
console.log(`${label}（${seconds} 秒）：${rows.slice(0, 5).map(([name, percent]) => `${name} ${percent.toFixed(2)}%`).join('，')}`)
