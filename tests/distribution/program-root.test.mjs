import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { selectProgramRoot } from '../../scripts/distribution/program-root.mjs'

const posix = process.platform !== 'win32'
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-root-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const base = join(directory, 'user data 空格')
  await mkdir(base)
  return { directory, base }
}

test('default root selection uses lowercase POSIX, unchanged Windows default, and empty-XDG fallback', async t => {
  const { directory, base } = await fixture(t)
  assert.equal(selectProgramRoot({ platform: 'linux', env: { XDG_DATA_HOME: base } }), resolve(base, 'dsh-modern-ui/program'))
  assert.equal(selectProgramRoot({ platform: 'darwin', env: { XDG_DATA_HOME: '' }, home: directory }), resolve(directory, '.local/share/dsh-modern-ui/program'))
  assert.equal(selectProgramRoot({ platform: 'win32', env: { LOCALAPPDATA: base } }), resolve(base, 'DSH-Modern-UI/program'))
  assert.throws(() => selectProgramRoot({ platform: 'win32', env: {} }), /Pass --root/)
  assert.equal(selectProgramRoot({ root: join(directory, 'chosen'), platform: 'win32', env: {} }), resolve(directory, 'chosen'))
})

test('POSIX selection preserves the sole existing application directory and requires a choice for distinct directories', { skip: !posix }, async t => {
  const { base } = await fixture(t)
  const canonical = join(base, 'dsh-modern-ui')
  const legacy = join(base, 'DSH-Modern-UI')
  const choose = () => selectProgramRoot({ platform: 'linux', env: { XDG_DATA_HOME: base } })
  await mkdir(legacy)
  if (existsSync(canonical)) return t.skip('Requires a case-sensitive filesystem for distinct legacy and canonical directories')
  assert.equal(choose(), join(legacy, 'program'))
  await writeFile(join(legacy, 'retained-data'), 'retained')
  await mkdir(canonical)
  assert.throws(choose, /Both .*explicit program root/)
  assert.equal(selectProgramRoot({ root: join(legacy, 'program') }), join(legacy, 'program'))
  assert.equal(await readFile(join(legacy, 'retained-data'), 'utf8'), 'retained')
  await rm(legacy, { recursive: true })
  assert.equal(choose(), join(canonical, 'program'))
  await symlink(canonical, legacy, 'dir')
  assert.equal(choose(), join(canonical, 'program'))
})

test('POSIX selection accepts filesystem aliases without a false ambiguity', async t => {
  const { base } = await fixture(t)
  const canonical = join(base, 'dsh-modern-ui')
  const legacy = join(base, 'DSH-Modern-UI')
  await mkdir(canonical)
  if (!existsSync(legacy)) await symlink(canonical, legacy, 'dir')
  assert.equal(selectProgramRoot({ platform: 'linux', env: { XDG_DATA_HOME: base } }), join(canonical, 'program'))
})

