import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { validateUiOwnerBindings } from '../../scripts/distribution/profile-settings.mjs'

const requireHost = createRequire(process.env.COMPAT_BACKEND_PACKAGE ? resolve(process.env.COMPAT_BACKEND_PACKAGE) : new URL('../../package.json', import.meta.url))
const yaml = requireHost('js-yaml')
const bundle = await readFile(new URL('../../packages/modern-ui/cordis.patch.yml', import.meta.url), 'utf8')
const expected = yaml.load(bundle).filter(row => row.disabled === true)
const effective = () => expected.map(({ id, name }) => ({ id, name, config: { userPreference: 'preserved' } }))
const dump = rows => yaml.dump(rows, { lineWidth: -1 })

test('packaged owner mappings accept default and nullable activation without changing source rows', () => {
  for (const disabled of [undefined, null, false, true]) {
    const rows = effective().map(row => disabled === undefined ? row : { ...row, disabled })
    const before = structuredClone(rows)
    const source = dump(rows)
    const result = validateUiOwnerBindings(bundle, source, yaml)
    assert.deepEqual(result, expected.map(({ id, name }) => ({ id, name, ...(disabled === undefined ? {} : { disabled }) })))
    assert.deepEqual(rows, before)
    assert.equal(dump(rows), source)
  }
})

for (const [name, change] of [
  ['custom owner id', rows => { rows[0].id = 'user-custom-layout' }],
  ['duplicate owner module', rows => { rows.push({ ...rows[0], id: 'another-layout' }) }],
  ['duplicate owner id', rows => { rows.push({ id: rows[0].id, name: '@example/other-plugin' }) }],
  ['nested group owner', rows => { const owner = rows.shift(); rows.push({ id: 'group', group: true, config: [owner] }) }],
  ['nested plugin owner', rows => { const owner = rows.shift(); rows.push({ id: 'preset', config: { plugins: [owner] } }) }],
  ['owner replaced by group', rows => { rows[0].group = true; rows[0].config = [] }],
  ['missing owner', rows => { rows.shift() }],
]) {
  test(`owner admission rejects ${name} without rewriting configuration`, () => {
    const rows = effective()
    change(rows)
    const source = dump(rows)
    assert.throws(() => validateUiOwnerBindings(bundle, source, yaml), /requires one top-level entry/)
    assert.equal(dump(rows), source)
  })
}

test('owner admission rejects a real !!js activation without evaluating it', () => {
  const rows = effective()
  rows[0].disabled = null
  const source = dump(rows).replace('disabled: null', 'disabled: !!js "globalThis.__ownerGuardExecuted = true"')
  assert.throws(() => validateUiOwnerBindings(bundle, source, yaml), /Computed activation/)
  assert.equal(globalThis.__ownerGuardExecuted, undefined)
})
