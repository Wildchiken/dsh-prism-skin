/**
 * 轮播时间表：第几张只由「起点 + 间隔 + 当前时间」决定。
 *
 * 所有标签页、所有窗口、host 半算出来的都是同一张，不需要互相通知，也不需要每换一张
 * 就写一次存档。打乱顺序时每轮用不同的排列，但同一轮里大家算出的排列一样。
 */

/**
 * @typedef {{interval: number, shuffle: boolean, epoch: number}} Schedule
 * interval 单位秒；epoch 是开始轮播的时刻（毫秒）。
 */

/** 简单可复现的伪随机（mulberry32）。 */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {number} n 张数
 * @param {number} seed 种子
 * @returns {number[]} 0..n-1 的一个排列
 */
export function permutation(n, seed) {
  const order = Array.from({ length: n }, (_, i) => i)
  const random = seeded(seed)
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/**
 * @param {Schedule} spec 时间表
 * @param {number} now 当前时刻（毫秒）
 * @returns {number} 从起点算起的第几格
 */
export function slotAt(spec, now) {
  const span = Math.max(1, spec.interval) * 1000
  return Math.max(0, Math.floor((now - spec.epoch) / span))
}

/**
 * @param {Schedule} spec 时间表
 * @param {number} n 张数
 * @param {number} now 当前时刻
 * @returns {number} 现在该显示第几张（0..n-1）；n 为 0 时返回 -1
 */
export function indexAt(spec, n, now) {
  if (n <= 0) return -1
  const slot = slotAt(spec, now)
  if (!spec.shuffle || n === 1) return slot % n
  const round = Math.floor(slot / n)
  return permutation(n, spec.epoch + round)[slot % n]
}

/**
 * @param {Schedule} spec 时间表
 * @param {number} now 当前时刻
 * @returns {number} 下一次换图的时刻（毫秒）
 */
export function nextChange(spec, now) {
  const span = Math.max(1, spec.interval) * 1000
  return spec.epoch + (slotAt(spec, now) + 1) * span
}
