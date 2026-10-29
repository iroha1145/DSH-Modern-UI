#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'
import { isMainModule } from '../distribution/entrypoint.mjs'
import { getHostCompatibility } from '../distribution/compatibility.mjs'

export const PREFLIGHT_VERSION = 2
const MAX_BYTES = 128 * 1024 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function officialReader(consumer) {
  const require = createRequire(path.resolve(consumer, 'package.json'))
  const metadata = require('@deepseek-ai/dsh/package.json')
  getHostCompatibility(metadata.version)
  const load = specifier => import(pathToFileURL(require.resolve(specifier)).href)
  const [session, persistence, { sessionFormatCatalog }] = await Promise.all([
    load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-persistence'),
    load('@deepseek-ai/dsh-session-format-catalog'),
  ])
  return { session, persistence, sessionFormatCatalog, version: metadata.version,
    entry: require.resolve('@deepseek-ai/dsh/profile-boot') }
}

export function inspectJsonl(bytes, reader) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (!text.endsWith('\n')) throw new Error('Incomplete JSONL tail; preflight does not repair or truncate snapshots')
  const lines = text.slice(0, -1).split('\n')
  const header = JSON.parse(lines.shift())
  if (header.version !== 4) throw new Error(`Unsupported source format v${header.version}; only v4 snapshots are verified`)
  const restore = reader.sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'transformed' })
  for (const line of lines) restore.decodeRow(JSON.parse(line))
  const artifact = restore.finish()
  const legacyWebEvents = artifact.events.filter(event => event.type === 'web/search')
    .map(event => ({ seq: event.seq, enabled: event.data?.enabled }))
  const pendingCommands = artifact.events.filter(event => event.type === 'command/run' && event.data?.name === 'web')
    .map(event => ({ seq: event.seq, settled: artifact.events.some(done => done.type === 'command/done' && done.data?.commandId === event.data.commandId) }))
  let officialReadable = false
  let refusal
  try {
    reader.persistence.validateStoredEvents(artifact.header, structuredClone(artifact.events))
    const current = reader.sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const line of lines) current.decodeRow(JSON.parse(line))
    current.finish()
    officialReadable = true
  } catch (error) { refusal = error.message }
  const needsLegacyReader = legacyWebEvents.length > 0
  return {
    formatVersion: artifact.header.version, eventCount: artifact.events.length,
    seeded: artifact.header.isSeeded, inheritedEventCount: artifact.inheritedEventCount,
    hasParent: artifact.header.parentSession !== undefined, hasAgentPreset: artifact.header.agentPreset !== undefined,
    officialReadable, legacyWebEvents, webCommands: pendingCommands,
    status: needsLegacyReader ? 'legacy-web-events' : officialReadable ? 'readable-snapshot' : 'unsupported',
    reason: needsLegacyReader ? 'This snapshot contains retired Modern UI web/search events. Preserve it for the legacy environment or read-only export; no conversion is performed.' : refusal,
    converted: false,
  }
}

function decodeZstd(bytes, maxBytes) {
  const chunks = []
  let offset = 0
  let decodedBytes = 0
  // Node 24's sync convenience call stops after one frame. DSH appends frames.
  while (offset < bytes.length) {
    const remaining = maxBytes - decodedBytes
    if (remaining <= 0) throw new Error('Expanded logs exceed the preflight size limit')
    const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true, maxOutputLength: remaining })
    const consumed = decoded.engine.bytesWritten
    if (!Number.isSafeInteger(consumed) || consumed <= 0 || consumed > bytes.length - offset) throw new Error('Invalid Zstandard frame boundary')
    offset += consumed
    decodedBytes += decoded.buffer.length
    if (decoded.buffer.length) chunks.push(decoded.buffer)
  }
  return Buffer.concat(chunks, decodedBytes)
}

