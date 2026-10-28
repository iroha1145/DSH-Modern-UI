import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(rootDir, 'package.json'))
const { buildSync } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const { Context } = require('@deepseek-ai/cordis')
const source = buildSync({
  absWorkingDir: rootDir,
  stdin: { contents: `
    export * from './packages/modern-ui/src/quotes.ts';
    export { ConversationInteractionRegistry } from './packages/modern-ui/src/vendor/conversation/client/conversation/interaction-registry.ts';
    export { UserTextRegistry } from './packages/modern-ui/src/vendor/conversation/client/conversation/user-text-registry.ts';
    export { SessionInputShell } from './packages/modern-ui/src/vendor/conversation/client/input/facade.ts';
    export { useTextInteraction } from './packages/modern-ui/src/vendor/chat/client/chat/text-interaction.ts';`, resolveDir: rootDir },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(rootDir, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
}).outputFiles[0].text
const primitiveSource = buildSync({
  absWorkingDir: rootDir, entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')],
  bundle: true, write: false, platform: 'browser', format: 'cjs',
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' },
}).outputFiles[0].text

async function fixture(t) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
  const { window } = dom
  const previous = new Map()
  const globals = { window, document: window.document, navigator: window.navigator, location: window.location,
    localStorage: window.localStorage, URL, URLSearchParams, TextEncoder, TextDecoder, crypto,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    HTMLIFrameElement: window.HTMLIFrameElement, MutationObserver: window.MutationObserver,
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0), cancelAnimationFrame: clearTimeout,
    getComputedStyle: window.getComputedStyle.bind(window), IS_REACT_ACT_ENVIRONMENT: true }
  for (const [name, value] of Object.entries(globals)) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }) }
  const rect = { left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 }
  window.HTMLElement.prototype.getBoundingClientRect = () => rect
  window.Range.prototype.getBoundingClientRect = () => ({ ...rect, width: 60, height: 20, right: 60, bottom: 20 })
  window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()] }
  const clientModule = { exports: {} }
  const runtime = { ...globals, console, setTimeout, clearTimeout, queueMicrotask, AbortController }
  const primitives = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...runtime, module: primitives, exports: primitives.exports, require })
  const imports = id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives.exports : require(id)
  vm.runInNewContext(source, { ...runtime, module: clientModule, exports: clientModule.exports, require: imports })
  const client = clientModule.exports
  let descriptor
  window.__ModuleLoader__ = { load: value => { descriptor = value } }
  vm.runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), { window, document: window.document, console })
  const renderer = descriptor.factory(require)
  const ctx = new Context()
  await ctx.plugin(renderer.SlotRegistry).await()
  const sessions = new Map([['session-1', { removed: false, subagent: null }]])
  const interactions = new client.ConversationInteractionRegistry(ctx)
  const userText = new client.UserTextRegistry(ctx)
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('uiConversation', { interactions, userText })
    scope.provide('sessions', { binding: id => sessions.has(id) ? { session: { getSnapshot: () => sessions.get(id) } } : undefined })
    scope.provide('locale', { register: () => () => {} })
    scope.slots.register({ name: 'root', children: {
      'conversation.chat.text-interaction': { kind: 'keyed', scope: 'session' },
      'conversation.user.text.node': { kind: 'keyed', scope: 'session' },
    } }, () => null)
  } }).await()
  let owner = ctx.plugin({ apply: client.installQuotes })
  await owner.await()
  const sent = []
  const shell = new client.SessionInputShell({ actx: ctx, defaultSink: async text => { sent.push(text); return { kind: 'success' } },
    commandAttachments: { serialize: async () => [], release() {}, unsupportedNotice: () => '' }, quoteInsertionAllowed: () => !sessions.get('session-1').removed })
  const view = createRoot(window.document.getElementById('app'))
  const dispatch = gesture => interactions.dispatch('session-1', gesture)
  function Harness() {
    const area = React.useRef(null), surface = React.useRef(null)
    const ids = React.useSyncExternalStore(listener => interactions.subscribe(listener), () => interactions.getSnapshot())
    const binding = client.useTextInteraction(area, surface, dispatch, ids)
    const entry = ctx.slots.entriesOfSlot('conversation.chat.text-interaction').find(item => item.options.key === binding.active?.id)
    return React.createElement('div', { 'data-conversation-scroll': '' },
      React.createElement('div', { ref: area, 'data-area': '', style: { position: 'relative' } },
        React.createElement('p', { 'data-text-interaction-source': '' }, 'Visible selected text'),
        React.createElement('div', { ref: surface, 'data-surface': '' }, entry && React.createElement(entry.component, {
          ...binding, trigger: binding.active.trigger, inputActions: shell.actions,
          useSession: selector => selector(sessions.get('session-1')), t: key => key,
        }))),
      React.createElement('div', { 'data-composer-seat': '' }, 'Composer'))
  }
  const render = () => act(async () => { view.render(React.createElement(Harness)) })
  await render()
  const select = async () => act(async () => {
    const range = window.document.createRange(); range.selectNodeContents(window.document.querySelector('p'))
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
    window.document.dispatchEvent(new window.Event('selectionchange'))
  })
  t.after(async () => {
    await act(async () => { view.unmount(); await ctx.fiber.dispose() })
    shell.dispose(); window.close()
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
  })
  return { ...client, ctx, interactions, userText, shell, sent, window, sessions, select, render,
    dispose: () => act(async () => { await owner.dispose() }),
    restart: () => act(async () => { owner = ctx.plugin({ apply: client.installQuotes }); await owner.await() }) }
}

