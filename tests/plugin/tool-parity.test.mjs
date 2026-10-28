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
const { Context } = require('@deepseek-ai/cordis')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const source = buildSync({
  absWorkingDir: rootDir,
  stdin: { contents: `export * from './packages/modern-ui/src/tool-cards.tsx';
    export { installFileDrag } from './packages/modern-ui/src/file-drag.ts';
    export { UiConversation } from './packages/modern-ui/src/vendor/conversation/client/conversation/assembly.ts';
    export { todoCallDefinition } from './packages/modern-ui/src/vendor/tool/client/tool/models/todo-history.ts';`, resolveDir: rootDir },
  bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(rootDir, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
}).outputFiles[0].text
const primitiveSource = buildSync({
  absWorkingDir: rootDir, entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')],
  bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' },
}).outputFiles[0].text

const started = (name, args = {}, callId = 'call-1', subCalls = []) => ({ phase: 'start', callId, name, subCalls,
  argsRaw: JSON.stringify(args), args: { text: key => args[key], has: key => key in args, complete: () => true, stringLength: key => String(args[key] ?? '').length } })
const result = (name, args = {}, callId = 'call-1', subCalls = []) => ({ kind: 'tool-result', callId,
  call: started(name, args, callId), args: started(name, args).args, name, subCalls, isError: false,
  content: [{ type: 'text', text: `Visible result for ${callId}` }] })

async function fixture(t) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' })
  const { window } = dom, previous = new Map()
  const globals = { window, document: window.document, navigator: window.navigator, location: window.location,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, HTMLIFrameElement: window.HTMLIFrameElement,
    MutationObserver: window.MutationObserver, ResizeObserver: class { observe() {} disconnect() {} },
    IS_REACT_ACT_ENVIRONMENT: true }
  for (const [name, value] of Object.entries(globals)) { previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }) }
  const runtime = { ...globals, console, setTimeout, clearTimeout, queueMicrotask, TextEncoder, TextDecoder, URL, URLSearchParams,
    AbortController, AbortSignal, crypto }
  const primitives = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...runtime, module: primitives, exports: primitives.exports, require })
  const imports = id => id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives.exports : require(id)
  const clientModule = { exports: {} }
  vm.runInNewContext(source, { ...runtime, module: clientModule, exports: clientModule.exports, require: imports })
  const client = clientModule.exports
  function load(id) {
    let descriptor
    window.__ModuleLoader__ = { load: value => { descriptor = value } }
    vm.runInNewContext(readFileSync(require.resolve(id + '/client'), 'utf8'), runtime)
    return descriptor.factory(imports)
  }
  const renderer = load('@deepseek-ai/dsh-client-ui-renderer'), official = load('@deepseek-ai/dsh-client-ui-tool')
  const ctx = new Context(), dictionaries = new Map(), panels = [], inspections = [], files = []
  const remote = { $host: { home: '/home/fixture' } }
  const feed = createSnapshotStore({ revision: 0, entries: [], hasMore: false, change: { kind: 'replace' } })
  const binding = { sessionId: 'session-1', ctx, eventSource: feed }
  const sessions = { binding: id => id === 'session-1' ? binding : undefined }
  await ctx.plugin(renderer.SlotRegistry).await()
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('remote', remote)
    scope.provide('locale', { register: (namespace, values) => { dictionaries.set(namespace, values); return () => dictionaries.delete(namespace) }, bind: () => key => key })
    scope.provide('sessions', sessions)
    new client.UiConversation(scope, sessions)
    scope.provide('userQuestionPanels', { reveal: (...args) => { panels.push(['reveal', ...args]); return true }, review: (...args) => { panels.push(['review', ...args]); return true } })
    scope.slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null)
  } }).await()
  await ctx.plugin({ apply: client.installFileDrag }).await()
  let owner = ctx.plugin({ apply: client.installToolCards }); await owner.await()
  const view = createRoot(window.document.getElementById('app'))
  const tText = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionaries.get('modern-tool')?.en[key] ?? key)
  function useDisclosure() { const [expanded, set] = React.useState(false); return { expanded, toggle: () => set(value => !value) } }
  const common = { sessionId: 'session-1', useDisclosure, useSession: selector => selector({ hasMore: false, removed: false, subagent: null }),
    useProjection: (_name, selector) => selector(undefined), useSessions: selector => selector({ byId: { 'session-1': { cwd: '/workspace' } } }),
    cwd: '/workspace', loadImage: async () => 'blob:authorized', openFile: (...args) => files.push(args), inspectCall: id => inspections.push(id),
    t: tText, useHostInfo: selector => selector(remote.$host) }
  const factories = []
  const renderFactorySlot = (name, props) => { factories.push({ name, props }); return React.createElement('div', { 'data-factory': name, 'data-image-count': props.images.length }) }
  const renderSlot = (name, ownerProps, options) => {
    if (name === 'tool.call.images') {
      const entry = [...ctx.slots.entriesOfSlot(name)].sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
      return entry ? React.createElement(entry.component, { ...common, ...ownerProps, renderFactorySlot }) : null
    }
    assert.equal(name, 'tool.call.toolview')
    const entry = ctx.slots.entriesOfSlot(name).filter(item => item.options.key === options.entryKey).sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
    if (!entry) return options.fallback
    const injected = entry.inject?.('session-1') ?? {}, hooks = {}
    for (const [key, store] of Object.entries(injected.hooks ?? {})) hooks[`use${key[0].toUpperCase()}${key.slice(1)}`] = selector => selector(store.getSnapshot())
    return React.createElement(entry.component, { ...common, ...ownerProps, ...injected, ...hooks, renderFactorySlot, renderSlot })
  }
  const render = block => React.act(async () => {
    const entry = ctx.slots.entriesOfSlot('conversation.chat.node').find(item => item.options.key === 'tool-call')
    view.render(React.createElement(entry.component, { ...common, node: { data: { root: block } }, renderSlot }))
  })
  t.after(async () => {
    await React.act(async () => { view.unmount(); await ctx.fiber.dispose() })
    window.close()
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
  })
  return { ...client, ctx, window, remote, dictionaries, panels, inspections, files, factories, feed, binding, common, renderSlot, render,
    dispose: () => React.act(async () => { view.render(null); await owner.dispose() }),
    restart: () => React.act(async () => { owner = ctx.plugin({ apply: client.installToolCards }); await owner.await() }),
    restoreOfficial: async () => { const restored = ctx.plugin(official); await restored.await(); return restored } }
}

