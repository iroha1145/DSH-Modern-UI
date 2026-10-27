import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync, constants } from 'node:zlib'
import { zipSync, strToU8, Zip, ZipPassThrough } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { inspectJsonl, officialReader, preflight, quarantineSnapshot, restoreSnapshot } from '../../scripts/migration/preflight.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const reader = await officialReader(root)
const header = { version: 4, id: 'migration-fixture', createdAt: 1, isSeeded: false, delegationDepth: 0 }
function jsonl(events = [], meta = header) {
  return Buffer.from([JSON.stringify(sessionFormatCatalog.encodeCurrentHeader({ ...meta, delegationDepth: meta.delegationDepth ?? 0 }, 0)),
    ...events.map(event => JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event)))].join('\n') + '\n')
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-ui-preflight-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('official v4 snapshot is readable without being marked converted', async () => {
  const report = inspectJsonl(jsonl(), reader)
  assert.equal(report.status, 'readable-snapshot')
  assert.equal(report.officialReadable, true)
  assert.equal(report.converted, false)
})

test('a readable ordinary snapshot imports through official persistence without changing its original', async t => {
  const directory = await fixture(t)
  const events = [{ seq: 0, time: 1, type: 'user/message', surfaceOp: 'append',
    data: { id: 'ordinary-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Preserved history' }] } }]
  const bytes = jsonl(events)
  const source = path.join(directory, 'original.jsonl')
  await writeFile(source, bytes)
  assert.equal((await preflight(source, root)).report.status, 'readable-snapshot')
  const destination = path.join(directory, 'new-session-store')
  const writerContext = new Context()
  try {
    await writerContext.plugin(JsonlPersistence, { root: destination, compression: 'none' }).await()
    const writer = await writerContext.sessionPersistence.create(header)
    try { await writer.append(events); await writer.flush() } finally { await writer.close() }
  } finally { await writerContext.fiber.dispose() }
  const restarted = new Context()
  try {
    await restarted.plugin(JsonlPersistence, { root: destination, compression: 'none' }).await()
    const imported = await restarted.sessionPersistence.open(header.id, 'read')
    try { assert.deepEqual((await imported.read()).events, events) } finally { await imported.close() }
    await assert.rejects(restarted.sessionPersistence.create(header), /already exists/i)
    assert.deepEqual(await readFile(source), bytes)
  } finally { await restarted.fiber.dispose() }
})

test('retired web/search events are detected in order and the snapshot stays unchanged', () => {
  const bytes = jsonl([
    { seq: 0, time: 1, type: 'web/search', data: { enabled: false } },
    { seq: 1, time: 2, type: 'web/search', data: { enabled: true } },
  ])
  const before = Buffer.from(bytes)
  const report = inspectJsonl(bytes, reader)
  assert.equal(report.status, 'legacy-web-events')
  assert.equal(report.officialReadable, false)
  assert.deepEqual(report.legacyWebEvents.map(entry => entry.enabled), [false, true])
  assert.deepEqual(bytes, before)
})

test('old command history is reported without reinstating a removed policy gate', () => {
  const report = inspectJsonl(jsonl([{ type: 'command/run', seq: 0, time: 1,
    data: { name: 'web', args: ' off', commandId: 'fixture-web-command' } }]), reader)
  assert.equal(report.status, 'readable-snapshot')
  assert.deepEqual(report.webCommands, [{ seq: 0, settled: false }])
})

test('duplicate ZIP log names cannot hide an earlier disabled-network session', async t => {
  const directory = await fixture(t)
  const chunks = []
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes) })
  for (const content of [jsonl([{ type: 'web/search', seq: 0, time: 1, data: { enabled: false } }]), jsonl()]) {
    const entry = new ZipPassThrough('session.v4.jsonl')
    archive.add(entry)
    entry.push(content, true)
  }
  archive.end()
  const source = path.join(directory, 'ambiguous.zip')
  await writeFile(source, Buffer.concat(chunks))
  await assert.rejects(preflight(source, root), /Duplicate or ambiguous/)
})

test('nested Zstandard logs share one cumulative decoded size budget', async t => {
  const directory = await fixture(t)
  const source = path.join(directory, 'compressed.zip')
  const log = jsonl([{ type: 'plugin:fixture/padding', seq: 0, time: 1, ignorable: true, data: { padding: 'x'.repeat(700) } }])
  const archive = zipSync({ 'first.jsonl.zstd': zstdCompressSync(log), 'second.jsonl.zstd': zstdCompressSync(log) })
  await writeFile(source, archive)
  assert.ok(archive.length < 1200 && log.length < 1200 && log.length * 2 > 1200)
  await assert.rejects(preflight(source, root, { maxBytes: 1200 }), /larger than|maxOutputLength|size limit/i)
})

