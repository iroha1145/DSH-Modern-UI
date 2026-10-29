import assert from 'node:assert/strict'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { API, PROBE, TARGET, MODERN, NULLABLE, DISABLED, LABELS, OWNERS } from './fixtures/lifecycle/protocol.mjs'
import { packFixture } from './pack-fixture.mjs'

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/lifecycle')

/** Build a private precompiled-JavaScript probe bundle, with its local target tgz inside. */
export async function prepareLifecycleFixture(output) {
  const directory = path.join(path.resolve(output), 'lifecycle-fixture')
  const target = path.join(directory, 'target/package')
  const probe = path.join(directory, 'probe/package')
  await Promise.all([mkdir(target, { recursive: true }), mkdir(path.join(probe, 'fixtures'), { recursive: true })])
  const save = (destination, name, value) => writeFile(path.join(destination, name), JSON.stringify(value, null, 2) + '\n')
  await save(target, 'package.json', { name: TARGET, version: '1.0.0', type: 'module', main: './index.mjs',
    peerDependencies: { [PROBE]: '1.0.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })
  await save(target, 'cordis.patch.yml', [{ insert: [{ id: TARGET, name: TARGET, config: { label: 'target', nullable: null, unknown: { retained: true } } }] }])
  await cp(path.join(source, 'target.mjs'), path.join(target, 'index.mjs'))
  const targetTarball = path.join(probe, 'fixtures/target.tgz')
  await packFixture(target, targetTarball)
  await save(probe, 'package.json', { name: PROBE, version: '1.0.0', type: 'module', main: './index.mjs',
    exports: { '.': './index.mjs', './sentinel': './sentinel.mjs', './contribution': './contribution.mjs', './package.json': './package.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } } })
  await save(probe, 'cordis.patch.yml', [{ insert: [
    { id: PROBE, name: PROBE },
    { id: NULLABLE, name: `${PROBE}/sentinel`, disabled: null, config: { label: 'nullable', nullable: null, unknown: { nested: ['keep', false, null] } }, metadata: { unknown: 'retained-nullable' } },
    { id: DISABLED, name: `${PROBE}/sentinel`, disabled: true, config: { label: 'disabled', nullable: null, unknown: { retained: 'disabled' } }, metadata: { unknown: 'retained-disabled' } },
  ] }])
  for (const name of ['protocol.mjs', 'contribution.mjs', 'sentinel.mjs']) await cp(path.join(source, name), path.join(probe, name))
  await cp(path.join(source, 'probe.mjs'), path.join(probe, 'index.mjs'))
  const tarball = path.join(directory, `${PROBE}-1.0.0.tgz`)
  await packFixture(probe, tarball)
  return tarball
}

/**
 * Exercise only public Host services after the caller authenticated the real CLI.
 * restart(changeResult) may restart that CLI and return its fresh {baseUrl,cookie}.
 * Browser state and official-file integrity remain the shared runner's responsibility.
 */
export async function runLifecycleChecks({ baseUrl, cookie, profile, output, restart, timeoutMs = 30_000 }) {
  assert.ok(baseUrl && cookie && typeof profile === 'string', 'Pass the authenticated final profile')
  const steps = []
  const restarts = []
  let modernOff = false
  let result
  const request = async (suffix, body) => {
    const response = await fetch(new URL(`${API}/${suffix}`, baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: new URL(baseUrl).origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000),
    })
    const text = await response.text()
    if (response.status !== 200) throw Object.assign(new Error(`${suffix}: ${response.status} ${text}`), { status: response.status })
    return JSON.parse(text)
  }
  const wait = async (description, predicate) => {
    const deadline = Date.now() + timeoutMs
    let state
    while (Date.now() < deadline) {
      try { state = await request('state') }
      catch (error) { if (error.status !== 404) throw error; await delay(100); continue }
      if (predicate(state)) return state
      await delay(100)
    }
    assert.fail(`${description} did not settle: ${JSON.stringify(state)}`)
  }
  const change = async (name, suffix, body = {}) => {
    const value = await request(suffix, body)
    steps.push({ name, result: value })
    assert.ok(['applied', 'restart-required'].includes(value.application), `${name}: ${JSON.stringify(value)}`)
    if (value.application === 'restart-required') {
      assert.equal(typeof restart, 'function', `${name} requires an actual CLI restart: ${value.restartReason}`)
      const connection = await restart(value)
      assert.ok(connection?.baseUrl && connection?.cookie, 'restart must return an authenticated connection')
      baseUrl = connection.baseUrl; cookie = connection.cookie
      restarts.push({ name, reason: value.restartReason })
    }
    return value
  }
  const targetState = (state, active) => {
    const entries = state.plugins.filter(entry => entry.moduleName === TARGET)
    return entries.length === 1 && entries[0].enabled === active && entries[0].fiberPhase === (active ? 'active' : null)
      && state.counts.target.active === Number(active) && state.tools.target === active
  }
  const noDuplicatesOrResidue = async (state, targetActive) => {
    assert.deepEqual(Object.fromEntries(LABELS.map(label => [label, state.counts[label].active])), { target: Number(targetActive), nullable: 1, disabled: 0 })
    assert.ok(LABELS.every(label => state.counts[label].maxActive <= 1), 'A fixture mounted twice concurrently')
    assert.deepEqual(state.tools, { target: targetActive, nullable: true, disabled: false })
    assert.deepEqual((await request('ping', {})).delta, { target: Number(targetActive), nullable: 1, disabled: 0 }, 'A disabled or duplicate listener remained')
    assert.equal(state.probeSelected, true)
  }
  const ownerState = (state, modernEnabled) => {
    const bundle = state.bundles.find(bundle => bundle.name === MODERN)
    if (bundle?.enabled !== modernEnabled) return false
    const modernEntries = state.plugins.filter(entry => entry.moduleName === MODERN)
    if (modernEnabled ? modernEntries.length !== 1 || modernEntries[0].fiberPhase !== 'active' : modernEntries.length !== 0) return false
    return OWNERS.every(owner => {
      const entries = state.plugins.filter(entry => entry.moduleName === owner.moduleName && entry.patchId === owner.id)
      return entries.length === 1 && entries[0].enabled === !modernEnabled && entries[0].fiberPhase === (modernEnabled ? null : 'active')
    })
  }
  try {
    const initial = await wait('probe and sentinel activation', state => state.counts.nullable.active === 1 && state.plugins.some(entry => entry.moduleName === PROBE && entry.fiberPhase === 'active'))
    assert.equal(initial.profile.name, profile)
    assert.equal(initial.targetInstalled, false, 'Use a fresh profile without the private lifecycle target')
    assert.ok(ownerState(initial, true), 'The final Modern bundle must initially own all seven surfaces')
    assert.equal(initial.preservedRows.find(row => row.id === NULLABLE)?.disabled, null)
    assert.equal(initial.preservedRows.find(row => row.id === DISABLED)?.disabled, true)
    await change('install-local-target', 'target/install')
    let state = await wait('target installation', state => state.targetInstalled && targetState(state, true))
    await noDuplicatesOrResidue(state, true)
    for (let cycle = 1; cycle <= 2; cycle++) {
      await change(`disable-target-${cycle}`, 'target/enabled', { enabled: false })
      state = await wait('target disablement', state => targetState(state, false))
      await noDuplicatesOrResidue(state, false)
      await change(`enable-target-${cycle}`, 'target/enabled', { enabled: true })
      state = await wait('target reactivation', state => targetState(state, true))
      await noDuplicatesOrResidue(state, true)
    }
    const preserved = { rows: state.preservedRows, patch: state.patchSha256, manifest: state.manifestWithoutBundlesSha256 }
    modernOff = true
    await change('disable-modern-bundle', 'modern/enabled', { enabled: false })
    state = await wait('seven official owners restored', state => ownerState(state, false))
    await noDuplicatesOrResidue(state, true)
    assert.deepEqual(state.preservedRows, preserved.rows)
    assert.equal(state.patchSha256, preserved.patch)
    assert.equal(state.manifestWithoutBundlesSha256, preserved.manifest)
    await change('enable-modern-bundle', 'modern/enabled', { enabled: true })
    state = await wait('Modern owner restoration', state => ownerState(state, true))
    modernOff = false
    await noDuplicatesOrResidue(state, true)
    assert.deepEqual(state.preservedRows, preserved.rows)
    assert.equal(state.patchSha256, preserved.patch)
    assert.equal(state.manifestWithoutBundlesSha256, preserved.manifest)
    await change('remove-local-target', 'target/remove')
    state = await wait('target removal', state => !state.targetInstalled && !state.plugins.some(entry => entry.moduleName === TARGET) && state.counts.target.active === 0 && !state.tools.target)
    await noDuplicatesOrResidue(state, false)
    assert.deepEqual(state.preservedRows, preserved.rows)
    assert.ok(ownerState(state, true))
    result = { status: 'passed', profile, steps, restarts, final: state,
      scope: 'Actual public Host management, Loader inventory, fixture registry and event lifecycle; browser checks run separately' }
    return result
  } catch (error) {
    result = { status: 'failed', profile, steps, restarts, error: error.stack }
    throw error
  } finally {
    if (modernOff) {
      try { await change('restore-modern-after-failure', 'modern/enabled', { enabled: true }) }
      catch (error) { result.cleanupError = error.stack }
    }
    if (output) { await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'lifecycle-result.json'), JSON.stringify(result, null, 2) + '\n') }
  }
}
