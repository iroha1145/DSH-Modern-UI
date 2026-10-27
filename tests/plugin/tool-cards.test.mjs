import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { Context } = require('@deepseek-ai/cordis')
const scratch = path.join(root, '.artifacts/tool-ui')
mkdirSync(scratch, { recursive: true })
const output = await build({
  absWorkingDir: root, stdin: { contents: `export * from './packages/modern-ui/src/tool-cards.tsx'; export * from './packages/modern-ui/src/vendor/tool/client/tool/models/web-card-model.ts';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'css-test-bindings', setup(builder) {
    // Behavioral fixture uses real components; CSS layout is covered by browser validation.
    builder.onLoad({ filter: /\.css$/ }, args => ({ contents: `module.exports = new Proxy({}, {get: (_, key) => String(key)});`, loader: 'js' }))
  } }],
})
writeFileSync(path.join(scratch, 'tool-fixture.cjs'), output.outputFiles[0].text)
const client = require(path.join(scratch, 'tool-fixture.cjs'))
function fixture() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  let descriptor
  dom.window.__ModuleLoader__ = { load: value => { descriptor = value } }
  vm.runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), { window: dom.window, document: dom.window.document, console })
  const renderer = descriptor.factory(require)
  const ctx = new Context()
  let bindings = 0
  ctx.plugin({ apply(scope) {
    scope.provide('locale', { register: () => () => {} })
    scope.provide('uiConversation', { binding: () => { bindings += 1; return { target: key => { assert.equal(key, 'tool-todo-history'); return { getSnapshot: () => new Map(), subscribe: () => () => {} } } } } })
  } })
  ctx.plugin(renderer.SlotRegistry)
  ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } }, () => null)
    for (const key of ['read', 'web_search', 'web_fetch', 'todo_write', 'schedule_create', 'pwsh', 'read_image']) scope.slots.register({ name: 'tool.call.toolview', key }, () => null)
  } })
  const fiber = ctx.plugin({ inject: ['slots', 'locale'], apply: client.installToolCards })
  return { ctx, fiber, dom, bindings: () => bindings }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 25))
const started = (name, args) => ({ phase: 'start', callId: 'call-1', name, argsRaw: JSON.stringify(args), args: { text: key => args[key], has: key => key in args, complete: () => true, stringLength: key => String(args[key] ?? '').length } })
const result = (name, args, meta = {}) => ({ kind: 'tool-result', callId: 'call-1', call: started(name, args), name, args: started(name,args).args, content: [{ type: 'text', text: 'result body' }], meta, isError: false })
function props(toolName, block, extra = {}) {
  return { phase: 'result', block, toolName, callId: 'call-1', cwd: '/workspace', useDisclosure: () => ({ expanded: true, toggle() {} }), t: key => key,
    openFile() {}, inspect() {}, useSession: selector => selector({ hasMore: false }), useProjection: (_name, selector) => selector(undefined), ...extra }
}

test('rc4 keyed slots shade atomic rows, reuse TODO target, and withdraw without touching official seats', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const entries = f.ctx.slots.entriesOfSlot('tool.call.toolview')
  assert.ok(entries.some(e => e.options.key === 'read' && e.options.priority === -100))
  assert.ok(entries.some(e => e.options.key === 'web_search' && e.options.priority === -100))
  for (const key of ['schedule_create', 'pwsh']) assert.equal(entries.filter(e => e.options.key === key).length, 1)
  const todo = entries.find(e => e.options.key === 'todo_write' && e.options.priority === -100)
  const injected = todo.inject('session-1')
  assert.ok(injected.hooks.todoHistory); assert.equal(f.bindings(), 1)
  await f.fiber.dispose()
  assert.equal(f.ctx.slots.entriesOfSlot('tool.call.toolview').length, 7)
})

test('read/write/search and error rows preserve result content and openable file summaries', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const entries = f.ctx.slots.entriesOfSlot('tool.call.toolview')
  for (const key of ['read','write','grep']) {
    const entry = entries.find(e => e.options.key === key && e.options.priority === -100)
    const block = result(key, { file_path: '/workspace/sample.txt', pattern: 'needle', content: 'test' })
    const html = renderToStaticMarkup(React.createElement(entry.component, props(key, block)))
    assert.match(html, new RegExp(`data-tool="${key}"`)); assert.match(html, key === 'write' ? /data-diff/ : /result body/)
    if (key !== 'grep') assert.match(html, /sample.txt/)
  }
  const read = entries.find(e => e.options.key === 'read' && e.options.priority === -100)
  const html = renderToStaticMarkup(React.createElement(read.component, props('read', { ...result('read', { file_path: '/workspace/missing' }), isError: true, error: { code: 'FAILED' } })))
  assert.match(html, /data-state="error"/); assert.match(html, /result body/)
  await f.fiber.dispose()
})

test('web results retain sources and safe URL cards independently of removed network controls', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const entries = f.ctx.slots.entriesOfSlot('tool.call.toolview')
  const block = result('web_search', { queries: ['example'] }, { sources: [{ url: 'https://example.com/page', title: 'Example source', snippet: 'Found evidence' }], truncated: false, answer: 'Search answer' })
  assert.equal(client.webCardModel(block).sources.length, 1)
  const entry = entries.find(e => e.options.key === 'web_search' && e.options.priority === -100)
  const html = renderToStaticMarkup(React.createElement(entry.component, props('web_search', block)))
  assert.match(html, /Example source/); assert.match(html, /https:\/\/example.com\/page/)
  assert.equal(client.webFetchHref(result('web_fetch', { url: 'javascript:alert(1)' })), undefined)
  assert.equal(client.webFetchHref(result('web_fetch', { url: 'https://example.com' })), 'https://example.com')
  await f.fiber.dispose()
})






test('image read reuses the official public gallery factory without claiming its child slot', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('tool.call.toolview').find(e => e.options.key === 'read_image' && e.options.priority === -100)
  assert.equal(entry.children, undefined)
  const loadImage = async () => 'blob:session-owned'
  let gallery
  const block = result('read_image', { file_path: '/workspace/picture.png' }, { path: '/workspace/picture.png' })
  block.content = [
    { type: 'text', text: '<path>/workspace/picture.png</path>\n<type>image</type>\n<content>\nimage\n</content>' },
    { type: 'image', attachment: { attachmentId: 'opaque-image', mediaType: 'image/png', width: 10, height: 20, bytes: 30 } },
  ]
  const html = renderToStaticMarkup(React.createElement(entry.component, props('read_image', block, {
    loadImage,
    renderFactorySlot: (name, data) => { gallery = { name, data }; return React.createElement('div', { 'data-official-gallery': true }) },
  })))
  assert.equal(gallery.name, 'conversation.images.content')
  assert.equal(gallery.data.loadImage, loadImage)
  assert.equal(gallery.data.images[0].attachment.attachmentId, 'opaque-image')
  assert.match(html, /data-official-gallery/); assert.match(html, /picture.png/)
  const refused = { ...block, isError: true, content: [{ type: 'text', text: 'Image access denied' }] }
  gallery = undefined
  const fallback = renderToStaticMarkup(React.createElement(entry.component, props('read_image', refused, { loadImage, renderFactorySlot: () => { throw new Error('must not render gallery for a refusal') } })))
  assert.match(fallback, /Image access denied/); assert.equal(gallery, undefined)
  await f.fiber.dispose()
})
test('tool disclosure keyboard, file navigation, and inspect callbacks retain owner actions', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('tool.call.toolview').find(e => e.options.key === 'read' && e.options.priority === -100)
  const previous = { window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT }
  globalThis.window = f.dom.window; globalThis.document = f.dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = require('react-dom/client')
  const mount = f.dom.window.document.createElement('div'); f.dom.window.document.body.append(mount)
  const render = createRoot(mount)
  let opened, inspected = 0
  function Row() {
    const useDisclosure = () => { const [expanded, set] = React.useState(false); return { expanded, toggle: () => set(value => !value) } }
    return React.createElement(entry.component, props('read', result('read', { file_path: '/workspace/sample.txt' }), { useDisclosure, openFile: file => { opened = file }, inspect: () => { inspected += 1 } }))
  }
  try {
    await React.act(async () => render.render(React.createElement(Row)))
    const row = mount.querySelector('[data-disclosure-row]')
    assert.equal(row.getAttribute('aria-expanded'), 'false')
    await React.act(async () => mount.querySelector('button.fileLink').click())
    assert.equal(opened, '/workspace/sample.txt'); assert.equal(row.getAttribute('aria-expanded'), 'false')
    await React.act(async () => row.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    assert.equal(row.getAttribute('aria-expanded'), 'true'); assert.match(mount.textContent, /result body/)
    await React.act(async () => mount.querySelector('button.inspectButton').click())
    assert.equal(inspected, 1)
    await React.act(async () => row.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })))
    assert.equal(row.getAttribute('aria-expanded'), 'false'); assert.doesNotMatch(mount.textContent, /result body/)
  } finally {
    await React.act(async () => render.unmount())
    Object.assign(globalThis, previous)
    await f.fiber.dispose()
  }
})
