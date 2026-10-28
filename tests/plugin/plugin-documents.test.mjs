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
const options = {
  absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'cjs', jsx: 'automatic',
  external: [...shared, '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
}
const source = buildSync({ ...options,
  stdin: { contents: "export * from './packages/modern-ui/src/plugin-documents/index.tsx'", resolveDir: root, loader: 'tsx' },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
}).outputFiles[0].text
const primitiveSource = buildSync({ ...options,
  entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')], external: shared,
}).outputFiles[0].text
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
async function action(work) { await React.act(async () => { await work(); await settle(); await settle() }) }
async function click(element) { assert.ok(element, 'the expected control must be rendered'); await action(() => element.click()) }
const button = (host, label) => [...host.querySelectorAll('button')].find(node => node.textContent === label)
const ok = value => ({ ok: true, value })
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const marketUrl = 'https://fixture.invalid/index.json'
const fence = String.fromCharCode(96).repeat(3)
const longDocument = heading => '# ' + heading + '\n\n' + Array.from({ length: 28 }, (_, i) => 'Paragraph ' + i + ': the full plugin instructions remain visible.').join('\n\n')
  + '\n\n![Local screenshot](docs/screen.png)\n\n' + fence + 'js\nconst completeDocument = true\n' + fence
  + '\n\n<script>window.unsafeDocument = true</script>\n\n[Unsafe](javascript:alert(1))\n\nThe final paragraph survives.\n'

function environment() {
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
  const requests = []
  let respond = url => json({ status: 'found', origin: url.searchParams.get('language') === 'zh' ? 'locale' : 'readme',
    markdown: longDocument(url.searchParams.get('language') === 'zh' ? '中文完整说明' : 'Default README'),
    document: 'document-' + url.searchParams.get('language') + '-' + url.searchParams.get('version') })
  const fetchDocument = (input, init) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/api/modern-ui/plugin-document')
    assert.equal(init.credentials, 'same-origin')
    const request = { url, signal: init.signal }
    requests.push(request)
    return Promise.resolve(respond(url, request))
  }
  const sandbox = { ...globals, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    AbortController, TextEncoder, TextDecoder, structuredClone, fetch: fetchDocument, queueMicrotask, crypto, AbortSignal,
    performance: dom.window.performance }
  const prim = { exports: {} }
  vm.runInNewContext(primitiveSource, { ...sandbox, module: prim, exports: prim.exports, require })
  const modules = new Map([['@deepseek-ai/dsh-client-ui-primitives', prim.exports]])
  const imports = id => modules.has(id) ? modules.get(id) : require(id)
  function load(id) {
    let descriptor
    dom.window.__ModuleLoader__ = { load: value => { descriptor = value } }
    vm.runInNewContext(readFileSync(require.resolve(id + '/client'), 'utf8'), sandbox)
    assert.equal(descriptor.id, id)
    const exports = descriptor.factory(imports)
    modules.set(id, exports)
    return exports
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { ...sandbox, module, exports: module.exports, require: imports })
  return { dom, load, product: module.exports, requests, respond: next => { respond = next }, restore() {
    dom.window.close()
    for (const name of names) {
      if (prior[name]) Object.defineProperty(globalThis, name, prior[name])
      else delete globalThis[name]
    }
  } }
}

function entry(version = '1.0.0') {
  return { name: 'fixture-document-bundle', title: { en: 'Document bundle', zh: '文档插件' }, description: { en: 'Short summary', zh: '简短摘要' },
    metadata: { labels: [] }, installation: { status: 'not-installed' }, defaultVersion: version,
    versions: [{ version, publishTimestamp: 1700000000, compatibility: { compatible: true, exempted: false, runtimeVersion: '0.2.1-rc.4', requirements: {} },
      source: { type: 'npm' }, install: { type: 'npm', name: 'fixture-document-bundle', version } }] }
}

