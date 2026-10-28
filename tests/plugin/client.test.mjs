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

function load(file, document, primitives, modules = new Map()) {
  let descriptor
  const window = document.defaultView
  window.__ModuleLoader__ = { load: value => { descriptor = value } }
  // Frame and clock globals the Modern Switch motion reads; jsdom supplies the clock, frames run on the timer.
  const requestAnimationFrame = callback => setTimeout(() => callback(window.performance.now()), 16)
  vm.runInNewContext(readFileSync(file, 'utf8'), { window, document, navigator: window.navigator, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, fetch,
    performance: window.performance, requestAnimationFrame, cancelAnimationFrame: clearTimeout, structuredClone, crypto, AbortSignal, queueMicrotask })
  assert.ok(descriptor?.factory, `${file} must register a module factory`)
  return descriptor.factory(name => modules.has(name) ? modules.get(name) : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(name))
}

// A pi-ai settings schema shaped like the adapter's own (`reasoningEfforts` is `false` or a dict keyed by the
// thinking levels), serialized the way the Host's describe answer carries it, plus the schema operations the
// settings-owned service offers; the reasoning declaration reads its levels out of this envelope.
const Schema = require('@deepseek-ai/schemastery')
const PI_AI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const piAiSchema = Schema.object({ providers: Schema.dict(Schema.object({
  apiKeyEnv: Schema.string(),
  models: Schema.array(Schema.object({
    id: Schema.string().required(), name: Schema.string(),
    reasoningEfforts: Schema.union([Schema.const(false), Schema.dict(Schema.union([Schema.string(), Schema.const(null)]), Schema.union(PI_AI_LEVELS))]),
  })),
})).default({}) })
const serializedPiAi = JSON.parse(JSON.stringify(piAiSchema))
function pathValue(value, path) {
  let current = value
  for (const key of path) {
    if (Array.isArray(current)) { current = current[Number(key)]; continue }
    if (typeof current !== 'object' || current === null) return undefined
    current = current[key]
  }
  return current
}
const settingsSchema = {
  rehydrate: serialized => new Schema(serialized),
  nodeAtPath(root, path) {
    let node = root
    for (const key of path) {
      if (node === undefined) return undefined
      if (node.type === 'object') node = node.dict?.[key]
      else if (node.type === 'dict' || node.type === 'array') node = node.inner
      else return undefined
    }
    return node
  },
  getPath: pathValue,
}
const piAiUser = () => ({ providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', models: [
  { id: 'gpt-4.1' }, { id: 'gpt-5.5-new', name: 'GPT 5.5' }, { id: 'o9', reasoningEfforts: false },
] } } })

