/** Installed deterministic model/tool fixture. Every DSH service is supplied by the actual consumer Host. */
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { providerId, firstAnswer, laterAnswer } from './scenario.mjs'

assert.ok(process.env.COMPAT_OFFICIAL_CLI, 'The fixture requires the actual consumer CLI')
const host = createRequire(process.env.COMPAT_OFFICIAL_CLI)
const { LlmAdapter, ReasoningEffortId } = await import(pathToFileURL(host.resolve('@deepseek-ai/dsh-llm')).href)
export const inject = ['llm', 'agents', 'tools', 'workspaceController', 'pluginManager', 'clientModules', 'profileContext', 'webServer']

function record(value) { appendFileSync(process.env.COMPAT_BROWSER_REPORT, JSON.stringify(value) + '\n') }
function textOf(messages) { return (messages.filter(row => row.role === 'user' && row.source?.kind === 'user').at(-1)?.content ?? []).filter(row => row.type === 'text').map(row => row.text).join('\n') }
async function* text(text, signal, slow = false) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  for (let at = 0; at < text.length; at += 24) {
    signal?.throwIfAborted()
    yield { type: 'text-delta', index: 0, text: text.slice(at, at + 24) }
    await delay(slow ? 100 : 8, undefined, { signal })
  }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
}

class CompatibilityAdapter extends LlmAdapter {
  stages = new Map()
  constructor(ctx) { super(); this.ctx = ctx }
  providerInfo() { return { id: providerId, name: 'Compatibility local provider' } }
  async listModels() { return ['compat-balanced', 'compat-fast'].map(id => ({ provider: providerId, id, name: id, inputModalities: ['text', 'image'] })) }
  async resolveModel(_provider, id) { return { provider: providerId, id, name: id, context: { contextWindow: 64000 }, inputModalities: ['text', 'image'],
    reasoning: { defaultEffort: ReasoningEffortId('medium'), efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('medium'), name: 'Medium' }, { id: ReasoningEffortId('high'), name: 'High' }] } } }
  async *stream(options) {
    const prompt = textOf(options.messages)
    record({ kind: 'request', sessionId: options.sessionId, provider: options.provider, model: options.model,
      reasoningEffort: options.reasoningEffort, purpose: options.purpose, user: options.messages.filter(row => row.role === 'user' && row.source?.kind === 'user') })
    if (options.purpose) {
      yield* text('Compatibility ' + (JSON.stringify(options.messages).match(/COMPAT_[A-Z]+/)?.[0] ?? 'session'), options.signal)
      yield { type: 'finish', reason: { kind: 'stop' } }; return
    }
    if (prompt.includes('COMPAT_STOP')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'COMPAT_STOP_STREAMING' }
      try { while (true) { await delay(100, undefined, { signal: options.signal }); yield { type: 'text-delta', index: 0, text: ' waiting' } } }
      finally { record({ kind: 'model-cancelled', sessionId: options.sessionId, aborted: options.signal?.aborted === true }) }
    }
    if (prompt.includes('COMPAT_FLOW')) {
      const stage = (this.stages.get(options.sessionId) ?? 0) + 1
      this.stages.set(options.sessionId, stage)
      if (stage === 1) {
        yield* text(firstAnswer, options.signal)
        const agent = this.ctx.agents.get(options.sessionId)
        assert.ok(agent)
        agent.inject({ id: 'compat-' + randomUUID(), role: 'user', content: [{ type: 'text', text: 'Continue the deterministic tool phase.' }],
          source: { kind: 'compat-browser-fixture', form: 'notice', summary: 'Continue compatibility tool phase' } })
        yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 150 } }
        yield { type: 'finish', reason: { kind: 'stop' } }; return
      }
      if (stage === 2) {
        yield* text('COMPAT_TOOL_PROGRESS', options.signal)
        for (const [index, name] of ['compat_echo', 'compat_failure'].entries()) {
          const block = { type: 'tool-call', id: 'compat-call-' + index, name, arguments: JSON.stringify({ text: 'Actual tool result' }) }
          yield { type: 'block-start', index: index + 1, blockType: 'tool-call' }
          yield { type: 'block-end', index: index + 1, block }
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      yield* text(laterAnswer, options.signal)
      yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 80 } }
      yield { type: 'finish', reason: { kind: 'stop' } }; return
    }
    yield* text(prompt.includes('COMPAT_ATTACHMENT') ? 'COMPAT_ATTACHMENTS_ACCEPTED' : 'COMPAT_PLAIN_RESPONSE', options.signal)
    yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 30 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export async function apply(ctx) {
  ctx.llm.registerAdapter([providerId], new CompatibilityAdapter(ctx))
  for (const name of ['compat_echo', 'compat_failure']) ctx.tools.register({ name, description: 'Deterministic compatibility tool',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }] },
    async execute(args) { record({ kind: 'tool-executed', name }); if (name === 'compat_failure') throw new Error('COMPAT_DETERMINISTIC_TOOL_ERROR'); return { text: args.text } },
  })
  ctx.on('session/event', (session, event) => {
    if (['turn/start', 'turn/end', 'step/start', 'step/end', 'assistant/message', 'tool/call', 'tool/result', 'feedback/message-put'].includes(event.type)) {
      record({ kind: 'session-event', sessionId: session.id, event })
    }
  }, { global: true })
  await ctx.workspaceController.create({ path: process.env.COMPAT_BROWSER_WORKSPACE })
  ctx.webServer.register({ kind: 'exact', path: '/api/compat-browser/evidence', handler: async (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ profile: ctx.profileContext.name, installAnchor: ctx.profileContext.installAnchor,
      version: host('@deepseek-ai/dsh/package.json').version, plugins: await ctx.pluginManager.listPlugins(), graph: ctx.clientModules.graph(),
      events: readFileSync(process.env.COMPAT_BROWSER_REPORT, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) }))
  } })
}
