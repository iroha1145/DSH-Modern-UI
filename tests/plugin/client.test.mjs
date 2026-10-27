import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(process.env.MODERN_UI_BUILD_DEPS
  ? path.join(path.resolve(process.env.MODERN_UI_BUILD_DEPS), 'package.json')
  : path.join(root, 'package.json'))
const { JSDOM } = require('jsdom')
const { Context } = require('@deepseek-ai/cordis')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const staticPrimitivesSource = require('esbuild').buildSync({
  entryPoints: [require.resolve('@deepseek-ai/dsh-client-ui-primitives')], bundle: true, write: false,
  platform: 'browser', format: 'cjs', external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  loader: { '.module.css': 'text', '.css': 'empty', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text

function load(file, document, primitives) {
  let descriptor
  const window = document.defaultView
  window.__ModuleLoader__ = { load: value => { descriptor = value } }
  vm.runInNewContext(readFileSync(file, 'utf8'), { window, document, navigator: window.navigator, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, fetch })
  assert.ok(descriptor?.factory, `${file} must register a module factory`)
  return descriptor.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name))
}

function fixture({ realTheme = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:3080/' })
  const staticModule = { exports: {} }
  vm.runInNewContext(staticPrimitivesSource, { module: staticModule, exports: staticModule.exports, require,
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, console, setTimeout, clearTimeout,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, fetch })
  const renderer = load(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), dom.window.document)
  const client = load(path.join(root, 'packages/modern-ui/lib/client.js'), dom.window.document, staticModule.exports)
  const themeClient = realTheme ? load(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), dom.window.document, staticModule.exports) : undefined
  const ctx = new Context()
  const dictionaries = new Map()
  const languages = new Map([['zh', { id: 'zh' }], ['en', { id: 'en' }]])
  const values = new Map()
  const remoteEvents = new Map()
  const catalogRequests = []
  if (realTheme) values.set('ui-theme', createSnapshotStore({ value: {
    preference: 'system', fontSize: 14, codeFontSize: 13, terminalFontSize: 13,
    textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
  } }))
  const form = name => {
    if (!values.has(name)) values.set(name, createSnapshotStore({ value: {} }))
    const store = values.get(name)
    return { getSnapshot: store.getSnapshot, subscribe: store.subscribe,
      set: async (field, value) => { store.set({ value: { ...store.getSnapshot().value, [field]: value } }); return true }, mutate: async () => true }
  }
  const dir = { store: createSnapshotStore({ current: null, groups: [], failures: [], status: 'ready', pending: null, error: null, routable: null }), load: async () => {}, select: async () => ({ ok: true }) }
  const providers = ctx.plugin({ apply(scope) {
    scope.provide('locale', {
      register: (name, language, dict) => {
        const key = dict === undefined ? name : `${name}:${language}`
        dictionaries.set(key, dict === undefined ? language : dict)
        return () => dictionaries.delete(key)
      },
      getLocale: () => ({ locales: [...languages.values()] }),
      addLanguage: value => { languages.set(value.id, value); return () => languages.delete(value.id) },
      bind: name => (key, params) => {
        let value = dictionaries.get(name)?.en?.[key] ?? key
        for (const [field, replacement] of Object.entries(params ?? {})) value = value.replace(`{${field}}`, String(replacement))
        return value
      },
    })
    const theme = realTheme ? new themeClient.ThemeRuntime(scope, form('ui-theme')) : { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens: () => () => {} }
    if (realTheme) theme.overrideTokens('earlier-theme', { '--page': { light: 'prior-light', dark: 'prior-dark' } })
    scope.provide('theme', theme)
    scope.provide('modelDirectories', { directoryFor: () => dir })
    scope.provide('sessions', { subagentAddress: () => undefined })
    scope.provide('uiWorkspace', { openSession: () => {} })
    scope.provide('sidebarRight', { openResource: () => {} })
    scope.provide('configForms', { get: form })
    scope.provide('commandUi', { catalogFor: () => createSnapshotStore([]) })
    scope.provide('remote', { commands: { execute: async () => ({ ok: false, error: { code: 'missing', message: 'unavailable' } }) }, session: { modelCatalog: async () => { catalogRequests.push(true); return { ok: true, value: { groups: [], failures: [] } } } }, $on: (event, listener) => {
      if (!remoteEvents.has(event)) remoteEvents.set(event, new Set())
      remoteEvents.get(event).add(listener)
      return () => remoteEvents.get(event).delete(listener)
    } })
    scope.provide('remote.commands', { execute: async () => ({ ok: false, error: { code: 'missing', message: 'unavailable' } }) })
    scope.provide('remote.session', { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) })
  } })
  ctx.plugin(renderer.SlotRegistry)
  ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.register({ name: 'root', children: {
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      'settings.models.footer': { kind: 'list', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    } }, () => null)
    // The shipped assistant has its own children. Both declarations must coexist.
    scope.slots.register({ name: 'conversation.input.model' }, () => null)
    scope.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', children: {
      'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'conversation.chat.message.images': { kind: 'single', scope: 'session' },
    } }, () => null)
  } })
  const fiber = ctx.plugin(client)
  return { dom, ctx, fiber, client, dictionaries, providers, remoteEvents, catalogRequests }
}

