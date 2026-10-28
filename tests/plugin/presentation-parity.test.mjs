import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const { Context } = require('@deepseek-ai/cordis')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const React = require('react')
const shared = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store']
const source = buildSync({
  absWorkingDir: root,
  stdin: { contents: "export * from './packages/modern-ui/src/presentation-parity.ts'; export * from './packages/modern-ui/src/presentation-shadow.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic', external: [...shared, '@deepseek-ai/dsh-client-ui-primitives'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text
const primitiveSource = buildSync({
  absWorkingDir: root, entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')], bundle: true, write: false,
  platform: 'browser', format: 'cjs', external: shared,
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text

function environment(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT', 'localStorage', 'Document']
  const prior = Object.fromEntries(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 16), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true, localStorage: dom.window.localStorage, Document: dom.window.Document }
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  const sandbox = { ...globals, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    AbortController, TextEncoder, TextDecoder, structuredClone, fetch, queueMicrotask, crypto, AbortSignal, performance: dom.window.performance }
  const prim = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...sandbox, module: prim, exports: prim.exports, require })
  const modules = new Map([['@deepseek-ai/dsh-client-ui-primitives', prim.exports]])
  const imports = id => modules.has(id) ? modules.get(id) : require(id)
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
  const restore = () => {
    dom.window.close()
    for (const name of names) {
      if (prior[name]) Object.defineProperty(globalThis, name, prior[name])
      else delete globalThis[name]
    }
  }
  return { dom, product, load, restore }
}


const settle = () => new Promise(resolve => setTimeout(resolve, 0))
async function action(work) { await React.act(async () => { await work(); await settle(); await settle() }) }
async function click(element) { assert.ok(element); await action(() => element.click()) }
async function change(element, text) {
  assert.ok(element)
  await action(() => {
    const window = element.ownerDocument.defaultView
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

async function fixture(t, { withQuestion = true, withPreset = true } = {}) {
  const env = environment(t)
  const ctx = new Context()
  let stop
  t.after(async () => { if (stop) await action(() => stop()); await ctx.fiber.dispose(); env.restore() })
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-renderer')).await()
  const sessionId = 'presentation-session'
  let actx
  await ctx.plugin({ apply(scope) { actx = scope.extend({ fixtureSession: sessionId }) } }).await()
  const dictionaries = new Map(), localeRevision = createSnapshotStore({ revision: 0 })
  const pending = createSnapshotStore(undefined)
  const projections = { userQuestions: createSnapshotStore({ active: [] }), inbox: createSnapshotStore({}) }
  const session = { projections: { faceOf: key => projections[key] }, getSnapshot: () => ({ blank: false }) }
  const binding = { sessionId, session, ctx: actx }
  const sessions = {
    list: createSnapshotStore({ byId: { [sessionId]: { id: sessionId, blank: false, retainedBy: {} } } }),
    binding: id => id === sessionId ? binding : undefined,
    scopeOf: owner => owner.fixtureSession, retainInfo: () => createSnapshotStore({ retainedBy: {} }),
  }
  const forms = new Map([
    ['ui-settings', createSnapshotStore({ status: 'ready', writable: true, revision: 1, value: { enabled: true } })],
    ['agent-preset-registry', createSnapshotStore({ status: 'ready', writable: true, revision: 1, value: { selectedDefault: 'standard' } })],
  ])
  const code = String.fromCharCode(96).repeat(3) + 'js\nconst example = 1\n' + String.fromCharCode(96).repeat(3)
  const calls = [], events = new Map(), definition = []
  let defaultPreset = 'standard', language = 'en'
  const roster = () => ({ presets: ['standard', 'ptc', 'minimal', 'cordis'].map(id => ({ id, isDefault: id === defaultPreset })) })
  const interpolate = (text, parameters) => Object.entries(parameters ?? {}).reduce((value, [key, item]) => value.replaceAll('{' + key + '}', String(item)), text)
  const locale = {
    register(ns, value) { dictionaries.set(ns, value); localeRevision.set({ revision: localeRevision.getSnapshot().revision + 1 }); return () => { dictionaries.delete(ns); localeRevision.set({ revision: localeRevision.getSnapshot().revision + 1 }) } },
    bind: ns => (key, parameters) => {
      const words = dictionaries.get(ns)
      let text = words?.[language]?.[key] ?? words?.en?.[key] ?? ({ submit: 'Submit', submitting: 'Submitting…', copy: 'Copy', copied: 'Copied', 'codeBlock.title': 'Code', 'codeBlock.wrap': 'Wrap', 'codeBlock.unwrap': 'Unwrap' }[key]) ?? key
      // A fenced example exercises the guide's Markdown presenter without changing production dictionaries.
      if (key === 'guideStandardUsage') text += '\n\n### Code example\n\n' + code
      return interpolate(text, parameters)
    },
  }
  const remote = {
    $on(name, listener) { events.set(name, listener); return () => events.delete(name) },
    userQuestions: { answer: async (id, callId, answer) => { calls.push(['answer', id, callId, answer]); return { ok: true, value: true } } },
    agentPresets: { list: async () => ({ ok: true, value: roster() }), read: async id => ({ ok: true, value: { content: 'preset: ' + id } }) },
    settings: { update: async (ns, value) => { calls.push(['settings', ns, value]); defaultPreset = value.selectedDefault; return { ok: true, value: undefined } } },
  }
  const standard = createSnapshotStore({ key: sessionId, ctx: actx, hooks: {}, keyedHooks: {}, props: { sessionId, locked: false } })
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('sessions', sessions); scope.provide('locale', locale)
    scope.provide('remote', remote); scope.provide('remote.userQuestions', remote.userQuestions)
    scope.provide('remote.agentPresets', remote.agentPresets); scope.provide('remote.settings', remote.settings)
    scope.provide('configForms', { get: ns => forms.get(ns), developerTools: { enabled: createSnapshotStore(true) } })
    scope.provide('uiSession', { registerPendingInteraction: () => carrier => {
      pending.set(carrier)
      return () => { if (pending.getSnapshot() === carrier) pending.set(undefined) }
    } })
    scope.provide('uiConversation', { events: { register: value => { definition.push(value); return () => {} } } })
    scope.provide('conversation', {})
    scope.provide('uiWorkspace', { startSession: (...args) => { calls.push(['creator', ...args]) } })
    scope.slots.installLocale({ ...localeRevision, bind: locale.bind })
    scope.slots.installScope('session', { current: standard, bindingSource: () => standard, renderArea: (_binding, { children }) => children })
    scope.slots.provideRoot({ hooks: { fixturePending: pending }, props: { close: () => calls.push(['close-settings']) } })
    scope.slots.register({ name: 'root', children: {
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'settings.section': { kind: 'list', scope: 'root' },
      'conversation.hero.agentPreset': { kind: 'single', scope: 'session-maybe' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'plugins.add.actions': { kind: 'list', scope: 'root' },
    } }, ({ renderSlot, renderSlotChain, useFixturePending }) => {
      const interaction = useFixturePending(value => value)
      return React.createElement(React.Fragment, null,
        renderSlot('settings.section', { close: () => calls.push(['close-settings']) }),
        interaction === undefined ? null : renderSlotChain('conversation.composer', { pendingInteraction: interaction }))
    })
  } }).await()
  const questionModule = env.load('@deepseek-ai/dsh-client-ui-user-questions')
  const presetModule = env.load('@deepseek-ai/dsh-client-ui-agent-preset')
  let questionOwner = withQuestion ? ctx.plugin(questionModule) : undefined
  let presetOwner = withPreset ? ctx.plugin(presetModule) : undefined
  await questionOwner?.await(); await presetOwner?.await(); await settle()
  let modern = ctx.plugin({ name: 'presentation-parity', inject: ['slots', 'locale'], apply: env.product.installPresentationParity })
  await modern.await(); await settle(); await settle()
  await action(() => { stop = ctx.uiRenderer.mount(env.dom.window.document.getElementById('app')) })
  const restartModern = async () => { await action(async () => { modern = ctx.plugin({ name: 'presentation-parity', inject: ['slots', 'locale'], apply: env.product.installPresentationParity }); await modern.await() }) }
  return { ...env, ctx, pending, projections, calls, dictionaries, definition, code, modern,
    questionOwner, presetOwner, restartModern,
    restartQuestion: async () => { questionOwner = ctx.plugin(questionModule); await questionOwner.await(); return questionOwner },
    restartPreset: async () => { presetOwner = ctx.plugin(presetModule); await presetOwner.await(); return presetOwner },
    language: async next => { await action(() => { language = next; localeRevision.set({ revision: localeRevision.getSnapshot().revision + 1 }) }) },
  }
}


test('ordinary questions use the official carrier/store, fold code and preserve drafts through presentation unload', async t => {
  const f = await fixture(t, { withPreset: false })
  const original = f.ctx.slots.entries('conversation.composer').find(entry => entry.children?.['conversation.plan-review.actions'])
  const shadow = f.ctx.slots.entries('conversation.composer').find(entry => entry.options.priority === -100)
  assert.equal(shadow.store, original.store)
  assert.equal(shadow.children, undefined, 'the presentation must not redeclare or render plan-review child slots')
  await action(() => f.projections.userQuestions.set({ active: [{ callId: 'q1', state: 'continued', questions: [{
    id: 'decision', question: 'Choose a result', detail: f.code,
    options: [{ label: 'Keep (Recommended)', description: 'Use the retained choice' }, { label: 'Change' }],
  }] }] }))
  const pending = f.pending.getSnapshot()
  assert.equal(pending.kind, 'question')
  assert.equal(shadow.select({ pendingInteraction: pending }), pending)
  assert.equal(shadow.inject().keyedHooks.questionCard(pending.key), original.inject().keyedHooks.questionCard(pending.key))
  const document = f.dom.window.document
  const codeBlock = () => document.querySelector('[data-code-block-content]')
  assert.ok(codeBlock())
  await click(document.querySelector('button[aria-label="Collapse code"]'))
  assert.equal(codeBlock().hidden, true)
  await click(document.querySelector('button[aria-label="Expand code"]'))
  assert.equal(codeBlock().hidden, false)
  await change(document.querySelector('textarea'), 'Keep this drafted answer')
  assert.equal(document.querySelector('textarea').value, 'Keep this drafted answer')
  await action(() => f.modern.dispose())
  assert.equal(f.ctx.slots.entries('conversation.composer').length, 1)
  assert.equal(document.querySelector('textarea').value, 'Keep this drafted answer', 'official presentation reads the same Session draft store')
  await f.restartModern()
  assert.equal(document.querySelector('textarea').value, 'Keep this drafted answer')
  let community
  await action(async () => { community = f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.register({ name: 'conversation.composer', priority: -200,
      select: owner => owner.pendingInteraction?.kind === 'question' ? owner.pendingInteraction : null,
    }, () => React.createElement('div', { 'data-community-question': true }, 'Community question'))
  } }); await community.await() })
  assert.ok(document.querySelector('[data-community-question]'))
  assert.equal(document.querySelector('textarea'), null)
  await action(() => community.dispose())
  assert.equal(document.querySelector('textarea').value, 'Keep this drafted answer')
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Submit'))
  const answers = f.calls.filter(call => call[0] === 'answer')
  assert.equal(answers.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(answers[0][3])), { answers: [{ id: 'decision', selected: [], custom: 'Keep this drafted answer' }] })
  await action(() => f.projections.userQuestions.set({ active: [{ callId: 'plan', state: 'continued', questions: [{
    id: 'plan', question: 'Approve this plan', detail: '# Plan', intent: { kind: 'plan-review', approve: 'Approve' }, options: [{ label: 'Approve' }, { label: 'Decline' }],
  }] }] }))
  const plan = f.pending.getSnapshot()
  assert.equal(plan.kind, 'plan-review')
  const currentShadow = f.ctx.slots.entries('conversation.composer').find(entry => entry.options.priority === -100)
  assert.equal(currentShadow.select({ pendingInteraction: plan }), null)
  assert.equal(original.select({ pendingInteraction: plan }), plan, 'plan-review remains owned by the official presentation')
  await action(() => f.projections.userQuestions.set({ active: [] }))
})