function fixture({ realTheme = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:3080/' })
  const staticModule = { exports: {} }
  vm.runInNewContext(staticPrimitivesSource, { module: staticModule, exports: staticModule.exports, require,
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, console, setTimeout, clearTimeout,
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, fetch })
  const renderer = load(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), dom.window.document)
  const modules = new Map()
  const client = load(path.join(root, 'packages/modern-ui/lib/client.js'), dom.window.document, staticModule.exports, modules)
  const themeClient = realTheme ? load(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), dom.window.document, staticModule.exports) : undefined
  const ctx = new Context()
  const dictionaries = new Map()
  const languages = new Map([['zh', { id: 'zh' }], ['en', { id: 'en' }]])
  const values = new Map()
  const remoteEvents = new Map()
  const catalogRequests = []
  const commands = new Map()
  if (realTheme) values.set('ui-theme', createSnapshotStore({ value: {
    preference: 'system', fontSize: 14, codeFontSize: 13, terminalFontSize: 13,
    textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
  } }))
  const mutations = []
  values.set('llm-pi-ai', createSnapshotStore({ status: 'ready', value: piAiUser(), user: piAiUser(), base: undefined, revision: 3, writable: true }))
  const form = name => {
    if (!values.has(name)) values.set(name, createSnapshotStore({ value: {} }))
    const store = values.get(name)
    return { getSnapshot: store.getSnapshot, subscribe: store.subscribe,
      set: async (field, value) => { store.set({ value: { ...store.getSnapshot().value, [field]: value } }); return true },
      // Path ops land on the user layer the way the Host applies them, so a card re-reads what it wrote.
      mutate: async (ops, expectedRevision) => {
        mutations.push({ namespace: name, ops: structuredClone(ops), expectedRevision })
        const current = store.getSnapshot()
        if (expectedRevision !== undefined && expectedRevision !== current.revision) return false
        const user = structuredClone(current.user ?? {})
        for (const op of ops) {
          let parent = user
          for (const key of op.path.slice(0, -1)) parent = parent[key] ??= {}
          if (op.op === 'set') parent[op.path.at(-1)] = structuredClone(op.value)
          else delete parent[op.path.at(-1)]
        }
        store.set({ ...current, user, value: user, revision: (current.revision ?? 0) + 1 })
        return true
      } }
  }
  const mirror = { getSnapshot: () => ({ status: 'ready', error: null, view: { writable: true, hasDocument: true,
    namespaces: [{ ns: 'llm-pi-ai', autoGenerate: true, applies: 'live', secrets: [], schema: serializedPiAi, value: values.get('llm-pi-ai').getSnapshot().value, user: values.get('llm-pi-ai').getSnapshot().user, revision: values.get('llm-pi-ai').getSnapshot().revision }] } }),
    subscribe: listener => values.get('llm-pi-ai').subscribe(listener), ensure: async () => {}, acceptView() {} }
  const llmRemote = { discoverModels: async (ns, request) => ({ ok: true, value: ns === 'llm-pi-ai' && request.provider === 'openai' ? [{ id: 'gpt-4.1' }, { id: 'gpt-4o' }] : [] }) }
  const connection = createSnapshotStore('connected')
  // A session scope and binding rich enough for Modern's conversation owner (and so the chat entry) to activate.
  const sessionId = 'session-1'
  let actx
  ctx.plugin({ apply(scope) { actx = scope.extend({ fixtureSessionId: sessionId }) } })
  const feed = createSnapshotStore({ revision: 0, entries: [], hasMore: false, change: { kind: 'replace' } })
  const sessionState = createSnapshotStore({ sessionId, blank: false, awaitingFirstTurn: false, running: false, removed: false, subagent: null, promptAttempted: true })
  const projections = new Map()
  const session = { sessionId, ...sessionState,
    projections: { faceOf(key) { if (!projections.has(key)) projections.set(key, createSnapshotStore(undefined)); return projections.get(key) } },
    prompt: async () => ({ ok: true, value: { accepted: true } }), updateQueue: async () => ({ ok: true, value: { accepted: true } }),
    cancel: async () => ({ ok: true, value: {} }), loadOlder: async () => {}, loadThrough: async () => {} }
  const binding = { sessionId, session, get ctx() { return actx }, eventSource: feed }
  const sessions = {
    list: createSnapshotStore({ phase: 'ready', ids: [sessionId], byId: { [sessionId]: { id: sessionId, title: 'Fixture', retainedBy: {}, running: false } } }),
    binding: id => id === sessionId ? binding : undefined, scope: id => id === sessionId ? actx : undefined,
    scopeOf: scope => scope.fixtureSessionId, sessionOf: scope => scope.fixtureSessionId === sessionId ? session : undefined,
    retainInfo: () => createSnapshotStore({ retainedBy: {} }), subagentAddress: () => undefined,
    refreshProjections: async () => {}, fork: async () => sessionId,
  }
  const developerTools = createSnapshotStore(true)
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
      subscribe: () => () => {},
    })
    const theme = realTheme ? new themeClient.ThemeRuntime(scope, form('ui-theme')) : { getTheme: () => ({ active: { colorScheme: 'light' } }), overrideTokens: () => () => {} }
    if (realTheme) theme.overrideTokens('earlier-theme', { '--page': { light: 'prior-light', dark: 'prior-dark' } })
    scope.provide('theme', theme)
    scope.provide('sessions', sessions)
    scope.provide('uiWorkspace', { openSession: () => {}, openWorkspace: () => {}, startSession: () => {} })
    scope.provide('sidebarRight', { openResource: () => {}, openTab: () => {} })
    scope.provide('configForms', { get: form, developerTools: { enabled: developerTools }, describe: () => mirror })
    scope.provide('settingsSchema', settingsSchema)
    scope.provide('remote.llm', llmRemote)
    scope.provide('connection', { state: connection })
    scope.provide('fileUpload', { upload: async () => { throw Error('No file upload requested by this fixture') } })
    scope.provide('remoteAccess', { source: () => createSnapshotStore(true) })
    scope.provide('pluginNavigation', { openList() {} })
    scope.provide('commandUi', { register: command => { commands.set(command.name, command); return () => commands.delete(command.name) } })
    const sessionRemote = { modelCatalog: async () => { catalogRequests.push(true); return { ok: true, value: { groups: [], failures: [] } } } }
    scope.provide('remote', { $host: { home: '/fixture-home', isLoopback: true }, commands: { execute: async () => ({ ok: false, error: { code: 'missing', message: 'unavailable' } }) }, session: sessionRemote, llm: llmRemote, $on: (event, listener) => {
      if (!remoteEvents.has(event)) remoteEvents.set(event, new Set())
      remoteEvents.get(event).add(listener)
      return () => remoteEvents.get(event).delete(listener)
    } })
    scope.provide('remote.commands', { execute: async () => ({ ok: false, error: { code: 'missing', message: 'unavailable' } }) })
    scope.provide('remote.session', sessionRemote)
  } })
  ctx.plugin(renderer.SlotRegistry)
  // The official session UI client supplies uiSession, which Modern's conversation owner and chat entry inject.
  ctx.plugin(load(require.resolve('@deepseek-ai/dsh-client-ui-session/client'), dom.window.document, staticModule.exports))
  ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.register({ name: 'root', children: {
      'conversation.input.model': { kind: 'single', scope: 'session' },
      'settings.models.footer': { kind: 'list', scope: 'root' },
      'conversation.view': { kind: 'list', scope: 'session' },
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
      'settings.general.item': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'conversation.approval.detail': { kind: 'single', scope: 'session' },
      'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'plugins.detail.section': { kind: 'list', scope: 'root' },
      'plugins.tab': { kind: 'list', scope: 'root' },
    } }, () => null)
    // The official document owner declares the keyed document-body seat from its own pane.tab entry; the official
    // Markdown body and plan preview sit under their keys at the default priority, for Modern to shade.
    scope.slots.register({ name: 'sidebar.right.pane.tab', key: 'official-text-preview', children: { 'sidebar.right.tab.document': { kind: 'keyed', scope: 'session' } } }, () => null)
    scope.slots.register({ name: 'sidebar.right.tab.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown' }, () => null)
    scope.slots.register({ name: 'sidebar.right.pane.tab', key: '@deepseek-ai/dsh-client-ui-plan' }, () => null)
  } })
  const fiber = ctx.plugin(client)
  return { dom, ctx, fiber, client, modules, dictionaries, providers, remoteEvents, catalogRequests, commands, connection, sessionId, session, binding, feed, mutations, piAiForm: () => values.get('llm-pi-ai'), primitives: staticModule.exports }
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
  // A second owner of the sprite (a second full plugin instance would re-provide the conversation services).
  const second = f.ctx.plugin({ apply: scope => { f.client.installIconSprite(scope) } })
  await second.await()
  assert.equal(document.querySelectorAll('#modern-ui-icon-sprite').length, 1, 'one sprite per document')
  await second.dispose()
  assert.ok(document.getElementById('modern-ui-icon-sprite'), 'the first owner still needs it')
  await f.fiber.dispose()
  assert.equal(document.getElementById('modern-ui-icon-sprite'), null)
})

