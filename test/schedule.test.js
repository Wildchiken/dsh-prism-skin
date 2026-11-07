import assert from 'node:assert/strict'
import { test } from 'node:test'
import { indexAt, nextChange, permutation, slotAt } from '../src/shared/schedule.js'

const spec = { interval: 60, shuffle: false, epoch: 1000000 }

test('顺序轮播：按时间依次换，循环', () => {
  assert.equal(indexAt(spec, 3, spec.epoch), 0)
  assert.equal(indexAt(spec, 3, spec.epoch + 59999), 0)
  assert.equal(indexAt(spec, 3, spec.epoch + 60000), 1)
  assert.equal(indexAt(spec, 3, spec.epoch + 180000), 0)
  assert.equal(indexAt(spec, 0, spec.epoch), -1)
})

test('时钟比起点早时停在第一张', () => {
  assert.equal(slotAt(spec, spec.epoch - 5000), 0)
  assert.equal(indexAt(spec, 3, spec.epoch - 5000), 0)
})

test('下一次换图的时刻正好是下一格的开头', () => {
  const at = nextChange(spec, spec.epoch + 90000)
  assert.equal(at, spec.epoch + 120000)
  assert.equal(slotAt(spec, at), slotAt(spec, at - 1) + 1)
})

test('打乱：每轮都走遍所有图，大家算出来一样', () => {
  const shuffled = { ...spec, shuffle: true }
  for (let round = 0; round < 5; round += 1) {
    const seen = new Set()
    for (let i = 0; i < 7; i += 1) seen.add(indexAt(shuffled, 7, spec.epoch + (round * 7 + i) * 60000))
    assert.equal(seen.size, 7)
  }
  assert.deepEqual(permutation(7, 42), permutation(7, 42))
  assert.notDeepEqual(permutation(16, 1), permutation(16, 2))
})