test('unregistered and MCP calls use the Modern wrench fallback and preserve keyboard disclosure plus inspection', async t => {
  const f = await fixture(t)
  for (const name of ['unregistered_custom_tool', 'mcp__fixture__lookup']) {
    await f.render(result(name, { query: 'needle' }))
    const tool = f.window.document.querySelector(`[data-tool="${name}"]`)
    assert.ok(tool.querySelector('[data-icon="dsw-icon-wrench-outline-regular"]'), 'the fallback uses the patched wrench glyph')
    const row = tool.querySelector('[data-disclosure-row]')
    assert.equal(row.getAttribute('aria-expanded'), 'false')
    assert.doesNotMatch(tool.textContent, /Visible result/)
    await React.act(async () => { row.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    assert.equal(row.getAttribute('aria-expanded'), 'true')
    assert.match(tool.textContent, /Visible result for call-1/)
    const inspect = [...tool.querySelectorAll('button')].find(button => button.textContent.includes('Inspect'))
    await React.act(async () => { inspect.click() })
    assert.equal(f.inspections.at(-1), 'call-1')
    await React.act(async () => { row.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })) })
    assert.equal(row.getAttribute('aria-expanded'), 'false')
  }
})

test('preparing, started and result fallback stages retain the same disclosure and complete recorded input', async t => {
  const f = await fixture(t)
  const call = started('mcp__fixture__stream', { query: 'streamed argument' })
  await f.render({ ...call, phase: 'preparing' })
  let tool = f.window.document.querySelector('[data-tool="mcp__fixture__stream"]')
  assert.equal(tool.dataset.state, 'preparing')
  assert.equal(tool.querySelector('[data-disclosure-row]').getAttribute('aria-expanded'), null)
  await f.render(call)
  tool = f.window.document.querySelector('[data-tool="mcp__fixture__stream"]')
  assert.equal(tool.dataset.state, 'running')
  await React.act(async () => { tool.querySelector('[data-disclosure-row]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
  assert.match(tool.textContent, /streamed argument/)
  await f.render(result('mcp__fixture__stream', { query: 'streamed argument' }))
  tool = f.window.document.querySelector('[data-tool="mcp__fixture__stream"]')
  assert.equal(tool.dataset.state, 'ok')
  assert.equal(tool.querySelector('[data-disclosure-row]').getAttribute('aria-expanded'), 'true')
  assert.match(tool.textContent, /streamed argument/)
  assert.match(tool.textContent, /Visible result for call-1/)
})

test('built-in atomic priorities retain the rc.4 conflict contract and allow a third-party -10 override', async t => {
  const f = await fixture(t)
  assert.equal(f.ctx.slots.entriesOfSlot('tool.call.toolview').find(entry => entry.options.key === 'read').options.priority ?? 0, 0)
  assert.throws(() => f.ctx.slots.register({ name: 'tool.call.toolview', key: 'read' }, () => null), 'a same-key/same-priority collision must remain an error')
  const custom = f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('tool.call.toolview', () => scope.slots.register({ name: 'tool.call.toolview', key: 'read', priority: -10 }, () => React.createElement('div', { 'data-third-party-read': '' }, 'Custom read presentation')))
  } })
  await custom.await()
  await f.render(result('read', { file_path: '/workspace/test.txt' }))
  assert.ok(f.window.document.querySelector('[data-third-party-read]'))
  await custom.dispose()
  await f.render(result('read', { file_path: '/workspace/test.txt' }))
  assert.equal(f.window.document.querySelector('[data-third-party-read]'), null)
  assert.ok(f.window.document.querySelector('[data-tool="read"]'))
})

