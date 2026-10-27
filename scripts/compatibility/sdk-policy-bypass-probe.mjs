// Exercise the normal official CLI SDK profile, without loading Modern UI.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const consumer = resolve(process.argv[2]);
const scratch = resolve(process.argv[3]);
const sessionId = process.argv[4] ?? 'owned-policy';
const require = createRequire(resolve(consumer, 'package.json'));
async function officialManifest() {
  const root = resolve(consumer, 'node_modules/@deepseek-ai');
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  const manifest = {};
  for (let offset = 0; offset < files.length; offset += 32) {
    await Promise.all(files.slice(offset, offset + 32).map(async file => {
      const path = resolve(file.parentPath, file.name);
      manifest[path.slice(root.length + 1)] = createHash('sha256').update(await readFile(path)).digest('hex');
    }));
  }
  return manifest;
}
const before = await officialManifest();
await mkdir(scratch, { recursive: true });
await copyFile(new URL('../../tests/compatibility/fixtures/counted-web-mock.mjs', import.meta.url), resolve(consumer, 'counted-web-mock.mjs'));
const overlay = resolve(scratch, 'sdk-mock.patch.yml');
const counts = resolve(scratch, `sdk-${sessionId}-counts.jsonl`);
await writeFile(counts, '');
await writeFile(overlay, `- id: tool-web\n  disabled: true\n- insert:\n    - id: counted-web-mock\n      name: '${pathToFileURL(resolve(consumer, 'counted-web-mock.mjs')).href}'\n`);
const child = spawn(process.execPath, [require.resolve('@deepseek-ai/dsh/lib/bin.js'), '--profile', 'sdk', '--patch', overlay], {
  cwd: consumer, env: { ...process.env, DSH_HOME: resolve(scratch, 'home'), DSH_POLICY_PROBE_LOG: counts }, windowsHide: true,
});
const pending = new Map();
const frames = [];
let stderr = '';
let nextId = 0;
child.stderr.on('data', chunk => { stderr += chunk; });
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let frame;
  try { frame = JSON.parse(line); } catch { frames.push({ nonJson: line }); return; }
  frames.push(frame);
  if (frame.id !== undefined) {
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    frame.error ? request.reject(new Error(JSON.stringify(frame.error))) : request.resolve(frame.result);
  }
});
function rpc(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
try {
  const initialized = await rpc('initialize', { cwd: consumer, provider: 'mock-policy-probe', model: 'mock' });
  const resumed = await rpc('session/resume', { sessionId });
  await rpc('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: 'Use web_search once.' }] });
  await rpc('session/wait', { sessionId });
  const rows = (await readFile(counts, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const toolCalls = rows.filter(row => row.kind === 'tool').length;
  const visible = rows.filter(row => row.kind === 'model').some(row => row.visible.includes('web_search'));
  const after = await officialManifest();
  assert.deepEqual(after, before, 'official published files changed');
  const report = { official: require('@deepseek-ai/dsh/package.json').version, node: process.version, sessionId,
    initialized, resumed, visible, toolCalls, officialFiles: Object.keys(before).length, officialFilesUnchanged: true, stderr, frames };
  await writeFile(resolve(scratch, 'official-files.sha256.json'), JSON.stringify(before, null, 2));
  await writeFile(resolve(scratch, `sdk-${sessionId}-result.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ official: report.official, node: report.node, sessionId, resumed, visible, toolCalls, stderr }, null, 2));
  assert.equal(visible, true);
  assert.equal(toolCalls, 1);
  await rpc('shutdown');
} finally {
  child.stdin.end();
  for (const request of pending.values()) clearTimeout(request.timer);
  await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(() => { child.kill(); resolve(); }, 5000).unref(); } });
}
