/** Scripted model for the README screenshots: reasoning, two official tool calls on a real workspace, then a Markdown answer. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

assert.ok(process.env.COMPAT_OFFICIAL_CLI && process.env.DEMO_WORKSPACE, 'The fixture requires the actual consumer CLI and a demo workspace')
const host = createRequire(process.env.COMPAT_OFFICIAL_CLI)
const { LlmAdapter, ReasoningEffortId } = await import(pathToFileURL(host.resolve('@deepseek-ai/dsh-llm')).href)
export const inject = ['llm', 'workspaceController']
export const demoProvider = 'demo-local-model'
const workspace = process.env.DEMO_WORKSPACE

const reasoning = {
  look: '用户想让 fetchJson 可以被取消，而且重试之间的等待也要能立刻中断。先找到它的定义和调用点，确认等待是怎么写的，再决定 signal 要穿过哪些地方。',
  plan: '等待用的是裸 setTimeout，fetch 也没有拿到 signal，所以取消既打不断请求，也打不断重试间隔。把 signal 传给 fetch，再把等待换成可中断的 sleep；已经取消时不再重试。调用方不传 signal 时行为保持不变。',
}
const answer = `问题在两处：\`fetch\` 没有拿到取消信号，重试之间的等待是一个普通的 \`setTimeout\`，所以调用方没法中途停下。

### 改动

- 新增 \`signal\` 选项，原样传给 \`fetch\`
- 等待换成可中断的 \`sleep\`，信号触发时立即结束
- 已经取消时不再重试

\`\`\`ts
export interface FetchJsonOptions {
  retries?: number
  signal?: AbortSignal
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })

export async function fetchJson<T>(url: string, { retries = 2, signal }: FetchJsonOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
      return (await response.json()) as T
    } catch (error) {
      if (signal?.aborted || attempt >= retries) throw error
      await sleep(200 * (attempt + 1), signal)
    }
  }
}
\`\`\`

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 请求进行中取消 | 等请求自己结束 | 立即中断 |
| 重试等待中取消 | 最多再等 600 ms | 立即中断 |
| 不传 \`signal\` | — | 行为不变 |

\`src/client.ts\` 里的两处调用不用改；需要取消的地方传入 \`AbortController\` 的 \`signal\` 即可。

\`\`\`followups
给 sleep 补一个取消时的单元测试
把重试间隔改成带抖动的指数退避
\`\`\``
const overview = `这是一个很小的 TypeScript 请求工具库：

- \`src/fetch-json.ts\`：带重试的 \`fetchJson\`
- \`src/client.ts\`：基于它的用户与仓库查询

没有运行时依赖，测试用 \`vitest\`。`

const textOf = messages =>
  (messages.filter(row => row.role === 'user' && row.source?.kind === 'user').at(-1)?.content ?? [])
    .filter(row => row.type === 'text')
    .map(row => row.text)
    .join('\n')

async function* chunks(index, type, text, signal) {
  yield { type: 'block-start', index, blockType: type }
  for (let at = 0; at < text.length; at += 12) {
    signal?.throwIfAborted()
    yield { type: type === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text: text.slice(at, at + 12) }
    await delay(6, undefined, { signal })
  }
  yield { type: 'block-end', index, block: { type, text } }
}

class DemoAdapter extends LlmAdapter {
  stages = new Map()
  providerInfo() {
    return { id: demoProvider, name: 'Demo' }
  }
  async listModels() {
    return [{ provider: demoProvider, id: 'demo-reasoner', name: 'demo-reasoner', inputModalities: ['text', 'image'] }]
  }
  async resolveModel(_provider, id) {
    return {
      provider: demoProvider,
      id,
      name: id,
      context: { contextWindow: 128000 },
      inputModalities: ['text', 'image'],
      reasoning: {
        defaultEffort: ReasoningEffortId('high'),
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('medium'), name: 'Medium' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
      },
    }
  }
  async *stream(options) {
    const prompt = textOf(options.messages)
    if (options.purpose) {
      yield* chunks(0, 'text', JSON.stringify(options.messages).includes('fetchJson') ? '让 fetchJson 支持取消' : '梳理项目结构', options.signal)
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (!prompt.includes('fetchJson')) {
      yield* chunks(0, 'text', overview, options.signal)
      yield { type: 'usage', usage: { inputTokens: 1840, outputTokens: 96 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const stage = (this.stages.get(options.sessionId) ?? 0) + 1
    this.stages.set(options.sessionId, stage)
    if (stage === 1) {
      yield* chunks(0, 'reasoning', reasoning.look, options.signal)
      yield* chunks(1, 'text', '先看一下 `fetchJson` 的实现和调用点。', options.signal)
      const calls = [
        { name: 'grep', arguments: { pattern: 'fetchJson', path: join(workspace, 'src') } },
        { name: 'read', arguments: { file_path: join(workspace, 'src', 'fetch-json.ts') } },
      ]
      for (const [offset, call] of calls.entries()) {
        const block = { type: 'tool-call', id: `demo-call-${offset}`, name: call.name, arguments: JSON.stringify(call.arguments) }
        yield { type: 'block-start', index: offset + 2, blockType: 'tool-call' }
        yield { type: 'block-end', index: offset + 2, block }
      }
      yield { type: 'usage', usage: { inputTokens: 2310, outputTokens: 164 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield* chunks(0, 'reasoning', reasoning.plan, options.signal)
    yield* chunks(1, 'text', answer, options.signal)
    yield { type: 'usage', usage: { inputTokens: 3125, outputTokens: 512 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export async function apply(ctx) {
  ctx.llm.registerAdapter([demoProvider], new DemoAdapter())
  await ctx.workspaceController.create({ path: workspace })
}
