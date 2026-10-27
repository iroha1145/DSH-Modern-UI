import assert from 'node:assert/strict'
import test from 'node:test'
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
const shared = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']
const ownerPath = './packages/modern-ui/src/vendor/conversation/client'
const source = buildSync({
  stdin: { contents: `export * from './packages/modern-ui/src/conversation-owner.ts';
    export { createViewPins } from '${ownerPath}/view-pins.ts';
    export { ViewsMoreMenu } from '${ownerPath}/skeleton/ConversationSession.tsx';
    export { ComposerSubmissionPolicy, resolveSubmitMode } from '${ownerPath}/input/submission-policy.ts';`,
  resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: [...shared, '@deepseek-ai/*'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text
const primitiveSource = buildSync({
  entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')],
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: shared,
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text

function environment() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  const { window } = dom
  const revoked = []
  let objectUrlId = 0
  class BrowserURL extends URL {
    static createObjectURL() { return `blob:conversation-fixture-${++objectUrlId}` }
    static revokeObjectURL(value) { revoked.push(value) }
  }
  const globals = { window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, console, setTimeout, clearTimeout, queueMicrotask,
    URL: BrowserURL, URLSearchParams, TextEncoder, TextDecoder, AbortController, crypto, fetch,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    MutationObserver: window.MutationObserver, FileReader: window.FileReader,
    HTMLIFrameElement: window.HTMLIFrameElement,
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 16), cancelAnimationFrame: clearTimeout,
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: window.getComputedStyle.bind(window) }
  const primitiveModule = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...globals, module: primitiveModule, exports: primitiveModule.exports, require })
  const imports = id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitiveModule.exports : require(id)
  const module = { exports: {} }
  vm.runInNewContext(source, { ...globals, module, exports: module.exports, require: imports })
  const load = id => {
    let descriptor
    window.__ModuleLoader__ = { load: value => { descriptor = value } }
    vm.runInNewContext(readFileSync(require.resolve(id + '/client'), 'utf8'), globals)
    return descriptor.factory(imports)
  }
  return { dom, owner: module.exports, load, revoked }
}

function form(initial = { busyEnter: 'queue', collapsedViews: ['trajectory'] }) {
  const store = createSnapshotStore({ status: 'ready', value: initial, writable: true, revision: 1 })
  const writes = []
  return { writes, store, ...store, set: async (field, value) => {
    writes.push({ field, value })
    store.set({ ...store.getSnapshot(), value: { ...store.getSnapshot().value, [field]: value }, revision: store.getSnapshot().revision + 1 })
    return true
  } }
}

async function fixture(t) {
  const env = environment()
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); env.dom.window.close() })
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-renderer')).await()
  const sessionId = 'owner-session'
  let actx
  const sessionFiber = ctx.plugin({ apply(scope) { actx = scope.extend({ fixtureSessionId: sessionId }) } })
  await sessionFiber.await()
  const calls = []
  const feed = createSnapshotStore({ revision: 0, entries: [], hasMore: false, change: { kind: 'replace' } })
  const sessionState = createSnapshotStore({ sessionId, blank: false, awaitingFirstTurn: false,
    running: false, removed: false, subagent: null, promptAttempted: true })
  const projections = new Map()
  const session = { sessionId, ...sessionState,
    projections: { faceOf(key) { if (!projections.has(key)) projections.set(key, createSnapshotStore(undefined)); return projections.get(key) } },
    prompt: async (...args) => { calls.push(['prompt', ...args]); return { ok: true, value: { accepted: true } } },
    updateQueue: async (...args) => { calls.push(['queue', ...args]); return { ok: true, value: { accepted: true } } },
    cancel: async () => { calls.push(['cancel']); return { ok: true, value: {} } },
    loadOlder: async () => { calls.push(['older']) },
  }
  const binding = { sessionId, session, ctx: actx, eventSource: feed }
  const sessions = {
    list: createSnapshotStore({ phase: 'ready', ids: [sessionId], byId: { [sessionId]: { id: sessionId, title: 'Fixture', retainedBy: {}, running: false } } }),
    binding: id => id === sessionId ? binding : undefined,
    scope: id => id === sessionId ? actx : undefined,
    scopeOf: scope => scope.fixtureSessionId,
    sessionOf: scope => scope.fixtureSessionId === sessionId ? session : undefined,
    retainInfo: () => createSnapshotStore({ retainedBy: {} }),
  }
  const settings = form()
  const developerTools = createSnapshotStore(true)
  const dictionaries = new Map(), localeListeners = new Set()
  const providers = ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('sessions', sessions)
    scope.provide('remote', { $on: () => () => {} })
    scope.provide('remoteAccess', { source: () => createSnapshotStore(true) })
    scope.provide('fileUpload', { upload: async () => { throw Error('No file upload requested by this fixture') } })
    scope.provide('uiWorkspace', { openSession: id => calls.push(['open', id]), openWorkspace: id => calls.push(['workspace', id]), startSession: () => {} })
    scope.provide('pluginNavigation', { openList() {} })
    scope.provide('locale', {
      register(namespace, language, dictionary) {
        const key = dictionary ? `${namespace}:${language}` : namespace
        dictionaries.set(key, dictionary ?? language)
        return () => dictionaries.delete(key)
      },
      bind: namespace => key => dictionaries.get(namespace)?.en?.[key] ?? key,
      subscribe: callback => { localeListeners.add(callback); return () => localeListeners.delete(callback) },
    })
    scope.provide('configForms', { get: namespace => { assert.equal(namespace, 'modern-ui'); return settings }, developerTools: { enabled: developerTools } })
    scope.slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' }, 'settings.general.item': { kind: 'list', scope: 'root' },
    } }, () => null)
  } })
  await providers.await()
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-session')).await()
  const attachment = ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-attachment'))
  const customization = ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-entry-customization'))
  const thirdParty = ctx.plugin({ inject: ['slots', 'uiConversation'], apply(scope) {
    scope.slots.inject('conversation.view', () => scope.slots.register({ name: 'conversation.view', id: 'fixture-view', label: 'Third party' }, () => null))
    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({ name: 'conversation.session.header.actions', id: 'fixture-action' }, () => null))
    scope.uiConversation.events.register({ kind: 'fixture-user', target: 'fixture-view',
      match: event => event.type === 'user/message' ? { id: event.data.id, role: 'start' } : null,
      start: (_context, match) => match.event.data,
      update: context => context.state,
      buildViewNode: context => ({ key: context.key, id: context.id, kind: 'fixture-user', target: 'fixture-view', data: context.state }),
    })
    scope.uiConversation.views.register({ target: 'fixture-view', create: () => ({ empty: [],
      replace: input => input.nodes, apply: input => input.upserts }), isActive: rows => rows.length > 0 })
  } })
  let owner = ctx.plugin(env.owner)
  await owner.await(); await attachment.await(); await customization.await(); await thirdParty.await()
  const restart = async () => { owner = ctx.plugin(env.owner); await owner.await(); return owner }
  return { ...env, ctx, owner, restart, sessionFiber, sessionId, actx, session, binding, feed, sessions, calls, settings, thirdParty, attachment, customization }
}

