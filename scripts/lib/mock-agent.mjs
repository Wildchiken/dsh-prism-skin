/**
 * 会调工具的假模型（Anthropic 接口），给主题体检造真实的对话画面：工具卡片、文件差异、轨迹。
 * 每一轮（用户发一条文字消息算一轮）按剧本走：找文件 → 写文件 → 改文件 → 跑命令 → 读文件 → 总结；
 * 工具名从请求里的 tools 现找，宿主没有的那步跳过。只在本机监听，不联网。
 */
import { createServer } from 'node:http'
const MODEL = 'deepseek-mock'
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

const FINAL = `改好了。总结一下这次做了什么：

## 改动

1. 新建了 \`palette.ts\`，放三档对比度门槛
2. 把 \`solve()\` 的默认门槛从 4.5 改成读配置

| 文件 | 改动 | 行数 |
| --- | --- | --- |
| palette.ts | 新建 | +6 |
| notes.md | 追加一行 | +1 |

> 提示：门槛改大以后，浅色主题的说明文字会更深一点。

\`\`\`ts
export const LEVELS = { body: 4.5, large: 3, ui: 3 } as const
\`\`\`

还有一个**很长很长的一行**用来看折行：这是一段用来检查长段落在对话区里怎么折行、行高和段落间距是不是舒服的文字，中英混排 mixed with English words and \`inline code\` 以及链接 [Material 3](https://m3.material.io)。`

/** 找宿主给的工具名：按关键词挑 */
function pick(tools, words) {
  const names = tools.map((t) => t.name)
  for (const w of words) { const hit = names.find((n) => n.toLowerCase() === w); if (hit) return hit }
  for (const w of words) { const hit = names.find((n) => n.toLowerCase().includes(w)); if (hit) return hit }
  return null
}

function stream(res, blocks, stop) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  sse(res, 'message_start', { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (let i = 0; i < b.text.length; i += 60) sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text.slice(i, i + 60) } })
    } else if (b.type === 'thinking') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.text } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'mock' } })
    } else {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index })
  })
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 320 } })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

/** 这一轮里已经回了几次（从最后一条带文字的用户消息往后数助手消息） */
function stepOf(messages) {
  let n = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant') n++
    else if (m.role === 'user') {
      const c = Array.isArray(m.content) ? m.content : [{ type: 'text', text: String(m.content) }]
      if (c.some((b) => b.type === 'text' && !/system-reminder|<runtime/i.test(b.text ?? ''))) break
    }
  }
  return n
}

/**
 * @param {number} port 端口
 * @returns {Promise<{url: string, requests: string[], close: () => Promise<void>}>} 句柄
 */
export async function startAgentMock(port) {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname
      if (path.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'mock', display_name: 'Mock', context_window: 128000, max_output_tokens: 8192 }] }))
        return
      }
      if (!path.endsWith('/messages')) { res.writeHead(404); res.end('{}'); return }
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'msg_t', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: '配色门槛调整' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }))
        return
      }
      const tools = body.tools ?? []
      const step = stepOf(body.messages ?? [])
      requests.push(`step ${step}`)
      const bash = pick(tools, ['bash', 'shell', 'exec', 'run', 'command'])
      const write = pick(tools, ['write', 'write_file', 'create'])
      const edit = pick(tools, ['edit', 'str_replace', 'replace', 'patch'])
      const read = pick(tools, ['read', 'read_file', 'view'])
      const ls = pick(tools, ['ls', 'list', 'glob'])
      const props = (name) => Object.keys(tools.find((t) => t.name === name)?.input_schema?.properties ?? {})
      const fileKey = (name) => props(name).find((k) => /path|file/i.test(k)) ?? 'path'
      const steps = [
        () => [{ type: 'thinking', text: '先看看工作区里有什么文件，再决定改哪里。' }, { type: 'text', text: '我先看一下工作区的结构。' }, ...(ls ? [{ type: 'tool_use', id: 'tu_ls', name: ls, input: { [props(ls)[0] ?? 'path']: '.' } }] : bash ? [{ type: 'tool_use', id: 'tu_ls', name: bash, input: { [props(bash).find((k) => /command|cmd/i.test(k)) ?? 'command']: 'ls -la' } }] : [])],
        () => write ? [{ type: 'text', text: '新建一个放门槛的文件。' }, { type: 'tool_use', id: 'tu_w', name: write, input: { [fileKey(write)]: 'palette.ts', [props(write).find((k) => /content|text/i.test(k)) ?? 'content']: 'export const LEVELS = {\n  body: 4.5,\n  large: 3,\n  ui: 3,\n} as const\n' } }] : null,
        () => edit ? [{ type: 'tool_use', id: 'tu_e', name: edit, input: { [fileKey(edit)]: 'palette.ts', [props(edit).find((k) => /old/i.test(k)) ?? 'old_string']: '  ui: 3,', [props(edit).find((k) => /new/i.test(k)) ?? 'new_string']: '  ui: 3,\n  hover: 4.5,' } }] : null,
        () => bash ? [{ type: 'text', text: '跑一下检查。' }, { type: 'tool_use', id: 'tu_b', name: bash, input: { [props(bash).find((k) => /command|cmd/i.test(k)) ?? 'command']: 'cat palette.ts && echo done' } }] : null,
        () => read ? [{ type: 'tool_use', id: 'tu_r', name: read, input: { [fileKey(read)]: 'palette.ts' } }] : null,
      ]
      // 宿主没有的工具那步跳过：用已回复次数在「有效步骤」里定位
      const valid = steps.map((s) => s()).filter((b) => b !== null)
      const blocks = valid[step]
      if (blocks) return stream(res, blocks, blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
      return stream(res, [{ type: 'text', text: FINAL }], 'end_turn')
    })
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${port}/anthropic`, requests, close: () => new Promise((r) => server.close(r)) }
}