async function fixture(t, view = 'installed') {
  const env = environment(), ctx = new Context()
  let stop
  t.after(async () => {
    await action(async () => { stop?.(); await ctx.fiber.dispose() })
    env.restore()
  })
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-ui-renderer')).await()
  const subject = { kind: 'bundle', pkg: { name: 'fixture-document-bundle', version: '1.0.0' } }
  const navigation = createSnapshotStore({ view, subject })
  const noSession = createSnapshotStore({ key: 'no-session', ctx, hooks: {}, keyedHooks: {}, props: {} })
  const localeForm = createSnapshotStore({ status: 'ready', writable: true, revision: 1, value: {} })
  localeForm.mutate = async () => true
  let listingEntry = entry()
  const remoteCalls = [], events = new Map(), installs = []
  const market = {
    listIndexes: async () => { remoteCalls.push(['indexes']); return ok([{ url: marketUrl }]) },
    search: async (url, query) => { remoteCalls.push(['search', url, query]); return ok({ url, title: { en: 'Fixture market', zh: '测试市场' },
      metadata: { categories: {}, labels: {}, sortKeys: {} }, entries: [listingEntry], total: 1, nextOffset: null, fetchedAt: 1 }) },
  }
  await ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.provide('configForms', { get: () => localeForm })
    scope.provide('remote', { pluginMarket: market, $on: (event, callback) => { events.set(event, callback); return () => events.delete(event) } })
    scope.provide('remote.pluginMarket', market)
    scope.slots.installScope('session', { current: noSession, bindingSource: () => noSession,
      renderArea: (_binding, { children }) => children })
    scope.slots.provideRoot({ hooks: { documentNavigation: navigation } })
    scope.slots.register({ name: 'root', children: {
      'plugins.detail.section': { kind: 'list', scope: 'root' },
      'plugins.tab': { kind: 'list', scope: 'root' },
    } }, ({ renderSlot, useDocumentNavigation }) => {
      const current = useDocumentNavigation(value => value)
      return current.view === 'installed'
        ? React.createElement('main', { 'data-installed-detail': true }, renderSlot('plugins.detail.section', { subject: current.subject }))
        : renderSlot('plugins.tab', { install: choice => installs.push(choice), openPackage: () => navigation.set({ ...current, view: 'installed' }) }, { only: 'discover' })
    })
  } }).await()
  await ctx.plugin(env.load('@deepseek-ai/dsh-client-locale')).await()
  await ctx.plugin({ inject: ['locale'], apply(scope) {
    scope.effect(() => scope.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }))
  } }).await()
  await action(() => ctx.locale.setLocale('en'))
  const officialModule = env.load('@deepseek-ai/dsh-client-ui-plugin-market')
  let official = ctx.plugin(officialModule)
  await official.await()
  const modernDefinition = { name: 'fixture-plugin-documents', inject: ['slots', 'locale'], apply: env.product.installPluginDocuments }
  let modern = ctx.plugin(modernDefinition)
  await modern.await()
  await action(() => { stop = ctx.uiRenderer.mount(env.dom.window.document.getElementById('app')) })
  return { ...env, ctx, navigation, remoteCalls, installs, events, modern, official,
    language: next => action(() => ctx.locale.setLocale(next)),
    setEntry: async next => { listingEntry = next; await action(() => events.get('plugin-manager/changed')?.()) },
    restartModern: () => action(async () => { modern = ctx.plugin(modernDefinition); await modern.await() }),
    restartOfficial: () => action(async () => { official = ctx.plugin(officialModule); await official.await() }),
  }
}

test('Installed detail renders complete Markdown, relative media, code folding, locale response and README fallback', async t => {
  const f = await fixture(t)
  const document = f.dom.window.document
  const region = () => document.querySelector('[data-installed-detail] [role="region"]')
  assert.match(region().textContent, /Default README/)
  assert.match(region().textContent, /Paragraph 27/)
  assert.match(region().textContent, /The final paragraph survives/)
  assert.equal(region().getAttribute('aria-label'), 'Details')
  assert.equal(region().tabIndex, 0)
  assert.equal(region().querySelector('script'), null)
  assert.equal(region().querySelector('a[href^="javascript:"]'), null)
  const image = new URL(region().querySelector('img[alt="Local screenshot"]').src)
  assert.equal(image.pathname, '/api/modern-ui/plugin-document-image')
  assert.equal(image.searchParams.get('document'), 'document-en-1.0.0')
  assert.equal(image.searchParams.get('path'), 'docs/screen.png')
  const code = () => region().querySelector('[data-code-block-content]')
  assert.match(code().textContent, /const completeDocument = true/)
  await click(region().querySelector('button[aria-label="Collapse code"]'))
  assert.equal(code().hidden, true)
  await click(region().querySelector('button[aria-label="Expand code"]'))
  assert.equal(code().hidden, false)
  await f.language('zh')
  assert.match(region().textContent, /中文完整说明/)
  assert.equal(region().getAttribute('aria-label'), '详细介绍')
  assert.equal(f.requests.at(-1).url.searchParams.get('language'), 'zh')
  await f.language('ja')
  assert.match(region().textContent, /Default README/, 'a readme-origin response is displayed when no language document exists')
  assert.equal(region().getAttribute('aria-label'), '詳細')
  await action(() => f.navigation.set({ view: 'installed', subject: { kind: 'plugin', plugin: { name: 'ordinary-plugin' } } }))
  assert.equal(region(), null, 'ordinary plugin rows do not pretend to be independently installed bundles')
  await action(() => f.navigation.set({ view: 'installed', subject: { kind: 'bundle', pkg: { name: 'fixture-document-bundle', version: '2.0.0' } } }))
  assert.equal(f.requests.at(-1).url.searchParams.get('version'), '2.0.0')
  assert.match(region().textContent, /The final paragraph survives/)
  await action(() => f.modern.dispose())
  assert.equal(document.querySelector('[data-detail-document]'), null)
  assert.equal(f.ctx.slots.entries('plugins.detail.section').length, 0)
  await f.restartModern()
  assert.match(region().textContent, /Default README/)
})

