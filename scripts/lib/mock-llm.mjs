/**
 * 本机假模型：实现 Messages 协议的最小子集，让宿主跑出一段真实对话（Markdown、代码块、
 * 表格、引用……）用来截图和看代码高亮。只监听 127.0.0.1，不联网。
 */
import { createServer } from 'node:http'

const REPLY = `这是棱镜的示例回复，用来检查**正文**、\`行内代码\`、[链接](https://example.com)和代码高亮。

## 配色思路

- 少量种子生成全部颜色
- 亮暗成对，对比度自动达标
- 首屏不闪

> 换主题只改变量，不碰宿主的结构。

\`\`\`ts
// 求解文字色：只动明度，直到每个背景都达标
export function solve(text: Color, backs: Color[], target = 4.5): Color {
  const start = toOklch(text)
  for (let step = 0; step <= 100; step += 1) {
    const next = { ...start, l: start.l - step * 0.01 }
    if (backs.every((back) => wcag(next, back) >= target)) return next
  }
  return text
}
\`\`\`

\`\`\`python
def greet(name: str = "棱镜") -> str:
    # 返回一句问候
    return f"你好，{name}！"
\`\`\`

| 层 | 内容 | 能否重置 |
| --- | --- | --- |
| 主题 | 一组种子 | 可以 |
| 我的调整 | 盖在主题上 | 可以 |
| 高级覆盖 | 单个变量 | 可以 |
`

const REPLY_EN = `This is Prism's sample reply, used to check **body text**, \`inline code\`, [links](https://example.com) and code highlighting.

## How the palette works

- A few seeds generate every color
- Light and dark in pairs, contrast checked automatically
- No flash on first paint

> Switching themes only changes variables, never the host's structure.

\`\`\`ts
// Solve the text color: adjust only lightness until every background passes
export function solve(text: Color, backs: Color[], target = 4.5): Color {
  const start = toOklch(text)
  for (let step = 0; step <= 100; step += 1) {
    const next = { ...start, l: start.l - step * 0.01 }
    if (backs.every((back) => wcag(next, back) >= target)) return next
  }
  return text
}
\`\`\`

\`\`\`python
def greet(name: str = "Prism") -> str:
    # Return a greeting
    return f"Hello, {name}!"
\`\`\`

| Layer | Holds | Resettable |
| --- | --- | --- |
| Theme | A set of seeds | Yes |
| Your changes | On top of the theme | Yes |
| Background | Wallpaper and glass | Yes |
`

const MODEL = 'deepseek-mock'

const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

function streamReply(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } })
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < text.length; i += 80) {
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 80) } })
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 256 } })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

/**
 * @param {number} port 端口
 * @param {{locale?: string}} [options] locale 以 en 开头时回英文示例
 * @returns {Promise<{url: string, requests: string[], close: () => Promise<void>}>} 句柄
 */
export async function startMockLlm(port, { locale = 'zh' } = {}) {
  const reply = String(locale).toLowerCase().startsWith('en') ? REPLY_EN : REPLY
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname
      requests.push(`${req.method} ${path}`)
      if (path.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'mock', display_name: 'Mock', context_window: 128000, max_output_tokens: 8192 }] }))
        return
      }
      if (path.endsWith('/messages')) {
        let body = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          // 请求体解析不了也照常回复
        }
        if (body.stream === true) return streamReply(res, reply)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: '示例会话' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end('{"error":"not found"}')
    })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${port}/anthropic`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
