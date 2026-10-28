import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { build, buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const { Context } = require('@deepseek-ai/cordis')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const React = require('react')
const shared = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store']
const source = (await build({
  absWorkingDir: root,
  stdin: { contents: [
    "export * from './packages/modern-ui/src/model-owner.ts'",
    "export { ModelDirectoryResolver } from './packages/modern-ui/src/vendor/model/client/service.ts'",
    "export * from './packages/modern-ui/src/vendor/settings-models/client/controller.ts'",
    "export * from './packages/modern-ui/src/vendor/settings-models/client/ReasoningDeclarationCard.tsx'",
    "export * from './packages/modern-ui/src/vendor/settings-models/client/ModelReasoningEfforts.tsx'",
    "export * from './packages/modern-ui/src/vendor/settings-models/client/reasoning-declaration.ts'",
    "export * as declarationLocales from './packages/modern-ui/src/vendor/settings-models/client/locales.ts'",
  ].join('\n'), resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: [...shared, '@deepseek-ai/dsh-client-ui-primitives'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  plugins: [{ name: 'official-model-client-id', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-model-selection\/client$/ }, () => ({ path: '@deepseek-ai/dsh-client-ui-model-selection', external: true }))
  } }],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0].text
const primitiveSource = buildSync({
  absWorkingDir: root,
  entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')], bundle: true, write: false,
  platform: 'browser', format: 'cjs', external: shared,
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text

function environment(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']
  const prior = Object.fromEntries(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 16), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true }
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  const sandbox = { ...globals, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    AbortController, TextEncoder, TextDecoder, structuredClone, fetch, queueMicrotask, performance: dom.window.performance }
  const prim = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...sandbox, module: prim, exports: prim.exports, require })
  const modules = new Map([['@deepseek-ai/dsh-client-ui-primitives', prim.exports]])
  const imports = id => {
    if (id === '@deepseek-ai/dsh-client-ui-model-selection' && !modules.has(id)) {
      throw new Error('disabled official model owner has no browser descriptor')
    }
    return modules.has(id) ? modules.get(id) : require(id)
  }
  function load(id) {
    let descriptor
    dom.window.__ModuleLoader__ = { load: value => { descriptor = value } }
    vm.runInNewContext(readFileSync(require.resolve(id + '/client'), 'utf8'), sandbox)
    assert.equal(descriptor.id, id, 'browser module IDs are canonical package names')
    const exports = descriptor.factory(imports)
    modules.set(id, exports)
    return exports
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { ...sandbox, module, exports: module.exports, require: imports })
  const product = module.exports
  t.after(() => {
    dom.window.close()
    for (const name of names) {
      if (prior[name]) Object.defineProperty(globalThis, name, prior[name])
      else delete globalThis[name]
    }
  })
  return { dom, product, load }
}

function declarationFixture(env) {
  const row = { id: 'future-model', name: 'Future', input: ['text', 'image'], contextWindow: 1000000,
    reasoningEfforts: { off: null, high: 'deep', max: 'ultra' }, vendorField: { retained: true } }
  const base = { providers: { openai: { models: [row, { id: 'gpt-4.1', input: ['text'] }] } } }
  const store = createSnapshotStore({ status: 'ready', user: {}, base, value: base, writable: true, revision: 7 })
  const writes = []
  let mode = 'accept'
  const form = { ...store, async mutate(ops, revision) {
    writes.push(structuredClone({ ops, revision }))
    if (mode === 'throw') throw new Error('transport disconnected')
    if (mode === 'refuse' || revision !== store.getSnapshot().revision) return false
    const current = store.getSnapshot()
    const user = structuredClone(current.user)
    user.providers ??= {}; user.providers.openai ??= {}
    user.providers.openai.models = structuredClone(ops[0].value)
    store.set({ ...current, user, value: user, revision: current.revision + 1 })
    return true
  } }
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  const serialized = {}
  const mirror = { ...store, getSnapshot: () => ({ view: { namespaces: [{ ns: 'llm-pi-ai', schema: serialized }] } }) }
  const controller = new env.product.ReasoningDeclarationController({ namespace: 'llm-pi-ai', form, describe: mirror,
    schema: { rehydrate: value => value, nodeAtPath: () => ({ list: [{ type: 'dict', sKey: { list: levels.map(value => ({ value })) } }] }) },
    discoverCatalog: async () => ['gpt-4.1'] })
  const target = { provider: 'openai', settingsPath: ['providers', 'openai'], index: 0 }
  return { row, base, store, writes, controller, target, levels, mode: next => { mode = next } }
}
const plain = value => JSON.parse(JSON.stringify(value))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function mounted(env, node, body) {
  const host = env.dom.window.document.getElementById('app')
  const root = require('react-dom/client').createRoot(host)
  await React.act(async () => { root.render(node); await settle() })
  try { await body(host) } finally { await React.act(async () => root.unmount()) }
}
async function click(element) { assert.ok(element); await React.act(async () => { element.click(); await settle() }) }
async function change(element, text) {
  assert.ok(element)
  const window = element.ownerDocument.defaultView
  const prototype = element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    await settle()
  })
}

