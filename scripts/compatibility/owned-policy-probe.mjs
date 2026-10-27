import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
const consumer = resolve(process.argv[2]);
const scratch = resolve(process.argv[3]);
const mode = process.argv[4] ?? 'create';
const require = createRequire(resolve(consumer, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot');
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment');
const PRESET = 'iroha-modern-ui-web-policy-v1';
await mkdir(scratch, { recursive: true });
await copyFile(new URL('../../tests/compatibility/fixtures/counted-web-mock.mjs', import.meta.url), resolve(consumer, 'counted-web-mock.mjs'));
process.env.DSH_HOME = resolve(scratch, 'home');
process.env.DSH_POLICY_PROBE_LOG = resolve(scratch, `${mode}-counts.jsonl`);
await writeFile(process.env.DSH_POLICY_PROBE_LOG, '');
const installed = mode !== 'missing';
const refused = mode === 'missing' || mode === 'disabled';
const overlay = resolve(scratch, `${mode}.patch.yml`);
await writeFile(overlay, `- id: agent-default-model\n  config:\n    provider: mock-policy-probe\n    model: mock\n- insert:\n    - id: counted-web-mock\n      name: '${pathToFileURL(resolve(consumer, 'counted-web-mock.mjs')).href}'\n${installed ? `    - id: modern-policy\n      name: '${pathToFileURL(require.resolve('@iroha1145/dsh-modern-ui-web-policy')).href}'\n      disabled: ${mode === 'disabled'}\n` : ''}`);
const { ctx, shutdown } = await runProfile({ environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]), profile: 'web', patchFiles: [overlay], args: ['--no-open', '--port', '0'] });
try {
  if (mode === 'create') {
    const made = await ctx.sessionController.create({ cwd: consumer, sessionId: 'owned-policy', agentPreset: PRESET });
    assert.equal(made.agentPreset, PRESET);
    const agent = ctx.agents.get(made.sessionId);
    const command = await ctx.commands.execute(agent, '/web off', [], new AbortController().signal);
    console.log('COMMAND', JSON.stringify(command));
    assert.equal(ctx.sessionProjections.snapshot(agent.session).values.webSearch.pending, true);
    await writeFile(resolve(scratch, 'session-id.txt'), made.sessionId);
    console.log('CREATED', made.sessionId);
  } else {
    const id = await readFile(resolve(scratch, 'session-id.txt'), 'utf8');
    try {
      await ctx.sessionController.prompt({ sessionId: id, requestId: `probe-${Date.now()}`, mode: 'queue', content: [{ type: 'text', text: 'Use web_search once.' }] }, new AbortController().signal);
      const agent = ctx.agents.get(id);
      await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('idle timeout')), 15000);
        const stop = ctx.on('agent/status', ({ agent: target, status }) => { if (target === agent && status === 'idle') { clearTimeout(timer); stop(); accept(); } });
      });
      const view = ctx.sessionProjections.snapshot(agent.session).values.webSearch;
      const counts = (await readFile(process.env.DSH_POLICY_PROBE_LOG, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.deepEqual(view, { enabled: false, pending: false });
      assert.equal(counts.filter(row => row.kind === 'tool').length, 0);
      assert.ok(counts.some(row => row.kind === 'model' && row.visible.length > 0));
      assert.ok(counts.filter(row => row.kind === 'model').every(row => !row.visible.includes('web_search') && !row.visible.includes('web_fetch')));
      assert.ok(agent.session.snapshotEvents().some(event => event.type === 'tool/result' && event.data.message?.isError === true));
      console.log('RESUMED', JSON.stringify({ ...view, webToolsVisible: false, forcedToolExecuted: 0 }));
      if (refused) throw new Error('Missing policy unexpectedly allowed resume');
    } catch (error) {
      if (!refused) throw error;
      assert.match(error.message, /Unknown agent preset/);
      assert.equal(await readFile(process.env.DSH_POLICY_PROBE_LOG, 'utf8'), '');
      console.log('MISSING_REFUSED', error.message);
    }
  }
} finally { await shutdown.shutdown(0); }
