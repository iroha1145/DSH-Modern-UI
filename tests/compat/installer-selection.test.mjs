import { onTestFinished, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, access, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { selectInstallHost, verifyPluginCompatibility, main } from '../../scripts/distribution/manager.mjs'
import {
  defaultHostVersion,
  hostRange,
  supportedHostVersions,
  getHostCompatibility,
  satisfiesRange,
  compareVersions,
} from '../../scripts/distribution/compatibility.mjs'

async function fixture(version, name = '@deepseek-ai/dsh') {
  // selectInstallHost resolves real paths; macOS temp directories sit behind the /var symlink.
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'compat-selection-')))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const backend = join(directory, 'package.json')
  await writeFile(backend, JSON.stringify({ name, version }))
  return { directory, backend }
}

test('fresh install selects the manifest default or a requested host inside the range', async () => {
  assert.equal((await selectInstallHost({})).compatibility.officialSource.version, defaultHostVersion)
  for (const version of supportedHostVersions) {
    const selected = await selectInstallHost({ 'backend-version': version })
    assert.equal(selected.backend, undefined)
    assert.equal(selected.compatibility.officialSource.version, version)
  }
  // Invalid, out of range, or known broken: refused before any download.
  for (const version of ['*', '>=0.2.1-rc.3', '0.2.0', '0.3.0', '0.3.0-rc.1', '0.2.1-rc.1', '0.2.2-alpha.2']) {
    await assert.rejects(selectInstallHost({ 'backend-version': version }))
  }
})

for (const version of supportedHostVersions) {
  test(`existing and previous ${version} remain selected with their source integrity`, async () => {
    const { backend } = await fixture(version)
    const original = await readFile(backend, 'utf8')
    for (const selected of [await selectInstallHost({ backend }), await selectInstallHost({}, { backend })]) {
      assert.equal(selected.backend, backend)
      assert.deepEqual(selected.compatibility.officialSource, getHostCompatibility(version).officialSource)
    }
    await assert.rejects(selectInstallHost({ backend, 'backend-version': '0.2.1-rc.999' }), /differs from the existing backend/)
    const alternate = await fixture(version)
    assert.equal((await selectInstallHost({ backend: alternate.backend }, { backend })).backend, alternate.backend)
    assert.equal(await readFile(backend, 'utf8'), original)
  })
}

test('host range follows SemVer precedence and the npm prerelease rule', () => {
  for (const version of supportedHostVersions) assert.ok(satisfiesRange(version, hostRange))
  for (const version of ['0.2.1-rc.5', '0.2.1-rc.10', '0.2.1', '0.2.2', '0.2.9']) assert.ok(satisfiesRange(version, hostRange), version)
  for (const version of ['0.2.1-rc.1', '0.2.1-alpha.5', '0.2.2-alpha.2', '0.3.0', '0.3.0-rc.1', '0.2.0', '1.0.0', 'latest']) {
    assert.equal(satisfiesRange(version, hostRange), false, version)
  }
  assert.ok(compareVersions('0.2.1-rc.10', '0.2.1-rc.9') > 0)
  assert.ok(compareVersions('0.2.1', '0.2.1-rc.9') > 0)
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0-alpha.1') < 0)
  assert.ok(compareVersions('1.0.0-alpha.beta', '1.0.0-alpha.1') > 0)
})

test('an existing host inside the range is allowed unverified, without community plugins or a pinned source', async () => {
  const { backend } = await fixture('0.2.1-rc.999')
  const selected = await selectInstallHost({ backend })
  assert.equal(selected.backend, backend)
  assert.equal(selected.compatibility.status, 'unverified')
  assert.match(selected.compatibility.warning, /has not been verified/)
  assert.deepEqual(selected.compatibility.communityPlugins, [])
  assert.equal(selected.compatibility.officialSource.integrity, undefined)
  const broken = await fixture('0.2.2-alpha.2')
  await assert.rejects(selectInstallHost({ backend: broken.backend }), /known to be incompatible/)
})

test('unsupported or unrelated existing packages cannot silently use the default', async () => {
  const unsupported = await fixture('0.3.0')
  const unrelated = await fixture(defaultHostVersion, '@example/unrelated')
  await assert.rejects(selectInstallHost({ backend: unsupported.backend }))
  await assert.rejects(selectInstallHost({}, { backend: unsupported.backend }))
  await assert.rejects(selectInstallHost({ backend: unrelated.backend }), /name mismatch/)
})

test('artifact admission requires the manifest host range and no consumer build hooks', () => {
  for (const version of supportedHostVersions) {
    const compatibility = getHostCompatibility(version)
    const expected = compatibility.plugin
    const declaration = expected.hostRange
    const artifact = { name: expected.name, version: expected.version, dsh: { compatibleHost: declaration }, engines: { dsh: declaration } }
    verifyPluginCompatibility(artifact, compatibility)
    for (const value of ['*', '>=0.2.1-rc.3', '0.2.1-rc.999', supportedHostVersions.join(' || ')]) {
      assert.throws(() => verifyPluginCompatibility({ ...artifact, dsh: { compatibleHost: value } }, compatibility), /host range/)
      assert.throws(() => verifyPluginCompatibility({ ...artifact, engines: { dsh: value } }, compatibility), /host range/)
    }
    assert.throws(() => verifyPluginCompatibility({ ...artifact, scripts: { install: 'node compile.js' } }, compatibility), /build lifecycle/)
    assert.throws(() => verifyPluginCompatibility({ ...artifact, version: 'unverified' }, compatibility), /artifact identity/)
  }
})

test('unsupported host install fails before touching the data home or selecting a generation', async () => {
  const { directory, backend } = await fixture('0.3.0')
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

test('changing a managed host version fails before backup, staging, CLI execution, or selection changes', async () => {
  const { directory, backend } = await fixture(defaultHostVersion)
  const target = await fixture(defaultHostVersion === '0.2.1-rc.3' ? '0.2.1-rc.4' : '0.2.1-rc.3')
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
  await assert.rejects(
    main(['install', '--root', root, '--home', home, '--backend', target.backend, '--plugin', plugin, '--plugin-integrity', integrity]),
    /new program root and isolated data copy/,
  )
  assert.deepEqual(await readdir(root, { recursive: true }), before)
  assert.equal(await readFile(join(root, 'current.json'), 'utf8'), selection)
  assert.equal(await readFile(join(generation, 'installation.json'), 'utf8'), selection)
  assert.equal(await readFile(join(home, 'retained-data'), 'utf8'), 'must not be touched')
  assert.deepEqual(await readdir(home), ['retained-data'])
  await assert.rejects(selectInstallHost({}, { ...previous, officialSource: { ...previous.officialSource, version: 'changed' } }), /identity changed/)
})
