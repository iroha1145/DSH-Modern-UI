import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild')
const { JSDOM } = require('jsdom')
const React = require('react')
const { Context } = require('@deepseek-ai/cordis')
const scratch = path.join(root, '.artifacts/tool-ui')
mkdirSync(scratch, { recursive: true })
const built = await build({
  absWorkingDir: root, stdin: { contents: `export * from './packages/modern-ui/src/layout-owner.ts'; export * from './packages/modern-ui/src/vendor/layout/columns.ts'; export * from './packages/modern-ui/src/vendor/layout/stores.ts'; export * from './packages/modern-ui/src/vendor/layout/AppFrame.tsx';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
  plugins: [{ name: 'css-behavior-fixture', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: `module.exports = new Proxy({}, {get: (_, key) => String(key)});`, loader: 'js' })) } }],
})
writeFileSync(path.join(scratch, 'layout-fixture.cjs'), built.outputFiles[0].text)
const client = require(path.join(scratch, 'layout-fixture.cjs'))
function globals(dom) {
  const names = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(names.map(key => [key, globalThis[key]]))
  const observers = new Set(), frames = new Map()
  let nextFrame = 0
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; observers.add(this) } observe() {} disconnect() { observers.delete(this) } }
  globalThis.requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  return { observers, frames, restore: () => Object.assign(globalThis, previous) }
}
const snapshot = (scheme = 'light') => ({ preference: 'system', active: { colorScheme: scheme, tokens: { '--layout-test-token': scheme } }, fontSizes: { text: 14, code: 13, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' } })
async function fixture(nested = false) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  const environment = globals(dom)
  let registration
  dom.window.__ModuleLoader__ = { load: value => { registration = value } }
  vm.runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), { window: dom.window, document: dom.window.document, console })
  const renderer = registration.factory(require)
  const ctx = new Context(), shortcuts = new Set(), locales = new Set()
  await ctx.plugin({ apply(scope) {
    scope.provide('theme', { getTheme: () => snapshot() })
    scope.provide('locale', { register: name => { locales.add(name); return () => locales.delete(name) }, bind: () => key => key })
    scope.provide('shortcuts', { register: value => { shortcuts.add(value); return () => shortcuts.delete(value) } })
  } }).await()
  await ctx.plugin(renderer.SlotRegistry).await()
  const official = ctx.plugin({ inject: ['slots'], apply(scope) {
    scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: 'conversation' }, () => null))
    scope.slots.inject('sidebar', () => scope.slots.register({ name: 'sidebar' }, () => null))
    scope.slots.inject('rightbar', () => scope.slots.register({ name: 'rightbar' }, () => null))
  } })
  const community = ctx.plugin({ inject: ['slots', 'layout'], apply(scope) {
    scope.slots.inject('shell.overlay', () => scope.slots.register({ name: 'shell.overlay', id: 'community-toast' }, () => null))
    scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: 'community-panel' }, () => null))
  } })
  const owner = nested
    ? ctx.plugin({ name: 'modern-client-bootstrap-fixture', inject: ['slots', 'theme', 'locale'], apply(scope) { scope.plugin(client.layoutOwner) } })
    : ctx.plugin(client.layoutOwner)
  await owner.await(); await official.await(); await community.await()
  const settle = () => new Promise(resolve => setTimeout(resolve, 25))
  await settle()
  const entry = ctx.slots.entriesOfSlot('root')[0]
  return { ctx, dom, owner, entry, environment, shortcuts, locales, settle, async dispose() { await ctx.fiber.dispose(); environment.restore() } }
}

test('layout service activates from a nested base-service bootstrap plugin', async () => {
  const f = await fixture(true)
  try {
    assert.ok(f.ctx.layout)
    assert.ok(f.ctx.modernLayout)
    assert.equal(f.ctx.slots.entriesOfSlot('root').length, 1)
    assert.equal(f.ctx.slots.entriesOfSlot('main').length, 2)
  } finally { await f.dispose() }
})

test('one Modern layout owns original children and public service; official and community contributions survive reinstall', async () => {
  const f = await fixture()
  try {
    assert.equal(f.ctx.slots.entriesOfSlot('root').length, 1)
    assert.deepEqual(Object.keys(f.entry.children).sort(), ['sidebar','main','rightbar','shell.bottom','shell.overlay','shell.leading'].sort())
    assert.equal(f.ctx.slots.entriesOfSlot('main').length, 2)
    assert.equal(f.ctx.slots.entriesOfSlot('shell.overlay').length, 1)
    assert.equal(f.shortcuts.size, 1)
    const layout = f.ctx.layout
    layout.selectPanel('community-panel')
    assert.equal(layout.panelInfo.getSnapshot().activePanelId, 'community-panel')
    assert.throws(() => layout.selectPanel('missing'), /not registered/)
    assert.equal(layout.panelInfo.getSnapshot().activePanelId, 'community-panel')
    const navigation = layout.beginNavigation()
    await f.owner.dispose(); await f.settle()
    assert.equal(navigation.aborted, true); assert.equal(f.ctx.get('layout'), undefined)
    assert.equal(f.shortcuts.size, 0); assert.equal(f.locales.size, 0)
    assert.equal(f.dom.window.document.querySelectorAll('meta[name="theme-color"]').length, 0)
    const again = f.ctx.plugin(client.layoutOwner); await again.await(); await f.settle()
    assert.notEqual(f.ctx.layout, layout)
    assert.equal(f.ctx.slots.entriesOfSlot('main').length, 2)
    assert.equal(f.ctx.slots.entriesOfSlot('shell.overlay').length, 1)
    assert.equal(f.ctx.slots.entriesOfSlot('root').length, 1)
    await again.dispose()
  } finally { await f.dispose() }
})

test('old column limits and transient width preferences survive responsive concessions and rightbar close', async () => {
  const f = await fixture()
  try {
    const store = f.entry.store.create(), actions = store.actions
    assert.equal(store.getSnapshot().layoutInfo.sidebar, 264)
    actions.setSidebar(1); assert.equal(store.getSnapshot().layoutInfo.sidebar, 228)
    actions.setSidebar(999); assert.equal(store.getSnapshot().layoutInfo.sidebar, 360)
    actions.setSidebar(312)
    actions.setViewportWidth(390); actions.toggleSidebar()
    assert.equal(store.getSnapshot().layoutInfo.narrowExpanded, true)
    actions.setViewportWidth(1400)
    assert.equal(store.getSnapshot().layoutInfo.narrowExpanded, false)
    assert.equal(store.getSnapshot().layoutInfo.sidebar, 312)
    f.ctx.layout.openRightbar(true, false); actions.setRightbar(510); f.ctx.layout.closeRightbar()
    assert.equal(store.getSnapshot().layoutInfo.rightbar, 510)
    f.ctx.layout.openRightbar(true, false); assert.equal(store.getSnapshot().layoutInfo.rightbar, 510)
    f.ctx.layout.toggleSidebar(); assert.equal(store.getSnapshot().layoutInfo.sidebar, 0)
    assert.equal(client.computeColumns(1400, 0, 510).sidebar, 68)
    f.ctx.layout.toggleSidebar(); assert.equal(store.getSnapshot().layoutInfo.sidebar, 264)
    assert.deepEqual(client.computeColumns(700, 264, 510), { sidebar: 264, center: 436, rightbar: 0 })
    // The old contract is transient: a new layout store starts at the default.
    assert.equal(client.createLayoutStore().create().getSnapshot().layoutInfo.sidebar, 264)
  } finally { await f.dispose() }
})

test('theme presenter follows official snapshots and releases owned DOM state and listeners', async () => {
  const f = await fixture()
  try {
    f.dom.window.document.body.style.setProperty('--foreign-token', 'keep')
    f.ctx.emit('theme/change', snapshot('dark'))
    assert.equal(f.dom.window.document.body.hasAttribute('data-ds-dark-theme'), true)
    assert.equal(f.dom.window.document.documentElement.getAttribute('data-ds-theme-source'), 'system')
    assert.equal(f.dom.window.document.body.style.getPropertyValue('--layout-test-token'), 'dark')
    await f.owner.dispose()
    assert.equal(f.dom.window.document.body.hasAttribute('data-ds-dark-theme'), false)
    assert.equal(f.dom.window.document.body.style.getPropertyValue('--layout-test-token'), '')
    assert.equal(f.dom.window.document.body.style.getPropertyValue('--foreign-token'), 'keep')
    f.ctx.emit('theme/change', snapshot('dark'))
    assert.equal(f.dom.window.document.body.hasAttribute('data-ds-dark-theme'), false)
  } finally { await f.dispose() }
})
test('AppFrame measures phone layout, preserves public owner props, updates title, and releases viewport effects', async () => {
  const f = await fixture()
  const mount = f.dom.window.document.createElement('div'); f.dom.window.document.body.append(mount)
  const { createRoot } = require('react-dom/client')
  const rootView = createRoot(mount), store = f.entry.store.create()
  const originalRect = f.dom.window.HTMLElement.prototype.getBoundingClientRect
  let width = 1400
  const owners = new Map()
  f.dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { width, height: 800, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, toJSON() {} } }
  const visual = new f.dom.window.EventTarget()
  Object.assign(visual, { height: 700, offsetTop: 0, scale: 1 })
  Object.defineProperty(f.dom.window, 'visualViewport', { configurable: true, value: visual })
  Object.defineProperty(f.dom.window, 'innerHeight', { configurable: true, value: 800 })
  const sessions = { byId: { selected: { id: 'selected', title: 'Recorded session', retainedBy: { mainView: 1 } } } }
  const useStore = selector => selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot))
  const usePanelInfo = selector => selector(React.useSyncExternalStore(f.ctx.layout.panelInfo.subscribe, f.ctx.layout.panelInfo.getSnapshot, f.ctx.layout.panelInfo.getSnapshot))
  const useSessions = selector => selector(sessions)
  try {
    await React.act(async () => rootView.render(React.createElement(client.AppFrame, {
      useStore, actions: store.actions, usePanelInfo, useSessions, t: key => key,
      renderSlot: (name, owner) => { owners.set(name, owner); return React.createElement('div', { 'data-test-slot': name }, name === 'main' ? React.createElement('textarea', { 'aria-label': 'composer' }) : null) },
    })))
    assert.equal(store.getSnapshot().layoutInfo.viewportWidth, 1400)
    assert.equal(f.environment.observers.size, 1)
    assert.equal(f.dom.window.document.title, 'Recorded session — brand.localBuild')
    assert.equal(mount.querySelector('.frame').hasAttribute('data-mobile-layout'), false)
    width = 390
    await React.act(async () => {
      for (const observer of f.environment.observers) observer.callback()
      const pending = [...f.environment.frames.entries()]; f.environment.frames.clear()
      for (const [, callback] of pending) callback()
    })
    const frame = mount.querySelector('.frame')
    assert.equal(frame.hasAttribute('data-mobile-layout'), true)
    assert.equal(frame.style.gridTemplateColumns.startsWith('0px '), true)
    assert.deepEqual(Object.keys(owners.get('sidebar')).sort(), ['collapsed', 'width'])
    assert.equal(owners.get('sidebar').width, 390)
    assert.equal(frame.style.getPropertyValue('--dsh-mobile-viewport-height'), '700px')
    await React.act(async () => { mount.querySelector('textarea').focus(); visual.height = 480; visual.dispatchEvent(new f.dom.window.Event('resize')) })
    assert.equal(frame.hasAttribute('data-mobile-keyboard'), true)
    assert.equal(frame.style.getPropertyValue('--dsh-mobile-keyboard-inset'), '320px')
    await React.act(async () => f.ctx.layout.selectPanel('community-panel'))
    assert.equal(f.dom.window.document.title, 'brand.localBuild')
    await React.act(async () => rootView.unmount())
    assert.equal(f.environment.observers.size, 0)
    assert.equal(f.environment.frames.size, 0)
    assert.equal(frame.style.getPropertyValue('--dsh-mobile-viewport-height'), '')
    assert.equal(frame.hasAttribute('data-mobile-keyboard'), false)
    visual.height = 300; visual.dispatchEvent(new f.dom.window.Event('resize'))
    assert.equal(frame.style.getPropertyValue('--dsh-mobile-viewport-height'), '')
  } finally {
    f.dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect
    await f.dispose()
  }
})

test('resize handles commit owner-store widths and release capture plus pending animation work on unmount', async () => {
  const f = await fixture()
  const mount = f.dom.window.document.createElement('div'); f.dom.window.document.body.append(mount)
  const { createRoot } = require('react-dom/client')
  const rootView = createRoot(mount), store = f.entry.store.create()
  store.actions.setViewportWidth(1400)
  const prototype = f.dom.window.HTMLElement.prototype
  const previous = { setPointerCapture: prototype.setPointerCapture, hasPointerCapture: prototype.hasPointerCapture, releasePointerCapture: prototype.releasePointerCapture }
  const captures = new Map()
  prototype.setPointerCapture = function (id) { captures.set(this, id) }
  prototype.hasPointerCapture = function (id) { return captures.get(this) === id }
  prototype.releasePointerCapture = function () { captures.delete(this) }
  const useStore = selector => selector(React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot))
  const usePanelInfo = selector => selector(React.useSyncExternalStore(f.ctx.layout.panelInfo.subscribe, f.ctx.layout.panelInfo.getSnapshot, f.ctx.layout.panelInfo.getSnapshot))
  const pointer = (target, name, x) => { const event = new f.dom.window.Event(name, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 7, button: 0, clientX: x }); target.dispatchEvent(event) }
  try {
    await React.act(async () => rootView.render(React.createElement(client.AppFrame, { useStore, usePanelInfo, actions: store.actions, useSessions: selector => selector({ byId: {} }), renderSlot: () => null, t: key => key })))
    const handle = mount.querySelector('[data-side="sidebar"]')
    assert.ok(handle)
    await React.act(async () => { pointer(handle, 'pointerdown', 264); pointer(handle, 'pointermove', 314) })
    assert.equal(captures.size, 1); assert.equal(f.environment.frames.size, 1)
    await React.act(async () => { const pending = [...f.environment.frames.values()]; f.environment.frames.clear(); pending.forEach(callback => callback()) })
    assert.equal(store.getSnapshot().layoutInfo.sidebar, 314)
    await React.act(async () => pointer(handle, 'pointerup', 320))
    assert.equal(store.getSnapshot().layoutInfo.sidebar, 320); assert.equal(captures.size, 0)
    await React.act(async () => { pointer(handle, 'pointerdown', 320); pointer(handle, 'pointermove', 340) })
    assert.equal(f.environment.frames.size, 1)
    await React.act(async () => rootView.unmount())
    assert.equal(captures.size, 0); assert.equal(f.environment.frames.size, 0)
  } finally { Object.assign(prototype, previous); await f.dispose() }
})
