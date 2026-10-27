import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { main, installEntrypoint } from '../../scripts/distribution/manager.mjs'
import { receiptReference, previousState, readSelection } from '../../scripts/distribution/lifecycle.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function generation(root, id, previous) {
  const state = { root, generation: join(root, 'versions', id), home: join(root, 'retained-data'), profile: id,
    node: process.execPath, officialBaseline: {}, previous }
  await mkdir(state.generation, { recursive: true })
  await writeFile(join(state.generation, 'installation.json'), JSON.stringify(state))
  return state
}
test('new receipt references bound state growth and preserve legacy rollback chains', async t => {
  const root = await fixture(t)
  const first = await generation(root, 'one')
  const legacy = await generation(root, 'two', first)
  const third = await generation(root, 'three', await receiptReference(legacy))
  assert.deepEqual(await previousState(third.previous, root), JSON.parse(JSON.stringify(legacy)))
  assert.deepEqual(await previousState(legacy.previous), first)
  let current = third
  for (let i = 0; i < 10; i++) current = await generation(root, `next-${i}`, await receiptReference(current))
  assert.equal(current.previous.previous, undefined)
  assert.equal(current.previous.officialBaseline, undefined)
  await assert.rejects(previousState({ ...third.previous, receipt: join(root, 'current.json') }, root), /belong to the referenced generation/)
  await assert.rejects(previousState(third.previous, current.generation), /inside the managed versions/)
  await writeFile(join(root, 'current.json'), JSON.stringify(third))
  await main(['rollback', '--root', root])
  assert.equal((await readSelection(root)).profile, 'two')
  await main(['rollback', '--root', root])
  assert.equal((await readSelection(root)).profile, 'one')
})
test('uninstall is idempotent and retains verified data/profile discovery and friendly launcher', async t => {
  const root = await fixture(t)
  const state = await generation(root, 'one')
  await mkdir(state.home)
  await writeFile(join(state.home, 'session'), 'keep')
  await installEntrypoint(state)
  await writeFile(join(state.generation, 'installation.json'), JSON.stringify(state))
  await writeFile(join(root, 'current.json'), JSON.stringify(state))
  await main(['uninstall', '--root', root])
  await main(['uninstall', '--root', root])
  assert.deepEqual(await main(['status', '--root', root]), { installed: false, recoverable: true })
  assert.equal((await readSelection(root)).home, state.home)
  assert.equal((await readSelection(root)).profile, state.profile)
  assert.equal(await readSelection(root, { recovery: false }), undefined)
  assert.equal(await readFile(join(state.home, 'session'), 'utf8'), 'keep')
  const result = spawnSync(process.execPath, [join(root, 'launch.mjs')], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not installed.*recover retained data/)
  assert.doesNotMatch(result.stderr, /ENOENT/)
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'launch.ps1')], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /not installed.*recover retained data/)
  }
  await writeFile(join(state.generation, 'installation.json'), '{}')
  await assert.rejects(readSelection(root), /receipt changed/)
})
test('uninstall on an empty root succeeds without manufacturing recovery state', async t => {
  const root = await fixture(t)
  await main(['uninstall', '--root', root])
  assert.equal(await readSelection(root), undefined)
})