test('Modern uses the real theme override layer and restores earlier owners without changing preference', async () => {
  const f = fixture({ realTheme: true })
  await f.providers.await()
  await f.fiber.await()
  assert.equal(f.ctx.theme.getTheme().preference, 'system')
  assert.match(f.ctx.theme.getTheme().active.tokens['--page'], /^#fff(?:fff)?$/)
  f.ctx.theme.setTheme('dark')
  assert.match(f.ctx.theme.getTheme().active.tokens['--page'], /^#111(?:111)?$/)
  assert.match(f.ctx.theme.getTheme().active.tokens['--bui-ease-out'], /^cubic-bezier\(/)
  const darkShadow = f.ctx.theme.getTheme().active.tokens['--bui-shadow-inset-field']
  assert.match(darkShadow, /(?:\.4|40%)/)
  f.ctx.theme.setTheme('light')
  assert.notEqual(f.ctx.theme.getTheme().active.tokens['--bui-shadow-inset-field'], darkShadow)
  f.ctx.theme.setTheme('dark')
  const stale = f.ctx.theme.overrideTokens('later-theme', { '--page': { light: 'old', dark: 'old-dark' } })
  const newest = f.ctx.theme.overrideTokens('later-theme', { '--page': { light: 'new', dark: 'new-dark' } })
  stale()
  assert.equal(f.ctx.theme.getTheme().active.tokens['--page'], 'new-dark')
  newest()
  await f.fiber.dispose()
  assert.equal(f.ctx.theme.getTheme().preference, 'dark')
  assert.equal(f.ctx.theme.getTheme().active.tokens['--page'], 'prior-dark')
  assert.equal(f.dom.window.document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]').length, 0)
})

test('product icon sprite is owned by the plugin: every dsw-icon symbol resolves, shared across instances, removed with the last owner', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await()
  const document = f.dom.window.document
  const sprite = document.getElementById('modern-ui-icon-sprite')
  assert.ok(sprite, 'the official host publishes no dsw-icon sprite, so the plugin must mount one')
  const symbols = [...sprite.querySelectorAll('symbol')]
  assert.ok(symbols.length >= 100, `expected the whole product icon set, got ${symbols.length}`)
  assert.ok(symbols.every(symbol => /^dsw-icon-[a-z0-9-]+-(?:regular|medium)$/.test(symbol.id) && symbol.getAttribute('viewBox')))
  const plus = document.getElementById('dsw-icon-plus-outline-medium')
  assert.equal(plus?.getAttribute('stroke-width'), '1.3')
  assert.equal(plus.querySelectorAll('path').length, 2)
  // Every <use> the bundle can emit points at a symbol that exists in this document.
  const rendered = renderToStaticMarkup(React.createElement(f.client.IconPlusOutlineMedium ?? (() => null)))
  for (const match of rendered.matchAll(/href="#([^"]+)"/g)) assert.ok(document.getElementById(match[1]), match[1])
  const second = f.ctx.plugin(f.client)
  await second.await()
  assert.equal(document.querySelectorAll('#modern-ui-icon-sprite').length, 1, 'one sprite per document')
  await second.dispose()
  assert.ok(document.getElementById('modern-ui-icon-sprite'), 'the first owner still needs it')
  await f.fiber.dispose()
  assert.equal(document.getElementById('modern-ui-icon-sprite'), null)
})

test('running status is rendered into the official running row from the composer dock, follows the phases and leaves with the row', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await()
  const entry = f.ctx.slots.entriesOfSlot('conversation.composer.dock').find(candidate => candidate.options.id === 'modern-running-status')
  assert.ok(entry, 'the plugin contributes an always-mounted dock entry that hosts the running status')
  const originals = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = f.dom.window
  globalThis.document = f.dom.window.document
  const doc = f.dom.window.document
  doc.body.innerHTML = '<div id="panel"><div data-slot="conversation.chat.flow"><div data-chat-running=""><span class="official">深度求索中</span></div></div><div data-composer-dock id="dock"></div></div>'
  const snapshot = (partial, runningCalls = [], start = Date.now() - 65_000) => ({
    legacy: { partial, runningCalls },
    navigation: { items: () => [{ anchorKey: 'turn-1' }] },
    nodes: new Map([['turn-1', { location: { kind: 'turn', turn: { start: { time: start } } } }]]),
  })
  const root = require('react-dom/client').createRoot(doc.getElementById('dock'))
  try {
    let chat = snapshot({ blocks: [{ kind: 'text', text: 'Answer' }] })
    const render = async () => {
      root.render(React.createElement(entry.component, { useChat: selector => selector(chat), t: key => key }))
      await settle(); await settle()
    }
    await render()
    assert.ok(doc.querySelector('[data-composer-dock] [data-modern-running-host]'), 'the dock keeps only a hidden anchor')
    const status = () => doc.querySelector('[data-chat-running] [data-modern-running]')
    assert.equal(status()?.getAttribute('data-modern-running'), 'responding', 'the status renders inside the official row')
    assert.match(status().textContent, /chat\.activity\.responding/)
    assert.ok(status().querySelector('[data-loading-elapsed]'))
    assert.ok(status().querySelector('.t-matrix'))
    chat = snapshot({ blocks: [{ kind: 'reasoning', text: 'Detailed: ...' }] })
    await render()
    assert.equal(status().getAttribute('data-modern-running'), 'thinking')
    assert.equal(status().querySelector('[data-loading-label]'), null, 'a live reasoning header already names the activity')
    assert.ok(status().querySelector('[data-loading-elapsed]'))
    chat = snapshot({ blocks: [] }, [{ id: 'call' }])
    await render()
    assert.equal(status().getAttribute('data-modern-running'), 'tools')
    doc.querySelector('[data-chat-running]').remove()
    await settle(); await settle()
    assert.equal(doc.querySelectorAll('[data-modern-running]').length, 0, 'the portal leaves with the official row')
  } finally {
    root.unmount()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  const styles = [...doc.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]')].map(style => style.textContent).join('\n')
  assert.match(styles, /\[data-chat-running\]>:not\(\[data-modern-running\]\)\{display:none/, 'the official row keeps its place but its own children hide')
  await f.fiber.dispose()
})

test('folded replies live in the plugin settings namespace, drive the presentation policy and get their own general-settings row', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await()
  const row = f.ctx.slots.entriesOfSlot('settings.general.item').find(candidate => candidate.options.id === 'modern-folded-replies')
  assert.ok(row, 'the plugin registers the folded-reply row next to the official transcript rows')
  assert.equal(row.options.order, 13)
  const assistant = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(candidate => candidate.options.key === 'assistant-step' && candidate.options.priority === -100)
  const policy = () => assistant.inject('session-1').hooks.presentation.getSnapshot()
  assert.equal(policy().foldedReplies, 'all')
  const face = row.inject()
  assert.equal(face.hooks.foldedReplies.getSnapshot(), 'all')
  face.setFoldedReplies('final')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(face.hooks.foldedReplies.getSnapshot(), 'final')
  assert.equal(policy().foldedReplies, 'final', 'the modern-ui form value reaches the chat presentation policy')
  assert.equal(policy().mode, 'standard')
  const markup = renderToStaticMarkup(React.createElement(row.component, { ...face, useFoldedReplies: selector => selector(face.hooks.foldedReplies.getSnapshot()), t: key => key }))
  assert.match(markup, /settings\.foldedReplies\.title/)
  assert.match(markup, /settings\.foldedReplies\.final/)
  await f.fiber.dispose()
})

function translationRemote(f, limits) {
  return f.ctx.plugin({ inject: ['remote'], apply(scope) {
    const cotTranslation = { limits, translate: async request => ({ ok: true, value: `Translated ${request.text}` }) }
    scope.remote.cotTranslation = cotTranslation
    scope.provide('remote.cotTranslation', cotTranslation)
  } })
}
const translationSnapshot = () => ({ ok: true, value: {
  maxTextChars: 1000, preferences: { provider: 'bing', targetLanguage: 'en' }, availableProviders: ['bing'],
} })
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

for (const failure of ['result', 'throw']) test(`initial translation ${failure} failure retries only after reset and mounts once`, async () => {
  const f = fixture()
  await f.fiber.await()
  let calls = 0, successful = false, active = 0, maximum = 0
  const remote = translationRemote(f, async () => {
    calls += 1; active += 1; maximum = Math.max(maximum, active)
    await settle()
    active -= 1
    if (successful) return translationSnapshot()
    if (failure === 'throw') throw new Error('fixture initial metadata failure')
    return { ok: false, error: { code: 'fixture', message: 'fixture initial metadata failure' } }
  })
  await remote.await()
  await settle(); await settle()
  assert.equal(calls, 1)
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 1)
  successful = true
  f.ctx.emit('connection/reset')
  f.ctx.emit('connection/reset')
  await settle(); await settle(); await settle()
  assert.equal(maximum, 1)
  assert.ok(calls >= 2 && calls <= 3)
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.equal(f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body')[0].options.priority, -100)
  const acceptedCalls = calls
  await settle(); await settle()
  assert.equal(calls, acceptedCalls)
  await remote.dispose()
  await f.fiber.dispose()
})

test('translation mounts after Modern is disabled and enabled before Remote appears', async () => {
  const f = fixture()
  await f.fiber.await()
  await f.fiber.dispose()
  const again = f.ctx.plugin(f.client)
  await again.await()
  const remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.equal(f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body')[0].options.priority, -100)
  await remote.dispose()
  await again.dispose()
})

test('translation mounts again after its Remote disappears and returns', async () => {
  const f = fixture()
  await f.fiber.await()
  let remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 2)
  await remote.dispose()
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 1)
  remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.equal(f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body')[0].options.priority, -100)
  await remote.dispose()
  await f.fiber.dispose()
})

test('Modern retains the official document-owned input tracker through disable and enable', async () => {
  const f = fixture()
  await f.fiber.await()
  const html = f.dom.window.document.documentElement
  f.dom.window.dispatchEvent(new f.dom.window.Event('pointerdown'))
  assert.equal(html.getAttribute('data-input-modality'), 'pointer')
  await f.fiber.dispose()
  f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Tab' }))
  assert.equal(html.getAttribute('data-input-modality'), 'keyboard')
  const again = f.ctx.plugin(f.client)
  await again.await()
  f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Tab' }))
  assert.equal(html.getAttribute('data-input-modality'), 'keyboard')
  await again.dispose()
})

test('optional official translation Remote installs and withdraws the Modern body', async () => {
  const f = fixture()
  await f.fiber.await()
  // Presentation waits in a child injection so UI owners can mount first.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body').length, 1)
  const remote = f.ctx.plugin({ inject: ['remote'], apply(scope) {
    const cotTranslation = { limits: async () => ({ ok: true, value: {
      maxTextChars: 1000, preferences: { provider: 'bing', targetLanguage: 'en' }, availableProviders: ['bing'],
    } }), translate: async request => ({ ok: true, value: `Translated ${request.text}` }) }
    scope.remote.cotTranslation = cotTranslation
    scope.provide('remote.cotTranslation', cotTranslation)
  } })
  await remote.await()
  await new Promise(resolve => setTimeout(resolve, 30))
  const entries = f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body')
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 2)
  const translation = entries.find(value => value.options.priority === -100)
  assert.ok(translation)
  const markup = renderToStaticMarkup(React.createElement(translation.component, {
    text: 'Original reasoning', running: false,
    translate: async () => 'Translated',
    usePreferences: selector => selector({ provider: 'bing', targetLanguage: 'en' }),
    useTranslationLocale: selector => selector({ active: 'en' }),
    useTranslationLimit: selector => selector(1000),
    t: key => key,
    reasoningT: key => key,
    renderFactorySlot: () => { throw new Error('Translated reasoning must use Modern Markdown') },
  }))
  assert.match(markup, /Original reasoning/)
  assert.match(markup, /data-cot-translation/)
  await remote.dispose()
  assert.equal(f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body').length, 1)
  await f.fiber.dispose()
})

test('withdrawing translation Remote cancels pending metadata before registering a body', async () => {
  const f = fixture()
  await f.fiber.await()
  let signal
  const remote = f.ctx.plugin({ inject: ['remote'], apply(scope) {
    const cotTranslation = { limits: cancellation => new Promise((_resolve, reject) => {
      signal = cancellation
      cancellation.addEventListener('abort', () => reject(new Error('fixture cancelled')), { once: true })
    }) }
    scope.remote.cotTranslation = cotTranslation
    scope.provide('remote.cotTranslation', cotTranslation)
  } })
  await remote.await()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(signal)
  await remote.dispose()
  assert.equal(signal.aborted, true)
  assert.equal(f.ctx.slots.snapshot('modern.conversation.chat.reasoning.body')[0].occupants.length, 1)
  await f.fiber.dispose()
})

test('official rc.4 slot registry accepts Modern shades without duplicate declarations', async () => {
  const f = fixture()
  await new Promise(resolve => setTimeout(resolve, 30))
  await f.fiber.await()
  const node = f.ctx.slots.snapshot('conversation.chat.node')[0]
  const assistantEntries = node.occupants.filter(entry => entry.key === 'assistant-step')
  assert.equal(assistantEntries.length, 2)
  assert.equal(assistantEntries.filter(entry => entry.active).length, 1)
  assert.equal(f.ctx.slots.spec('conversation.chat.reasoning.body').kind, 'single')
  assert.equal(f.ctx.slots.spec('modern.conversation.chat.message.code').kind, 'chain')
  const chain = f.ctx.slots.entriesOfSlot('modern.conversation.chat.message.code')
  assert.equal(chain.length, 3)
  assert.equal(f.ctx.slots.snapshot('conversation.input.model')[0].occupants.length, 2)
  assert.equal(f.dictionaries.get('modern-intelligent').ja.loading !== undefined, true)
  assert.equal(f.dictionaries.get('common:ja').copy, 'コピー')
  const styles = f.dom.window.document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]')
  assert.ok(styles.length > 20)
  await f.fiber.dispose()
  assert.equal(f.dom.window.document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]').length, 0)
})

test('precompiled code chain keeps openui, followups, and ordinary code presentation', async () => {
  const f = fixture()
  await new Promise(resolve => setTimeout(resolve, 30))
  const chain = f.ctx.slots.entriesOfSlot('modern.conversation.chat.message.code')
  const elected = lang => chain.filter(entry => entry.select({ lang }) !== null).sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
  assert.notEqual(elected('openui'), elected('javascript'))
  assert.notEqual(elected('followups'), elected('javascript'))
  const output = renderToStaticMarkup(React.createElement(elected('followups').component, {
    code: 'Explain the tradeoff\nShow another example', streaming: false, closed: true,
    t: key => key,
    useSession: selector => selector({ running: false, removed: false, subagent: null }),
    useInput: selector => selector({ phase: 'plain', draft: '', attachmentIds: [] }),
    useAccess: () => true,
    inputActions: {},
  }))
  assert.match(output, /Explain the tradeoff/)
  await f.fiber.dispose()
})

test('artifact does not embed React, Cordis, session services, or host source', () => {
  const metadata = JSON.parse(readFileSync(path.join(root, 'packages/modern-ui/lib/build-inputs.json'), 'utf8'))
  assert.equal(metadata.host, '0.2.1-rc.4')
  assert.ok(!metadata.inputs.some(file => /node_modules\/(react|react-dom|@deepseek-ai\/cordis)\//.test(file)))
  assert.ok(!metadata.inputs.some(file => /vendor\/(model\/client\/(service|directory)|chat\/client\/(apply|stores))\.ts$/.test(file)))
  const packageJson = JSON.parse(readFileSync(path.join(root, 'packages/modern-ui/package.json'), 'utf8'))
  assert.equal(packageJson.scripts?.prepare, undefined)
  assert.equal(packageJson.scripts?.postinstall, undefined)
})

test('agent tree preserves nested parentage, models, statuses, usage and external children', async () => {
  const f = fixture()
  await f.fiber.await()
  await new Promise(resolve => setTimeout(resolve, 30))
  const entry = f.ctx.slots.entriesOfSlot('conversation.view').find(value => value.options.id === 'agents')
  assert.ok(entry)
  const summary = (id, extra = {}) => ({ id, displayTitle: id, running: false, blank: false, updatedAt: 0, retainedBy: {}, ...extra })
  const values = {
    root: summary('root'),
    child: summary('child', { origin: 'subagent', parentId: 'root', projectionValues: { modelSelection: { next: { model: 'child-model' } }, subagentTiming: { settledMs: 1100, lastTurnCompleted: true }, tokenUsage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5 } } }),
    grandchild: summary('grandchild', { origin: 'subagent', parentId: 'child', running: true }),
  }
  const list = { byId: values, projectionsBySession: {
    root: { state: 'ready', values: { subagentCatalog: [{ id: 'child', mode: 'continuable', createdAt: 1 }, { id: 'external-task', mode: 'external', label: 'External worker', createdAt: 2 }] } },
    child: { state: 'ready', values: {} }, grandchild: { state: 'ready', values: {} },
  } }
  const translate = f.dictionaries.get('modern-subagent').en
  const markup = renderToStaticMarkup(React.createElement(entry.component, {
    sessionId: 'root', useSession: selector => selector({ subagent: null }),
    useSessions: selector => selector(list), useSessionStatus: selector => selector(new Map()),
    openSession: () => {}, refreshProjections: () => {},
    t: (key, params = {}) => Object.entries(params).reduce((value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)), translate[key] ?? key),
  }))
  const document = new JSDOM(markup).window.document
  assert.equal(document.querySelectorAll('[role="treeitem"]').length, 4)
  assert.match(document.body.textContent, /child-model/)
  assert.match(document.body.textContent, /135/)
  assert.match(document.body.textContent, /External worker/)
  assert.ok(document.querySelector('[aria-level="3"]'))
  await f.fiber.dispose()
})

test('model catalog refreshes after either credential event', async () => {
  const f = fixture()
  await f.fiber.await(); await settle()
  for (const event of ['credentials/record-updated', 'credentials/reference-updated']) {
    const before = f.catalogRequests.length
    assert.equal(f.remoteEvents.get(event)?.size, 1)
    for (const listener of f.remoteEvents.get(event)) listener()
    await settle()
    assert.equal(f.catalogRequests.length, before + 1)
  }
  await f.fiber.dispose()
})

test('manual compaction uses Modern checkpoints and retains running and complete failure output', async () => {
  const f = fixture()
  await f.fiber.await(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(value => value.options.key === 'manual-compaction')
  assert.ok(entry)
  const render = (command, compaction = null) => renderToStaticMarkup(React.createElement(entry.component, {
    node: { kind: 'manual-compaction', data: { command, compaction } }, t: key => key,
  }))
  const running = render({ name: 'compact', outcome: null })
  assert.match(running, /data-state="running"/)
  assert.match(running, /message.compaction.running/)
  const failure = render({ name: 'compact', outcome: { kind: 'error', text: 'First failure line\nSecond failure line' } })
  assert.match(failure, /data-state="error"/)
  assert.match(failure, /First failure line/)
  assert.match(failure, /Second failure line/)
  const checkpoint = render({ name: 'compact', outcome: { kind: 'ok', text: 'Saved summary' } }, {
    summary: 'Full summary', shadowedItemCount: null, shadowedTokenCount: null,
  })
  assert.match(checkpoint, /data-compaction-icon="context"/)
  assert.match(checkpoint, /message.compaction.commandTitle/)
  assert.match(checkpoint, /Saved summary/)
  assert.doesNotMatch(checkpoint, /data-state=/)
  await f.fiber.dispose()
})

test('translated and original reasoning retain Modern code disclosure and localized labels', async () => {
  const f = fixture()
  await f.fiber.await()
  const remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('modern.conversation.chat.reasoning.body').find(value => value.options.priority === -100)
  const originals = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = f.dom.window
  globalThis.document = f.dom.window.document
  const root = require('react-dom/client').createRoot(f.dom.window.document.body.appendChild(f.dom.window.document.createElement('div')))
  try {
    root.render(React.createElement(entry.component, {
      text: '```text\nOriginal body\n```', running: false,
      translate: async () => '```text\nTranslated body\n```',
      usePreferences: selector => selector({ provider: 'bing', targetLanguage: 'en' }),
      useTranslationLocale: selector => selector({ active: 'en' }),
      useTranslationLimit: selector => selector(1000),
      t: key => key,
      reasoningT: key => `localized:${key}`,
      renderFactorySlot: () => { throw new Error('Official reasoning factory must not be used') },
    }))
    await settle(); await settle()
    const doc = f.dom.window.document
    assert.match(doc.body.textContent, /Translated body/)
    const collapse = doc.querySelector('button[aria-label="localized:codeBlock.collapse"]')
    assert.ok(collapse, 'translated code exposes the Modern collapse control')
    collapse.click(); await settle()
    assert.ok(doc.querySelector('button[aria-label="localized:codeBlock.expand"]'))
    ;[...doc.querySelectorAll('button')].find(button => button.textContent === 'original').click()
    await settle()
    assert.match(doc.body.textContent, /Original body/)
    assert.equal(doc.querySelector('[data-translation-view]').dataset.translationView, 'original')
    assert.ok(doc.querySelector('button[aria-label^="localized:codeBlock."]'))
  } finally {
    root.unmount()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    await remote.dispose(); await f.fiber.dispose()
  }
})

test('official rc4 Remote subscriptions belong to their calling Cordis fiber', async () => {
  const gateway = await import('@deepseek-ai/dsh-api-gateway/client')
  const ctx = new Context()
  const providers = ctx.plugin({ apply(scope) {
    scope.provide('typert', {})
    scope.provide('connection', {
      interactions: 'answer', rpc: { open: () => { throw new Error('No transport is used in this fixture') } },
      registerGenerationSource: () => () => {}, start: () => ({ stop() {} }),
    })
  } })
  await providers.await()
  const service = ctx.plugin(gateway)
  await service.await()
  let calls = 0
  const listener = { inject: ['remote'], apply(scope) {
    scope.remote.$on('credentials/record-updated', () => { calls += 1 })
  } }
  let owner = ctx.plugin(listener)
  await owner.await()
  const deliver = async () => {
    ctx.remote.events.deliver({ event: 'credentials/record-updated', args: [] })
    await settle()
  }
  await deliver()
  assert.equal(calls, 1)
  await owner.dispose()
  await deliver()
  assert.equal(calls, 1, 'bare $on is automatically withdrawn with its caller')
  owner = ctx.plugin(listener)
  await owner.await()
  await deliver()
  assert.equal(calls, 2, 'reload registers one listener')
  await owner.dispose(); await service.dispose(); await providers.dispose()
})

test('Markdown file clicks resolve against the owning workspace and preserve absolute paths and lines', async () => {
  const f = fixture()
  await f.fiber.await(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(value => value.options.key === 'assistant-step' && value.options.priority === -100)
  const originals = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = f.dom.window
  globalThis.document = f.dom.window.document
  const root = require('react-dom/client').createRoot(f.dom.window.document.body.appendChild(f.dom.window.document.createElement('div')))
  const opens = []
  try {
    for (const [cwd, expected] of [['/isolated/workspace', '/isolated/workspace/m1-note.txt'], ['C:\\isolated\\workspace', 'C:\\isolated\\workspace\\m1-note.txt'], [undefined, 'm1-note.txt']]) {
      root.render(React.createElement(entry.component, {
        node: { location: { kind: 'root' }, data: { status: 'settled', blocks: [{ kind: 'text',
          text: '[Relative](m1-note.txt#L2) [Absolute](/outside/note.txt#L4) [Drive](C:/outside/note.txt#L6)',
        }] } },
        cwd, openFile: (path, options) => opens.push({ path, line: options?.line }),
        openExternalLink: () => { throw new Error('Local paths must not open an external link') },
        useChat: selector => selector({ legacy: { runningCalls: [] } }),
        useTurnData: () => undefined, usePresentation: selector => selector({ foldedReplies: 'all' }),
        fileMentions: () => undefined, renderSlot: () => null, renderSlotChain: () => null,
        t: key => key,
      }))
      await settle()
      const buttons = [...f.dom.window.document.querySelectorAll('button')]
      for (const label of ['Relative', 'Absolute', 'Drive']) {
        const button = buttons.find(value => value.textContent === label)
        assert.ok(button, `${label} renders as a local Markdown file action`)
        button.click()
      }
      assert.deepEqual(opens.splice(0), [
        { path: expected, line: 2 }, { path: '/outside/note.txt', line: 4 }, { path: 'C:/outside/note.txt', line: 6 },
      ])
    }
  } finally {
    root.unmount()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    await f.fiber.dispose()
  }
})
