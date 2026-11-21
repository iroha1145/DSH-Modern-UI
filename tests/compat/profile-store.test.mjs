import { onTestFinished, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureProfileStore } from '../../scripts/distribution/manager.mjs'

// The installer passes the official backend's own js-yaml; use the same copy here.
const yaml = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json'))('js-yaml')

async function profileWith(text) {
  const directory = await mkdtemp(join(tmpdir(), 'compat-profile-store-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'pnpm-workspace.yaml')
  if (text !== undefined) await writeFile(file, text)
  return { profile: directory, root: join(directory, 'program'), file }
}

for (const [label, text] of [
  ['double-quoted key', '"storeDir": /srv/shared-pnpm\npackages:\n  - .\n'],
  ['single-quoted key', "packages:\n  - .\n'storeDir': /srv/shared-pnpm\n"],
  ['flow mapping', '{ packages: [.], "storeDir": /srv/shared-pnpm }\n'],
  ['plain key', 'packages:\n  - .\nstoreDir: /srv/shared-pnpm\n'],
]) {
  test(`a ${label} storeDir the profile already chose is kept byte for byte`, async () => {
    const { profile, root, file } = await profileWith(text)
    const result = await ensureProfileStore(profile, root, yaml)
    assert.equal(result.pinned, false)
    assert.equal(await readFile(file, 'utf8'), text)
    assert.equal(yaml.load(await readFile(file, 'utf8')).storeDir, '/srv/shared-pnpm')
  })
}

test('a nested storeDir is not the workspace store, so the program store is still pinned', async () => {
  const text = '# my workspace\npackages:\n  - .\nsettings:\n  storeDir: /not/top-level\n'
  const { profile, root, file } = await profileWith(text)
  const result = await ensureProfileStore(profile, root, yaml)
  assert.equal(result.pinned, true)
  const written = await readFile(file, 'utf8')
  assert.ok(written.startsWith(text), 'comments and existing lines are kept')
  assert.deepEqual(yaml.load(written), { packages: ['.'], settings: { storeDir: '/not/top-level' }, storeDir: join(root, 'store') })
})

test('a missing or empty workspace file gets only the program store', async () => {
  for (const text of [undefined, '', '# comments only\n']) {
    const { profile, root, file } = await profileWith(text)
    assert.equal((await ensureProfileStore(profile, root, yaml)).pinned, true)
    assert.deepEqual(yaml.load(await readFile(file, 'utf8')), { storeDir: join(root, 'store') })
  }
})

test('a flow-mapping workspace without storeDir is rewritten with every existing entry kept', async () => {
  const { profile, root, file } = await profileWith('{ packages: [., "tools/*"], nodeLinker: hoisted }')
  const result = await ensureProfileStore(profile, root, yaml)
  assert.equal(result.pinned, true)
  assert.equal(result.rewritten, true)
  assert.deepEqual(yaml.load(await readFile(file, 'utf8')), { packages: ['.', 'tools/*'], nodeLinker: 'hoisted', storeDir: join(root, 'store') })
})

test('a program root with YAML-significant characters is written as one exact value', async () => {
  const { profile, file } = await profileWith('packages:\n  - .\n')
  const root = join(profile, "prog: 'x' [1] {a} 中文")
  await ensureProfileStore(profile, root, yaml)
  assert.equal(yaml.load(await readFile(file, 'utf8')).storeDir, join(root, 'store'))
})

test('a workspace file that is not a YAML mapping stops the install and stays untouched', async () => {
  for (const text of ['- not\n- a mapping\n', 'storeDir: /a\n"storeDir": /b\n', 'packages: [unclosed\n']) {
    const { profile, root, file } = await profileWith(text)
    await assert.rejects(ensureProfileStore(profile, root, yaml), /pnpm-workspace\.yaml/)
    assert.equal(await readFile(file, 'utf8'), text)
  }
})