test('replacement owns original children while official attachment/customization and third-party contributions activate', async t => {
  const f = await fixture(t)
  assert.equal(f.owner.state, 2)
  assert.equal(f.attachment.state, 2)
  assert.equal(f.customization.state, 2)
  assert.equal(f.ctx.sessions, f.sessions)
  assert.equal(f.ctx.slots.entries('conversation.input.attachments').length, 1)
  assert.equal(f.ctx.slots.entries('conversation.session.header.views.actions').length, 1)
  assert.equal(f.ctx.slots.entries('conversation.session.header.actions').length, 1)
  assert.equal(f.ctx.slots.entries('conversation.view').length, 1)
  assert.equal(f.ctx.slots.entries('conversation.session.header')[0].options.store,
    f.ctx.slots.entries('conversation.session')[0].options.store, 'Header and body share the same selected-view store')
  const source = f.ctx.uiSession.adapter.bindingSource({ sessionId: f.sessionId, binding: f.binding })
  const standard = source.getSnapshot()
  assert.equal(standard.props.sessionId, f.sessionId)
  assert.ok(standard.hooks.input && standard.hooks.conversation && standard.props.inputActions)
  const input = f.ctx.conversation.input.for(f.actx)
  input.setDraft('Retained draft')
  assert.equal(standard.hooks.input.getSnapshot().draft, 'Retained draft')
  const retainedSession = f.binding.session
  await f.actx.get('conversation').send('hello')
  await f.actx.get('conversation').updateQueue('queued-1', { kind: 'remove' })
  await f.actx.get('conversation').cancel()
  await f.actx.get('conversation').loadOlder()
  assert.deepEqual(f.calls.map(call => call[0]), ['prompt', 'queue', 'cancel', 'older'])
  assert.equal(f.binding.session, retainedSession)
  const evaluator = f.ctx.uiConversation.userText.createEvaluator()
  const text = '  hello @[Task](dsh-session:fixture)  '
  const nodes = evaluator({ text, facts: { trimWhitespace: true, collapseWhitespace: true, sessionLabels: [] } })
  assert.ok(nodes.some(node => node.id === 'session' && node.data.label === 'Task'))
})