test('read_image retains its standard child chain, Modern original-byte factory and a replaceable base renderer', async t => {
  const f = await fixture(t)
  const block = result('read_image', { file_path: '/workspace/image.png' })
  block.meta = { path: '/workspace/image.png' }
  block.content = [{ type: 'text', text: '<path>/workspace/image.png</path>\n<type>image</type>\n<content>\nimage\n</content>' }]
  block.content.push({ type: 'image', attachment: { attachmentId: 'image-ref', mediaType: 'image/png', width: 1, height: 1, bytes: 68 } })
  const imageEntry = f.ctx.slots.entriesOfSlot('tool.call.images')[0]
  assert.equal(imageEntry.options.priority ?? 0, 0)
  await f.render(block)
  const tool = f.window.document.querySelector('[data-tool="read_image"]')
  await React.act(async () => { tool.querySelector('[data-disclosure-row]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
  assert.ok(tool.querySelector('[data-factory="modern.images.content"]'))
  assert.equal(f.factories.at(-1).props.loadImage, f.common.loadImage)
  assert.equal(f.factories.at(-1).props.images[0].attachment.attachmentId, 'image-ref')
  const custom = f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('tool.call.images', () => scope.slots.register({ name: 'tool.call.images', priority: -10 }, () => React.createElement('div', { 'data-third-party-image': '' }, 'Custom image presentation')))
  } })
  await custom.await()
  await f.render({ ...block })
  assert.ok(f.window.document.querySelector('[data-third-party-image]'))
  await custom.dispose()
  await f.render({ ...block })
  assert.ok(f.window.document.querySelector('[data-factory="modern.images.content"]'))
})

test('auto-review denial bypasses even a claimed atomic key and presents only the localized unexecuted result', async t => {
  const f = await fixture(t)
  await f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('tool.call.toolview', () => scope.slots.register({ name: 'tool.call.toolview', key: 'mcp__fixture__write', priority: -200 }, () => React.createElement('div', null, 'WRONG ATOMIC VIEW')))
  } }).await()
  const denied = { ...result('mcp__fixture__write', { sensitive: 'not-an-input-card' }), isError: true,
    error: { name: 'AutoReviewDeniedError', code: 'AUTO_REVIEW_DENIED', reason: 'Retain source\nfiles' },
    content: [{ type: 'text', text: 'RAW DENIAL STACK' }] }
  await f.render(denied)
  const tool = f.window.document.querySelector('[data-tool="mcp__fixture__write"]')
  assert.equal(tool.dataset.state, 'error')
  assert.match(tool.textContent, /Rejected by Auto review/)
  assert.doesNotMatch(tool.textContent, /WRONG ATOMIC VIEW|RAW DENIAL STACK|not-an-input-card/)
  const row = tool.querySelector('[data-disclosure-row]')
  await React.act(async () => { row.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
  assert.match(tool.textContent, /Tool was not executed\. Reason: Retain source files/)
  assert.doesNotMatch(tool.textContent, /RAW DENIAL STACK|not-an-input-card/)
})

test('recursive subcalls retain actual owner file, line, image loader and inspection callbacks', async t => {
  const f = await fixture(t)
  let childOwner
  await f.ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('tool.call.toolview', () => scope.slots.register({ name: 'tool.call.toolview', key: 'fixture_child' }, props => {
      childOwner = props
      return React.createElement('button', { onClick: () => { props.openFile('/workspace/nested.txt', { line: 7 }); props.inspect() } }, 'Open nested result')
    }))
  } }).await()
  await f.render(result('unknown_parent', {}, 'parent', [result('fixture_child', {}, 'child')]))
  assert.ok(f.window.document.querySelector('[data-chat-call-id="child"]'))
  await React.act(async () => { [...f.window.document.querySelectorAll('button')].find(button => button.textContent === 'Open nested result').click() })
  assert.equal(childOwner.phase, 'result')
  assert.equal(childOwner.home, '/home/fixture')
  assert.equal(childOwner.loadImage, f.common.loadImage)
  assert.deepEqual(f.files[0], ['/workspace/nested.txt', { line: 7 }])
  assert.equal(f.inspections[0], 'child')
})

