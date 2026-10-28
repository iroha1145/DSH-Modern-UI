import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { preserveEffectivePreferences, transformEffectivePreferences, preserveLegacySettings, transformProfileSettings, transformHostBindings,
  preserveConversationPreferences, transformConversationPreferences, preserveChatPreferences, transformChatPreferences } from '../../scripts/distribution/profile-settings.mjs'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as baseline from './fixtures/profile-settings-bb606b3.mjs'

const PICKER_VALUES = { models: { 'inherited/model': { label: 'Inherited model', quality: 4 } },
  prices: { 'inherited/model': { input: 1, output: 2 } } }
async function generatedPickerProfile(t, { effectiveReceipt = false, initialPatch } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'modern-generated-picker-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const bundle = yaml.load(await readFile(new URL('../../packages/modern-ui/cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema })
  const official = bundle.filter(row => row.id && row.name).map(row => ({ id: row.id, name: row.name, config:
    row.name === '@deepseek-ai/dsh-client-ui-model-selection' ? PICKER_VALUES
      : row.name === '@deepseek-ai/dsh-client-ui-conversation' ? { busyEnter: 'steer', collapsedViews: ['agents'] } : {} }))
  const base = applyEntryPatches(official, bundle, message => assert.fail(message))
  const filename = join(profile, 'cordis.patch.yml')
  await writeFile(filename, initialPatch ?? '[]\n')
  const compose = async () => yaml.dump(applyEntryPatches(base,
    yaml.load(await readFile(filename, 'utf8'), { schema: entryListSchema }), message => assert.fail(message)), { schema: entryListSchema })
  // Execute the real baseline writer; the empty maps come from the actual
  // shipped bundle and are copied by its unmodified conversation converter.
  const conversation = await baseline.preserveConversationPreferences(profile, await compose(), yaml)
  assert.equal(conversation.changed, true)
  const emitted = yaml.load(await readFile(filename, 'utf8')).find(row => row.id === 'modern-ui').config
  assert.deepEqual(emitted.models, {})
  assert.deepEqual(emitted.prices, {})
  if (effectiveReceipt) {
    const effective = await baseline.preserveEffectivePreferences(profile, await compose(), await compose(), yaml)
    assert.equal(effective.conversionVersion, 2)
    assert.deepEqual(effective.movedFields, [], 'baseline mistakes the conversation-written defaults for user overrides')
    assert.equal((await baseline.preserveEffectivePreferences(profile, await compose(), await compose(), yaml)).alreadyMigrated, true)
  }
  return { profile, filename, compose, conversation }
}

test('baseline conversation writer remains byte-equivalent to the frozen reproduction', async () => {
  const frozen = await readFile(new URL('./fixtures/profile-settings-bb606b3.mjs', import.meta.url), 'utf8')
  assert.equal(createHash('sha256').update(frozen.slice(frozen.indexOf('\n') + 1)).digest('hex'), '645cb341f599a6dadd1c68fbf444b368717b641c83a4d4069545b433aae2873f')
  const normalize = value => value.toString().replaceAll('\r\n', '\n')
  assert.equal(normalize(preserveConversationPreferences), normalize(baseline.preserveConversationPreferences))
  assert.equal(normalize(transformConversationPreferences), normalize(baseline.transformConversationPreferences))
})

for (const effectiveReceipt of [false, true]) test(`recover generated picker defaults from the real conversation writer${effectiveReceipt ? ' after a real v2 effective receipt' : ''}`, async t => {
  const f = await generatedPickerProfile(t, { effectiveReceipt })
  const before = await f.compose()
  const original = await readFile(f.filename, 'utf8')
  const receipts = ['modern-ui-conversation-migration.json', ...(effectiveReceipt ? ['modern-ui-effective-preferences-v1.json'] : [])]
  const retained = new Map(await Promise.all(receipts.map(async name => [name, await readFile(join(f.profile, name), 'utf8')])))
  const result = await preserveEffectivePreferences(f.profile, before, before, yaml)
  assert.deepEqual(result.pickerDefaultsRecovery.recoveredFields, ['models', 'prices'])
  assert.equal(await readFile(join(f.profile, result.pickerDefaultsRecovery.backup), 'utf8'), original)
  for (const [name, bytes] of retained) assert.equal(await readFile(join(f.profile, name), 'utf8'), bytes)
  const modern = yaml.load(await readFile(f.filename, 'utf8')).find(row => row.id === 'modern-ui').config
  assert.deepEqual(modern.models, PICKER_VALUES.models)
  assert.deepEqual(modern.prices, PICKER_VALUES.prices)
  assert.equal(modern.busyEnter, 'steer')
  assert.deepEqual(modern.collapsedViews, ['agents'])
})

