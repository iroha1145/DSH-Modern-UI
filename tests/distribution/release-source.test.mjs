import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { sourceArchivePath, verifyReleaseSource } from '../../scripts/distribution/verify-release-source.mjs'

test('same-version code tampering is refused against integrity-verified release bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-proof-'))
  try {
    const published = join(root, 'published')
    const packageRoot = join(published, 'legacy-npm-prefix')
    await mkdir(packageRoot, { recursive: true })
    const identity = { name: '@deepseek-ai/source-proof-fixture', version: '1.0.0' }
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify(identity))
    await writeFile(join(packageRoot, 'entry.js'), 'export const official = true')
    await mkdir(join(packageRoot, 'lib', 'node_modules'), { recursive: true })
    await writeFile(join(packageRoot, 'lib', 'node_modules', 'runtime.js'), 'published nested runtime')
    const archive = join(root, 'published.tgz')
    const packed = spawnSync('tar', ['-czf', archive, '-C', published, 'legacy-npm-prefix'], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
    const bytes = await readFile(archive)
    const source = { ...identity, url: 'https://registry.npmjs.org/@deepseek-ai/source-proof-fixture/-/source-proof-fixture-1.0.0.tgz', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
    const cache = join(root, 'cache')
    await mkdir(cache)
    await writeFile(sourceArchivePath(cache, source), bytes)
    await verifyReleaseSource(packageRoot, source, cache, join(root, 'scratch'))
    await writeFile(join(packageRoot, 'entry.js'), 'export const patched = true')
    await assert.rejects(verifyReleaseSource(packageRoot, source, cache, join(root, 'scratch')), /differs from its published release: entry.js/)
    await writeFile(join(packageRoot, 'entry.js'), 'export const official = true')
    await writeFile(join(packageRoot, 'lib', 'node_modules', 'runtime.js'), 'tampered nested runtime')
    await assert.rejects(verifyReleaseSource(packageRoot, source, cache, join(root, 'scratch')), /lib\/node_modules\/runtime.js/)
    await writeFile(sourceArchivePath(cache, source), Buffer.from('corrupted cache'))
    await assert.rejects(verifyReleaseSource(packageRoot, source, cache, join(root, 'scratch')), /integrity mismatch/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