test('rc.4 image drafts stay inline while ordinary files use the official upload receipt face', async t => {
  const f = await fixture(t)
  const uploads = []
  const fileReference = { attachmentId: 'fixture-file', name: 'notes.txt', bytes: 3 }
  f.ctx.fileUpload.upload = async (sessionId, file, name, _signal, progress) => {
    uploads.push({ sessionId, name, type: file.type })
    progress({ loaded: file.size, total: file.size })
    return { ok: true, value: { receiptId: 'file-receipt', file: fileReference } }
  }
  const image = new f.dom.window.File([Uint8Array.of(1, 2, 3)], 'preview.png', { type: 'image/png' })
  const file = new f.dom.window.File(['abc'], 'notes.txt', { type: 'text/plain' })
  const drafts = f.ctx.conversation.createDrafts(f.sessionId, [image, file])
  await new Promise(setImmediate)
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].name, 'notes.txt')
  assert.equal(f.ctx.conversation.fileUploads.getSnapshot()[drafts[1].id].file, fileReference)
  const serialized = await f.ctx.conversation.serializeDraftAttachments(drafts.map(draft => draft.id))
  assert.equal(serialized.attachments[0].type, 'image')
  assert.equal(serialized.attachments[0].data, 'AQID')
  assert.equal(serialized.attachments[1].type, 'file')
  assert.equal(serialized.attachments[1].receiptId, 'file-receipt')
  const preview = drafts[0].previewUrl
  await f.owner.dispose()
  assert.ok(f.revoked.includes(preview))
})

test('public event source updates target snapshots and owner unload releases bindings/input while retaining Sessions', async t => {
  const f = await fixture(t)
  const conversation = f.ctx.uiConversation.binding(f.binding)
  const target = conversation.target('fixture-view')
  let notifications = 0
  const off = target.subscribe(() => { notifications++ })
  const input = f.ctx.conversation.input.for(f.actx)
  const event = { type: 'event', event: { seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'one', source: { kind: 'user' }, content: [{ type: 'text', text: 'One' }] } } }
  f.feed.set({ revision: 1, entries: [event], hasMore: false, change: { kind: 'append', entries: [event] } })
  assert.equal(target.getSnapshot().length, 1)
  assert.ok(notifications > 0)
  await f.owner.dispose()
  const count = notifications
  f.feed.set({ revision: 2, entries: [], hasMore: false, change: { kind: 'replace' } })
  assert.equal(notifications, count)
  assert.equal(f.ctx.sessions, f.sessions)
  assert.equal(f.sessionFiber.state, 2)
  assert.equal(input.insertQuote('must not revive a disposed input'), false)
  assert.equal(f.ctx.slots.entries('conversation.session.header.actions').length, 0)
  await f.restart()
  await f.thirdParty.await()
  const replacement = f.ctx.conversation.input.for(f.actx)
  assert.notEqual(replacement, input)
  replacement.setDraft('New owner draft')
  assert.equal(replacement.state.getSnapshot().draft, 'New owner draft')
  assert.equal(f.ctx.slots.entries('conversation.session.header.actions').length, 1)
  off()
})