test('generated picker defaults follow real chat and effective receipt transitions without replaying preferences', async t => {
  const initialPatch = yaml.dump([{ id: 'ui-chat', config: { foldedReplies: 'final' } }])
  const f = await generatedPickerProfile(t, { initialPatch })
  assert.equal((await baseline.preserveChatPreferences(f.profile, yaml)).changed, true)
  await baseline.preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)
  const result = await preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)
  assert.deepEqual(result.pickerDefaultsRecovery.recoveredFields, ['models', 'prices'])
  assert.ok(Object.hasOwn(result.pickerDefaultsRecovery.receipts, 'modern-ui-chat-migration.json'))
  const modern = yaml.load(await readFile(f.filename, 'utf8')).find(row => row.id === 'modern-ui').config
  assert.deepEqual(modern.models, PICKER_VALUES.models)
  assert.equal(modern.foldedReplies, 'final')
  assert.equal(modern.busyEnter, 'steer')
})

test('generated picker defaults recovery preserves preexisting explicit empty maps', async t => {
  // This is an actual user override before the baseline writer, not an
  // imitation of its generated output used to set up a positive test.
  const initialPatch = yaml.dump([{ id: 'modern-ui', config: { models: {}, prices: {} } }])
  const f = await generatedPickerProfile(t, { initialPatch, effectiveReceipt: true })
  const original = await readFile(f.filename, 'utf8')
  const result = await preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)
  assert.equal(result.changed, false)
  assert.equal(await readFile(f.filename, 'utf8'), original)
  await assert.rejects(readFile(join(f.profile, 'modern-ui-picker-defaults-recovery-v1.json')), { code: 'ENOENT' })
})

for (const edit of ['clear-after-recovery', 'change-after-recovery']) test(`generated picker defaults recovery never replays a user's ${edit}`, async t => {
  const f = await generatedPickerProfile(t, { effectiveReceipt: true })
  await preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)
  const patch = yaml.load(await readFile(f.filename, 'utf8'))
  const modern = patch.find(row => row.id === 'modern-ui')
  modern.config.models = edit === 'clear-after-recovery' ? {} : { user: { label: 'User edited' } }
  modern.config.prices = {}
  const edited = yaml.dump(patch, { lineWidth: -1, noCompatMode: true })
  await writeFile(f.filename, edited)
  const result = await preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)
  assert.equal(result.changed, false)
  assert.equal(result.pickerDefaultsRecovery.alreadyRecovered, true)
  assert.equal(await readFile(f.filename, 'utf8'), edited)
})

for (const damage of ['edited-profile', 'missing-receipt', 'altered-backup', 'altered-output-digest']) test(`generated picker defaults recovery declines ${damage}`, async t => {
  const f = await generatedPickerProfile(t, { effectiveReceipt: true })
  if (damage === 'edited-profile') {
    const patch = yaml.load(await readFile(f.filename, 'utf8'))
    const modern = patch.find(row => row.id === 'modern-ui')
    modern.config.models = { temporarilyChosen: {} }
    await writeFile(f.filename, yaml.dump(patch))
    modern.config.models = {}
    modern.config.busyEnter = 'queue'
    await writeFile(f.filename, yaml.dump(patch))
  } else if (damage === 'missing-receipt') await rm(join(f.profile, 'modern-ui-conversation-migration.json'))
  else if (damage === 'altered-backup') await writeFile(join(f.profile, 'modern-ui-conversation-before-migration.yml'), '# altered evidence\n[]\n')
  else {
    const path = join(f.profile, 'modern-ui-conversation-migration.json')
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    receipt.migratedSha256 = '0'.repeat(64)
    await writeFile(path, JSON.stringify(receipt))
  }
  const original = await readFile(f.filename, 'utf8')
  assert.equal((await preserveEffectivePreferences(f.profile, await f.compose(), await f.compose(), yaml)).changed, false)
  assert.equal(await readFile(f.filename, 'utf8'), original)
  await assert.rejects(readFile(join(f.profile, 'modern-ui-picker-defaults-recovery-v1.json')), { code: 'ENOENT' })
})

