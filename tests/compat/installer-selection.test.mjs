import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { selectInstallHost, verifyPluginCompatibility, main } from '../../scripts/distribution/manager.mjs'
import { defaultHostVersion, supportedHostVersions, getHostCompatibility } from '../../scripts/distribution/compatibility.mjs'

async function fixture(t, version, name = '@deepseek-ai/dsh') {
  const directory = await mkdtemp(join(tmpdir(), 'compat-selection-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const backend = join(directory, 'package.json')
  await writeFile(backend, JSON.stringify({ name, version }))
  return { directory, backend }
}

test('fresh install selects only the manifest default or an exact requested host', async () => {
  assert.equal((await selectInstallHost({})).compatibility.officialSource.version, defaultHostVersion)
  for (const version of supportedHostVersions) {
    const selected = await selectInstallHost({ 'backend-version': version })
    assert.equal(selected.backend, undefined)
    assert.equal(selected.compatibility.officialSource.version, version)
  }
  for (const version of ['*', '>=0.2.1-rc.3', '0.2.1', '0.2.1-rc.999']) {
    await assert.rejects(selectInstallHost({ 'backend-version': version }))
  }
})

for (const version of supportedHostVersions) {
  test(`existing and previous ${version} remain selected with their source integrity`, async t => {
    const { backend } = await fixture(t, version)
    const original = await readFile(backend, 'utf8')
    for (const selected of [await selectInstallHost({ backend }), await selectInstallHost({}, { backend })]) {
      assert.equal(selected.backend, backend)
      assert.deepEqual(selected.compatibility.officialSource, getHostCompatibility(version).officialSource)
    }
    await assert.rejects(selectInstallHost({ backend, 'backend-version': '0.2.1-rc.999' }), /differs from the existing backend/)
    const alternate = await fixture(t, version)
    assert.equal((await selectInstallHost({ backend: alternate.backend }, { backend })).backend, alternate.backend)
    assert.equal(await readFile(backend, 'utf8'), original)
  })
}

test('unsupported or unrelated existing packages cannot silently use the default', async t => {
  const unsupported = await fixture(t, '0.2.1-rc.999')
  const unrelated = await fixture(t, defaultHostVersion, '@example/unrelated')
  await assert.rejects(selectInstallHost({ backend: unsupported.backend }))
  await assert.rejects(selectInstallHost({}, { backend: unsupported.backend }))
  await assert.rejects(selectInstallHost({ backend: unrelated.backend }), /name mismatch/)
})

test('artifact admission requires exact manifest declarations and no consumer build hooks', () => {
  for (const version of supportedHostVersions) {
    const compatibility = getHostCompatibility(version)
    const expected = compatibility.plugin
    const declaration = expected.compatibleHosts.join(' || ')
    const artifact = { name: expected.name, version: expected.version, dsh: { compatibleHost: declaration }, engines: { dsh: declaration } }
    verifyPluginCompatibility(artifact, compatibility)
    for (const value of ['*', '>=0.2.1-rc.3', '0.2.1-rc.999']) {
      assert.throws(() => verifyPluginCompatibility({ ...artifact, dsh: { compatibleHost: value } }, compatibility), /exact verified host set/)
      assert.throws(() => verifyPluginCompatibility({ ...artifact, engines: { dsh: value } }, compatibility), /exact verified host set/)
    }
    assert.throws(() => verifyPluginCompatibility({ ...artifact, scripts: { install: 'node compile.js' } }, compatibility), /build lifecycle/)
    assert.throws(() => verifyPluginCompatibility({ ...artifact, version: 'unverified' }, compatibility), /artifact identity/)
  }
})

test('unsupported host install fails before touching the data home or selecting a generation', async t => {
  const { directory, backend } = await fixture(t, '0.2.1-rc.999')
  const root = join(directory, 'program')
  const home = join(directory, 'untouched-home')
  const plugin = join(directory, 'plugin.tgz')
  const bytes = Buffer.from('selection is checked before archive extraction')
  await writeFile(plugin, bytes)
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  await assert.rejects(main(['install', '--root', root, '--home', home, '--backend', backend, '--plugin', plugin, '--plugin-integrity', integrity]))
  await assert.rejects(access(home), { code: 'ENOENT' })
  await assert.rejects(access(join(root, 'current.json')), { code: 'ENOENT' })
  await assert.rejects(access(join(root, 'versions')), { code: 'ENOENT' })
})

test('changing a managed host version fails before backup, staging, CLI execution, or selection changes', async t => {
  const { directory, backend } = await fixture(t, defaultHostVersion)
  const target = await fixture(t, defaultHostVersion === '0.2.1-rc.3' ? '0.2.1-rc.4' : '0.2.1-rc.3')
  const root = join(directory, 'program')
  const home = join(directory, 'existing-data')
  const generation = join(root, 'versions', 'existing')
  await mkdir(generation, { recursive: true })
  await mkdir(home)
  await writeFile(join(home, 'retained-data'), 'must not be touched')
  const previous = { root, generation, home, backend, profile: 'existing', officialSource: getHostCompatibility(defaultHostVersion).officialSource }
  const selection = JSON.stringify(previous)
  await writeFile(join(root, 'current.json'), selection)
  await writeFile(join(generation, 'installation.json'), selection)
  const plugin = join(directory, 'plugin.tgz')
  const bytes = Buffer.from('host selection must fail before archive extraction')
  await writeFile(plugin, bytes)
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
  const before = await readdir(root, { recursive: true })
  await assert.rejects(main(['install', '--root', root, '--home', home, '--backend', target.backend, '--plugin', plugin, '--plugin-integrity', integrity]), /new program root and isolated data copy/)
  assert.deepEqual(await readdir(root, { recursive: true }), before)
  assert.equal(await readFile(join(root, 'current.json'), 'utf8'), selection)
  assert.equal(await readFile(join(generation, 'installation.json'), 'utf8'), selection)
  assert.equal(await readFile(join(home, 'retained-data'), 'utf8'), 'must not be touched')
  assert.deepEqual(await readdir(home), ['retained-data'])
  await assert.rejects(selectInstallHost({}, { ...previous, officialSource: { ...previous.officialSource, version: 'changed' } }), /identity changed/)
})