test('Discover uses the actual rc4 controller face and retains reading, install, locale and owner replacement behavior', async t => {
  const f = await fixture(t, 'discover')
  const document = f.dom.window.document
  const official = () => f.ctx.slots.entries('plugins.tab').find(entry => (entry.options.priority ?? 0) === 0)
  const modern = () => f.ctx.slots.entries('plugins.tab').find(entry => entry.options.priority === -100)
  assert.equal(modern().inject().hooks.discover, official().inject().hooks.discover)
  assert.equal(modern().inject().hooks.locale, f.ctx.locale)
  assert.equal(modern().inject().search, official().inject().search)
  assert.equal(f.remoteCalls.filter(call => call[0] === 'indexes').length, 1)
  assert.equal(document.querySelectorAll('[data-market-entry]').length, 1)
  await click(document.querySelector('[data-market-entry] button[aria-label="View Document bundle"]'))
  const region = () => document.querySelector('[data-market-detail] [role="region"]')
  assert.match(region().textContent, /Paragraph 27/)
  assert.equal(f.requests.at(-1).url.searchParams.get('kind'), 'market')
  assert.equal(f.requests.at(-1).url.searchParams.get('url'), marketUrl)
  await click(region().querySelector('button[aria-label="Collapse code"]'))
  assert.equal(region().querySelector('[data-code-block-content]').hidden, true)
  await click(document.querySelector('[data-market-detail] button[aria-label="Install Document bundle"]'))
  assert.ok(document.querySelector('[role="dialog"]'))
  await click(button(document.querySelector('[role="dialog"]'), 'Install'))
  assert.equal(f.installs.length, 1)
  assert.equal(f.installs[0].version, '1.0.0')
  await f.language('zh')
  assert.match(region().textContent, /中文完整说明/)
  assert.equal(document.querySelector('[data-market-detail] h3').textContent, '文档插件')
  await f.setEntry(entry('2.0.0'))
  assert.equal(f.requests.at(-1).url.searchParams.get('version'), '2.0.0')
  assert.match(region().textContent, /The final paragraph survives/)
  await action(() => f.modern.dispose())
  assert.equal(modern(), undefined)
  assert.ok(document.querySelector('[data-plugin-tab="discover"]'), 'the official view resumes after Modern unload')
  assert.equal(document.querySelector('[data-detail-document]'), null)
  await f.restartModern()
  await click(document.querySelector('[data-market-entry] button[aria-label="查看 文档插件"]'))
  assert.match(region().textContent, /Paragraph 27/)
  const previousFace = official().inject()
  await action(() => f.official.dispose())
  assert.equal(modern(), undefined, 'the shadow leaves together with its official controller owner')
  assert.equal(document.querySelector('[data-plugin-tab="discover"]'), null)
  await f.restartOfficial()
  assert.notEqual(official().inject().hooks.discover, previousFace.hooks.discover)
  assert.equal(modern().inject().hooks.discover, official().inject().hooks.discover)
  await click(document.querySelector('[data-market-entry] button[aria-label="查看 文档插件"]'))
  assert.match(region().textContent, /The final paragraph survives/)
})

test('document failures show a localized retry and stale requests cannot overwrite a new language or owner', async t => {
  const f = await fixture(t)
  const document = f.dom.window.document
  f.respond(() => json({ reason: 'too-large' }, 413))
  await f.language('zh')
  assert.match(document.querySelector('[role="alert"]').textContent, /超过大小限制/)
  f.respond(() => json({ status: 'found', origin: 'readme', markdown: '# Repaired full README\n\nRetry succeeded.', document: 'repaired' }))
  await click(button(document, '重试'))
  assert.equal(f.requests.at(-1).url.searchParams.get('refresh'), 'true')
  assert.match(document.querySelector('[role="region"]').textContent, /Retry succeeded/)
  let release
  f.respond(() => new Promise(resolve => { release = resolve }))
  await f.language('en')
  const stale = f.requests.at(-1)
  assert.ok(document.querySelector('[role="status"][aria-busy="true"]'))
  f.respond(() => json({ status: 'found', origin: 'locale', markdown: '# Fresh Chinese document', document: 'fresh' }))
  await f.language('zh')
  assert.equal(stale.signal.aborted, true)
  await action(() => release(json({ status: 'found', origin: 'readme', markdown: '# Stale English document', document: 'stale' })))
  assert.match(document.querySelector('[role="region"]').textContent, /Fresh Chinese document/)
  assert.doesNotMatch(document.body.textContent, /Stale English document/)
  let abandoned
  f.respond(() => new Promise(resolve => { abandoned = resolve }))
  await f.language('en')
  const pending = f.requests.at(-1)
  await action(() => f.modern.dispose())
  assert.equal(pending.signal.aborted, true)
  await action(() => abandoned(json({ status: 'found', origin: 'readme', markdown: '# Unmounted response', document: 'abandoned' })))
  assert.equal(document.querySelector('[data-detail-document]'), null)
})
