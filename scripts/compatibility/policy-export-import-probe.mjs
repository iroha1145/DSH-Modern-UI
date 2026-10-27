// Logical export/import through the official public persistence interface.
// This is a synthetic compatibility probe, NOT a legacy-data migration tool.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
const consumer = resolve(process.argv[2]);
const scratch = resolve(process.argv[3]);
const require = createRequire(resolve(consumer, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const [{ Context }, sessions, persistence] = await Promise.all([
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-persistence-jsonl',
].map(load));
const { readSessionLogText, serializeSessionLog } = await load('@deepseek-ai/dsh-session-log-export');
const ctx = new Context();
try {
  await ctx.plugin(sessions.default);
  await ctx.plugin(persistence, { root: resolve(scratch, 'home/sessions') });
  const original = await ctx.sessionPersistence.open('owned-policy', 'read');
  const exported = { header: original.header, inheritedEventCount: original.inheritedEventCount, events: (await original.read()).events };
  await original.close();
  assert.equal(exported.header.agentPreset, 'iroha-modern-ui-web-policy-v1');
  assert.ok(exported.events.some(e => e.type === 'plugin:iroha-modern-ui/web-search-v1' && e.data.enabled === false));
  const filename = resolve(scratch, 'owned-policy.export.json');
  await writeFile(filename, JSON.stringify(exported, null, 2));
  const jsonl = await readSessionLogText(ctx.sessionPersistence, 'owned-policy');
  assert.equal(jsonl, serializeSessionLog(exported.header, exported.events));
  await writeFile(resolve(scratch, 'owned-policy.export.jsonl'), jsonl);
  const copy = JSON.parse(await readFile(filename, 'utf8'));
  const imported = await ctx.sessionPersistence.create({ ...copy.header, id: 'owned-policy-imported' }, { inheritedEventCount: copy.inheritedEventCount });
  await imported.append(copy.events);
  await imported.flush();
  assert.deepEqual((await imported.read()).events, copy.events);
  await imported.close();
  const [physicalHeader, ...exportedEvents] = jsonl.trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(physicalHeader.type, 'session');
  const { type, ...logicalHeader } = physicalHeader;
  const fromJsonl = await ctx.sessionPersistence.create({ ...logicalHeader, id: 'owned-policy-jsonl-imported' }, { inheritedEventCount: copy.inheritedEventCount });
  await fromJsonl.append(exportedEvents);
  await fromJsonl.flush();
  assert.deepEqual((await fromJsonl.read()).events, exported.events);
  await fromJsonl.close();
  const unchanged = await ctx.sessionPersistence.open('owned-policy', 'read');
  assert.deepEqual((await unchanged.read()).events, exported.events);
  await unchanged.close();
  console.log(JSON.stringify({ exported: 'owned-policy', imported: 'owned-policy-imported', events: copy.events.length,
    preservedPreset: copy.header.agentPreset, originalUnchanged: true, exactEventRoundTrip: true,
    officialJsonlExport: true, jsonlStorageApiImport: 'owned-policy-jsonl-imported', frontendZipImportTested: false }, null, 2));
} finally { await ctx.fiber.dispose(); }
