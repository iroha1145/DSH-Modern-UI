import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire, Module } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const source = path.join(repo, 'packages/modern-ui/src')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'SVGElement', 'getComputedStyle']) globalThis[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia = () => ({ matches: true })
const result = await build({ absWorkingDir: repo, tsconfigRaw: {}, stdin: { contents: `export { HoverCard } from './vendor/primitives/HoverCard.tsx'; export { MenuSurface } from './vendor/primitives/MenuSurface.tsx'; export { Modal } from './vendor/primitives/Modal.tsx'; export { StateDot } from './vendor/primitives/StateDot.tsx'; export { useAnchoredPosition } from './vendor/primitives/useAnchoredPosition.ts'; export { ReasoningTranslation } from './vendor/translation/client/translation.ts'; export { TranslationBody } from './vendor/translation/client/TranslationBody.tsx'; export { PluginDocument } from './plugin-documents/PluginDocument.tsx';`, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', plugins: [{ name: 'test-resources', setup(builder) {
  builder.onResolve({ filter: /@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'stub' }))
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: args.path, external: true }))
  builder.onResolve({ filter: /(?:icons\/index\.tsx|useModalLayer\.ts|DetailDocument\.tsx)$/ }, args => ({ path: args.path, namespace: 'stub' }))
  builder.onResolve({ filter: /^\./ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'source' }))
  builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
  builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'primitives' ? `const React = require('react'); export const Button = ({children, ...props}) => React.createElement('button', props, children); export const MarkdownText = ({text}) => React.createElement('article', null, text); export const IconLoadingOutlineRegular = () => null;` : args.path.endsWith('useModalLayer.ts') ? 'export function useModalLayer() {} export function isBehindModal() { return false }' : args.path.endsWith('DetailDocument.tsx') ? `const React = require('react'); export const useDetailDocumentLabels = x => x; export const DetailDocument = ({state}) => React.createElement('output', null, JSON.stringify(state));` : 'export const IconCloseOutlineRegular = () => null; export const IconCheckOutlineRegular = () => null;' }))
  builder.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: 'export default new Proxy({}, { get: (_, key) => key })', loader: 'js' }))
  builder.onLoad({ filter: /\.(?:tsx|ts)$/, namespace: 'source' }, args => {
    const relative = path.relative(repo, args.path).split(path.sep).join('/')
    return { contents: process.env.AUDIT_BASELINE ? execFileSync('git', ['show', '6b05926:' + relative], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
  })
} }] })
const loaded = new Module(path.join(repo, 'tests/audit/interactions-runtime.cjs'))
loaded.filename = path.join(repo, 'tests/audit/interactions-runtime.cjs')
loaded.paths = Module._nodeModulePaths(repo)
loaded._compile(result.outputFiles[0].text, loaded.filename)
const ui = loaded.exports
const h = React.createElement
async function mount(element) {
 const container = document.createElement('div'); document.body.append(container)
 const root = createRoot(container)
 await act(async () => { root.render(element) })
 return { root, container, async dispose() { await act(async () => root.unmount()); container.remove() } }
}
const tick = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }

test('L1 model selection transport rejection is announced', async () => {
 const ts = require('typescript')
 const file = 'packages/modern-ui/src/vendor/model/client/ModelSelect.tsx'
 const code = process.env.AUDIT_BASELINE ? execFileSync('git', ['show', '6b05926:' + file], { cwd: repo, encoding: 'utf8' }) : readFileSync(path.join(repo, file), 'utf8')
 const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
 let submit
 function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submit') submit = node.initializer.getText(ast); ts.forEachChild(node, visit) }
 visit(ast)
 const js = ts.transpile('const submit = ' + submit + '; return submit', { target: ts.ScriptTarget.ES2023 })
 const announced = []
 const rejection = Promise.reject(new Error('offline'))
 // Mark the original promise handled so the assertion also detects a missing rejection branch without crashing the runner.
 rejection.catch(() => {})
 let observed
 const select = () => ({ then: (...callbacks) => { observed = callbacks[1]; return rejection.then(...callbacks).catch(() => {}) } })
 const run = new Function('select', 'settle', 'announce', 't', 'lastActionRef', js)(select, () => {}, x => announced.push(x), (_, values) => values.message, { current: '' })
 run({}, true)
 await tick()
 assert.equal(typeof observed, 'function')
 assert.deepEqual(announced, ['offline'])
})