test('the Modern chat flow renders the patched running status, keeps the matrix outside the thinking phase and pauses while disconnected', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await(); await settle()
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.composer.dock').find(candidate => candidate.options.id === 'modern-running-status'), undefined, 'no portal host remains: the flow is Modern\'s own')
  const flow = f.ctx.slots.entriesOfSlot('conversation.chat.flow')[0]
  assert.ok(flow, 'Modern owns the chat flow once the official ui-chat entry is disabled')
  assert.equal(f.ctx.slots.spec('conversation.chat.node').kind, 'keyed', 'the flow declares the node seat')
  const snapshot = (partial, runningCalls = []) => ({ legacy: { partial, runningCalls }, nodes: { get: () => undefined }, navigation: { items: () => [{ anchorKey: 'turn-1' }] } })
  const nodes = { 'turn-1': { location: { kind: 'turn', turn: { status: 'open', start: { time: Date.now() - 65_000 } } } } }
  let chat = snapshot({ blocks: [{ kind: 'text', text: 'Answer' }] })
  let connection = 'connected'
  const render = () => renderToStaticMarkup(React.createElement(flow.component, {
    entries: [], pendingInputs: [], lastInputTurn: undefined, deferCollapse: false,
    useSession: selector => selector({ running: true }), useChat: selector => selector(chat),
    useChatNode: (key, selector) => selector(nodes[key]), useChatNodeBottom: (_key, selector) => selector(undefined),
    useChatNodeProcess: (_key, selector) => selector(undefined), useChatGroup: (_key, selector) => selector(undefined),
    usePresentation: selector => selector({ mode: 'standard', collapseTiming: 'completion', foldedReplies: 'all' }),
    useConnectionState: selector => selector(connection),
    useStore: selector => selector({}), actions: {}, renderSlot: () => null, renderFactorySlot: () => null, t: key => key,
    useGroupAction: () => false, useGroupHeaderAction: () => {},
    cwd: undefined, openFile: () => {}, inspectCall: () => {}, forkAt: () => {}, loadImage: () => undefined, fileMentions: () => undefined,
  }))
  let markup = render()
  assert.match(markup, /data-modern-running="responding"/)
  assert.match(markup, /chat\.activity\.responding/)
  assert.match(markup, /t-matrix/)
  assert.match(markup, /data-loading-elapsed/)
  assert.doesNotMatch(markup, /data-modern-paused/)
  chat = snapshot({ blocks: [{ kind: 'reasoning', text: 'Detailed: ...' }] })
  markup = render()
  assert.match(markup, /data-modern-running="thinking"/)
  assert.doesNotMatch(markup, /data-loading-label/, 'while reasoning streams the patched group header carries the matrix and label; the row keeps the clock')
  assert.match(markup, /data-loading-elapsed/)
  chat = snapshot({ blocks: [] }, [{ id: 'call' }])
  markup = render()
  assert.match(markup, /data-modern-running="tools"/)
  assert.match(markup, /t-matrix/)
  connection = 'disconnected'
  markup = render()
  assert.match(markup, /data-modern-paused/, 'the clock freezes while the Client cannot observe the Session')
  await f.fiber.dispose()
})