test('preset guide folds code while official default/view/Creator actions and higher-priority contributions remain live', async t => {
  const f = await fixture(t, { withQuestion: false })
  const original = f.ctx.slots.entries('settings.section').find(entry => (entry.options.priority ?? 0) === 0)
  const shadow = f.ctx.slots.entries('settings.section').find(entry => entry.options.priority === -100)
  assert.equal(shadow.inject().hooks.agentPresetSection, original.inject().hooks.agentPresetSection)
  const face = original.inject()
  const document = f.dom.window.document
  const standardCard = () => document.querySelector('[data-agent-preset-id="standard"]')
  assert.ok(standardCard())
  await click([...standardCard().querySelectorAll('button')].find(button => button.textContent === 'How to use'))
  assert.equal(f.calls.filter(call => call[0] === 'settings').length, 0, 'opening read-only help must never change the default')
  assert.ok(document.querySelector('[role="dialog"] [data-code-block-content]'))
  await click(document.querySelector('[role="dialog"] button[aria-label="Collapse code"]'))
  assert.equal(document.querySelector('[role="dialog"] [data-code-block-content]').hidden, true)
  await f.language('ja')
  assert.ok(document.querySelector('button[aria-label="コードを展開"]'), 'the new disclosure labels follow the global locale revision')
  await f.language('en')
  await click(document.querySelector('[role="dialog"] button[aria-label="Close"]'))
  const ptcCard = document.querySelector('[data-agent-preset-id="ptc"]')
  await click(ptcCard.querySelector('button[aria-pressed]'))
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(call => call[0] === 'settings'))), ['settings', 'agent-preset-registry', { selectedDefault: 'ptc' }])
  assert.equal(face.hooks.agentPresetSection.getSnapshot().rows.find(row => row.id === 'ptc').isDefault, true)
  await click(document.querySelector('[data-agent-preset-id="ptc"] button[aria-label^="View configuration"]'))
  assert.match(document.querySelector('[role="dialog"]').textContent, /preset: ptc/)
  await click([...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Close'))
  await click([...document.querySelectorAll('button')].find(button => button.textContent === 'Let the agent help me create a preset'))
  assert.equal(f.calls.filter(call => call[0] === 'creator').length, 1)
  assert.equal(f.calls.filter(call => call[0] === 'close-settings').length, 1)
  let community
  await action(async () => { community = f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.register({ name: 'settings.section', id: 'agent-presets', priority: -200 }, () => React.createElement('div', { 'data-community-preset': true }, 'Community preset section'))
  } }); await community.await() })
  assert.ok(document.querySelector('[data-community-preset]'))
  assert.equal(document.querySelector('[data-agent-preset-id]'), null)
  await action(() => community.dispose())
  assert.ok(document.querySelector('[data-agent-preset-id="ptc"]'))
  await action(() => f.modern.dispose())
  assert.equal(f.ctx.slots.entries('settings.section').length, 1)
  assert.equal(f.ctx.slots.entries('settings.section')[0], original)
  assert.equal(original.inject().hooks.agentPresetSection, face.hooks.agentPresetSection)
  await f.restartModern()
  assert.equal(f.ctx.slots.entries('settings.section').find(entry => entry.options.priority === -100).inject().hooks.agentPresetSection, face.hooks.agentPresetSection)
})

