import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { bindHostCompatibility, preserveEffectivePreferences, transformHostBindings } from '../../scripts/distribution/profile-settings.mjs'
import { preserveConversationPreferences } from './fixtures/old-conversation-writer.mjs'

const requireHost = createRequire(process.env.COMPAT_BACKEND_PACKAGE ? resolve(process.env.COMPAT_BACKEND_PACKAGE) : new URL('../../package.json', import.meta.url))
const yaml = requireHost('js-yaml')
const { applyEntryPatches, entryListSchema } = await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis-plugin-include')).href)
const dump = rows => yaml.dump(rows, { schema: entryListSchema, lineWidth: -1, noCompatMode: true })
const picker = { models: { inherited: { quality: 4 } }, prices: { inherited: { input: 1, output: 2 } } }

test('frozen conversation writer retains its extracted source digest', async () => {
  const text = await readFile(new URL('./fixtures/old-conversation-writer.mjs', import.meta.url), 'utf8')
  assert.equal(createHash('sha256').update(text.split('// BEGIN FROZEN BODY\n')[1]).digest('hex'), text.match(/body SHA-256: ([a-f0-9]+)/)[1])
})

for (const disabled of [undefined, null, false, true]) {
  test(`Host disabled=${String(disabled)} preserves activation, metadata, and recoverable picker evidence`, async t => {
    const profile = await mkdtemp(join(tmpdir(), 'compat-null-host-'))
    t.after(() => rm(profile, { recursive: true, force: true }))
    const filename = join(profile, 'cordis.patch.yml')
    const host = { id: 'translator', name: '@deepseek-ai/dsh-experimental-translator', group: null,
      inject: { optional: ['logger'] }, intercept: { logger: 'root' }, isolate: null,
      config: { timeoutMs: 4321 } }
    if (disabled !== undefined) host.disabled = disabled
    const base = [
      { id: 'modern-ui', name: '@iroha1145/dsh-modern-ui', config: { models: {}, prices: {} } },
      { id: 'models', name: '@deepseek-ai/dsh-client-ui-model-selection', config: picker },
      { id: 'conversation', name: '@deepseek-ai/dsh-client-ui-conversation', config: { busyEnter: 'steer' } }, host,
    ]
    await writeFile(filename, dump([]))
    const compose = async () => applyEntryPatches(base, yaml.load(await readFile(filename, 'utf8'), { schema: entryListSchema }), message => assert.fail(message))
    assert.equal((await preserveConversationPreferences(profile, dump(await compose()), yaml)).changed, true)
    const binding = await bindHostCompatibility(profile, dump(await compose()), yaml)
    assert.equal(binding.changed, disabled !== true)
    const bound = await compose()
    if (disabled === true) assert.deepEqual(bound.find(row => row.id === host.id), host)
    else {
      assert.equal(bound.find(row => row.id === host.id).disabled, true)
      const replacement = bound.find(row => row.id === 'modern-ui-compat-translator')
      assert.deepEqual(replacement, { ...host, id: 'modern-ui-compat-translator', name: '@iroha1145/dsh-modern-ui/translator' })
    }
    await preserveEffectivePreferences(profile, dump(bound), dump(bound), yaml)
    const effective = await compose()
    assert.deepEqual(effective.find(row => row.id === 'modern-ui').config.models, picker.models)
    assert.deepEqual(effective.find(row => row.id === 'modern-ui').config.prices, picker.prices)
    assert.deepEqual(effective.filter(row => row.id !== 'modern-ui'), bound.filter(row => row.id !== 'modern-ui'))
  })
}

test('real !!js activation is rejected without evaluation; unknown metadata is retained', () => {
  const source = '[]\n'
  const dynamic = '- id: translator\n  name: "@deepseek-ai/dsh-experimental-translator"\n  disabled: !!js "globalThis.__compatShouldNotRun = true"\n  config: {}\n'
  assert.throws(() => transformHostBindings(source, dynamic, yaml), /Computed activation/)
  assert.equal(globalThis.__compatShouldNotRun, undefined)
  const original = { id: 'translator', name: '@deepseek-ai/dsh-experimental-translator', disabled: null, customMetadata: { retained: 'yes' }, config: { timeoutMs: 1234 } }
  const transformed = transformHostBindings(source, dump([original]), yaml)
  const rows = yaml.load(transformed.source, { schema: entryListSchema })
  assert.deepEqual(rows.at(-1).insert[0], { ...original, id: 'modern-ui-compat-translator', name: '@iroha1145/dsh-modern-ui/translator' })
})
