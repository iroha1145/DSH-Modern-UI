import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { preserveLegacySettings, transformProfileSettings, transformHostBindings,
  preserveConversationPreferences, transformConversationPreferences } from '../../scripts/distribution/profile-settings.mjs'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const model = { models: { 'my/model': { icon: 'letter', efforts: ['low', 'high'], priceInput: 1.23 } },
  prices: { 'my/model': { input: 1, output: 2, provider: 'fixture' } }, pricesUpdatedAt: '2026-10-27T00:00:00Z' }
const source = yaml.dump([{ id: 'ui-model-selection', config: model }, { id: 'ui-conversation', config: { busyEnter: 'queue', collapsedViews: ['agents'] } }])

test('copied picker settings retain every field and collapsedViews is preserved without claiming UI acceptance', () => {
  const converted = transformProfileSettings(source, yaml)
  const rows = yaml.load(converted.source, { schema: entryListSchema })
  assert.deepEqual(rows[0].config, model)
  assert.deepEqual(rows[2], { id: 'modern-ui', config: { ...model, collapsedViews: ['agents'] } })
  assert.match(converted.result.collapsedViews, /not yet accepted/)
  assert.deepEqual(transformProfileSettings(converted.source, yaml), { source: converted.source,
    result: { changed: false, movedFields: [], conversionVersion: 1 } })
})

test('conflicting modern settings and ambiguous layered rows refuse', () => {
  const collision = source + yaml.dump([{ id: 'modern-ui', config: { models: {} } }])
  assert.throws(() => transformProfileSettings(collision, yaml), /conflicts/)
  assert.throws(() => transformProfileSettings(source + source, yaml), /Multiple ui-model-selection/)
})

test('unrelated !!js is preserved without execution; computed migrated values refuse', () => {
  const expression = '- id: unrelated\n  config:\n    value: !!js process.exit(99)\n'
  const output = transformProfileSettings(expression + source, yaml)
  assert.match(output.source, /!!js process.exit\(99\)/)
  assert.throws(() => transformProfileSettings('- id: ui-model-selection\n  config: !!js process.exit(99)\n', yaml), /not evaluated/)
  assert.throws(() => transformProfileSettings('- id: ui-model-selection\n  config:\n    models: !!js process.exit(99)\n', yaml), /not evaluated/)
})

test('only the staged copy changes and its exact original remains recoverable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-profile-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = join(root, 'original.yml')
  const profile = join(root, 'profile')
  await writeFile(original, source)
  await cp(original, join(profile, 'cordis.patch.yml'), { recursive: true })
  const result = await preserveLegacySettings(profile, yaml)
  assert.equal(result.changed, true)
  assert.equal(await readFile(original, 'utf8'), source)
  assert.equal(await readFile(join(profile, result.backup), 'utf8'), source)
  assert.equal((await preserveLegacySettings(profile, yaml)).changed, false)
  const updated = yaml.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  updated.find(row => row.id === 'modern-ui').config.models['my/model'].quality = 5
  await writeFile(join(profile, 'cordis.patch.yml'), yaml.dump(updated))
  assert.equal((await preserveLegacySettings(profile, yaml)).alreadyMigrated, true)
  const preserved = yaml.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  assert.equal(preserved.find(row => row.id === 'modern-ui').config.models['my/model'].quality, 5)
})