test('view pins restore before use, retain absent views, persist shared choices, and recover from refusals and disposal', async () => {
  const { owner, dom } = environment()
  const host = form({ busyEnter: 'queue', collapsedViews: ['trajectory', 'not-installed'] })
  const pins = owner.createViewPins(host)
  assert.deepEqual([...pins.unpinned.getSnapshot()], ['trajectory', 'not-installed'])
  assert.equal(host.writes.length, 0)
  pins.setPinned('chat', false)
  assert.equal(host.writes.length, 0)
  pins.setPinned('agents', false)
  pins.setPinned('trajectory', true)
  await Promise.resolve()
  assert.deepEqual([...host.store.getSnapshot().value.collapsedViews], ['not-installed', 'agents'])
  const restored = owner.createViewPins(host)
  assert.deepEqual([...restored.unpinned.getSnapshot()], ['not-installed', 'agents'])
  let reject
  host.set = () => new Promise((_resolve, failure) => { reject = failure })
  pins.setPinned('agents', true)
  reject(Error('Transport failed'))
  await new Promise(setImmediate)
  assert.deepEqual([...pins.unpinned.getSnapshot()], ['not-installed', 'agents'])
  assert.equal(pins.saveFailed.getSnapshot(), true)
  pins.dispose(); restored.dispose()
  const before = pins.unpinned.getSnapshot()
  pins.setPinned('another', false)
  assert.equal(pins.unpinned.getSnapshot(), before)
  dom.window.close()
})

test('busy Enter retains queue/steer behavior and failed persistence restores the accepted preference', async () => {
  const { owner, dom } = environment()
  const host = form({ busyEnter: 'steer', collapsedViews: [] })
  const policy = new owner.ComposerSubmissionPolicy(host)
  assert.equal(policy.busyEnter.getSnapshot(), 'steer')
  assert.equal(owner.resolveSubmitMode('steer', true, 'enter', true), 'steer')
  assert.equal(owner.resolveSubmitMode('steer', true, 'complementary', true), 'queue')
  assert.equal(owner.resolveSubmitMode('steer', false, 'enter', true), 'queue')
  assert.equal(owner.resolveSubmitMode('steer', true, 'enter', false), 'queue')
  host.set = async () => false
  policy.setBusyEnter('queue')
  await new Promise(setImmediate)
  assert.equal(policy.busyEnter.getSnapshot(), 'steer')
  assert.equal(policy.saveFailed.getSnapshot(), true)
  policy.dispose(); policy.setBusyEnter('queue')
  assert.equal(policy.busyEnter.getSnapshot(), 'steer')
  dom.window.close()
})

test('superseded pin failures and late settlements cannot undo newer choices or revive a disposed owner', async () => {
  const { owner, dom } = environment()
  const host = form({ busyEnter: 'queue', collapsedViews: [] })
  const pending = []
  host.set = (field, value) => new Promise((resolve, reject) => { pending.push({ field, value, resolve, reject }) })
  const pins = owner.createViewPins(host)
  pins.setPinned('first', false)
  pins.setPinned('second', false)
  pending[0].reject(Error('Superseded failure'))
  await new Promise(setImmediate)
  assert.deepEqual([...pins.unpinned.getSnapshot()], ['first', 'second'])
  assert.equal(pins.saveFailed.getSnapshot(), false)
  host.store.set({ ...host.store.getSnapshot(), value: { busyEnter: 'queue', collapsedViews: ['first', 'second'] } })
  pending[1].resolve(true)
  await new Promise(setImmediate)
  pins.setPinned('third', false)
  pins.dispose()
  const before = pins.unpinned.getSnapshot()
  pending[2].reject(Error('Owner removed'))
  await new Promise(setImmediate)
  assert.equal(pins.unpinned.getSnapshot(), before)
  assert.equal(pins.saveFailed.getSnapshot(), false)
  dom.window.close()
})

