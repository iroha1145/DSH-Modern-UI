import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { zipSync, strToU8 } from 'fflate'
import { archiveEntries, unpack } from '../../scripts/distribution/artifacts.mjs'

test('archive validation rejects Windows roots, drive-relative and alternate streams on every platform', () => {
  assert.deepEqual(archiveEntries('package/\n./package/index.js\n'), ['package/', './package/index.js'])
  for (const entry of ['/root/entry', '../entry', 'package/../entry', 'package\\..\\entry',
    'C:/entry', 'C:entry', '\\entry', '\\\\host\\share\\entry', './C:/entry', '././C:entry', 'package/file:stream']) {
    assert.throws(() => archiveEntries(entry + '\n'), /Unsafe archive entry/, entry)
  }
})

test('real archive extraction works from Unicode program roots with a nonstandard archive extension', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const generation = join(root, 'program \u7a7a\u683c', 'versions', 'fixture')
  await mkdir(generation, { recursive: true })
  const archive = join(generation, 'node.archive')
  if (process.platform === 'win32') {
    await writeFile(archive, zipSync({ 'runtime/bin/marker.txt': strToU8('official fixture bytes') }))
  } else {
    const payload = join(root, 'payload')
    await mkdir(join(payload, 'runtime/bin'), { recursive: true })
    await writeFile(join(payload, 'runtime/bin/marker.txt'), 'official fixture bytes')
    const packed = spawnSync('tar', ['-czf', archive, '-C', payload, 'runtime'], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
  }
  const target = join(generation, 'runtime')
  const entries = await unpack(archive, target)
  assert.ok(entries.includes('runtime/bin/marker.txt'))
  assert.equal(await readFile(join(target, 'runtime/bin/marker.txt'), 'utf8'), 'official fixture bytes')
})

test('archive inspection retains actionable executable and archive errors', async () => {
  await assert.rejects(unpack(join(tmpdir(), 'does-not-exist-dsh-archive.tgz'), join(tmpdir(), 'unused-dsh-archive-target')),
    error => /Cannot inspect release archive/.test(error.message) && error.message.includes('tar') && error.message.length > 55)
})