test('catalog declaration materializes inherited models, preserves fields and rejects stale/read-only/invalid writes', async t => {
  const env = environment(t)
  const f = declarationFixture(env)
  const edited = { ...f.row, reasoningEfforts: { high: 'deep', max: 'ultra' } }
  assert.equal(await f.controller.face.saveModel(f.target, edited, 7), true)
  assert.equal(f.writes[0].revision, 7)
  assert.deepEqual(f.writes[0].ops[0].path, ['providers', 'openai', 'models'])
  assert.deepEqual(f.writes[0].ops[0].value, [edited, f.base.providers.openai.models[1]])
  assert.deepEqual(f.base.providers.openai.models[0].reasoningEfforts, { off: null, high: 'deep', max: 'ultra' })
  assert.equal(await f.controller.face.saveModel(f.target, f.row, 7), false)
  assert.equal(f.writes.length, 1, 'a stale draft must not be reinterpreted at a newer revision')
  assert.equal(await f.controller.face.saveModel(f.target, { ...edited, reasoningEfforts: { off: null } }, 8), false)
  assert.equal(f.writes.length, 1, 'only-Off declarations never reach the Host')
  f.store.set({ ...f.store.getSnapshot(), writable: false })
  assert.equal(await f.controller.face.saveModel(f.target, edited, 8), false)
  f.store.set({ ...f.store.getSnapshot(), writable: true })
  f.mode('refuse')
  assert.equal(await f.controller.face.saveModel(f.target, edited, 8), false)
  assert.equal(f.controller.store.getSnapshot().refused, 'openai')
  f.mode('throw')
  assert.equal(await f.controller.face.saveModel(f.target, edited, 8), false)
  assert.equal(f.controller.store.getSnapshot().saving, undefined)
  f.controller.dispose()
})