test('todo predecessors replay through the real Conversation assembly, including legacy PTC calls; owner reload has one target', async t => {
  const f = await fixture(t)
  const conversation = f.ctx.uiConversation.binding(f.binding)
  const target = conversation.target('tool-todo-history'), off = target.subscribe(() => {})
  t.after(off)
  const todos = [{ id: 'one', content: 'Original task', status: 'pending' }]
  const events = [
    { seq: 0, type: 'todo/write', data: { todos } },
    { seq: 1, type: 'tool/call', data: { name: 'todo_write', callId: 'root-todo' } },
    { seq: 2, type: 'tool/ptc-dispatch-start', data: { name: 'todo_write', subCallId: 'nested-todo' } },
  ].map(event => ({ type: 'event', event: { time: 1, surfaceOp: 'append', ...event } }))
  f.feed.set({ revision: 1, entries: events, hasMore: false, change: { kind: 'append', entries: events } })
  assert.equal(target.getSnapshot().get('root-todo').todos[0].content, 'Original task')
  assert.equal(target.getSnapshot().get('nested-todo').todos[0].content, 'Original task')
  assert.equal(f.ctx.uiConversation.views.entries().filter(entry => entry.target === 'tool-todo-history').length, 1)
  await f.dispose()
  assert.equal(f.ctx.uiConversation.views.entries().length, 0)
  assert.equal(f.ctx.uiConversation.events.entries().length, 0)
  await f.restart()
  assert.equal(f.ctx.uiConversation.views.entries().filter(entry => entry.target === 'tool-todo-history').length, 1)
  assert.equal(f.ctx.uiConversation.events.entries().length, 2)
})

test('timed question review uses the official panel API and recorded questions/answers', async t => {
  const f = await fixture(t)
  const record = { questions: [{ id: 'q', question: 'Choose', options: [{ label: 'A', description: 'One' }], multiSelect: false }], answers: [{ id: 'q', selected: ['A'], custom: '' }] }
  f.common.useProjection = (name, selector) => selector(name === 'userQuestions'
    ? { active: [], settled: [{ callId: 'question-1', answers: record.answers }] } : undefined)
  await f.render(result('ask_user_question', { questions: [{ ...record.questions[0], multi_select: false }] }, 'question-1'))
  const tool = f.window.document.querySelector('[data-tool="ask_user_question"]')
  const review = [...tool.querySelectorAll('button')].find(button => button.textContent === 'View answers')
  assert.ok(review)
  await React.act(async () => { review.click() })
  assert.equal(f.panels[0][0], 'review')
  assert.equal(f.panels[0][1], 'session-1')
  assert.equal(f.panels[0][2], 'question-1')
  assert.equal(f.panels[0][3].questions[0].question, 'Choose')
  assert.deepEqual([...f.panels[0][3].answers[0].selected], ['A'])
  await React.act(async () => { tool.querySelector('button[aria-expanded="false"]').click() })
  assert.equal(tool.querySelector('dt').textContent, 'Choose')
  assert.equal(tool.querySelector('dd').textContent, 'A')
})

test('releasing the complete owner withdraws its child slot and restores the untouched official UI owner', async t => {
  const f = await fixture(t)
  const entry = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(item => item.options.key === 'tool-call')
  assert.deepEqual(Object.keys(entry.children), ['tool.call.toolview'])
  const source = entry.inject('session-1').hooks.hostInfo
  let resets = 0; const off = source.subscribe(() => resets++)
  t.after(off)
  f.remote.$host = { home: '/changed' }; f.ctx.emit('connection/reset')
  assert.equal(source.getSnapshot().home, '/changed'); assert.equal(resets, 1)
  await f.dispose()
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.node').length, 0)
  const official = await f.restoreOfficial()
  assert.equal(official.state, 2)
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.node').filter(item => item.options.key === 'tool-call').length, 1)
  assert.equal(f.ctx.uiConversation.views.entries().filter(item => item.target === 'tool-todo-history').length, 1)
  await official.dispose()
  assert.equal(f.ctx.uiConversation.views.entries().length, 0)
  await f.restart()
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.node').filter(item => item.options.key === 'tool-call').length, 1)
})