test('L2 background inline hover does not swallow target Escape', async () => {
 const mounted = await mount(h(ui.HoverCard, { inline: true, anchor: h('button', null, 'anchor'), content: 'preview' }))
 try {
 const anchor = mounted.container.querySelector('button')
 await act(async () => anchor.focus())
 assert.ok(document.querySelector('.portal'))
 const other = document.createElement('input'); document.body.append(other)
 let escaped = 0
 other.addEventListener('keydown', () => { escaped += 1 })
 await act(async () => other.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
 assert.equal(escaped, 1)
 assert.equal(document.querySelector('.portal'), null)
 other.remove()
 } finally { await mounted.dispose() }
})

test('L3 inline hover tolerates a Window relatedTarget', async () => {
 const mounted = await mount(h(ui.HoverCard, { inline: true, anchor: h('button', null, 'anchor'), content: 'preview' }))
 const errors = []
 const capture = event => { errors.push(event.error); event.preventDefault() }
 window.addEventListener('error', capture)
 try {
 const anchor = mounted.container.querySelector('button')
 await act(async () => anchor.focus())
 await act(async () => anchor.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true, relatedTarget: window })))
 assert.deepEqual(errors, [])
 assert.equal(document.querySelector('.portal'), null)
 } finally { window.removeEventListener('error', capture); await mounted.dispose() }
})

test('L4 non-JSON HTTP error retains the network document message', async () => {
 const old = globalThis.fetch
 globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 })
 const mounted = await mount(h(ui.PluginDocument, { target: { kind: 'bundle', name: 'test' }, language: 'en', t: x => x }))
 try { await tick(); assert.equal(JSON.parse(mounted.container.textContent).message, 'detailNetwork') }
 finally { await mounted.dispose(); globalThis.fetch = old }
})

test('L7 a late translation failure preserves successful paragraphs and allows view switching and retry', async () => {
 let fail = true
 const requests = []
 const translate = async ({ text }) => { requests.push(text); if (text === 'Second' && fail) throw new Error('offline'); return text === 'First' ? '一' : '二' }
 const mounted = await mount(h(ui.TranslationBody, { text: 'First\n\nSecond', running: false, translate, t: x => x, reasoningT: x => x,
 usePreferences: selector => selector({ provider: 'test', targetLanguage: 'zh' }), useTranslationLocale: selector => selector({ active: 'en' }), useTranslationLimit: selector => selector(1000) }))
 try {
 await tick()
 assert.equal(mounted.container.querySelector('article').textContent, '一\n\nSecond')
 const toggle = mounted.container.querySelector('button')
 assert.equal(toggle.disabled, false)
 await act(async () => toggle.click())
 assert.equal(mounted.container.querySelector('article').textContent, 'First\n\nSecond')
 await act(async () => toggle.click())
 fail = false
 await act(async () => [...mounted.container.querySelectorAll('button')].find(x => x.textContent === 'retry').click())
 await tick()
 assert.equal(mounted.container.querySelector('article').textContent, '一\n\n二')
 assert.deepEqual(requests, ['First', 'Second', 'Second'])
 } finally { await mounted.dispose() }
})

test('U6/P4 anchored panels flip, coalesce scroll, retain identity, and cancel pending frames', async () => {
 let position, renders = 0, measurements = 0
 let rect = { left: 200, right: 240, top: 700, bottom: 730 }
 const anchor = { current: { getBoundingClientRect: () => { measurements++; return rect } } }
 const panel = { current: { offsetWidth: 200, offsetHeight: 200 } }
 const frames = new Map(); let nextFrame = 0
 const oldRequest = window.requestAnimationFrame, oldCancel = window.cancelAnimationFrame
 window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
 window.cancelAnimationFrame = id => frames.delete(id)
 function Probe() { renders++; position = ui.useAnchoredPosition({ open: true, anchorRef: anchor, panelRef: panel, gap: 8, margin: 8 }); return null }
 const mounted = await mount(h(Probe))
 try {
 assert.equal(position.top, 492)
 const before = measurements, previous = position
 await act(async () => { window.dispatchEvent(new window.Event('scroll')); window.dispatchEvent(new window.Event('scroll')); window.dispatchEvent(new window.Event('resize')) })
 assert.equal(measurements, before)
 assert.equal(frames.size, 1)
 await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) })
 assert.equal(measurements, before + 1)
 assert.equal(position, previous)
 const settledRenders = renders
 await act(async () => { window.dispatchEvent(new window.Event('scroll')); const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) })
 assert.equal(renders, settledRenders)
 await act(async () => window.dispatchEvent(new window.Event('scroll')))
 await mounted.dispose()
 assert.equal(frames.size, 0)
 } finally { if (mounted.container.isConnected) await mounted.dispose(); window.requestAnimationFrame = oldRequest; window.cancelAnimationFrame = oldCancel }
})

