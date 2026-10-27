// Reproduce the gate in an isolated consumer already containing official rc.4.
// The successful exit means the assertions (including the unsafe SDK bypass)
// reproduced. It DOES NOT mean the migration safety gate passed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
const consumer = resolve(process.argv[2]);
const require = createRequire(resolve(consumer, 'package.json'));
assert.equal(process.version, 'v24.22.1', 'Use the pinned Node runtime');
assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.1-rc.4');
const scripts = dirname(fileURLToPath(import.meta.url));
const repository = resolve(scripts, '../..');
const scratch = await mkdtemp(resolve(consumer, 'policy-gate-'));
const npm = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const steps = [];
async function run(name, args, { env = {}, expected = 0 } = {}) {
  const child = spawn(process.execPath, args, { cwd: consumer, env: { ...process.env, ...env }, windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 120000);
  const code = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', accept); });
  clearTimeout(timer);
  // Web startup prints a short-lived authentication token; do not retain it.
  const sanitize = value => value.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]');
  const row = { name, code, stdout: sanitize(stdout), stderr: sanitize(stderr) };
  steps.push(row);
  await writeFile(resolve(scratch, 'steps.json'), JSON.stringify(steps, null, 2));
  console.log(`${name}: exit ${code}`);
  assert.equal(code, expected, `${name}\n${row.stdout}\n${row.stderr}`);
  return row;
}
await run('pack-experimental-policy', [npm, 'pack', resolve(repository, 'packages/web-policy'), '--pack-destination', scratch, '--cache', resolve(scratch, 'npm-cache')]);
await run('install-packed-policy', [npm, 'install', '--save-exact', resolve(scratch, 'iroha1145-dsh-modern-ui-web-policy-0.1.0.tgz'), '--offline', '--ignore-scripts', '--cache', resolve(scratch, 'npm-cache')]);
await run('event-and-restriction-controls', [resolve(scripts, 'web-policy-probe.mjs'), consumer, resolve(scratch, 'controls')]);
const owned = resolve(scratch, 'owned');
await mkdir(owned);
for (const mode of ['create', 'resume', 'missing', 'disabled']) {
  await run(`official-web-${mode}`, [resolve(scripts, 'owned-policy-probe.mjs'), consumer, owned, mode]);
}
await run('official-export-and-storage-import', [resolve(scripts, 'policy-export-import-probe.mjs'), consumer, owned]);
for (const id of ['owned-policy', 'owned-policy-imported', 'owned-policy-jsonl-imported']) {
  await run(`official-sdk-bypass-${id}`, [resolve(scripts, 'sdk-policy-bypass-probe.mjs'), consumer, owned, id]);
}
const cli = require.resolve('@deepseek-ai/dsh/lib/bin.js');
const headless = await run('official-headless-refuses-owned-preset', [cli, '--profile', 'headless', '--patch', resolve(owned, 'sdk-mock.patch.yml'), 'Use web_search', '--session-id', 'owned-policy', '--json'], {
  env: { DSH_HOME: resolve(owned, 'home'), DSH_POLICY_PROBE_LOG: resolve(owned, 'headless-counts.jsonl') }, expected: 1,
});
assert.match(headless.stdout + headless.stderr, /one-shot runner does not compose/);
await run('uninstall-policy-package', [npm, 'uninstall', '@iroha1145/dsh-modern-ui-web-policy', '--offline', '--ignore-scripts', '--cache', resolve(scratch, 'npm-cache')]);
await run('official-web-after-uninstall', [resolve(scripts, 'owned-policy-probe.mjs'), consumer, owned, 'missing']);
await run('official-sdk-after-uninstall', [resolve(scripts, 'sdk-policy-bypass-probe.mjs'), consumer, owned, 'owned-policy-jsonl-imported']);
const summary = { gate: 'blocked', official: '0.2.1-rc.4', node: process.version,
  reason: 'The official SDK CLI profile resumes a policy-preset-bound, web-disabled session and executes web_search without the policy plugin.',
  exportCoverage: 'Official canonical JSONL export and public persistence API import; not frontend ZIP import.',
  scratch, steps: steps.map(({ name, code }) => ({ name, code })) };
await writeFile(resolve(scratch, 'gate-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