test('effective preferences preserve inherited values by module name and explicit Modern overrides', () => {
  const inherited = [
    { id: 'custom-picker', name: '@deepseek-ai/dsh-client-ui-model-selection', config: { models: { inherited: { quality: 3 } }, prices: { inherited: 2 } } },
    { id: 'custom-chat', name: '@deepseek-ai/dsh-client-ui-chat', config: { foldedReplies: 'final', linkOpening: 'new-tab' } },
  ]
  const modern = { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { models: {}, prices: {}, busyEnter: 'steer' } }
  const result = transformEffectivePreferences('- id: modern-ui\n  config: {linkOpening: sidebar}\n', yaml.dump(inherited), yaml.dump([...inherited, modern]), yaml)
  const applied = applyEntryPatches([...inherited, modern], yaml.load(result.source, { schema: entryListSchema }), () => {})
  const config = applied.find(row => row.id === 'modern-ui').config
  assert.deepEqual(config.models, inherited[0].config.models)
  assert.equal(config.foldedReplies, 'final')
  assert.equal(config.busyEnter, 'steer')
  assert.equal(config.linkOpening, 'sidebar')
  const upgrade = transformEffectivePreferences('[]', yaml.dump([...inherited, modern]), yaml.dump([...inherited, modern]), yaml)
  assert.deepEqual(yaml.load(upgrade.source)[0].config.models, inherited[0].config.models)
  const emptyOverride = transformEffectivePreferences('- id: modern-ui\n  config: {models: {}}', yaml.dump([...inherited, modern]), yaml.dump([...inherited, modern]), yaml)
  assert.deepEqual(yaml.load(emptyOverride.source)[0].config.models, {})
  assert.throws(() => transformEffectivePreferences('[]', yaml.dump([...inherited, inherited[0]]), yaml.dump([modern]), yaml), /Multiple/)
})

test('effective migration upgrades patch-only receipts once and retains later edits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-effective-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(root, 'modern-ui-chat-migration.json'), '{"conversionVersion":2}\n')
  const before = [{ id: 'chat', name: '@deepseek-ai/dsh-client-ui-chat', config: { foldedReplies: 'final' } }]
  const after = [...before, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { models: {} } }]
  const result = await preserveEffectivePreferences(root, yaml.dump(before), yaml.dump(after), yaml)
  assert.deepEqual(result.movedFields, ['foldedReplies'])
  assert.equal(await readFile(join(root, result.backup), 'utf8'), '[]\n')
  await writeFile(join(root, 'cordis.patch.yml'), '- id: modern-ui\n  config: {foldedReplies: all}\n')
  assert.equal((await preserveEffectivePreferences(root, yaml.dump(before), yaml.dump(after), yaml)).alreadyMigrated, true)
  assert.match(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), /foldedReplies: all/)
})

