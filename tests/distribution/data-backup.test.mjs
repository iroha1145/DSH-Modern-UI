import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupDataHome } from '../../scripts/distribution/data-backup.mjs'
import { acquireOperationLock } from '../../scripts/distribution/operation-lock.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-backup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'data'), program = join(root, 'program')
  await mkdir(home); await mkdir(program)
  return { home, program }
}
test('complete backup retains sessions, attachments, profiles and empty directories', async t => {
  const { home, program } = await fixture(t)
  assert.equal((await backupDataHome(home, program)).state, 'empty-home')
  await mkdir(join(home, 'empty'))
  for (const name of ['sessions.jsonl', 'attachment.bin', 'profile.yml']) await writeFile(join(home, name), name)
  const result = await backupDataHome(home, program)
  assert.equal(result.state, 'verified')
  assert.deepEqual(await readdir(join(result.path, 'data')), await readdir(home))
  assert.equal(await readFile(join(result.path, 'data', 'sessions.jsonl'), 'utf8'), 'sessions.jsonl')
  const lease = await acquireOperationLock(home)
  try { await assert.rejects(acquireOperationLock(home), { code: 'DSH_OPERATION_LOCKED' }) }
  finally { await lease.release() }
})
test('changing source, copy failure and insufficient space do not publish incomplete backups', async t => {
  const { home, program } = await fixture(t)
  await writeFile(join(home, 'session'), 'original')
  await assert.rejects(backupDataHome(home, program, { copy: async (...args) => { await cp(...args); await writeFile(join(home, 'session'), 'changed') } }), /changed/)
  assert.deepEqual(await readdir(join(program, 'data-backups')), [])
  assert.equal(await readFile(join(home, 'session'), 'utf8'), 'changed')
  await assert.rejects(backupDataHome(home, program, { copy: async () => { throw new Error('disk failure') } }), /disk failure/)
  assert.deepEqual(await readdir(join(program, 'data-backups')), [])
  await assert.rejects(backupDataHome(home, program, { space: async () => ({ bavail: 0n, bsize: 4096n }) }), /Insufficient/)
  await assert.rejects(backupDataHome(home, home), /separate/)
})
test('a copy left by an interrupted run is removed before the next backup, published backups stay', async t => {
  const { home, program } = await fixture(t)
  await writeFile(join(home, 'session'), 'original')
  const published = await backupDataHome(home, program)
  const stale = join(program, 'data-backups', 'home-00000000-0000-4000-8000-000000000000.pending')
  await mkdir(join(stale, 'data'), { recursive: true })
  await writeFile(join(stale, 'data', 'session'), 'partial')
  await writeFile(join(program, 'data-backups', 'notes.pending'), 'not a backup copy')
  const next = await backupDataHome(home, program)
  assert.deepEqual((await readdir(join(program, 'data-backups'))).sort(),
    [published.path, next.path].map(path => path.slice(path.lastIndexOf('home-'))).concat('notes.pending').sort())
})
