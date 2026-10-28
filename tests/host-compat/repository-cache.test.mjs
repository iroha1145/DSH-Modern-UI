import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { bytesOnDisk, partialGitServer } from './fixtures/partial-git-server.mjs'

const require = createRequire(import.meta.url)
const { buildSync } = require('esbuild')
// Test current source in memory; do not read or rewrite the shared release artifact.
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL('../../packages/modern-ui/src/host-compat/plugin-documents/repository-cache.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', target: 'node24',
}).outputFiles[0].text
const module = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
const { RepositoryCache } = module.exports

function cacheFor(f, maxCacheBytes = 160 * 1024) {
  const life = new AbortController()
  const cache = new RepositoryCache({ dir: f.cacheDir, maxRepositoryBytes: 256 * 1024, maxCacheBytes,
    timeoutMs: 8000, ttlMs: 600000, transports: ['git'], lifetime: life.signal, sizePollMs: 10 })
  return { cache: f.track(cache, life), life }
}

async function assertPartialClone(f) {
  assert.equal(await f.git(['--git-dir', f.repository, 'config', '--get', 'remote.origin.promisor']), 'true')
  assert.equal(await f.git(['--git-dir', f.repository, 'config', '--get', 'remote.origin.partialclonefilter']), 'blob:none')
  const objects = await f.git(['--git-dir', f.repository, 'rev-list', '--objects', '--all', '--missing=print'])
  for (const id of f.blobIds) assert.ok(objects.split('\n').includes('?' + id), 'the initial fetch must omit every large blob')
}

test('oversized lazy blobs still enforce the cumulative on-disk repository cache budget', { timeout: 60000 }, async t => {
  const f = await partialGitServer(t)
  const maxCacheBytes = 160 * 1024
  const { cache } = cacheFor(f, maxCacheBytes)
  const signal = new AbortController().signal
  assert.deepEqual(Buffer.from(await cache.read(f.url, f.commit, 'README.md', 1024, signal)), f.small)
  await assertPartialClone(f)
  const sizes = []
  for (const [index] of f.blobs.entries()) {
    await assert.rejects(cache.read(f.url, f.commit, `large-${index}.bin`, 1024, signal), error =>
      error.reason === 'too-large' && error.message.includes(`large-${index}.bin exceeds 1024 bytes`))
    await cache.settled()
    sizes.push(await bytesOnDisk(f.cacheDir))
  }
  t.diagnostic(JSON.stringify({ maxCacheBytes, settledBytesAfterEachRejectedBlob: sizes }))
  assert.ok(sizes.every(bytes => bytes <= maxCacheBytes), 'failed file reads must not retain fetched blobs above the total cache limit')
  // Eviction may remove the current clone. A later normal read must reinitialize it normally.
  assert.deepEqual(Buffer.from(await cache.read(f.url, f.commit, 'README.md', 1024, signal)), f.small)
  await cache.settled()
  assert.ok(await bytesOnDisk(f.cacheDir) <= maxCacheBytes)
})

test('a too-large file below the cache budget keeps its usable clone and serialized normal reads', { timeout: 60000 }, async t => {
  const f = await partialGitServer(t)
  const { cache } = cacheFor(f, 1024 * 1024)
  const signal = new AbortController().signal
  await cache.read(f.url, f.commit, 'README.md', 1024, signal)
  await assertPartialClone(f)
  const outcomes = await Promise.allSettled([
    cache.read(f.url, f.commit, 'large-0.bin', 1024, signal),
    cache.read(f.url, f.commit, 'large-0.bin', 128 * 1024, signal),
    cache.readme(f.url, f.commit, '', 1024, signal),
  ])
  assert.equal(outcomes[0].status, 'rejected')
  assert.equal(outcomes[0].reason.reason, 'too-large')
  assert.equal(outcomes[1].status, 'fulfilled')
  assert.deepEqual(Buffer.from(outcomes[1].value), f.blobs[0])
  assert.equal(outcomes[2].status, 'fulfilled')
  assert.deepEqual(Buffer.from(outcomes[2].value.bytes), f.small)
  await cache.settled()
  assert.ok(existsSync(f.repository), 'a per-file limit alone must not delete a healthy under-budget clone')
  const objects = await f.git(['--git-dir', f.repository, 'rev-list', '--objects', '--all', '--missing=print'])
  assert.ok(!objects.split('\n').includes('?' + f.blobIds[0]), 'the read must have fetched the initially missing blob')
  assert.ok(objects.split('\n').includes('?' + f.blobIds[1]), 'unrequested file content must remain absent')
})

test('cancelling a real lazy fetch releases the repository lock and lifetime cancellation drains queued reads', { timeout: 60000 }, async t => {
  const f = await partialGitServer(t)
  const { cache, life } = cacheFor(f, 1024 * 1024)
  const signal = new AbortController().signal
  await cache.read(f.url, f.commit, 'README.md', 1024, signal)
  const caller = new AbortController()
  const held = f.holdConnections()
  const cancelled = cache.read(f.url, f.commit, 'large-0.bin', 128 * 1024, caller.signal)
  const failure = assert.rejects(cancelled, error => error === caller.signal.reason)
  await held
  caller.abort(new Error('Cancel the held real Git blob fetch'))
  await failure
  await cache.settled()
  assert.equal(existsSync(f.repository), false, 'cancelled Git operations discard their partial clone')
  f.releaseConnections()
  assert.deepEqual(Buffer.from(await cache.read(f.url, f.commit, 'README.md', 1024, signal)), f.small)
  const heldAgain = f.holdConnections()
  const pending = cache.read(f.url, f.commit, 'large-1.bin', 128 * 1024, signal)
  const queued = cache.read(f.url, f.commit, 'README.md', 1024, signal)
  const pendingFailure = assert.rejects(pending, error => error === life.signal.reason)
  const queuedFailure = assert.rejects(queued, error => error === life.signal.reason)
  await heldAgain
  life.abort(new Error('Dispose with a real fetch and a queued read'))
  await Promise.all([pendingFailure, queuedFailure])
  await cache.settled()
  assert.equal(existsSync(f.repository), false)
  assert.equal(await bytesOnDisk(f.cacheDir), 0, 'settlement leaves neither Git objects nor lock files after cancellation')
})