test('More exposes pin actions for visible tabs, keeps extension actions, and supports keyboard return and hidden-view reopening', async () => {
  const { owner, dom } = environment()
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { act } = React
  const globals = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const host = form({ busyEnter: 'queue', collapsedViews: [] })
  const pins = owner.createViewPins(host)
  const opened = [], contributedOwners = []
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  const labels = { 'session.tabVisibility': 'View tabs', 'session.hideTab': 'Hide {name} tab', 'session.showTab': 'Show {name} tab' }
  function Harness() {
    const collapsed = React.useSyncExternalStore(pins.unpinned.subscribe, pins.unpinned.getSnapshot)
    const allEntries = ['chat', 'agents', 'timeline'].map(id => ({ id, label: id === 'agents' ? 'Agents' : id,
      pinned: !collapsed.includes(id), active: false }))
    return React.createElement(owner.ViewsMoreMenu, { label: 'More views', current: false, allEntries,
      hasEntryActions: true, entries: allEntries.filter(entry => collapsed.includes(entry.id)),
      onOpen: id => opened.push(id), onPinnedChange: pins.setPinned,
      t: (key, params) => (labels[key] ?? key).replace('{name}', params?.name ?? ''),
      renderSlot: (name, props) => {
        assert.equal(name, 'conversation.session.header.views.actions')
        contributedOwners.push(props)
        return React.createElement(React.Fragment, null,
          ...props.entries.map(entry => React.createElement('button', { key: entry.id, role: 'menuitem',
            'data-extension-open': entry.id, onClick: () => { props.onDismiss(); props.onOpen(entry.id) } }, entry.label)),
          React.createElement('button', { role: 'menuitem', 'data-extension-discover': '', onClick: props.onDismiss }, 'Discover plugins'))
      },
    })
  }
  const click = async element => { act(() => { element.focus(); element.click() }); await act(async () => {}) }
  const trigger = () => container.querySelector('[data-conversation-views-menu]')
  try {
    await act(async () => { root.render(React.createElement(Harness)) })
    await click(trigger())
    const document = dom.window.document
    assert.equal(document.querySelector('[data-view-pin-action="agents"]').textContent, 'Hide Agents tab')
    assert.equal(document.querySelector('[data-view-pin-action="chat"]'), null)
    assert.ok(document.querySelector('[data-extension-discover]'))
    await click(document.querySelector('[data-view-pin-action="agents"]'))
    assert.deepEqual([...host.store.getSnapshot().value.collapsedViews], ['agents'])
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.ok(document.activeElement === trigger(), 'focus returns to More trigger')
    await click(trigger())
    assert.equal(document.querySelector('[data-view-pin-action="agents"]').textContent, 'Show Agents tab')
    assert.deepEqual([...contributedOwners.at(-1).entries].map(entry => entry.id), ['agents'])
    await click(document.querySelector('[data-extension-open="agents"]'))
    assert.deepEqual(opened, ['agents'])
    assert.deepEqual([...host.store.getSnapshot().value.collapsedViews], ['agents'])
    await click(trigger())
    const show = document.querySelector('[data-view-pin-action="agents"]')
    act(() => { show.focus(); show.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) }); await act(async () => {})
    assert.deepEqual([...host.store.getSnapshot().value.collapsedViews], [])
    assert.ok(document.activeElement === trigger(), 'focus returns to More trigger')
    await click(trigger())
    act(() => { document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    assert.equal(document.querySelector('[role="menu"]'), null)
    assert.ok(document.activeElement === trigger(), 'focus returns to More trigger')
  } finally {
    await act(async () => root.unmount())
    pins.dispose(); dom.window.close()
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})