test('Host replacement uses real public patch semantics and preserves configuration', () => {
  const effective = [
    { id: 'translator', name: '@deepseek-ai/dsh-experimental-translator', config: { timeoutMs: 4321 } },
    { id: 'fixture-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'fixture', command: 'fixture' } },
  ]
  const transformed = transformHostBindings('[]\n', yaml.dump(effective), yaml)
  const warnings = []
  const after = applyEntryPatches(effective, yaml.load(transformed.source, { schema: entryListSchema }), message => warnings.push(message))
  assert.deepEqual(warnings, [])
  assert.equal(after.find(row => row.id === 'translator').disabled, true)
  assert.equal(after.find(row => row.id === 'fixture-mcp').disabled, true)
  assert.deepEqual(after.find(row => row.id === 'modern-ui-compat-translator').config, effective[0].config)
  assert.equal(after.find(row => row.id === 'modern-ui-compat-translator').name, '@iroha1145/dsh-modern-ui/translator')
  assert.equal(after.find(row => row.id === 'modern-ui-compat-fixture-mcp').name, '@iroha1145/dsh-modern-ui/mcp-client')
  assert.equal(transformHostBindings(transformed.source, yaml.dump(after), yaml).result.changed, false)
})

test('Host replacement preserves an explicitly disabled feature and refuses ambiguous activation', () => {
  const disabled = [{ id: 'translator', name: '@deepseek-ai/dsh-experimental-translator', disabled: true }]
  assert.equal(transformHostBindings('[]', yaml.dump(disabled), yaml).result.changed, false)
  assert.throws(() => transformHostBindings('[]', '- id: translator\n  name: "@deepseek-ai/dsh-experimental-translator"\n  disabled: !!js true\n', yaml), /Computed activation/)
  assert.throws(() => transformHostBindings('[]', yaml.dump([{ id: 'group', group: true, config: [disabled.map(row => ({ ...row, disabled: false }))[0]] }]), yaml), /Nested translator/)
})

const ownerEntries = (original, modern = {}) => [
  { id: 'custom-conversation-id', name: '@deepseek-ai/dsh-client-ui-conversation', disabled: true, config: original },
  { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: modern },
]

test('conversation owner migration preserves busy Enter and pins across an original custom id', () => {
  const preferences = { busyEnter: 'steer', collapsedViews: ['agents', 'trajectory'] }
  const effective = ownerEntries(preferences, model)
  const input = yaml.dump([{ id: 'modern-ui', config: model }])
  const migrated = transformConversationPreferences(input, yaml.dump(effective), yaml)
  const patch = yaml.load(migrated.source, { schema: entryListSchema })
  assert.equal(patch.filter(row => row.id === 'modern-ui').length, 1)
  const composed = applyEntryPatches(effective, patch)
  assert.deepEqual(composed.find(row => row.id === 'modern-ui').config, { ...model, ...preferences })
  assert.deepEqual(composed[0].config, preferences)
  assert.equal(composed[0].disabled, true)
  const noPatchRow = transformConversationPreferences('[]', yaml.dump(effective), yaml)
  const complete = applyEntryPatches(effective, yaml.load(noPatchRow.source, { schema: entryListSchema }))
  assert.deepEqual(complete.find(row => row.id === 'modern-ui').config, { ...model, ...preferences })
})

test('explicit Modern preferences win, while computed or invalid source preferences refuse', () => {
  assert.equal(transformConversationPreferences('[]', yaml.dump(ownerEntries({ busyEnter: 'queue' }, { busyEnter: 'steer' })), yaml).result.changed, false)
  assert.throws(() => transformConversationPreferences('[]', yaml.dump(ownerEntries({ busyEnter: 'invented' })), yaml), /Invalid original/)
  assert.throws(() => transformConversationPreferences('[]', yaml.dump(ownerEntries({ collapsedViews: [true] })), yaml), /Invalid original/)
  const expression = '- id: custom\n  name: "@deepseek-ai/dsh-client-ui-conversation"\n  config: !!js process.exit(99)\n- id: modern-ui\n  name: "@iroha1145/dsh-modern-ui"\n'
  assert.throws(() => transformConversationPreferences('[]', expression, yaml), /not evaluated/)
})

test('conversation receipt upgrades a v1 model migration once without overwriting later preferences', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-conversation-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'cordis.patch.yml'), source)
  await preserveLegacySettings(root, yaml)
  const before = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  const first = await preserveConversationPreferences(root, yaml.dump(ownerEntries({ busyEnter: 'steer' }, model)), yaml)
  assert.deepEqual(first.movedFields, ['busyEnter'])
  assert.equal(await readFile(join(root, first.backup), 'utf8'), before)
  const changed = yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  changed.find(row => row.id === 'modern-ui').config.busyEnter = 'queue'
  await writeFile(join(root, 'cordis.patch.yml'), yaml.dump(changed))
  assert.equal((await preserveLegacySettings(root, yaml)).alreadyMigrated, true)
  assert.equal((await preserveConversationPreferences(root, yaml.dump(ownerEntries({ busyEnter: 'steer' })), yaml)).alreadyMigrated, true)
  assert.equal(yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8')).find(row => row.id === 'modern-ui').config.busyEnter, 'queue')
})