test('document migration preserves separate manager/market policies and Modern overrides', () => {
  const before = [
    { id: 'custom-manager', name: '@deepseek-ai/dsh-plugin-manager', config: { detailMaxBytes: 1000, detailImageMaxBytes: 101,
      detailFetchTimeoutMs: 1100, detailNpmFileSources: ['npmmirror'] } },
    { id: 'custom-market', name: '@deepseek-ai/dsh-plugin-market', config: { detailMaxBytes: 2000, detailImageMaxBytes: 202,
      fetchTimeoutMs: 2200, cacheTtlMs: 2300, detailNpmFileSources: ['jsdelivr'], detailGitlabHosts: ['gitlab.example.org'],
      detailRepositoryMaxBytes: 3000, detailCacheMaxBytes: 4000, detailCacheDir: '.old-market-cache', detailGitTimeoutMs: 5000 } },
  ]
  const docs = { id: 'modern-plugin-documents', name: '@iroha1145/dsh-modern-ui/plugin-documents',
    config: { maxImageBytes: 999, market: { npmFileSources: ['unpkg'] } } }
  const after = [...before, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: {} }, docs]
  const transformed = transformEffectivePreferences('[]', yaml.dump(before), yaml.dump(after), yaml)
  const applied = applyEntryPatches(after, yaml.load(transformed.source, { schema: entryListSchema }), message => assert.fail(message))
  const result = applied.find(row => row.id === docs.id).config
  assert.deepEqual(result.bundle, { maxDocumentBytes: 1000, fetchTimeoutMs: 1100, npmFileSources: ['npmmirror'] })
  assert.deepEqual(result.market, { maxDocumentBytes: 2000, fetchTimeoutMs: 2200, cacheTtlMs: 2300, npmFileSources: ['unpkg'],
    gitlabHosts: ['gitlab.example.org'], maxRepositoryBytes: 3000, maxCacheBytes: 4000, cacheDir: '.old-market-cache', gitTimeoutMs: 5000 })
  assert.equal(result.maxImageBytes, 999)
  assert.equal(transformed.result.conversionVersion, 2)
})

test('v1 effective receipt upgrades document policies without replaying UI migration', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'modern-document-migration-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const original = '- id: modern-ui\n  config: {models: {}, foldedReplies: all}\n'
  const oldBackup = 'modern-ui-effective-preferences-before-v1.yml'
  await writeFile(join(profile, 'cordis.patch.yml'), original)
  await writeFile(join(profile, oldBackup), '[]\n')
  await writeFile(join(profile, 'modern-ui-effective-preferences-v1.json'), JSON.stringify({ conversionVersion: 1,
    backup: oldBackup, originalSha256: createHash('sha256').update('[]\n').digest('hex') }))
  const before = [
    { id: 'old-model', name: '@deepseek-ai/dsh-client-ui-model-selection', config: { models: { mustNotReturn: {} } } },
    { id: 'old-manager', name: '@deepseek-ai/dsh-plugin-manager', config: { detailNpmFileSources: ['npmmirror'] } },
    { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { models: {}, foldedReplies: 'all' } },
  ]
  const after = [...before, { id: 'modern-plugin-documents', name: '@iroha1145/dsh-modern-ui/plugin-documents', config: {} }]
  const result = await preserveEffectivePreferences(profile, yaml.dump(before), yaml.dump(after), yaml)
  assert.equal(result.conversionVersion, 2)
  assert.equal(result.backup, 'modern-ui-effective-preferences-before-v2.yml')
  assert.equal(await readFile(join(profile, result.backup), 'utf8'), original)
  const rows = yaml.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
  assert.deepEqual(rows.find(row => row.id === 'modern-ui').config.models, {})
  assert.deepEqual(rows.find(row => row.id === 'modern-plugin-documents').config.bundle.npmFileSources, ['npmmirror'])
  assert.equal((await preserveEffectivePreferences(profile, yaml.dump(before), yaml.dump(after), yaml)).alreadyMigrated, true)
})

test('computed old document fields are never evaluated and explicit Modern values take precedence', () => {
  const before = '- id: manager\n  name: "@deepseek-ai/dsh-plugin-manager"\n  config:\n    detailMaxBytes: !!js process.exit(99)\n'
  const modern = { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: {} }
  const docs = { id: 'modern-plugin-documents', name: '@iroha1145/dsh-modern-ui/plugin-documents', config: { bundle: { maxDocumentBytes: 7000 } } }
  assert.equal(transformEffectivePreferences('[]', before, yaml.dump([modern, docs]), yaml).result.changed, false)
  assert.throws(() => transformEffectivePreferences('[]', before, yaml.dump([modern, { ...docs, config: {} }]), yaml), /not evaluated/)
})

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

test('stale composed settings refuse before a staged field can be dropped or overwritten', () => {
  const local = { ...model, localPresentation: 'keep-me' }
  const patch = yaml.dump([{ id: 'modern-ui', config: local }])
  assert.throws(() => transformConversationPreferences(patch, yaml.dump(ownerEntries({ busyEnter: 'steer' }, model)), yaml), /do not match the staged profile/)
  assert.throws(() => transformConversationPreferences(patch, yaml.dump(ownerEntries({ busyEnter: 'steer' }, { ...local, localPresentation: 'stale' })), yaml), /do not match the staged profile/)
  const current = transformConversationPreferences(patch, yaml.dump(ownerEntries({ busyEnter: 'steer' }, local)), yaml)
  assert.deepEqual(yaml.load(current.source, { schema: entryListSchema })[0].config, { ...local, busyEnter: 'steer' })
})

