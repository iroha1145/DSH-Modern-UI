import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyRelease } from '../scripts/verify-release.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'dsh-release-check-'))
  roots.push(root)
  const patch = 'diff --git a/example b/example\n--- a/example\n+++ b/example\n@@ -1 +1 @@\n-old\n+new\n'
  writeFileSync(resolve(root, 'patch'), patch)
  const manifest = { upstream: { commit: '1'.repeat(40), tarballSha256: '2'.repeat(64) }, patch: { file: 'patch', sha256: createHash('sha256').update(patch).digest('hex') } }
  writeFileSync(resolve(root, 'dsh-ui.json'), JSON.stringify(manifest))
  return { root, manifest }
}

test('checks the real release manifest and patch', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  assert.match(verifyRelease(root).sha256, /^[a-f0-9]{64}$/)
})
test('rejects changed patch bytes, mutable refs and paths outside the release', () => {
  const { root, manifest } = fixture()
  assert.equal(verifyRelease(root).upstream, '1'.repeat(40))
  writeFileSync(resolve(root, 'patch'), `${readFileSync(resolve(root, 'patch'), 'utf8')}\n`)
  assert.throws(() => verifyRelease(root), /SHA-256/)
  manifest.upstream.commit = 'main'
  writeFileSync(resolve(root, 'dsh-ui.json'), JSON.stringify(manifest))
  assert.throws(() => verifyRelease(root), /immutable/)
  manifest.upstream.commit = '1'.repeat(40)
  manifest.patch.file = '../outside.patch'
  writeFileSync(resolve(root, 'dsh-ui.json'), JSON.stringify(manifest))
  assert.throws(() => verifyRelease(root), /inside/)
})
test('checks actual applied files and rejects a missing or altered patch', () => {
  const { root } = fixture()
  const source = resolve(root, 'source')
  mkdirSync(source)
  writeFileSync(resolve(source, 'example'), 'old\n')
  assert.throws(() => verifyRelease(root, source))
  execFileSync('git', ['apply', resolve(root, 'patch')], { cwd: source, env: { ...process.env, GIT_CEILING_DIRECTORIES: root } })
  assert.equal(verifyRelease(root, source).appliedSource, source)
  writeFileSync(resolve(source, 'example'), 'changed\n')
  assert.throws(() => verifyRelease(root, source))
})