test('inherited catalog model UI edits wire aliases, removes/adds Off and keeps drafts local until save', async t => {
  const env = environment(t)
  const f = declarationFixture(env)
  const face = f.controller.face
  const bind = source => selector => React.useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  const translate = key => env.product.declarationLocales.en[key]
  const owner = { provider: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] }
  const node = React.createElement(env.product.ReasoningDeclarationCard, { provider: owner, t: translate,
    useForm: bind(face.hooks.form), useMirror: bind(face.hooks.mirror), useDeclaration: bind(face.hooks.declaration),
    levels: face.levels, loadCatalog: face.loadCatalog, saveModel: face.saveModel })
  await mounted(env, node, async host => {
    assert.ok(host.querySelector('[data-model-id="future-model"]'), 'base-layer models must be editable without first creating an unrelated override')
    assert.equal(host.querySelector('[data-model-id="gpt-4.1"]'), null)
    const input = level => host.querySelector('input[aria-label="' + level + ' API value"]')
    const button = label => [...host.querySelectorAll('button')].find(item => item.textContent === label)
    assert.equal(input('max').value, 'ultra')
    await change(input('max'), 'ultimate')
    assert.equal(f.writes.length, 0, 'typing drafts must not race the official provider editor on every keystroke')
    await click(host.querySelector('button[aria-label="Delete level off"]'))
    assert.equal(input('off'), null)
    await click(button('Apply'))
    assert.equal(f.writes.length, 1)
    assert.deepEqual(f.writes[0].ops[0].value[0].reasoningEfforts, { high: 'deep', max: 'ultimate' })
    assert.deepEqual(f.writes[0].ops[0].value[0].input, ['text', 'image'])
    await click(button('Add level'))
    assert.ok(input('off'), 'Off can be explicitly restored')
    await click(button('Cancel'))
    assert.equal(input('off'), null, 'cancel reloads the saved declaration')
    assert.equal(f.writes.length, 1)
    await click(host.querySelector('button[role="switch"]'))
    await click(button('Apply'))
    assert.equal(f.writes.at(-1).ops[0].value[0].reasoningEfforts, false)
    await click(host.querySelector('button[role="switch"]'))
    for (const level of ['low', 'medium', 'high']) await click(host.querySelector('button[aria-label="Delete level ' + level + '"]'))
    assert.equal(button('Apply').disabled, true)
    assert.match(host.textContent, /Add at least one level besides Off/)
    await click(button('Cancel'))
    assert.equal(f.writes.length, 2)
    await click(host.querySelector('button[role="switch"]'))
    await React.act(async () => {
      f.store.set({ ...f.store.getSnapshot(), revision: f.store.getSnapshot().revision + 1 })
      await settle()
    })
    await click(button('Apply'))
    assert.equal(f.writes.length, 2, 'a draft keeps its first-edit revision across pushed updates')
    assert.match(host.querySelector('[role="alert"]').textContent, /write was refused/)
    await click(button('Cancel'))
  })
  f.controller.dispose()
})