test('the official 1017 plugin owns its standard label contribution across enable and disable', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await()
  assert.equal(f.ctx.slots.spec('modern.conversation.input.model.label'), undefined)
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.input.model.label').length, 0, 'Modern must not manufacture a badge while the official contribution is disabled')
  const badgeModule = load(require.resolve('@deepseek-ai/dsh-client-ui-deepseek-model-label-1017/client'), f.dom.window.document, f.primitives)
  let badge = f.ctx.plugin(badgeModule)
  await badge.await()
  const entry = f.ctx.slots.entriesOfSlot('conversation.input.model.label')[0]
  assert.ok(entry, 'the official contribution reaches the selector-owned standard child')
  const flash = { provider: { id: 'deepseek-official', name: 'DeepSeek' }, model: { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }, placement: 'trigger', selected: true, t: f.ctx.locale.bind('deepseek-model-label-1017') }
  const markup = renderToStaticMarkup(React.createElement(entry.component, flash))
  assert.match(markup, />1017</)
  assert.match(markup, /data-tone="info"/, 'the original plugin still owns its markup; Modern styles its official route locally')
  const styles = [...f.dom.window.document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]')].map(style => style.textContent).join('\n')
  assert.match(styles, /data-tone(?:=|\[?[^}]*=)["']?info["']?[^}]*\{[^}]*background:(?:transparent|0 0)/, 'the adapter keeps the patched quiet badge background')
  assert.match(markup, /DeepSeek-V4\.1-Flash/)
  const other = renderToStaticMarkup(React.createElement(entry.component, { ...flash, model: { id: 'deepseek-pro', name: 'DeepSeek-V4.1-Pro' } }))
  assert.equal(other, 'DeepSeek-V4.1-Pro', 'every other entry keeps its catalog name')
  const account = renderToStaticMarkup(React.createElement(entry.component, { ...flash, provider: { id: 'other-vendor', name: 'Other' } }))
  assert.equal(account, 'DeepSeek-V4.1-Flash')
  await badge.dispose()
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.input.model.label').length, 0)
  badge = f.ctx.plugin(badgeModule); await badge.await()
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.input.model.label').length, 1)
  await badge.dispose()
  await f.fiber.dispose()
})

test('official shell and official surfaces receive the patched global rules', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await()
  const styles = [...f.dom.window.document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]')].map(style => style.textContent).join('\n')
  assert.match(styles, /html,body\{overscroll-behavior-y:none\}/, 'phones neither rubber-band the whole page nor pull to refresh (PR #4)')
  assert.match(styles, /body\{[^}]*--dsw-alias-bg-l1:var\(--dsw-alias-bg-layer-1\)[^}]*--dsw-alias-bg-l2:var\(--dsw-alias-bg-layer-2\)/, 'the official terminal aliases resolve on body, where the layer tokens live')
  await f.fiber.dispose()
})

test('folded replies live in the plugin settings namespace, drive the presentation policy and sit on the patched transcript-view row', async () => {
  const f = fixture()
  await f.providers.await()
  await f.fiber.await(); await settle()
  const rows = f.ctx.slots.entriesOfSlot('settings.general.item')
  const row = rows.find(candidate => candidate.options.id === 'transcript-view')
  assert.ok(row, 'Modern registers the patched transcript-view row in place of the official one')
  assert.equal(row.options.order, 12)
  assert.ok(rows.find(candidate => candidate.options.id === 'performance-usage'), 'and the performance-usage row')
  assert.equal(rows.find(candidate => candidate.options.id === 'modern-folded-replies'), undefined, 'the interim folded-reply row is gone')
  const assistant = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(candidate => candidate.options.key === 'assistant-step')
  const policy = () => assistant.inject('session-1').hooks.presentation.getSnapshot()
  assert.equal(policy().foldedReplies, 'all')
  const face = row.inject()
  assert.equal(face.hooks.foldedReplies.getSnapshot(), 'all')
  face.setFoldedReplies('final')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(face.hooks.foldedReplies.getSnapshot(), 'final')
  assert.equal(policy().foldedReplies, 'final', 'the modern-ui form value reaches the chat presentation policy')
  assert.equal(f.ctx.configForms.get('modern-ui').getSnapshot().value.foldedReplies, 'final', 'persisted in the plugin namespace, not in ui-chat')
  face.setTranscriptView('standard')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(policy().mode, 'standard')
  const markup = renderToStaticMarkup(React.createElement(row.component, { ...face,
    useTranscriptView: selector => selector(face.hooks.transcriptView.getSnapshot()),
    useCollapseTiming: selector => selector(face.hooks.collapseTiming.getSnapshot()),
    useFoldedReplies: selector => selector(face.hooks.foldedReplies.getSnapshot()), t: key => key }))
  assert.match(markup, /settings\.transcript\.title/)
  assert.match(markup, /settings\.collapse\.title/)
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
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 1)
  successful = true
  f.ctx.emit('connection/reset')
  f.ctx.emit('connection/reset')
  await settle(); await settle(); await settle()
  assert.equal(maximum, 1)
  assert.ok(calls >= 2 && calls <= 3)
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.ok(f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').some(entry => entry.options.priority === -100))
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
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.ok(f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').some(entry => entry.options.priority === -100))
  await remote.dispose()
  await again.dispose()
})

test('translation mounts again after its Remote disappears and returns', async () => {
  const f = fixture()
  await f.fiber.await()
  let remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 2)
  await remote.dispose()
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 1)
  remote = translationRemote(f, async () => translationSnapshot())
  await remote.await(); await settle()
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 2)
  assert.ok(f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').some(entry => entry.options.priority === -100))
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
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').length, 1)
  const remote = f.ctx.plugin({ inject: ['remote'], apply(scope) {
    const cotTranslation = { limits: async () => ({ ok: true, value: {
      maxTextChars: 1000, preferences: { provider: 'bing', targetLanguage: 'en' }, availableProviders: ['bing'],
    } }), translate: async request => ({ ok: true, value: `Translated ${request.text}` }) }
    scope.remote.cotTranslation = cotTranslation
    scope.provide('remote.cotTranslation', cotTranslation)
  } })
  await remote.await()
  await new Promise(resolve => setTimeout(resolve, 30))
  const entries = f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body')
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 2)
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
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').length, 1)
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
  assert.equal(f.ctx.slots.snapshot('conversation.chat.reasoning.body')[0].occupants.length, 1)
  await f.fiber.dispose()
})