test('selection action inserts the real atomic quote and sent-text rules render the same excerpt', async t => {
  const f = await fixture(t)
  f.shell.setDraft('Existing draft ')
  await f.select()
  const action = f.window.document.querySelector('button[aria-label="quote.add"]')
  assert.ok(action, 'the standard selection slot mounts its quote action')
  await act(async () => { action.click() })
  assert.equal(f.window.getSelection().toString(), '')
  assert.match(f.shell.snapshot.draft, /Existing draft/)
  assert.match(f.shell.snapshot.draft, /> Visible selected text/)
  assert.equal(f.shell.draftSnapshot.quotes[0].text, 'Visible selected text')
  await act(async () => { f.shell.actions.submit(); await new Promise(setImmediate) })
  assert.equal(f.sent[0], 'Existing draft\n\n> Visible selected text')
  const evaluate = f.userText.createEvaluator()
  const nodes = evaluate({ text: f.sent[0], facts: {} })
  assert.equal(nodes.find(node => node.id === 'quote').data.text, 'Visible selected text')
  assert.ok(f.ctx.slots.entriesOfSlot('conversation.user.text.node').some(entry => entry.options.key === 'quote'))
})

test('read-only sessions decline quote admission; teardown removes both rule and interaction, reload restores them once', async t => {
  const f = await fixture(t)
  f.sessions.set('session-1', { removed: false, subagent: { address: { mode: 'one-shot' }, parentAvailable: true } })
  await f.select()
  assert.equal(f.window.document.querySelector('button'), null)
  f.sessions.set('session-1', { removed: false, subagent: null })
  await act(async () => { f.window.getSelection().removeAllRanges(); f.window.document.dispatchEvent(new f.window.Event('selectionchange')) })
  await f.select()
  assert.ok(f.window.document.querySelector('button'))
  await f.dispose()
  assert.equal(f.window.document.querySelector('button'), null)
  assert.equal(f.interactions.getSnapshot().length, 0)
  assert.equal(f.userText.createEvaluator()({ text: '> Original', facts: {} }).some(node => node.id === 'quote'), false)
  await f.restart()
  assert.deepEqual([...f.interactions.getSnapshot()], ['quote'])
})

test('a third-party context-menu consumer receives the standard gesture and can prevent the browser menu', async t => {
  const f = await fixture(t)
  const plugin = f.ctx.plugin({ inject: ['slots', 'uiConversation'], apply(scope) {
    scope.effect(() => scope.uiConversation.interactions.register({ id: 'third-party', onInteraction(request) {
      if (request.trigger === 'contextmenu') { request.preventDefault(); request.open() }
    } }))
    scope.slots.inject('conversation.chat.text-interaction', () => scope.slots.register({
      name: 'conversation.chat.text-interaction', key: 'third-party',
    }, () => React.createElement('button', null, 'Third party action')))
  } })
  await act(async () => { await plugin.await() })
  const event = new f.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
  await act(async () => { f.window.document.querySelector('p').dispatchEvent(event) })
  assert.equal(event.defaultPrevented, true)
  assert.equal(f.window.document.querySelector('button').textContent, 'Third party action')
  await act(async () => { await plugin.dispose() })
  assert.equal(f.window.document.querySelector('button'), null)
})
