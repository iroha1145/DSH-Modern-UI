// Test-only fixture. Probe scripts copy it into the isolated npm consumer.
import { appendFileSync } from 'node:fs';
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools';
export const inject = ['llm', 'tools'];
export function apply(ctx) {
  const log = record => appendFileSync(process.env.DSH_POLICY_PROBE_LOG, `${JSON.stringify(record)}\n`);
  class Mock extends LlmAdapter {
    count = 0;
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }); }
    async *stream(options) {
      log({ kind: 'model', visible: options.tools?.map(t => t.name) ?? [] });
      if (++this.count === 1) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('cli-call'), name: 'web_search', arguments: '{}' } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['mock-policy-probe'], new Mock());
  ctx.tools.register(defineContentToolFixture({ name: 'web_search', description: 'counted mock without network', parameters: {},
    async execute() { log({ kind: 'tool', name: 'web_search' }); return [{ type: 'text', text: 'mock' }]; } }));
}