test('Modern owns the chat slots under their standard names once the official ui-chat entry is disabled', async () => {
  const f = fixture()
  await new Promise(resolve => setTimeout(resolve, 30))
  await f.fiber.await()
  const node = f.ctx.slots.snapshot('conversation.chat.node')[0]
  const assistantEntries = node.occupants.filter(entry => entry.key === 'assistant-step')
  assert.equal(assistantEntries.length, 1, 'the official assistant view is gone with its package; Modern\'s is the only one')
  assert.equal(assistantEntries.filter(entry => entry.active).length, 1)
  assert.equal(f.ctx.slots.spec('conversation.chat.message.images').kind, 'single', 'standard child names: third-party registrations reach Modern\'s assistant view')
  assert.equal(f.ctx.slots.spec('conversation.chat.turnTail').kind, 'list')
  assert.equal(f.ctx.slots.spec('conversation.chat.assistant-actions').kind, 'list')
  assert.equal(f.ctx.slots.spec('conversation.chat.reasoning.body').kind, 'single')
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.view').find(entry => entry.options.id === 'chat')?.options.order, 0)
  for (const key of ['user', 'steering', 'context', 'turn-trigger', 'system-prompt', 'command', 'manual-compaction', 'compaction', 'model-retry', 'turn-error', 'turn-max-tokens', 'turn-process', 'turn-tail', 'unknown']) {
    assert.ok(node.occupants.some(entry => entry.key === key), `node view ${key}`)
  }
  assert.ok(f.ctx.slots.entriesOfSlot('shell.overlay').find(entry => entry.options.id === 'chat.quota-notice'), 'quota notice overlay')
  assert.equal(f.ctx.slots.entriesOfSlot('conversation.composer.dock').filter(entry => ['activity', 'usage'].includes(entry.options.id)).length, 2, 'stats pills')
  assert.equal(f.ctx.slots.spec('conversation.chat.message.code').kind, 'chain')
  const chain = f.ctx.slots.entriesOfSlot('conversation.chat.message.code')
  assert.equal(chain.length, 3)
  assert.equal(f.ctx.slots.snapshot('conversation.input.model')[0].occupants.length, 1, 'the bundle selects one explicit model owner')
  assert.equal(f.ctx.modelDirectories.directoryFor(f.sessionId), f.ctx.modelDirectories.directoryFor(f.sessionId), 'one directory per official Session binding without the disabled browser descriptor')
  assert.ok(f.commands.has('model'), 'the original /model entry is retained by the new owner')
  assert.equal(typeof f.ctx.fileDrag.read, 'function', 'Modern supplies its real original-image transfer service')
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
  const chain = f.ctx.slots.entriesOfSlot('conversation.chat.message.code')
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

test('real Session tool events reach the complete Tool owner with Host facts and result details intact', async () => {
  const f = fixture()
  await f.fiber.await(); await settle()
  const target = f.ctx.uiConversation.binding(f.binding).target('chat')
  const unsubscribe = target.subscribe(() => {})
  const entries = [
    { type: 'event', event: { seq: 1, time: 1000, type: 'tool/call', data: {
      turn: 1, step: 1, callId: 'read-call', name: 'read', arguments: JSON.stringify({ file_path: '~/notes.txt' }),
    } } },
    { type: 'event', event: { seq: 2, time: 1010, type: 'tool/result', surfaceOp: 'append', data: {
      turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'read-call' },
        content: [{ type: 'text', text: 'retained file body' }] }, meta: {},
    } } },
  ]
  f.feed.set({ revision: 1, entries, hasMore: false, change: { kind: 'append', entries } })
  await settle(); await settle()
  const node = target.getSnapshot().nodes.values().find(value => value.kind === 'tool-call')
  assert.ok(node, 'the registered Chat event definitions assemble the real call/result pair')
  assert.equal(node.data.root.call.name, 'read')
  assert.equal(node.data.root.content[0].text, 'retained file body')
  const tree = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'tool-call')
  assert.ok(tree)
  assert.equal(tree.children['tool.call.toolview'].kind, 'keyed')
  const face = tree.inject()
  assert.deepEqual(face.hooks.hostInfo.getSnapshot(), { home: '/fixture-home', isLoopback: true })
  const rows = f.ctx.slots.entriesOfSlot('tool.call.toolview')
  for (const key of ['read', 'read_image', 'bash', 'web_search', 'todo_write', 'ask_user_question']) {
    assert.ok(rows.some(entry => entry.options.key === key), key)
  }
  const markup = renderToStaticMarkup(React.createElement(tree.component, {
    node, cwd: '/workspace', sessionId: f.sessionId, t: key => key,
    useHostInfo: selector => selector(face.hooks.hostInfo.getSnapshot()),
    useDisclosure: () => ({ expanded: true, toggle() {} }), openFile() {},
    renderSlot(key, owner, options) {
      assert.equal(key, 'tool.call.toolview')
      const entry = rows.find(value => value.options.key === options.entryKey)
      assert.ok(entry)
      return React.createElement(entry.component, { ...owner, sessionId: f.sessionId, t: key => key,
        useSessions: selector => selector(f.ctx.sessions.list.getSnapshot()),
      })
    },
  }))
  assert.match(markup, /data-tool="read"/)
  assert.match(markup, /retained file body/)
  assert.match(markup, /notes\.txt/)
  unsubscribe()
  await f.fiber.dispose()
  assert.equal(f.ctx.slots.entries('tool.call.toolview').length, 0)
})

