import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkIntegrity, snapshot, verifySnapshot } from '../../scripts/distribution/integrity.mjs'
import { main } from '../../scripts/distribution/manager.mjs'
import { acquireOperationLock } from '../../scripts/distribution/operation-lock.mjs'

test('official baseline detects changed, missing and added package code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-distribution-'))
  try {
    await writeFile(join(root, 'package.json'), '{"name":"official"}')
    await writeFile(join(root, 'entry.js'), 'export const version = 1')
    const before = await snapshot(root)
    assert.equal((await verifySnapshot(root, before)).unchanged, true)
    await writeFile(join(root, 'entry.js'), 'export const version = 2')
    await assert.rejects(verifySnapshot(root, before), /entry.js/)
    await rm(join(root, 'entry.js'))
    await assert.rejects(verifySnapshot(root, before), /entry.js/)
    await writeFile(join(root, 'injected.js'), 'patched')
    await assert.rejects(verifySnapshot(root, before), /injected.js/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reject incomplete downloads without accepting a matching version string', () => {
  const bytes = Buffer.from('complete npm archive')
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  checkIntegrity(bytes, integrity)
  assert.throws(() => checkIntegrity(bytes.subarray(0, 5), integrity), /mismatch/)
  assert.throws(() => checkIntegrity(bytes, undefined), /required/)
})

test('failed staging and concurrent operations preserve the old selection and data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-安装 failure-'))
  const original = '{"generation":"still runnable"}\n'
  try {
    await writeFile(join(root, 'current.json'), original)
    await assert.rejects(main(['install', '--root', root]), /requires/)
    assert.equal(await readFile(join(root, 'current.json'), 'utf8'), original)
    await writeFile(join(root, 'operation.lock'), 'historical user file')
    const lease = await acquireOperationLock(root)
    try { await assert.rejects(main(['uninstall', '--root', root]), { code: 'DSH_OPERATION_LOCKED' }) }
    finally { await lease.release() }
    assert.equal(await readFile(join(root, 'current.json'), 'utf8'), original)
    assert.equal(await readFile(join(root, 'operation.lock'), 'utf8'), 'historical user file')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failed staging removes only its own generation and staged profile', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-staging-cleanup-'))
  try {
    const root = join(scratch, 'program')
    const home = join(scratch, 'data')
    await mkdir(join(root, 'versions', 'kept-earlier-generation'), { recursive: true })
    await mkdir(join(home, 'profiles', 'web'), { recursive: true })
    await writeFile(join(home, 'profiles', 'web', 'package.json'), '{"name":"dsh-profile-web"}')
    const plugin = join(scratch, 'plugin.tgz')
    const bytes = Buffer.from('artifact bytes')
    await writeFile(plugin, bytes)
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
    const lock = join(scratch, 'runtime-lock.json')
    await writeFile(lock, JSON.stringify({ nodeVersion: '0.0.0', pnpmVersion: '0.0.0', node: {} }))
    await assert.rejects(main(['install', '--root', root, '--home', home, '--plugin', plugin, '--plugin-integrity', integrity, '--runtime-lock', lock]), /Missing exact runtime artifacts/)
    assert.deepEqual(await readdir(join(root, 'versions')), ['kept-earlier-generation'])
    assert.deepEqual(await readdir(join(home, 'profiles')), ['web'])
    assert.equal(existsSync(join(root, 'current.json')), false)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('uninstall only removes selected entry; preserves other profiles, sessions, official program', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-uninstall-'))
  try {
    const { root, home } = await saveFixture(scratch)
    await main(['uninstall', '--root', root])
    assert.equal(existsSync(join(root, 'current.json')), false)
    assert.equal(await readFile(join(root, 'official.js'), 'utf8'), 'official')
    assert.equal(await readFile(join(home, 'profiles', 'other-profile', 'settings.json'), 'utf8'), 'settings')
    assert.equal(await readFile(join(home, 'sessions', 'fixture.jsonl'), 'utf8'), 'retained session bytes')
    assert.equal(JSON.parse(await readFile(join(root, 'recovery.json'), 'utf8')).home, home)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
test('junction/symlink aliases cannot mix the program and data directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-path-boundary-'))
  try {
    const program = join(root, 'program')
    const alias = join(root, 'data-alias')
    await mkdir(program)
    await symlink(program, alias, 'junction')
    const plugin = join(root, 'plugin.tgz')
    const bytes = Buffer.from('artifact is checked before unpacking')
    await writeFile(plugin, bytes)
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
    await assert.rejects(main(['install', '--root', program, '--home', alias, '--plugin', plugin, '--plugin-integrity', integrity]), /separate after resolving/)
    const forbidden = join(program, 'must-not-be-created')
    await assert.rejects(main(['install', '--root', program, '--home', forbidden, '--plugin', plugin, '--plugin-integrity', integrity]), /separate after resolving/)
    assert.equal(existsSync(forbidden), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('copied production manager checks pinned community packages without a checkout manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-copied-manager-'))
  try {
    const generation = join(root, 'versions', 'fixture')
    const home = join(root, 'data-fixture')
    const profile = join(home, 'profiles', 'modern-fixture')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), '{"dependencies":{}}')
    await cp(fileURLToPath(new URL('../../scripts/distribution', import.meta.url)), join(generation, 'manager'), { recursive: true })
    await writeFile(join(root, 'current.json'), JSON.stringify({ root, generation, home, profile: 'modern-fixture', officialBaseline: {} }))
    const result = spawnSync(process.execPath, [join(generation, 'manager', 'manager.mjs'), 'community', '--root', root, '--check', 'true'], { cwd: home, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const plugins = JSON.parse(result.stdout)
    assert.equal(plugins.length, 3)
    assert.equal(plugins.every(plugin => plugin.state === 'missing' && plugin.integrity.startsWith('sha512-')), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
async function saveFixture(scratch) {
  const root = join(scratch, 'program')
  const home = join(scratch, 'data')
  const generation = join(root, 'versions', 'fixture')
  await mkdir(generation, { recursive: true })
  await mkdir(join(home, 'profiles', 'other-profile'), { recursive: true })
  await mkdir(join(home, 'sessions'))
  const state = JSON.stringify({ root, home, generation, profile: 'modern-fixture', officialBaseline: {} })
  await writeFile(join(root, 'current.json'), state)
  await writeFile(join(generation, 'installation.json'), state)
  await writeFile(join(root, 'official.js'), 'official')
  await writeFile(join(home, 'profiles', 'other-profile', 'settings.json'), 'settings')
  await writeFile(join(home, 'sessions', 'fixture.jsonl'), 'retained session bytes')
  return { root, home }
}
