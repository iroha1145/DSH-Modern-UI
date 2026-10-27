// Run against a separately installed, unchanged official npm release.
// node web-policy-probe.mjs <consumer-directory> <scratch-data-directory>
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const consumer = resolve(process.argv[2]);
const data = resolve(process.argv[3]);
const require = createRequire(resolve(consumer, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const [{ Context }, session, llm, { default: Projections }, { default: Prompt }, tools,
  { default: Agents }, { default: Loop }, persistence, { default: Loader }, { default: Presets }] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-agent-preset-registry',
].map(load));
await mkdir(data, { recursive: true });
const result = { node: process.version, official: require('@deepseek-ai/dsh/package.json').version,
  entry: require.resolve('@deepseek-ai/dsh/profile-boot'), scenarios: [] };
assert.equal(result.official, '0.2.1-rc.4');
class CounterModel extends llm.LlmAdapter {
  requests = [];
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }); }
  async *stream(options) {
    this.requests.push(options);
    if (this.requests.length === 1) {
      const block = { type: 'tool-call', id: llm.ToolCallId('probe-call'), name: 'web_search', arguments: '{}' };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function mount(root, withPresets = false) {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(`${consumer}/`).href;
  await ctx.plugin(Loader);
  for (const plugin of [llm.default, session.default, Projections, Prompt, tools.default, Agents]) await ctx.plugin(plugin);
  await ctx.plugin(persistence, { root, compression: 'none' });
  await ctx.plugin(Loop, { agents: [] });
  if (withPresets) await ctx.plugin(Presets, { default: 'modern-policy' });
  const model = new CounterModel();
  ctx.llm.registerAdapter(['mock'], model);
  let calls = 0;
  ctx.tools.register(tools.defineContentToolFixture({ name: 'web_search', description: 'counted mock; no network', parameters: {},
    async execute() { calls++; return [{ type: 'text', text: 'mock result' }]; } }));
  return { ctx, model, calls: () => calls };
}
async function drive(h, agent) {
  const done = new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('agent did not become idle')), 10000);
    const stop = h.ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { clearTimeout(timer); stop(); accept(); }
    });
  });
  agent.followup(llm.createUserMessage({ content: [{ type: 'text', text: 'Use web_search once.' }], source: { kind: 'user' } }));
  await done;
  return { modelCalls: h.model.requests.length, toolCalls: h.calls(),
    visible: h.model.requests[0]?.tools?.map(tool => tool.name) ?? [],
    errors: agent.session.snapshotEvents().filter(e => e.type === 'agent/error' || e.type === 'tool/result').map(e => e.data) };
}
assert.equal(session.KNOWN_SESSION_EVENT_TYPES.has('web/search'), false);
result.scenarios.push({ name: 'required-event-registry', supported: false });
const root = resolve(data, 'sessions');
let h = await mount(root);
const prepared = h.ctx.sessions.prepare(session.SessionId('required-event'));
const writer = await h.ctx.sessionPersistence.create(prepared.header);
try {
  await writer.append([{ type: 'web/search', seq: 0, time: 1, data: { enabled: false } }]);
} finally { await writer.close(); }
await assert.rejects(async () => {
  const reader = await h.ctx.sessionPersistence.open(session.SessionId('required-event'), 'read');
  try { await reader.read(); } finally { await reader.close(); }
}, error => {
  result.scenarios.push({ name: 'required-event-durable-read', rejected: true, message: error.message });
  return true;
});
for (const [id, preset] of [['cli-record', undefined], ['cli-preset', 'modern-policy']]) {
  const fixture = await h.ctx.agents.create({ sessionId: session.SessionId(id), meta: { cwd: consumer, ...(preset ? { agentPreset: preset } : {}) } });
  session.appendPluginRecord(fixture.agent.session, 'plugin:modern-ui/web-search', { enabled: false });
  await fixture.dispose();
}
let handle = await h.ctx.agents.create({ sessionId: session.SessionId('plugin-record'), agentOptions: { provider: 'mock', model: 'mock' } });
session.appendPluginRecord(handle.agent.session, 'plugin:modern-ui/web-search', { enabled: false });
await handle.dispose();
await h.ctx.fiber.dispose();
h = await mount(root);
handle = await h.ctx.agents.resume({ resumeSessionId: session.SessionId('plugin-record'), agentOptions: { provider: 'mock', model: 'mock' } });
result.scenarios.push({ name: 'plugin-record-without-policy-restart', ...await drive(h, handle.agent) });
await h.ctx.fiber.dispose();

// A recorded preset identity remains resolvable when its policy row is disabled.
// The official loader/registry decide whether this is an acceptable composition.
h = await mount(root, true);
await h.ctx.agentPresets.register({ id: 'modern-policy', plugins: [{ name: 'absent-policy-plugin', disabled: true }] });
handle = await h.ctx.agents.create({ sessionId: session.SessionId('preset-disabled'),
  meta: { agentPreset: 'modern-policy' }, agentOptions: { provider: 'mock', model: 'mock' },
  setup: async scope => { await h.ctx.agentPresets.mount(scope, 'modern-policy'); } });
session.appendPluginRecord(handle.agent.session, 'plugin:modern-ui/web-search', { enabled: false });
await handle.dispose();
await h.ctx.fiber.dispose();
h = await mount(root, true);
await h.ctx.agentPresets.register({ id: 'modern-policy', plugins: [{ name: 'absent-policy-plugin', disabled: true }] });
handle = await h.ctx.agents.resume({ resumeSessionId: session.SessionId('preset-disabled'),
  agentOptions: { provider: 'mock', model: 'mock' },
  setup: async scope => { await h.ctx.agentPresets.mount(scope, 'modern-policy'); } });
result.scenarios.push({ name: 'recorded-preset-disabled-policy-restart', ...await drive(h, handle.agent) });
await h.ctx.fiber.dispose();
h = await mount(resolve(data, 'restricted'));
handle = await h.ctx.agents.create({ sessionId: session.SessionId('restricted'), agentOptions: { provider: 'mock', model: 'mock' },
  setup: scope => { scope.tools.restrict({ deny: ['web_search'] }); } });
const restricted = await drive(h, handle.agent);
assert.equal(restricted.toolCalls, 0);
assert.equal(restricted.visible.includes('web_search'), false);
result.scenarios.push({ name: 'loaded-policy-restrict-positive-control', ...restricted });
await h.ctx.fiber.dispose();
for (const row of result.scenarios.filter(row => row.name.endsWith('restart'))) {
  assert.equal(row.toolCalls, 1);
  assert.equal(row.visible.includes('web_search'), true);
}
await writeFile(resolve(data, 'probe-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
