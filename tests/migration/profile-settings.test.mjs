import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { preserveLegacySettings, transformProfileSettings, transformHostBindings,
  preserveConversationPreferences, transformConversationPreferences, preserveChatPreferences, transformChatPreferences } from '../../scripts/distribution/profile-settings.mjs'
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

