import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { preserveEffectivePreferences } from '../../scripts/distribution/profile-settings.mjs'
import * as old from './fixtures/profile-settings-bb606b3.mjs'
import { bindPowerShell as oldBindPowerShell } from './fixtures/shell-runtime-a3da03f.mjs'

const PICKER = {
  models: { 'inherited/model': { label: 'Inherited from preset', quality: 4 } },
  prices: { 'inherited/model': { input: 1.25, output: 2.5 } },
}
const USER_PICKER = { models: { 'user/model': { label: 'User model' } }, prices: { 'user/model': { input: 9, output: 12 } } }
const digest = text => createHash('sha256').update(text).digest('hex')
const dump = value => yaml.dump(value, { schema: entryListSchema, lineWidth: -1, noCompatMode: true })
const modern = entries => entries.find(entry => entry.id === 'modern-ui').config

/** Every persisted receipt and backup below is produced by an actual old writer. */
async function pipeline(t, { host = true, powershell = true, effectiveV2 = false, explicitEmpty = false, existingShellTail = false, existingHostTail = false, chat = true } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'modern-picker-pipeline-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const filename = join(profile, 'cordis.patch.yml')
  const bundle = yaml.load(await readFile(new URL('../../packages/modern-ui/cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema })
  const official = bundle.filter(row => row.id && row.name).map(row => ({ id: row.id, name: row.name, config:
    row.name === '@deepseek-ai/dsh-client-ui-model-selection' ? PICKER
      : row.name === '@deepseek-ai/dsh-client-ui-conversation' ? { busyEnter: 'steer', collapsedViews: ['agents'] } : {} }))
  const translator = { id: 'pipeline-translator', name: '@deepseek-ai/dsh-experimental-translator', config: { timeoutMs: 4321, maxResponseBytes: 23456 } }
  const mcp = { id: 'pipeline-mcp', name: '@deepseek-ai/dsh-mcp-client', config: { transport: 'stdio', serverName: 'pipeline', command: 'fixture', args: ['one', 'two'], env: { FIXTURE: 'retained' } } }
  const shellConfig = { timeoutMs: 4321, maxTimeoutMs: 9876, cwd: join(profile, 'workspace'), maxOutputBytes: 123456, maxSpillBytes: 654321, graceMs: 432 }
  const shells = ['local', 'sandbox'].map(kind => ({ id: `pipeline-pwsh-${kind}`, name: `@deepseek-ai/dsh-pwsh-${kind}`, disabled: false, config: { ...shellConfig } }))
  official.push({ id: 'pipeline-disabled-translator', name: translator.name, disabled: true, config: { timeoutMs: 1234 } })
  official.push({ id: 'pipeline-disabled-shell', name: '@deepseek-ai/dsh-pwsh-local', disabled: true, config: { pwshPath: 'user-disabled-shell' } })
  if (host) official.push(translator, mcp)
  if (powershell) official.push(...shells)
  const base = applyEntryPatches(official, bundle, message => assert.fail(message))
  // Legacy model settings live in the preset, not this user patch. Chat's
  // user preference ensures the real chat migration also contributes a stage.
  const initial = chat ? [{ id: 'ui-chat', config: { foldedReplies: 'final' } }] : []
  if (explicitEmpty) initial.push({ id: 'modern-ui', config: { models: {}, prices: {} } })
  if (existingShellTail) initial.push({ id: 'modern-ui', disabled: false }, {
    id: shells[0].id, name: shells[0].name,
    config: { ...shellConfig, pwshPath: join(profile, 'private runtime', 'pwsh.exe') },
  })
  if (existingHostTail) initial.push({ id: 'modern-ui', disabled: false })
  await writeFile(filename, dump(initial))
  const compose = async (warnings) => applyEntryPatches(base, yaml.load(await readFile(filename, 'utf8'), { schema: entryListSchema }), message => warnings ? warnings.push(message) : assert.fail(message))
  const stages = []
  const stage = async (name, action) => {
    const before = await readFile(filename, 'utf8')
    const result = await action()
    const after = await readFile(filename, 'utf8')
    stages.push({ name, before: digest(before), after: digest(after), result })
    return result
  }
  await stage('preserveLegacySettings', () => old.preserveLegacySettings(profile, yaml))
  if (existingHostTail) {
    const earlyHost = await stage('earlierHostBinding', async () => old.bindHostCompatibility(profile, dump((await compose()).filter(row => row.id !== mcp.id)), yaml))
    assert.equal(earlyHost.changed, true)
  }
  const conversation = await stage('preserveConversationPreferences', async () => old.preserveConversationPreferences(profile, dump(await compose()), yaml))
  assert.equal(conversation.changed, true, 'the baseline conversation writer must generate the placeholder maps')
  assert.deepEqual(modern(await compose()).models, {})
  assert.deepEqual(modern(await compose()).prices, {})
  const chatResult = await stage('preserveChatPreferences', () => old.preserveChatPreferences(profile, yaml))
  assert.equal(chatResult.changed, chat)
  const hostBinding = await stage('bindHostCompatibility', async () => old.bindHostCompatibility(profile, dump(await compose()), yaml))
  assert.equal(hostBinding.changed, host)
  const privateShell = powershell ? { path: join(profile, 'private runtime', 'pwsh.exe') } : undefined
  const shellBinding = await stage('bindPowerShell', async () => oldBindPowerShell(profile, dump(await compose()), privateShell, yaml))
  assert.equal(shellBinding.changed, powershell)
  if (effectiveV2) {
    const effective = await stage('preserveEffectivePreferences-v2', async () => old.preserveEffectivePreferences(profile, dump(await compose()), dump(await compose()), yaml))
    assert.equal(effective.conversionVersion, 2)
    assert.deepEqual(modern(await compose()).models, {}, 'the actual old effective writer must preserve the bug')
    assert.deepEqual(modern(await compose()).prices, {})
  }
  const installed = await compose()
  if (host) for (const entry of [translator, mcp]) {
    assert.equal(installed.find(row => row.id === entry.id).disabled, true)
    const replacement = installed.find(row => row.id === `modern-ui-compat-${entry.id}`)
    assert.match(replacement.name, /^@iroha1145\/dsh-modern-ui\//)
    assert.deepEqual(replacement.config, entry.config)
  }
  if (powershell) for (const entry of shells) {
    const actual = installed.find(row => row.id === entry.id)
    assert.equal(actual.disabled, false)
    assert.deepEqual(actual.config, { ...entry.config, pwshPath: privateShell.path })
  }
  const adjacent = installed.filter(row => row.id !== 'modern-ui')
  const recover = async (warnings) => preserveEffectivePreferences(profile, dump(await compose(warnings)), dump(await compose(warnings)), yaml)
  const edit = async values => {
    const patch = yaml.load(await readFile(filename, 'utf8'), { schema: entryListSchema })
    Object.assign(patch.find(row => row.id === 'modern-ui').config, values)
    await writeFile(filename, dump(patch))
  }
  const assertAdjacent = async () => {
    const effective = await compose()
    assert.deepEqual(effective.filter(row => row.id !== 'modern-ui'), adjacent, 'Host, PowerShell, and all other effective entries must remain unchanged')
    assert.equal(modern(effective).busyEnter, 'steer')
    assert.deepEqual(modern(effective).collapsedViews, ['agents'])
    if (chat) assert.equal(modern(effective).foldedReplies, 'final')
  }
  return { profile, filename, compose, recover, edit, assertAdjacent, stages, hostBinding }
}

test('frozen pipeline producers retain their original source digests', async () => {
  const profile = await readFile(new URL('./fixtures/profile-settings-bb606b3.mjs', import.meta.url), 'utf8')
  assert.equal(digest(profile.slice(profile.indexOf('\n') + 1)), '645cb341f599a6dadd1c68fbf444b368717b641c83a4d4069545b433aae2873f')
  const shell = await readFile(new URL('./fixtures/shell-runtime-a3da03f.mjs', import.meta.url), 'utf8')
  assert.equal(digest(shell.split('// BEGIN FROZEN FUNCTION\n')[1]), '51af9876d83f90af6cebff086f5145e0171e5580956edec87ba37a8de628c1dd')
})

const bindings = [
  ['Host', { host: true, powershell: false }],
  ['PowerShell', { host: false, powershell: true }],
  ['Host+PowerShell', { host: true, powershell: true }],
]
for (const [name, options] of bindings) for (const effectiveV2 of [false, true]) {
  test(`legacy pipeline restores picker after ${name} bindings, ${effectiveV2 ? 'with' : 'without'} old effective v2`, async t => {
    const f = await pipeline(t, { ...options, effectiveV2 })
    await f.recover()
    const effective = await f.compose()
    assert.deepEqual(modern(effective).models, PICKER.models)
    assert.deepEqual(modern(effective).prices, PICKER.prices)
    await f.assertAdjacent()
  })
}
test('legacy pipeline control without Host/PowerShell additions restores picker', async t => {
  const f = await pipeline(t, { host: false, powershell: false })
  await f.recover()
  assert.deepEqual(modern(await f.compose()).models, PICKER.models)
  assert.deepEqual(modern(await f.compose()).prices, PICKER.prices)
  await f.assertAdjacent()
})

test('complete pipeline preserves original explicit empty picker maps', async t => {
  const f = await pipeline(t, { explicitEmpty: true, effectiveV2: true })
  const original = await readFile(f.filename, 'utf8')
  await f.recover()
  assert.deepEqual(modern(await f.compose()).models, {})
  assert.deepEqual(modern(await f.compose()).prices, {})
  assert.equal(await readFile(f.filename, 'utf8'), original)
  await f.assertAdjacent()
})
test('complete pipeline preserves subsequent user model and price edits', async t => {
  const f = await pipeline(t, { effectiveV2: true })
  await f.edit(USER_PICKER)
  await f.recover()
  assert.deepEqual(modern(await f.compose()).models, USER_PICKER.models)
  assert.deepEqual(modern(await f.compose()).prices, USER_PICKER.prices)
  await f.assertAdjacent()
})
test('complete pipeline recovery is idempotent and does not replay after an intentional clear', async t => {
  const f = await pipeline(t, { effectiveV2: true })
  const originalRecords = new Map(await Promise.all((await readdir(f.profile)).filter(name => name !== 'cordis.patch.yml')
    .map(async name => [name, await readFile(join(f.profile, name))])))
  await f.recover()
  assert.deepEqual(modern(await f.compose()).models, PICKER.models)
  assert.deepEqual(modern(await f.compose()).prices, PICKER.prices)
  const repaired = await readFile(f.filename, 'utf8')
  await f.recover()
  assert.equal(await readFile(f.filename, 'utf8'), repaired)
  for (const [name, original] of originalRecords) assert.deepEqual(await readFile(join(f.profile, name)), original, `Preserve old restoration evidence: ${name}`)
  await f.edit({ models: {}, prices: {} })
  await f.recover()
  assert.deepEqual(modern(await f.compose()).models, {})
  assert.deepEqual(modern(await f.compose()).prices, {})
  await f.assertAdjacent()
})
for (const damage of ['missing-conversation-receipt', 'altered-chat-backup', 'altered-conversation-output-digest']) {
  test(`complete pipeline declines ${damage}`, async t => {
    const f = await pipeline(t, { effectiveV2: true })
    if (damage === 'missing-conversation-receipt') await rm(join(f.profile, 'modern-ui-conversation-migration.json'))
    else if (damage === 'altered-chat-backup') await writeFile(join(f.profile, 'modern-ui-chat-before-migration-v2.yml'), '# invalid evidence\n[]\n')
    else {
      const path = join(f.profile, 'modern-ui-conversation-migration.json')
      const receipt = JSON.parse(await readFile(path, 'utf8'))
      receipt.migratedSha256 = '0'.repeat(64)
      await writeFile(path, JSON.stringify(receipt))
    }
    const original = await readFile(f.filename, 'utf8')
    await f.recover()
    assert.deepEqual(modern(await f.compose()).models, {})
    assert.deepEqual(modern(await f.compose()).prices, {})
    assert.equal(await readFile(f.filename, 'utf8'), original)
    await f.assertAdjacent()
  })
}

for (const damage of ['missing', 'altered']) {
  test(`Host pipeline requires its ${damage === 'missing' ? 'present' : 'intact'} original preimage`, async t => {
    const f = await pipeline(t, { host: true, powershell: true })
    const backup = join(f.profile, f.hostBinding.backup)
    if (damage === 'missing') await rm(backup)
    else await writeFile(backup, '# modified preimage\n[]\n')
    const original = await readFile(f.filename, 'utf8')
    await f.recover()
    assert.equal(await readFile(f.filename, 'utf8'), original)
    assert.deepEqual(modern(await f.compose()).models, {})
    assert.deepEqual(modern(await f.compose()).prices, {})
    await f.assertAdjacent()
  })
}

const untrustedBindings = [
  ['unknown prefix modification', {}, rows => { rows[0].config.foldedReplies = 'all' }],
  ['Host mismatched replacement id', { powershell: false }, rows => { rows.at(-1).insert[0].id = 'unrelated-host' }],
  ['Host mismatched replacement module', { powershell: false }, rows => { rows.at(-1).insert[0].name = '@iroha1145/dsh-modern-ui/unknown' }],
  ['Host extra disable override', { powershell: false }, rows => { rows.at(-2).config = { userSetting: true } }],
  ['Host extra replacement override', { powershell: false }, rows => { rows.at(-1).insert[0].extra = true }],
  ['Host nested insert', { powershell: false }, rows => { rows.at(-1).insert[0].insert = [{ id: 'nested', name: 'unknown' }] }],
  ['Host group override', { powershell: false }, rows => { rows.at(-1).insert[0].group = [] }],
  ['Host nested plugins', { powershell: false }, rows => { rows.at(-1).insert[0].config.plugins = [] }],
  ['PowerShell extra override', { host: false }, rows => { rows.at(-1).disabled = true }],
  ['PowerShell Modern id', { host: false }, rows => { rows.at(-1).id = 'modern-ui' }],
  ['PowerShell unknown module', { host: false }, rows => { rows.at(-1).name = '@example/unknown-shell' }],
  ['PowerShell nested plugins', { host: false }, rows => { rows.at(-1).config.plugins = [] }],
  ['PowerShell missing executable path', { host: false }, rows => { delete rows.at(-1).config.pwshPath }],
]
for (const [name, options, change] of untrustedBindings) {
  test(`legacy pipeline declines ${name}`, async t => {
    const f = await pipeline(t, options)
    const rows = yaml.load(await readFile(f.filename, 'utf8'), { schema: entryListSchema })
    change(rows)
    await writeFile(f.filename, dump(rows))
    const original = await readFile(f.filename, 'utf8')
    // Some deliberate malformed bindings are ignored by the official patcher
    // with warnings. Still test their actual effective configuration.
    const warnings = []
    const effective = await f.compose(warnings)
    if (name === 'PowerShell Modern id') await assert.rejects(f.recover(warnings), /Layered Modern UI settings require explicit precedence review/)
    else await f.recover(warnings)
    assert.equal(await readFile(f.filename, 'utf8'), original)
    assert.deepEqual(await f.compose(warnings), effective)
    assert.deepEqual(modern(effective).models, {})
    assert.deepEqual(modern(effective).prices, {})
  })
}

for (const effectiveV2 of [false, true]) {
  test(`PowerShell recovery stops at recorded prefix with an already bound shell, ${effectiveV2 ? 'with' : 'without'} v2`, async t => {
    const f = await pipeline(t, { host: false, powershell: true, existingShellTail: true, effectiveV2 })
    const rows = yaml.load(await readFile(f.filename, 'utf8'), { schema: entryListSchema })
    assert.deepEqual(rows.slice(-2).map(row => row.id), ['pipeline-pwsh-local', 'pipeline-pwsh-sandbox'])
    await f.recover()
    assert.deepEqual(modern(await f.compose()).models, PICKER.models)
    assert.deepEqual(modern(await f.compose()).prices, PICKER.prices)
    await f.assertAdjacent()
  })
}

for (const effectiveV2 of [false, true]) {
  test(`Host recovery stops at recorded prefix with an earlier bound pair, ${effectiveV2 ? 'with' : 'without'} v2`, async t => {
    const f = await pipeline(t, { host: true, powershell: false, existingHostTail: true, effectiveV2 })
    await f.recover()
    assert.deepEqual(modern(await f.compose()).models, PICKER.models)
    assert.deepEqual(modern(await f.compose()).prices, PICKER.prices)
    await f.assertAdjacent()
  })
}

for (const [name, options] of bindings) {
  test(`legacy ${name} pipeline without a chat migration still restores picker`, async t => {
    const f = await pipeline(t, { ...options, chat: false })
    await f.recover()
    assert.deepEqual(modern(await f.compose()).models, PICKER.models)
    assert.deepEqual(modern(await f.compose()).prices, PICKER.prices)
    await f.assertAdjacent()
  })
}
