/** Test-only provider. No credentials, external network, or billable model calls. */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { realpathSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { hasOwnerSteeringBatch, waitForOwnerStreamRelease } from './owner-stream-barrier.mjs'
const require = createRequire(process.env.MODERN_UI_OFFICIAL_CLI ?? import.meta.url)
const { LlmAdapter, ReasoningEffortId } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)
if (process.env.MODERN_UI_PEER_REPORT) {
  const host = createRequire(realpathSync(process.env.MODERN_UI_OFFICIAL_CLI))
  const plugin = createRequire(realpathSync(process.env.MODERN_UI_INSTALLED_PLUGIN))
  const report = []
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-experimental-translator']) {
    const left = realpathSync(host.resolve(name))
    const right = realpathSync(plugin.resolve(name))
    const [leftModule, rightModule] = await Promise.all([import(pathToFileURL(left).href), import(pathToFileURL(right).href)])
    report.push({ name, host: left, plugin: right, samePath: left === right, sameModule: leftModule === rightModule,
      ...(name.endsWith('translator') ? { sameErrorClass: leftModule.TranslationError === rightModule.TranslationError } : {}) })
  }
  writeFileSync(process.env.MODERN_UI_PEER_REPORT, JSON.stringify(report, null, 2))
}

const provider = 'modern-ui-fixture'
const models = ['mock-balanced', 'mock-fast', 'mock-reasoning']
const ownerNextStep = new Map()
const reasoning = {
  defaultEffort: ReasoningEffortId('medium'),
  efforts: [
    { id: ReasoningEffortId('none'), name: 'Off' },
    { id: ReasoningEffortId('medium'), name: 'Medium' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
}
const response = `The fixture has a cited claim.[1]

${process.env.MODERN_UI_RUN_MARKER ?? ''}

[Open fixture file](m1-note.txt#L2)

![M1 relative image](m1-image.png)

[External fixture](${process.env.MODERN_UI_EXTERNAL_FIXTURE_URL ?? 'https://example.com/m1-fixture'})

| Model | Result |
| --- | --- |
| Local mock | Passed |

\`\`\`typescript
const result = 'streamed';
\`\`\`

\`\`\`openui
<title>Local visualization</title><div class="ui-card"><h3>Interactive fixture</h3><button id="increment">Count: 0</button></div><script>let n=0;document.getElementById('increment').onclick=()=>document.getElementById('increment').textContent='Count: '+(++n)</script>
\`\`\`

[1]: https://example.com/fixture "Fixture source"

\`\`\`followups
Explain the fixture result
Show another local example
\`\`\``

class FixtureAdapter extends LlmAdapter {
  ownerSteps = new Map()
  providerInfo() { return { id: provider, name: 'Local mock' } }
  async listModels() { return models.map(id => ({ provider, id, name: id })) }
  async resolveModel(_provider, id) { return { provider, id, name: id, reasoning, contextWindow: 64000 } }
  async *stream(options) {
    if (process.env.MODERN_UI_OWNER_REPORT) {
      const user = options.messages.filter(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
      appendFileSync(process.env.MODERN_UI_OWNER_REPORT, JSON.stringify({ sessionId: options.sessionId, purpose: options.purpose, user }) + '\n')
      if (options.purpose === 'session-title') {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Owner behavior fixture' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const delayed = JSON.stringify(user).includes('OWNER_DELAY_START')
      const step = (this.ownerSteps.get(options.sessionId) ?? 0) + 1
      this.ownerSteps.set(options.sessionId, step)
      const text = delayed ? `OWNER_STEP_${step}` : 'OWNER_ATTACHMENTS_ACCEPTED'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      if (delayed && step === 1) {
        const cancellationCase = JSON.stringify(user).includes('OWNER_DELAY_START CANCEL')
        await waitForOwnerStreamRelease({
          signal: options.signal,
          released: () => existsSync(process.env.MODERN_UI_OWNER_GATE),
          admitted: () => cancellationCase || hasOwnerSteeringBatch(ownerNextStep.get(options.sessionId) ?? []),
          onAbort: reason => appendFileSync(process.env.MODERN_UI_OWNER_REPORT, JSON.stringify({ kind: 'adapter-abort',
            sessionId: options.sessionId, step, cancellationCase, reason: reason instanceof Error ? reason.message : reason }) + '\n'),
        })
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const thought = 'Checking **streaming reasoning** with a preserved original body.'
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: thought }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: thought } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    for (let at = 0; at < response.length; at += 80) {
      options.signal?.throwIfAborted()
      yield { type: 'text-delta', index: 1, text: response.slice(at, at + 80) }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: response } }
    yield { type: 'block-start', index: 2, blockType: 'm1-fixture-data' }
    yield { type: 'block-end', index: 2, block: { type: 'm1-fixture-data', value: { nested: { marker: 'M1 JSON menu' } } } }
    yield { type: 'usage', usage: { inputTokens: 80, outputTokens: 240 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export const inject = ['llm', 'workspaceController']
export async function apply(ctx) {
  ctx.llm.registerAdapter([provider], new FixtureAdapter())
  if (process.env.MODERN_UI_OWNER_REPORT) ctx.on('session/event', (session, event) => {
    if (event.type === 'agent/inbox/spliced' && event.data.target === 'next-step') {
      const pending = ownerNextStep.get(session.id) ?? []
      pending.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
      ownerNextStep.set(session.id, pending)
    }
    if (['user/message', 'agent/inbox/spliced', 'step/start', 'step/end', 'turn/start', 'turn/end'].includes(event.type)) {
      appendFileSync(process.env.MODERN_UI_OWNER_REPORT, JSON.stringify({ kind: 'event', sessionId: session.id, event }) + '\n')
    }
  }, { global: true })
  if (process.env.MODERN_UI_BROWSER_WORKSPACE) await ctx.workspaceController.create({ path: process.env.MODERN_UI_BROWSER_WORKSPACE })
}