test('P11 stable spinner ref does not re-register a listener on ordinary rerenders', async () => {
 const original = window.SVGElement.prototype.addEventListener
 let starts = 0
 window.SVGElement.prototype.addEventListener = function(type, ...args) { if (type === 'animationstart') starts++; return original.call(this, type, ...args) }
 let mounted
 try {
 mounted = await mount(h(ui.StateDot, { state: 'ongoing' }))
 const initial = starts
 await act(async () => mounted.root.render(h(ui.StateDot, { state: 'ongoing', size: 18 })))
 await act(async () => mounted.root.render(h(ui.StateDot, { state: 'ongoing', size: 22 })))
 assert.equal(starts, initial)
 assert.equal(initial, 1)
 } finally { if (mounted) await mounted.dispose(); window.SVGElement.prototype.addEventListener = original }
})

test('L5 body backing survives same-parent portal reorder and sibling reconciliation', async () => {
 const { createPortal } = require('react-dom')
 const View = ({ names }) => h(React.Fragment, null, ...names.map(name => createPortal(h(ui.MenuSurface, { 'data-name': name }, name), document.body, name)))
 const mounted = await mount(h(React.StrictMode, null, h(View, { names: ['first', 'second'] })))
 try {
 assert.equal(document.querySelectorAll('[data-menu-backing]').length, 2)
 await act(async () => mounted.root.render(h(React.StrictMode, null, h(View, { names: ['second', 'third', 'first'] }))))
 assert.equal(document.querySelectorAll('[data-menu-backing]').length, 3)
 assert.equal(document.querySelectorAll('[data-menu-material]').length, 3)
 await act(async () => mounted.root.render(h(React.StrictMode, null, h(View, { names: ['third'] }))))
 assert.equal(document.querySelectorAll('[data-menu-backing]').length, 1)
 assert.equal(document.querySelector('[data-menu-material]').textContent, 'third')
 } finally { await mounted.dispose() }
 assert.equal(document.querySelector('[data-menu-backing]'), null)
})

test('P4 hover scroll measurements coalesce and queued work is cancelled on unmount', async () => {
 const original = window.HTMLElement.prototype.getBoundingClientRect
 const oldRequest = window.requestAnimationFrame, oldCancel = window.cancelAnimationFrame
 let reads = 0
 const frames = new Map(); let nextFrame = 0
 window.HTMLElement.prototype.getBoundingClientRect = function() { reads++; return original.call(this) }
 window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame }
 window.cancelAnimationFrame = id => frames.delete(id)
 let mounted
 try {
 mounted = await mount(h(ui.HoverCard, { inline: true, anchor: h('button', null, 'anchor'), content: 'preview' }))
 await act(async () => mounted.container.querySelector('button').focus())
 const before = reads
 await act(async () => { window.dispatchEvent(new window.Event('scroll')); window.dispatchEvent(new window.Event('scroll')); window.dispatchEvent(new window.Event('resize')) })
 assert.equal(reads, before)
 assert.equal(frames.size, 1)
 await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) })
 assert.equal(reads, before + 1)
 await act(async () => window.dispatchEvent(new window.Event('scroll')))
 await mounted.dispose()
 assert.equal(frames.size, 0)
 } finally {
 if (mounted?.container.isConnected) await mounted.dispose()
 window.HTMLElement.prototype.getBoundingClientRect = original
 window.requestAnimationFrame = oldRequest; window.cancelAnimationFrame = oldCancel
 }
})

test('P12 an abandoned concurrent expansion cannot change the committed closing height cap', async () => {
 const filename = 'packages/modern-ui/src/vendor/chat/client/chat/ChatGroupSeat.tsx'
 const text = process.env.AUDIT_BASELINE ? execFileSync('git', ['show', '6b05926:' + filename], { cwd: repo, encoding: 'utf8' }) : readFileSync(path.join(repo, filename), 'utf8')
 const start = text.indexOf('const [closingCap, setClosingCap]')
 const end = text.indexOf('if (members === undefined)', start)
 assert.ok(start >= 0 && end > start)
 // Execute the component's actual state adjustment independently of host store injection.
 const readCap = new Function('useState', 'shownCap', text.slice(start, end) + '\nreturn shownCap ?? closingCap')
 const pending = new Promise(() => {})
 let attempts = 0
 function Probe({ cap, suspend = false }) {
  const value = readCap(React.useState, cap)
  if (suspend) { attempts++; throw pending }
  return h('output', null, String(value))
 }
 const mounted = await mount(h(React.Suspense, { fallback: 'loading' }, h(Probe, { cap: false })))
 try {
 await act(async () => React.startTransition(() => mounted.root.render(h(React.Suspense, { fallback: 'loading' }, h(Probe, { cap: true, suspend: true })))))
 assert.ok(attempts > 0)
 assert.equal(mounted.container.textContent, 'false')
 await act(async () => mounted.root.render(h(React.Suspense, { fallback: 'loading' }, h(Probe, { cap: undefined }))))
 assert.equal(mounted.container.textContent, 'false')
 } finally { await mounted.dispose() }
})