test('native append-style concatenated Zstandard frames cannot hide later web events', async t => {
  const directory = await fixture(t)
  const source = path.join(directory, 'session.v4.jsonl.zstd')
  const log = jsonl([{ type: 'web/search', seq: 0, time: 1, data: { enabled: false } }])
  const lines = log.toString().trimEnd().split('\n')
  const frames = lines.map(line => zstdCompressSync(line + '\n', { params: { [constants.ZSTD_c_checksumFlag]: 1 } }))
  await writeFile(source, Buffer.concat(frames))
  const { report } = await preflight(source, root)
  assert.equal(report.status, 'blocked')
  assert.equal(report.entries[0].eventCount, 1)
  assert.equal(report.entries[0].legacyWebEvents[0].enabled, false)
  assert.equal(report.automaticImportPermitted, false)
  const corrupt = Buffer.concat(frames)
  corrupt[corrupt.length - 1] ^= 1
  await writeFile(source, corrupt)
  await assert.rejects(preflight(source, root))
})

test('future, corrupt, unknown required and torn inputs refuse without tail repair', () => {
  assert.throws(() => inspectJsonl(Buffer.from('{"type":"session","version":5}\n'), reader), /Unsupported source format/)
  assert.throws(() => inspectJsonl(Buffer.from('not-json\n'), reader), /JSON/)
  assert.throws(() => inspectJsonl(jsonl().subarray(0, -1), reader), /Incomplete JSONL tail/)
  const unknown = inspectJsonl(jsonl([{ seq: 0, time: 1, type: 'unknown/required', data: {} }]), reader)
  assert.equal(unknown.status, 'unsupported')
})

test('zstd and ZIP exports inspect the same exact session and preserve attachments in quarantine', async t => {
  const directory = await fixture(t)
  const data = jsonl([{ seq: 0, time: 1, type: 'web/search', data: { enabled: false } }])
  const compressed = path.join(directory, 'log.v4.jsonl.zstd')
  await writeFile(compressed, zstdCompressSync(data))
  assert.equal((await preflight(compressed, root)).report.status, 'blocked')
  const archive = zipSync({ 'session/log.v4.jsonl': data, 'attachments/fixture.txt': strToU8('opaque attachment') })
  const source = path.join(directory, 'session.zip')
  await writeFile(source, archive)
  const target = path.join(directory, 'quarantine')
  const report = await quarantineSnapshot(source, target, root)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(await readFile(path.join(target, 'original.snapshot')), Buffer.from(archive))
  assert.deepEqual(await readFile(source), Buffer.from(archive))
})

test('quarantine is idempotent, restores exact bytes to a new file, and refuses overwrite or tampering', async t => {
  const directory = await fixture(t)
  const source = path.join(directory, 'log.v4.jsonl')
  const target = path.join(directory, 'quarantine')
  const bytes = jsonl([{ seq: 0, time: 1, type: 'web/search', data: { enabled: false } }])
  await writeFile(source, bytes)
  assert.equal((await quarantineSnapshot(source, target, root)).reused, false)
  assert.equal((await quarantineSnapshot(source, target, root)).reused, true)
  const restored = path.join(directory, 'restored.jsonl')
  await restoreSnapshot(target, restored)
  assert.deepEqual(await readFile(restored), bytes)
  await assert.rejects(restoreSnapshot(target, restored), { code: 'EEXIST' })
  await writeFile(path.join(target, 'original.snapshot'), 'changed')
  await assert.rejects(restoreSnapshot(target, path.join(directory, 'second.jsonl')), /checksum mismatch/)
  await assert.rejects(quarantineSnapshot(source, target, root), /does not match/)
  assert.deepEqual(await readFile(source), bytes)
})

test('a live data directory or unrelated destination is never read recursively or overwritten', async t => {
  const directory = await fixture(t)
  await assert.rejects(preflight(directory, root), /regular exported snapshot/)
  const source = path.join(directory, 'session.jsonl')
  await writeFile(source, jsonl())
  const unrelated = path.join(directory, 'user-data')
  await mkdir(unrelated)
  await writeFile(path.join(unrelated, 'keep.txt'), 'keep')
  await assert.rejects(quarantineSnapshot(source, unrelated, root))
  assert.equal(await readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep')
})