async function entriesOf(bytes, filename, maxBytes) {
  if (filename.endsWith('.jsonl')) return [[path.basename(filename), bytes]]
  if (filename.endsWith('.jsonl.zstd')) return [[path.basename(filename), decodeZstd(bytes, maxBytes)]]
  if (!filename.endsWith('.zip')) throw new Error('Expected an exported .zip, .jsonl, or .jsonl.zstd snapshot, not a live DSH data directory')
  const { unzipSync } = await import('fflate')
  let expanded = 0
  const names = new Set()
  const entries = unzipSync(bytes, { filter(entry) {
    if (!entry.name.endsWith('.jsonl') && !entry.name.endsWith('.jsonl.zstd')) return false
    if (entry.name.includes('\\') || entry.name.startsWith('/') || /^[A-Za-z]:/.test(entry.name) || entry.name.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsafe archive entry name')
    const identity = entry.name.normalize('NFC').toLowerCase()
    if (names.has(identity)) throw new Error('Duplicate or ambiguous session log name in ZIP export')
    names.add(identity)
    expanded += entry.originalSize
    if (!Number.isSafeInteger(expanded) || expanded > maxBytes) throw new Error('Exported session logs exceed the preflight size limit')
    return true
  } })
  const logs = []
  let decodedBytes = 0
  for (const [name, entry] of Object.entries(entries)) {
    const remaining = maxBytes - decodedBytes
    if (remaining <= 0) throw new Error('Expanded logs exceed the preflight size limit')
    const decoded = name.endsWith('.zstd') ? decodeZstd(entry, remaining) : entry
    decodedBytes += decoded.byteLength
    if (decodedBytes > maxBytes) throw new Error('Expanded logs exceed the preflight size limit')
    logs.push([name, decoded])
  }
  if (logs.length === 0) throw new Error('Export contains no session JSONL logs')
  return logs
}

export async function preflight(source, consumer, { maxBytes = MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES) throw new Error('Invalid preflight size limit')
  const input = path.resolve(source)
  const before = await lstat(input, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Source must be one regular exported snapshot file')
  if (before.size > BigInt(maxBytes)) throw new Error('Snapshot exceeds the preflight size limit')
  const bytes = await readFile(input)
  const after = await stat(input, { bigint: true })
  if (before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    throw new Error('Source changed during read; create a completed export before retrying')
  }
  const reader = await officialReader(consumer)
  const report = { preflightVersion: PREFLIGHT_VERSION, officialVersion: reader.version,
    sourceSha256: digest(bytes), sourceBytes: bytes.length, converted: false, automaticImportPermitted: false,
    scope: 'Session log readability only; ZIP attachment contents are preserved but not validated.', entries: [] }
  for (const [name, content] of await entriesOf(bytes, input, maxBytes)) {
    try { report.entries.push({ name, ...inspectJsonl(content, reader) }) }
    catch (error) { report.entries.push({ name, status: 'unsupported', reason: error.message, converted: false }) }
  }
  report.status = report.entries.every(entry => entry.status === 'readable-snapshot') ? 'readable-snapshot' : 'blocked'
  return { report, bytes }
}

// Quarantine is a byte-for-byte snapshot copy, never a DSH import or data-directory backup.
export async function quarantineSnapshot(source, destination, consumer) {
  const { report, bytes } = await preflight(source, consumer)
  const target = path.resolve(destination)
  const parent = await realpath(path.dirname(target))
  const normalized = path.join(parent, path.basename(target))
  const original = await realpath(source)
  if (normalized === original) throw new Error('Quarantine must be a new directory separate from the source file')
  let existing
  try { existing = await lstat(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Quarantine destination is not an owned regular directory')
    const previous = JSON.parse(await readFile(path.join(target, 'preflight.json'), 'utf8'))
    const saved = await readFile(path.join(target, 'original.snapshot'))
    if (![1, PREFLIGHT_VERSION].includes(previous.preflightVersion) || previous.sourceSha256 !== report.sourceSha256 || digest(saved) !== report.sourceSha256) {
      throw new Error('Existing quarantine does not match this snapshot; nothing was overwritten')
    }
    return { ...report, quarantine: target, reused: true }
  }
  await mkdir(target, { mode: 0o700 })
  await writeFile(path.join(target, 'original.snapshot'), bytes, { flag: 'wx', mode: 0o600 })
  if (digest(await readFile(path.join(target, 'original.snapshot'))) !== report.sourceSha256) throw new Error('Quarantine copy verification failed')
  await writeFile(path.join(target, 'preflight.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await writeFile(path.join(target, 'DO-NOT-IMPORT.txt'),
    'This is an unchanged snapshot, not a DSH import. Keep snapshots containing retired web/search events in the legacy environment or a read-only export path. New Modern UI sessions use official plugin configuration and do not preserve the retired session switch.\n',
    { flag: 'wx', mode: 0o600 })
  return { ...report, quarantine: target, reused: false }
}

export async function restoreSnapshot(directory, destination) {
  const root = await realpath(directory)
  const manifest = JSON.parse(await readFile(path.join(root, 'preflight.json'), 'utf8'))
  if (![1, PREFLIGHT_VERSION].includes(manifest.preflightVersion)) throw new Error('Unsupported quarantine manifest version')
  const original = await readFile(path.join(root, 'original.snapshot'))
  if (digest(original) !== manifest.sourceSha256) throw new Error('Quarantined snapshot checksum mismatch')
  await writeFile(path.resolve(destination), original, { flag: 'wx', mode: 0o600 })
  return { restored: path.resolve(destination), sha256: manifest.sourceSha256, bytes: original.length }
}

async function main(args) {
  const [command, ...rest] = args
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--source', '--consumer', '--destination', '--quarantine'].includes(rest[i]) || rest[i + 1] === undefined) throw new Error('Invalid preflight arguments')
    if (Object.hasOwn(options, rest[i])) throw new Error(`Duplicate option ${rest[i]}`)
    options[rest[i]] = rest[i + 1]
  }
  let result
  if (command === 'restore' && options['--quarantine'] && options['--destination']) result = await restoreSnapshot(options['--quarantine'], options['--destination'])
  else if (command === 'inspect' && options['--source'] && options['--consumer']) result = (await preflight(options['--source'], options['--consumer'])).report
  else if (command === 'quarantine' && options['--source'] && options['--consumer'] && options['--destination']) result = await quarantineSnapshot(options['--source'], options['--destination'], options['--consumer'])
  else throw new Error('Usage: preflight.mjs inspect|quarantine --source <completed export> --consumer <official install> [--destination <new directory>]; restore --quarantine <directory> --destination <new file>')
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (result.status === 'blocked') process.exitCode = 2
}
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`migration-preflight: ${error.message}`); process.exitCode = 1 })
}