test('model owner works without the disabled official browser descriptor and standard labels follow plugin lifetimes', async t => {
  const env = environment(t)
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-renderer')).await()
  const sessionId = 'model-session'
  let sessionContext
  await ctx.plugin({ apply(scope) { sessionContext = scope.extend({ testSession: sessionId }) } }).await()
  const selection = createSnapshotStore({ next: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' } })
  const model = { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } }
  const catalog = { default: selection.getSnapshot().next, groups: [{ id: 'deepseek-official', name: 'Official', models: [model] }], failures: [] }
  const binding = { session: { projections: { faceOf: () => selection }, getSnapshot: () => ({ blank: false }) } }
  const commands = new Map(), calls = [], dictionaries = new Map()
  let subagent = false
  const standard = createSnapshotStore({ key: sessionId, ctx: sessionContext, hooks: {}, keyedHooks: {}, props: { sessionId, locked: false } })
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('sessions', { scope: () => sessionContext, binding: () => binding, subagentAddress: () => subagent ? { childSessionId: sessionId } : undefined })
    const remote = { modelCatalog: async () => ({ ok: true, value: catalog }), selectModel: async next => {
      calls.push(next); selection.set({ next: { provider: next.provider, model: next.model, reasoningEffort: next.reasoningEffort } }); return { ok: true, value: undefined }
    } }
    scope.provide('remote', { session: remote, $on: () => () => {} })
    scope.provide('remote.session', remote)
    scope.provide('commandUi', { register: command => { commands.set(command.name, command); return () => commands.delete(command.name) } })
    scope.provide('locale', { bind: ns => key => dictionaries.get(ns)?.en?.[key] ?? key,
      register: (ns, dict) => { dictionaries.set(ns, dict); return () => dictionaries.delete(ns) } })
    scope.provide('configForms', { get: () => createSnapshotStore({ value: {} }) })
    scope.slots.installLocale({ getSnapshot: () => ({ revision: 0 }), subscribe: () => () => {}, bind: ns => scope.locale.bind(ns) })
    scope.slots.installScope('session', { current: standard, bindingSource: () => standard, renderArea: (_binding, { children }) => children })
    scope.slots.register({ name: 'root', children: { 'conversation.input.model': { kind: 'single', scope: 'session' } } },
      ({ renderSlot }) => renderSlot('conversation.input.model', {}))
  } }).await()
  let owner = ctx.plugin(env.product.modelOwner)
  await owner.await(); await settle()
  assert.ok(ctx.modelDirectories instanceof env.product.ModelDirectoryResolver)
  assert.ok(ctx.slots.spec('conversation.input.model.label'))
  assert.equal(ctx.slots.spec('modern.conversation.input.model.label'), undefined)
  const command = commands.get('model')
  assert.equal(command.available({ sessionId }), true)
  const options = await command.ui.options({ sessionId })
  assert.equal(options[0].active, true)
  await command.ui.onSelect(options[0], { sessionId })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].reasoningEffort, 'high')
  subagent = true
  assert.equal(command.available({ sessionId }), false)
  await assert.rejects(command.ui.options({ sessionId }), /unavailable for addressed subagent/)
  subagent = false
  let stop
  await React.act(async () => { stop = ctx.uiRenderer.mount(env.dom.window.document.getElementById('app')); await settle() })
  const host = env.dom.window.document.getElementById('app')
  assert.doesNotMatch(host.textContent, /1017/)
  let badge = ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-deepseek-model-label-1017'))
  await React.act(async () => { await badge.await(); await settle() })
  assert.match(host.textContent, /1017/, 'the original official plugin must supply its own badge')
  await React.act(async () => { await badge.dispose(); await settle() })
  assert.doesNotMatch(host.textContent, /1017/)
  const thirdParty = ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('conversation.input.model.label', () => scope.slots.register({ name: 'conversation.input.model.label' },
      ({ model }) => React.createElement('span', { 'data-community-label': true }, 'Community: ' + model.name)))
  } })
  await React.act(async () => { await thirdParty.await(); await settle() })
  assert.match(host.textContent, /Community: DeepSeek-V4.1-Flash/)
  await React.act(async () => { await owner.dispose(); await settle() })
  assert.equal(ctx.slots.spec('conversation.input.model.label'), undefined)
  assert.equal(commands.size, 0)
  await React.act(async () => { owner = ctx.plugin(env.product.modelOwner); await owner.await(); await settle() })
  assert.match(host.textContent, /Community: DeepSeek-V4.1-Flash/, 'contributions reattach when the owning declaration returns')
  await React.act(async () => { await thirdParty.dispose(); stop() })
})