test('artifact does not embed React, Cordis, session services, or host source', () => {
  const metadata = JSON.parse(readFileSync(path.join(root, 'packages/modern-ui/lib/build-inputs.json'), 'utf8'))
  assert.equal(metadata.host, '0.2.1-rc.4')
  assert.ok(!metadata.inputs.some(file => /node_modules\/(react|react-dom|@deepseek-ai\/cordis)\//.test(file)))
  // Client adapters are packaged with their owner; Host/Remote implementations remain external.
  for (const part of ['service', 'directory']) assert.ok(metadata.inputs.some(file => file.endsWith(`/vendor/model/client/${part}.ts`)))
  assert.ok(!metadata.inputs.some(file => /node_modules\/@deepseek-ai\/dsh-api-(session-controller|remotes)\//.test(file)))
  assert.ok(metadata.inputs.some(file => /vendor\/chat\/client\/apply\.ts$/.test(file)))
  const packageJson = JSON.parse(readFileSync(path.join(root, 'packages/modern-ui/package.json'), 'utf8'))
  assert.ok(!packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-model-selection'), 'the disabled official owner is not a boot-graph dependency')
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
    assert.equal(f.remoteEvents.get(event)?.size, 2, 'the official selection directory and the settings catalog both observe credentials')
    for (const listener of f.remoteEvents.get(event)) listener()
    await settle()
    assert.equal(f.catalogRequests.length, before + 2, 'both public consumers reload their catalog after the credential changes')
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
  const entry = f.ctx.slots.entriesOfSlot('conversation.chat.reasoning.body').find(value => value.options.priority === -100)
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
  const entry = f.ctx.slots.entriesOfSlot('conversation.chat.node').find(value => value.options.key === 'assistant-step')
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

/** Mount a slot component in the fixture's jsdom and settle React; restores the globals afterwards. */
async function mounted(f, element, body) {
  const originals = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = f.dom.window
  globalThis.document = f.dom.window.document
  const host = f.dom.window.document.body.appendChild(f.dom.window.document.createElement('div'))
  const root = require('react-dom/client').createRoot(host)
  try {
    root.render(element)
    await settle(); await settle()
    await body(host)
  } finally {
    root.unmount()
    host.remove()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}
const fence = (lang, lines) => `\`\`\`${lang}\n${Array.from({ length: lines }, (_line, index) => `const line${index} = ${index}`).join('\n')}\n\`\`\`\n`

test('Modern shades the official Markdown file preview and plan preview bodies under their keys and folds their code fences', async () => {
  const f = fixture(); await f.fiber.await(); await settle()
  const markdownKey = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'
  const planKey = '@deepseek-ai/dsh-client-ui-plan'
  const body = f.ctx.slots.entriesOfSlot('sidebar.right.tab.document').find(entry => entry.options.key === markdownKey)
  assert.equal(body?.options.priority, -100, 'the Modern Markdown body wins the keyed cell')
  assert.equal(f.ctx.slots.entries('sidebar.right.tab.document').filter(entry => entry.options.key === markdownKey).length, 2, 'the official body stays registered, only shaded')
  const plan = f.ctx.slots.entriesOfSlot('sidebar.right.pane.tab').find(entry => entry.options.key === planKey)
  assert.equal(plan?.options.priority, -100, 'the Modern plan preview wins the keyed cell')
  assert.equal(f.ctx.slots.entries('sidebar.right.pane.tab').filter(entry => entry.options.key === planKey).length, 2)
  assert.equal(f.ctx.slots.entriesOfSlot('sidebar.right.pane.tab').find(entry => entry.options.key === 'official-text-preview')?.options.priority, undefined, 'other keyed cells keep their official entries')
  for (const language of ['zh', 'en', 'ja', 'pt']) {
    assert.ok(f.dictionaries.get('modern-document-markdown')[language]['codeBlock.collapse'])
    assert.ok(f.dictionaries.get('modern-plan')[language]['codeBlock.expand'])
  }
  const documentProps = {
    content: { kind: 'text', text: `---\ntitle: Probe guide\n---\n\n# Guide\n\n${fence('typescript', 40)}`, pages: [], eof: true },
    resourceAddress: 'dsh-resource://file/session/session-1/guide.md', wrap: false, scrollportRef() {}, addResource() {}, setResources() {},
    useResource: () => ({ status: 'ready', value: { absolutePath: '/workspace/guide.md' } }), useTabInfo: () => ({}), t: key => `md:${key}`,
  }
  await mounted(f, React.createElement(body.component, documentProps), async host => {
    assert.ok(host.querySelector('[data-document-markdown]'))
    assert.match(host.querySelector('[data-document-frontmatter]').textContent, /title/)
    assert.match(host.querySelector('[data-document-frontmatter]').textContent, /Probe guide/)
    const block = host.querySelector('.md-code-block')
    assert.ok(block, 'the fence renders through the Modern CodeBlock')
    assert.equal(block.hasAttribute('data-code-collapsed'), false)
    const collapse = host.querySelector('button[aria-label="md:codeBlock.collapse"]')
    assert.ok(collapse, 'the file preview exposes the collapse control')
    collapse.click(); await settle()
    assert.equal(block.getAttribute('data-code-collapsed'), 'true')
    assert.equal(block.querySelector('[data-code-block-content]').hidden, true)
    const expand = host.querySelector('button[aria-label="md:codeBlock.expand"]')
    assert.ok(expand)
    expand.click(); await settle()
    assert.equal(block.hasAttribute('data-code-collapsed'), false)
    assert.equal(block.querySelector('[data-code-block-content]').hidden, false)
  })
  const tab = { tab: { title: 'Plan', navigation: { address: 'dsh-resource://plan/session-1/call-1', params: undefined } } }
  const planProps = {
    useTabInfo: () => tab, t: key => `plan:${key}`,
    useResource: () => ({ status: 'ready', value: { callId: 'call-1', title: 'Release plan', markdown: `# Release plan\n\n${fence('js', 30)}` } }),
  }
  await mounted(f, React.createElement(plan.component, planProps), async host => {
    const section = host.querySelector('[data-plan-preview="call-1"]')
    assert.ok(section)
    assert.equal(section.getAttribute('aria-label'), 'Release plan')
    const collapse = host.querySelector('button[aria-label="plan:codeBlock.collapse"]')
    assert.ok(collapse, 'the plan preview exposes the collapse control')
    collapse.click(); await settle()
    assert.equal(host.querySelector('.md-code-block').getAttribute('data-code-collapsed'), 'true')
    assert.ok(host.querySelector('button[aria-label="plan:codeBlock.expand"]'))
  })
  await mounted(f, React.createElement(plan.component, { ...planProps, useResource: () => ({ status: 'failed', value: undefined, failure: { code: 'plan/not-found', message: 'gone' } }) }), async host => {
    assert.match(host.textContent, /plan:preview\.failed/)
    assert.match(host.textContent, /plan:preview\.notFound/)
  })
  await f.fiber.dispose()
  assert.equal(f.ctx.slots.entries('sidebar.right.tab.document').filter(entry => entry.options.key === markdownKey).length, 1, 'the official body is back alone once Modern leaves')
})

test('pi-ai provider cards draft complete reasoning declarations and save with schema levels and a revision fence', async () => {
  const f = fixture(); await f.fiber.await(); await settle(); await settle()
  const entry = f.ctx.slots.entriesOfSlot('settings.models.provider-card').find(candidate => candidate.options.key === 'llm-pi-ai')
  assert.ok(entry, 'the block registers under the pi-ai settings namespace')
  assert.equal(entry.options.priority, -100)
  assert.ok(f.dictionaries.get('modern-reasoning').ja.title)
  const face = entry.inject()
  const bind = source => selector => React.useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  const t = key => key
  const provider = (extra = {}) => ({ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], ...extra })
  function Harness({ owner }) {
    return React.createElement(entry.component, {
      provider: owner, configured: true, keyConfigured: false, t,
      useForm: bind(face.hooks.form), useMirror: bind(face.hooks.mirror), useDeclaration: bind(face.hooks.declaration),
      levels: face.levels, loadCatalog: face.loadCatalog, saveModel: face.saveModel,
    })
  }
  assert.deepEqual([...face.levels(serializedPiAi)], PI_AI_LEVELS, 'levels come out of the namespace schema in escalation order')
  assert.deepEqual([...face.levels({ type: 'object' })], [], 'a schema without the field offers nothing')
  await mounted(f, React.createElement(Harness, { owner: provider() }), async host => {
    await settle(); await settle()
    const rows = () => [...host.querySelectorAll('[data-model-id]')].map(row => [row.dataset.modelId, row.dataset.reasoning])
    assert.deepEqual(rows(), [['gpt-5.5-new', 'off'], ['o9', 'off']], 'catalog-described gpt-4.1 stays with the official editor; the newer id and explicit false row are offered')
    const row = () => host.querySelector('[data-model-id="gpt-5.5-new"]')
    assert.match(row().textContent, /GPT 5\.5/)
    const switchFor = () => row().querySelector('button[role="switch"]')
    const button = text => [...row().querySelectorAll('button')].find(value => value.textContent === text)
    const press = async element => { assert.ok(element); element.click(); await settle(); await settle() }
    const save = () => press(button('apply'))
    const remove = level => press(row().querySelector('button[aria-label="modelReasoningRemove ' + level + '"]'))
    const change = async (element, value) => {
      assert.ok(element)
      require('react-dom/test-utils').Simulate.change(element, { target: { value } })
      await settle(); await settle()
    }
    const written = () => f.mutations.at(-1).ops[0].value
    assert.equal(switchFor().getAttribute('aria-label'), 'modelReasoning 2')
    await press(switchFor())
    assert.equal(f.mutations.length, 0, 'switching and typing edit a local draft until Apply')
    assert.equal(switchFor().getAttribute('aria-checked'), 'true')
    await save()
    assert.equal(f.mutations.length, 1)
    assert.deepEqual(f.mutations[0].ops[0].path, ['providers', 'openai', 'models'])
    assert.equal(f.mutations[0].expectedRevision, 3)
    assert.deepEqual(written().map(model => model.id), ['gpt-4.1', 'gpt-5.5-new', 'o9'])
    assert.deepEqual(written()[1].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high' })
    assert.deepEqual(written()[2], { id: 'o9', reasoningEfforts: false })
    await press(button('modelReasoningAdd'))
    const lastLevel = row().querySelector('select[aria-label="modelReasoningLevel 5"]')
    assert.equal(lastLevel.value, 'xhigh')
    assert.deepEqual([...lastLevel.options].map(option => option.value), ['minimal', 'xhigh', 'max'], 'the schema supplies every unused level')
    await change(lastLevel, 'max')
    await change(row().querySelector('input[aria-label="max modelReasoningValue"]'), 'ultra')
    assert.equal(f.mutations.length, 1, 'API wire-value changes stay local until accepted')
    await save()
    assert.deepEqual(written()[1].reasoningEfforts, { off: null, low: 'low', medium: 'medium', high: 'high', max: 'ultra' })
    await remove('off')
    await save()
    assert.deepEqual(written()[1].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', max: 'ultra' }, 'Off can be removed without losing the custom max wire value')
    await press(button('modelReasoningAdd'))
    assert.ok(row().querySelector('input[aria-label="off modelReasoningValue"]'), 'Off can be restored')
    await press(button('cancel'))
    assert.equal(row().querySelector('input[aria-label="off modelReasoningValue"]'), null)
    await press(switchFor()); await save()
    assert.deepEqual(written()[1], { id: 'gpt-5.5-new', name: 'GPT 5.5', reasoningEfforts: false })
    await press(switchFor())
    await remove('low'); await remove('medium'); await remove('high')
    assert.equal(button('apply').disabled, true, 'the complete draft cannot save a declaration containing only Off')
    assert.match(row().textContent, /modelReasoningNeedsLevel/)
    await press(button('cancel'))
    const writesBeforeConflict = f.mutations.length
    await press(switchFor())
    const current = f.piAiForm().getSnapshot()
    f.piAiForm().set({ ...current, revision: current.revision + 1 })
    await settle()
    await save()
    assert.equal(f.mutations.length, writesBeforeConflict, 'a pushed settings revision refuses the stale draft before writing')
    assert.match(host.querySelector('[role="alert"]').textContent, /writeRefused/)
    await press(button('cancel'))
    assert.equal(host.querySelector('[data-model-id="gpt-4.1"]'), null)
  })
  await mounted(f, React.createElement(Harness, { owner: provider({ declared: true }) }), async host => {
    await settle()
    assert.equal(host.querySelector('[data-modern-reasoning-declaration]'), null, 'hand-declared routes retain the official per-row control')
  })
  await mounted(f, React.createElement(Harness, { owner: provider({ provider: 'anthropic', settingsPath: ['providers', 'anthropic'] }) }), async host => {
    await settle(); await settle()
    assert.equal(host.querySelector('[data-modern-reasoning-declaration]'), null)
  })
  await f.fiber.dispose()
  assert.equal(f.ctx.slots.entries('settings.models.provider-card').length, 0)
})