test('public presentation watcher withdraws and rebinds when the official entry changes generation', async t => {
  const f = await fixture(t)
  const initialQuestion = f.ctx.slots.entries('conversation.composer').find(entry => entry.options.priority === -100)
  const initialPreset = f.ctx.slots.entries('settings.section').find(entry => entry.options.priority === -100)
  const initialPresetStore = initialPreset.inject().hooks.agentPresetSection
  await action(() => f.questionOwner.dispose())
  assert.equal(f.ctx.slots.entries('conversation.composer').length, 0)
  assert.equal(f.ctx.slots.spec('conversation.plan-review.actions'), undefined)
  await action(async () => { await f.restartQuestion() })
  const replacedQuestion = f.ctx.slots.entries('conversation.composer').find(entry => entry.options.priority === -100)
  assert.ok(replacedQuestion)
  assert.notEqual(replacedQuestion, initialQuestion)
  assert.notEqual(replacedQuestion.store, initialQuestion.store)
  await action(() => f.presetOwner.dispose())
  assert.equal(f.ctx.slots.entries('settings.section').length, 0)
  await action(async () => { await f.restartPreset() })
  const replacedPreset = f.ctx.slots.entries('settings.section').find(entry => entry.options.priority === -100)
  assert.ok(replacedPreset)
  assert.notEqual(replacedPreset, initialPreset)
  assert.notEqual(replacedPreset.inject().hooks.agentPresetSection, initialPresetStore)
})