async function directoryBehavior(Resolver) {
  const ctx = new Context()
  const scopes = new Map(), bindings = new Map(), projections = new Map()
  const catalogReads = [], selections = [], events = new Map(), snapshots = []
  let addressed = false
  for (const id of ['first', 'second']) {
    await ctx.plugin({ apply(scope) { scopes.set(id, scope) } }).await()
    const projection = createSnapshotStore({ next: null })
    projections.set(id, projection)
    bindings.set(id, { session: { projections: { faceOf: name => {
      assert.equal(name, 'modelSelection'); return projection
    } }, getSnapshot: () => ({ blank: false }) } })
  }
  const remote = { modelCatalog: () => new Promise(resolve => catalogReads.push(resolve)),
    selectModel: input => new Promise(resolve => selections.push({ input, resolve })) }
  await ctx.plugin({ apply(scope) {
    scope.provide('sessions', { scope: id => scopes.get(id), binding: id => bindings.get(id),
      subagentAddress: () => addressed ? { childSessionId: 'child' } : undefined })
    scope.provide('remote', { session: remote, $on: (event, callback) => { events.set(event, callback); return () => events.delete(event) } })
    scope.provide('remote.session', remote)
  } }).await()
  const owner = ctx.plugin(Resolver)
  await owner.await()
  try {
    const resolver = ctx.modelDirectories
    const first = resolver.directoryFor('first'), second = resolver.directoryFor('second')
    assert.equal(resolver.directoryFor('first'), first, 'one existing Session binding owns one directory')
    const firstRead = first.load(), secondRead = second.load()
    assert.equal(catalogReads.length, 1, 'all Session menus share one in-flight Host catalog')
    const initialSelection = { provider: 'fixture', model: 'present', reasoningEffort: 'high' }
    const model = { id: 'present', name: 'Present', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'Maximum thinking' }, { id: 'low', name: 'Low' }] } }
    const catalog = { default: initialSelection, groups: [{ id: 'fixture', name: 'Fixture', models: [model] }],
      failures: [{ id: 'unavailable', name: 'Unavailable provider', message: 'No credentials' }] }
    catalogReads[0]({ ok: true, value: catalog })
    await Promise.all([firstRead, secondRead])
    assert.deepEqual(plain(first.store.getSnapshot().current), initialSelection)
    snapshots.push(plain(first.store.getSnapshot()))
    const low = { ...initialSelection, reasoningEffort: 'low' }
    const selection = first.select(low)
    assert.deepEqual(plain(first.store.getSnapshot().current), initialSelection, 'a request does not create a second durable selection state')
    assert.deepEqual(plain(selections[0].input), { sessionId: 'first', ...low })
    projections.get('first').set({ next: low })
    selections[0].resolve({ ok: true, value: undefined })
    await selection
    assert.deepEqual(plain(first.store.getSnapshot().current), low)
    assert.deepEqual(plain(second.store.getSnapshot().current), initialSelection, 'the other Session retains its own projection')
    snapshots.push(plain(first.store.getSnapshot()))
    addressed = true
    await assert.rejects(first.load(), /unavailable for addressed subagent/)
    await assert.rejects(first.select(initialSelection), /unavailable for addressed subagent/)
    addressed = false
    // An unavailable model keeps the previously advertised effort caption in this Host generation.
    projections.get('first').set({ next: initialSelection })
    events.get('llm/adapters-updated')()
    assert.equal(catalogReads.length, 2)
    catalogReads[1]({ ok: true, value: { ...catalog, groups: [] } })
    await settle()
    assert.equal(first.store.getSnapshot().routable, false)
    assert.equal(first.store.getSnapshot().retainedEffort, 'Maximum thinking')
    snapshots.push(plain(first.store.getSnapshot()))
    const pending = first.select(low)
    await ctx.emit('connection/reset')
    assert.equal(catalogReads.length, 3)
    assert.equal(first.store.getSnapshot().current, null)
    assert.equal(first.store.getSnapshot().pending, null)
    selections[1].resolve({ ok: false, error: { code: 'old-host', message: 'late selection result' } })
    await pending
    assert.equal(first.store.getSnapshot().error, null, 'a selection settlement from the previous Host cannot poison the new generation')
    await ctx.emit('connection/reset')
    assert.equal(catalogReads.length, 4)
    catalogReads[2]({ ok: true, value: catalog })
    await settle()
    assert.deepEqual(plain(first.store.getSnapshot().groups), [], 'the previous Host catalog cannot land after a second reset')
    catalogReads[3]({ ok: true, value: { ...catalog, groups: [] } })
    await settle()
    assert.equal(first.store.getSnapshot().retainedEffort, 'high', 'Host generation reset clears old reasoning captions')
    snapshots.push(plain(first.store.getSnapshot()))
    const beforeRelease = first.store.getSnapshot()
    await scopes.get('first').fiber.dispose()
    projections.get('first').set({ next: low })
    assert.equal(first.store.getSnapshot(), beforeRelease, 'released Session bindings stop reacting to their former projection')
    assert.throws(() => resolver.directoryFor('missing'), /resolved no scope/)
    return { snapshots, catalogReads: catalogReads.length, selections: selections.map(item => plain(item.input)) }
  } finally {
    await ctx.fiber.dispose()
  }
}

test('owned directory preserves the published rc4 catalog, projection, Session disposal and Host-generation behavior', async t => {
  const env = environment(t)
  const actual = await directoryBehavior(env.product.ModelDirectoryResolver)
  const reference = env.load('@deepseek-ai/dsh-client-ui-model-selection').ModelDirectoryResolver
  assert.deepEqual(actual, await directoryBehavior(reference), 'the actual published rc4 browser implementation is the reference')
})
