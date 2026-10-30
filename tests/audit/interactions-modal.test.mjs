import { test } from 'vitest'
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
const official = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
const region = name => {
 const begin = official.indexOf('//#region lib/types/' + name + '.js')
 const end = official.indexOf('//#endregion', begin)
 assert.ok(begin >= 0 && end > begin)
 return official.slice(begin, end)
}
// Run exact published implementations together; they share the official private WeakMap stack.
const officialLayer = `import { useRef, useLayoutEffect } from 'react'; ${region('keyboard-composition')} ${region('focus')} ${region('useModalLayer')} export { useModalLayer, isBehindModal, observeComposition };`
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
const result = await build({ absWorkingDir: repo, tsconfigRaw: {}, stdin: { contents: `export { Menu } from './vendor/primitives/Menu.tsx'; export { useDismissBehindModal } from './vendor/primitives/useDismissBehindModal.ts'; export { useModalLayer, isBehindModal } from './vendor/primitives/useModalLayer.ts'; export { HoverCard } from './vendor/primitives/HoverCard.tsx'; export { MenuSurface } from './vendor/primitives/MenuSurface.tsx'; export { Modal } from './vendor/primitives/Modal.tsx'; export { StateDot } from './vendor/primitives/StateDot.tsx'; export { useAnchoredPosition } from './vendor/primitives/useAnchoredPosition.ts'; export { ReasoningTranslation } from './vendor/translation/client/translation.ts'; export { TranslationBody } from './vendor/translation/client/TranslationBody.tsx'; export { PluginDocument } from './plugin-documents/PluginDocument.tsx';`, resolveDir: source, loader: 'tsx' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic', plugins: [{ name: 'test-resources', setup(builder) {
  builder.onResolve({ filter: /@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'stub' }))
  builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'useModalLayer.ts', namespace: 'stub' }))
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: args.path, external: true }))
  builder.onResolve({ filter: /(?:icons\/index\.tsx|useModalLayer\.ts|DetailDocument\.tsx)$/ }, args => ({ path: args.path.endsWith('useModalLayer.ts') ? 'useModalLayer.ts' : args.path, namespace: 'stub' }))
  builder.onResolve({ filter: /^\./ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'source' }))
  builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
  builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'primitives' ? `const React = require('react'); export const Button = ({children, ...props}) => React.createElement('button', props, children); export const MarkdownText = ({text}) => React.createElement('article', null, text); export const IconLoadingOutlineRegular = () => null;` : args.path.endsWith('useModalLayer.ts') ? officialLayer : args.path.endsWith('DetailDocument.tsx') ? `const React = require('react'); export const useDetailDocumentLabels = x => x; export const DetailDocument = ({state}) => React.createElement('output', null, JSON.stringify(state));` : 'export const IconCloseOutlineRegular = () => null; export const IconCheckOutlineRegular = () => null;' }))
  builder.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: 'export default new Proxy({}, { get: (_, key) => key })', loader: 'js' }))
  builder.onLoad({ filter: /\.(?:tsx|ts)$/, namespace: 'source' }, args => {
    const relative = path.relative(repo, args.path).split(path.sep).join('/')
    return { contents: process.env.AUDIT_BASELINE && !args.path.endsWith('useDismissBehindModal.ts') ? execFileSync('git', ['show', '6b05926:' + relative], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) }
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

function OfficialDialog({ children, focus = true }) {
 const ref = React.useRef(null)
 ui.useModalLayer(ref, true, () => {})
 // Focus before the official layout-effect registration leaves no later focusin;
 // the observer must notice that registration at mutation delivery.
 const attach = element => { ref.current = element; if (!focus) element?.focus() }
 return require('react-dom').createPortal(h('div', { ref: attach, role: 'dialog', 'aria-modal': true, tabIndex: -1 }, children ?? h('button', null, 'Dialog control')), document.body)
}
function FloatingMenu({ name = 'background' }) {
 const [open, setOpen] = React.useState(true)
 return h(ui.Menu, { open, portal: true, anchor: h('button', { 'data-background-anchor': true }, name), items: [{ id: 'item', label: 'Item' }], onClose: () => setOpen(false) })
}
for (const focus of [true, false]) test(`U5 an asynchronously opened official modal closes the background Modern menu (focus=${focus})`, async () => {
 const mounted = await mount(h(FloatingMenu))
 let node, modalRoot
 try {
 assert.ok(document.querySelector('[role="menu"]'))
 node = document.createElement('div'); document.body.append(node)
 modalRoot = createRoot(node)
 await act(async () => { modalRoot.render(h(OfficialDialog, { focus })); await Promise.resolve() })
 assert.equal(document.querySelector('[role="menu"]') === null, true)
 } finally { if (modalRoot) await act(async () => modalRoot.unmount()); node?.remove(); await mounted.dispose() }
})

test('U5 a foreground dialog keeps its own portaled menu usable, then a later modal dismisses it', async () => {
 const mounted = await mount(h(OfficialDialog, null, h(FloatingMenu, { name: 'inside' })))
 let modalRoot, node
 try {
 assert.ok(document.querySelector('[role="menu"]'))
 assert.equal(ui.isBehindModal(document.querySelector('[data-background-anchor]')), false)
 await act(async () => window.dispatchEvent(new window.Event('resize')))
 assert.ok(document.querySelector('[role="menu"]'))
 node = document.createElement('div'); document.body.append(node); modalRoot = createRoot(node)
 await act(async () => { modalRoot.render(h(OfficialDialog)); await Promise.resolve() })
 assert.equal(document.querySelector('[role="menu"]') === null, true)
 } finally { if (modalRoot) await act(async () => modalRoot.unmount()); node?.remove(); await mounted.dispose() }
})

test('U5 an official modal dismisses the background hover immediately including its fade lifetime', async () => {
 const mounted = await mount(h(ui.HoverCard, { inline: true, variant: 'preview', anchor: h('button', null, 'anchor'), content: 'preview' }))
 let modalRoot, node
 try {
 await act(async () => mounted.container.querySelector('button').focus())
 assert.ok(document.querySelector('.portal'))
 node = document.createElement('div'); document.body.append(node); modalRoot = createRoot(node)
 await act(async () => { modalRoot.render(h(OfficialDialog)); await Promise.resolve() })
 assert.equal(document.querySelector('.portal'), null)
 } finally { if (modalRoot) await act(async () => modalRoot.unmount()); node?.remove(); await mounted.dispose() }
})

test('U5 official focus entry dismisses a background menu when a dialog reuses its mounted shell', async () => {
 const mounted = await mount(h(FloatingMenu))
 let activate
 function DeferredDialog() {
  const [open, setOpen] = React.useState(false)
  activate = setOpen
  const ref = React.useRef(null)
  ui.useModalLayer(ref, open, () => {})
  return h('div', { ref, role: 'dialog', 'aria-modal': open || undefined, tabIndex: -1 })
 }
 const node = document.createElement('div'); document.body.append(node); const modalRoot = createRoot(node)
 try {
 await act(async () => modalRoot.render(h(DeferredDialog)))
 assert.ok(document.querySelector('[role="menu"]'))
 await act(async () => { activate(true); await Promise.resolve() })
 assert.equal(document.querySelector('[role="menu"]') === null, true)
 } finally { await act(async () => modalRoot.unmount()); node.remove(); await mounted.dispose() }
})

test('U5 dismiss hook disconnects observations when the floating surface closes', async () => {
 const original = window.MutationObserver
 let active = 0
 window.MutationObserver = class extends original {
  observe(...args) { active++; return super.observe(...args) }
  disconnect() { active--; return super.disconnect() }
 }
 let dismissals = 0
 function Probe({ open }) {
  const ref = React.useRef(null)
  ui.useDismissBehindModal(ref, open, () => { dismissals++ })
  return h('button', { ref }, 'anchor')
 }
 let mounted
 try {
 mounted = await mount(h(Probe, { open: true }))
 assert.equal(active, 1)
 await act(async () => mounted.root.render(h(Probe, { open: false })))
 assert.equal(active, 0)
 assert.equal(dismissals, 0)
 } finally { if (mounted) await mounted.dispose(); window.MutationObserver = original }
})

test('U5 a newly mounted second dialog may open its own menu in the same commit', async () => {
 const first = await mount(h(OfficialDialog))
 const second = await mount(h(OfficialDialog, null, h(FloatingMenu, { name: 'new dialog menu' })))
 try {
 await tick()
 assert.ok(document.querySelector('[role="menu"]'))
 assert.equal(ui.isBehindModal(document.querySelector('[data-background-anchor]')), false)
 } finally { await second.dispose(); await first.dispose() }
})