test('conversation receipt upgrades a v1 model migration once without overwriting later preferences', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-conversation-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'cordis.patch.yml'), source)
  await preserveLegacySettings(root, yaml)
  const before = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  const first = await preserveConversationPreferences(root, yaml.dump(ownerEntries({ busyEnter: 'steer' }, { ...model, collapsedViews: ['agents'] })), yaml)
  assert.deepEqual(first.movedFields, ['busyEnter'])
  assert.equal(await readFile(join(root, first.backup), 'utf8'), before)
  const changed = yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  assert.deepEqual(changed.find(row => row.id === 'modern-ui').config.collapsedViews, ['agents'])
  changed.find(row => row.id === 'modern-ui').config.busyEnter = 'queue'
  await writeFile(join(root, 'cordis.patch.yml'), yaml.dump(changed))
  assert.equal((await preserveLegacySettings(root, yaml)).alreadyMigrated, true)
  assert.equal((await preserveConversationPreferences(root, yaml.dump(ownerEntries({ busyEnter: 'steer' })), yaml)).alreadyMigrated, true)
  assert.equal(yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8')).find(row => row.id === 'modern-ui').config.busyEnter, 'queue')
})

test('legacy ui-chat preferences move into the modern-ui row once; computed, invalid and present values refuse or skip', () => {
  const chat = yaml.dump([{ id: 'ui-chat', name: '@deepseek-ai/dsh-client-ui-chat', config: { transcriptView: 'standard', foldedReplies: 'final' } }])
  const moved = transformChatPreferences(chat, yaml)
  const rows = yaml.load(moved.source, { schema: entryListSchema })
  assert.deepEqual(rows[0].config, { transcriptView: 'standard', foldedReplies: 'final' }, 'the retained original row keeps its value')
  assert.deepEqual(rows[1], { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { transcriptView: 'standard', foldedReplies: 'final' } })
  assert.deepEqual(moved.result, { changed: true, movedFields: ['transcriptView', 'foldedReplies'], conversionVersion: 2, namespace: 'modern-ui', retainedOriginalEntry: 'ui-chat' })
  assert.equal(transformChatPreferences(moved.source, yaml).result.changed, false, 'a modern-ui value already present wins')
  const existing = chat + yaml.dump([{ id: 'modern-ui', config: { transcriptView: 'detailed', foldedReplies: 'all' } }])
  assert.equal(transformChatPreferences(existing, yaml).result.changed, false)
  const partial = transformChatPreferences(chat + yaml.dump([{ id: 'modern-ui', config: { foldedReplies: 'all' } }]), yaml)
  assert.deepEqual(partial.result.movedFields, ['transcriptView'], 'only fields the plugin row lacks move')
  const every = transformChatPreferences(yaml.dump([{ id: 'ui-chat', config: { transcriptView: 'compact', collapseTiming: 'next-input', performanceUsage: 'compact', linkOpening: 'browser', foldedReplies: 'all', other: 1 } }]), yaml)
  assert.deepEqual(every.result.movedFields, ['transcriptView', 'collapseTiming', 'foldedReplies', 'performanceUsage', 'linkOpening'])
  assert.deepEqual(yaml.load(every.source, { schema: entryListSchema })[1].config, { transcriptView: 'compact', collapseTiming: 'next-input', foldedReplies: 'all', performanceUsage: 'compact', linkOpening: 'browser' }, 'unknown ui-chat fields stay behind')
  assert.throws(() => transformChatPreferences(yaml.dump([{ id: 'ui-chat', config: { transcriptView: 3 } }]), yaml), /plain string/)
  assert.throws(() => transformChatPreferences('- id: ui-chat\n  config:\n    foldedReplies: !!js process.exit(99)\n', yaml), /not evaluated/)
  assert.throws(() => transformChatPreferences(yaml.dump([{ id: 'ui-chat', config: { foldedReplies: 'some' } }]), yaml), /must be "all" or "final"/)
})

