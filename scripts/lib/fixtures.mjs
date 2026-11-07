/**
 * 测试和截图用的壁纸：用画布现画（原创内容，没有版权问题），不往仓库里放大文件。
 */

/** 画一张图的页面脚本。 */
const PAINTERS = {
  // 夜色山谷：深蓝天空、亮月、深色山脊
  valley: `(c) => {
    const g = c.createLinearGradient(0, 0, 0, 800)
    g.addColorStop(0, '#0d1b3e'); g.addColorStop(0.6, '#2d4a7c'); g.addColorStop(1, '#e8a06a')
    c.fillStyle = g; c.fillRect(0, 0, 1280, 800)
    const m = c.createRadialGradient(980, 180, 10, 980, 180, 220)
    m.addColorStop(0, '#fff6dc'); m.addColorStop(0.2, '#ffe9b8aa'); m.addColorStop(1, '#ffe9b800')
    c.fillStyle = m; c.fillRect(0, 0, 1280, 800)
    for (const [y, color, amp] of [[520, '#26365f', 70], [610, '#1a2747', 90], [700, '#0e162c', 60]]) {
      c.fillStyle = color; c.beginPath(); c.moveTo(0, 800)
      for (let x = 0; x <= 1280; x += 16) c.lineTo(x, y + Math.sin(x / 130 + y) * amp + Math.sin(x / 47) * amp * 0.3)
      c.lineTo(1280, 800); c.fill()
    }
  }`,
  // 暖色花田：亮粉、橙黄的柔和色块
  bloom: `(c) => {
    const g = c.createLinearGradient(0, 0, 1280, 800)
    g.addColorStop(0, '#fde2d0'); g.addColorStop(0.5, '#f7b7a3'); g.addColorStop(1, '#f5d76e')
    c.fillStyle = g; c.fillRect(0, 0, 1280, 800)
    const blobs = [[200, 180, 260, '#ff7e6b'], [720, 240, 320, '#ffb347'], [1080, 620, 300, '#e85d8a'], [380, 640, 280, '#ffd166'], [900, 120, 180, '#ff9aa2']]
    for (const [x, y, r, color] of blobs) {
      const b = c.createRadialGradient(x, y, 10, x, y, r)
      b.addColorStop(0, color); b.addColorStop(1, color + '00')
      c.fillStyle = b; c.fillRect(0, 0, 1280, 800)
    }
  }`,
  // 青绿湖面：冷色、中等明度
  lagoon: `(c) => {
    const g = c.createLinearGradient(0, 0, 200, 800)
    g.addColorStop(0, '#7fd6c2'); g.addColorStop(0.5, '#2f9e9a'); g.addColorStop(1, '#134e5e')
    c.fillStyle = g; c.fillRect(0, 0, 1280, 800)
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 197) % 1280, y = (i * 311) % 800, r = 60 + (i * 37) % 140
      const b = c.createRadialGradient(x, y, 4, x, y, r)
      b.addColorStop(0, '#d9fff0aa'); b.addColorStop(1, '#d9fff000')
      c.fillStyle = b; c.fillRect(0, 0, 1280, 800)
    }
  }`,
}

/**
 * 在页面里画一张 JPEG，返回内容。
 * @param {any} page 页面（任意同源页面都行）
 * @param {keyof typeof PAINTERS} name 哪一张
 * @returns {Promise<Buffer>} 文件内容
 */
export async function paintWallpaper(page, name) {
  const base64 = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1280; canvas.height = 800
    const c = canvas.getContext('2d')
    ;(${PAINTERS[name]})(c)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  })()`)
  return Buffer.from(base64, 'base64')
}