test('chat receipt upgrades an already migrated profile once and leaves a recoverable original', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-profile-chat-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = yaml.dump([{ id: 'ui-chat', config: { foldedReplies: 'final' } }, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { busyEnter: 'steer' } }])
  await writeFile(join(root, 'cordis.patch.yml'), original)
  const first = await preserveChatPreferences(root, yaml)
  assert.deepEqual(first.movedFields, ['foldedReplies'])
  const rows = yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  assert.deepEqual(rows[1].config, { busyEnter: 'steer', foldedReplies: 'final' })
  assert.equal(await readFile(join(root, 'modern-ui-chat-before-migration-v2.yml'), 'utf8'), original)
  const receipt = JSON.parse(await readFile(join(root, 'modern-ui-chat-migration.json'), 'utf8'))
  assert.equal(receipt.backup, 'modern-ui-chat-before-migration-v2.yml')
  assert.equal(receipt.conversionVersion, 2)
  const second = await preserveChatPreferences(root, yaml)
  assert.equal(second.alreadyMigrated, true)
  assert.deepEqual(yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }), rows)
})

test('a profile migrated by the version-1 installer gets one more pass for the remaining chat preferences', async t => {
  const root = await mkdtemp(join(tmpdir(), 'modern-profile-chat-v1-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const before = yaml.dump([{ id: 'ui-chat', config: { transcriptView: 'standard', foldedReplies: 'final' } }, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: {} }])
  const afterV1 = yaml.dump([{ id: 'ui-chat', config: { transcriptView: 'standard', foldedReplies: 'final' } }, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { foldedReplies: 'final' } }])
  const sha = text => createHash('sha256').update(text).digest('hex')
  await writeFile(join(root, 'modern-ui-chat-before-migration.yml'), before)
  await writeFile(join(root, 'cordis.patch.yml'), afterV1)
  await writeFile(join(root, 'modern-ui-chat-migration.json'), JSON.stringify({ changed: true, movedFields: ['foldedReplies'], conversionVersion: 1, namespace: 'modern-ui',
    retainedOriginalEntry: 'ui-chat', backup: 'modern-ui-chat-before-migration.yml', originalSha256: sha(before), migratedSha256: sha(afterV1) }))
  const upgraded = await preserveChatPreferences(root, yaml)
  assert.deepEqual(upgraded.movedFields, ['transcriptView'])
  assert.equal(upgraded.conversionVersion, 2)
  assert.equal(upgraded.previousConversionVersion, 1)
  assert.equal(upgraded.backup, 'modern-ui-chat-before-migration-v2.yml')
  assert.equal(await readFile(join(root, 'modern-ui-chat-before-migration-v2.yml'), 'utf8'), afterV1, 'the version-2 backup is the file the version-1 pass left')
  const rows = yaml.load(await readFile(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
  assert.deepEqual(rows[1].config, { foldedReplies: 'final', transcriptView: 'standard' })
  assert.equal((await preserveChatPreferences(root, yaml)).alreadyMigrated, true)
  // A version-1 profile with nothing left to move is stamped as current against its earlier backup.
  const settled = await mkdtemp(join(tmpdir(), 'modern-profile-chat-v1-settled-'))
  t.after(() => rm(settled, { recursive: true, force: true }))
  const only = yaml.dump([{ id: 'ui-chat', config: { foldedReplies: 'final' } }, { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { foldedReplies: 'final' } }])
  await writeFile(join(settled, 'modern-ui-chat-before-migration.yml'), before)
  await writeFile(join(settled, 'cordis.patch.yml'), only)
  await writeFile(join(settled, 'modern-ui-chat-migration.json'), JSON.stringify({ conversionVersion: 1, backup: 'modern-ui-chat-before-migration.yml', originalSha256: sha(before), migratedSha256: sha(only) }))
  const stamped = await preserveChatPreferences(settled, yaml)
  assert.deepEqual([stamped.changed, stamped.conversionVersion, stamped.previousConversionVersion, stamped.backup], [false, 2, 1, 'modern-ui-chat-before-migration.yml'])
  assert.equal((await preserveChatPreferences(settled, yaml)).alreadyMigrated, true)
})

