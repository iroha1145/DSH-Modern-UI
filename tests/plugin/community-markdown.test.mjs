import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { JSDOM } = require('jsdom')
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const output = await build({
  absWorkingDir: root, stdin: { resolveDir: root, contents: `
    export { installCommunityMarkdown } from './packages/modern-ui/src/community-markdown.ts';
    export { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';
  ` },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl' },
})
const scratch = path.join(root, '.artifacts/community-markdown-tests')
await mkdir(scratch, { recursive: true })
await writeFile(path.join(scratch, 'fixture.cjs'), output.outputFiles[0].text)
const { installCommunityMarkdown, MarkdownText } = require(path.join(scratch, 'fixture.cjs'))
const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied', toolbarLabels: { codeLabel: 'Code', wrapLabel: 'Wrap', unwrapLabel: 'Unwrap' } }, footnotes: '' }
const markdown = 'A document\n\n```text\nfirst line\nsecond line\n```\n'
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function fixture(t, host = 'data-dsh-better-sidebar') {
  const dom = new JSDOM(`<html><head></head><body><div ${host}><div class="nArs4W_editorMd" id="preview"></div><textarea id="editor">original edit buffer</textarea><a id="navigation" href="#section">Navigate</a></div><div id="outside"></div></body></html>`, { url: 'http://localhost/' })
  const { window } = dom
  const globals = { window, document: window.document, navigator: window.navigator, Element: window.Element, HTMLElement: window.HTMLElement,
    Node: window.Node, MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = new Map()
  for (const [key, value] of Object.entries(globals)) { previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }) }
  let language = 'en'
  const listeners = new Set()
  const disposers = []
  const ctx = { locale: {
    bind: namespace => { assert.equal(namespace, 'modern-chat'); return key => language === 'zh' ? key.endsWith('expand') ? '展开代码' : '收起代码' : key.endsWith('expand') ? 'Expand code' : 'Collapse code' },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }, effect: effect => { const dispose = effect(); if (dispose) disposers.push(dispose) } }
  const view = createRoot(window.document.getElementById('preview'))
  const outside = createRoot(window.document.getElementById('outside'))
  const render = async text => { await act(async () => { view.render(React.createElement(MarkdownText, { text, labels })); await settle() }); await settle() }
  await render(markdown)
  await act(async () => { outside.render(React.createElement(MarkdownText, { text: markdown, labels })); await settle() })
  t.after(async () => {
    for (const dispose of disposers.splice(0)) dispose()
    await act(async () => { view.unmount(); outside.unmount(); await settle() })
    window.close()
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  })
  return { document: window.document, render, install: async () => { installCommunityMarkdown(ctx); await settle() },
    withdraw: async () => { disposers.pop()?.(); await settle() },
    language: async value => { language = value; listeners.forEach(listener => listener()); await settle() }, listeners,
    click: async button => { await act(async () => { button.click(); await settle() }) },
  }
}

test('floating community preview folds real official Markdown without touching editing, copy controls or outside fences', async t => {
  const f = await fixture(t)
  const preview = f.document.getElementById('preview')
  const content = preview.querySelector('[data-code-block-content]')
  const original = content.textContent
  const existingButtons = [...preview.querySelectorAll('button')]
  await f.install()
  const button = preview.querySelector('[data-modern-community-fold]')
  assert.ok(button)
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(f.document.getElementById(button.getAttribute('aria-controls')), content)
  assert.equal(f.document.querySelector('#outside [data-modern-community-fold]'), null)
  await f.click(button)
  assert.equal(content.hidden, true)
  assert.equal(content.textContent, original)
  assert.equal(button.getAttribute('aria-label'), 'Expand code')
  for (const control of existingButtons) assert.ok(control.isConnected)
  assert.equal(f.document.getElementById('editor').value, 'original edit buffer')
  assert.equal(f.document.getElementById('navigation').getAttribute('href'), '#section')
  await f.language('zh')
  assert.equal(button.getAttribute('aria-label'), '展开代码')
  await f.render(markdown.replace('second line', 'updated second line'))
  assert.match(preview.querySelector('[data-code-block-content]').textContent, /updated second line/)
  assert.equal(preview.querySelector('[data-code-block-content]').hidden, true)
  assert.equal(preview.querySelectorAll('[data-modern-community-fold]').length, 1)
  await f.withdraw()
  assert.equal(content.hidden, false)
  assert.equal(content.getAttribute('id'), null)
  assert.equal(preview.querySelector('[data-modern-community-fold]'), null)
  assert.equal(f.listeners.size, 0)
})

test('native community host restores exact preexisting hidden/id and ignores Mermaid or native disclosure owners', async t => {
  const f = await fixture(t, 'data-dsh-native-tab-host')
  const block = f.document.querySelector('#preview .md-code-block')
  const content = block.querySelector('[data-code-block-content]')
  content.setAttribute('id', 'existing-content')
  content.setAttribute('hidden', 'until-found')
  await f.install()
  const button = block.querySelector('[data-modern-community-fold]')
  assert.equal(button.getAttribute('aria-controls'), 'existing-content')
  await f.click(button)
  assert.equal(content.hidden, false)
  await f.withdraw()
  assert.equal(content.getAttribute('hidden'), 'until-found')
  assert.equal(content.id, 'existing-content')
  block.setAttribute('data-mermaid-processed', 'true')
  await f.install()
  assert.equal(block.querySelector('[data-modern-community-fold]'), null)
  block.removeAttribute('data-mermaid-processed')
  await settle()
  assert.ok(block.querySelector('[data-modern-community-fold]'))
  block.setAttribute('data-mermaid-processed', 'true')
  await settle()
  assert.equal(block.querySelector('[data-modern-community-fold]'), null)
  assert.equal(content.getAttribute('hidden'), 'until-found')
  const nativeToggle = f.document.createElement('button')
  nativeToggle.setAttribute('aria-expanded', 'false')
  nativeToggle.setAttribute('aria-controls', content.id)
  block.querySelector('[data-code-block-banner]').appendChild(nativeToggle)
  block.removeAttribute('data-mermaid-processed')
  await settle()
  assert.equal(block.querySelector('[data-modern-community-fold]'), null)
  nativeToggle.remove()
  await settle()
  assert.ok(block.querySelector('[data-modern-community-fold]'))
  await f.render('No fenced code here.')
  assert.equal(f.document.querySelector('#preview [data-modern-community-fold]'), null)
  await f.render(markdown)
  assert.equal(f.document.querySelectorAll('#preview [data-modern-community-fold]').length, 1)
})

test('community preview selector agrees with fixed 0.28.0 source and compiled modules when available', async t => {
  const base = path.join(root, '../sidebar-package/package')
  let metadata
  try { metadata = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return t.skip('Fixed community release fixture is not unpacked'); throw error }
  assert.equal(metadata.version, '0.28.0')
  const [floating, native, text, compiled] = await Promise.all(['src/client/index.tsx', 'src/client/native/tab-adapter.tsx', 'src/client/TextEditor.tsx', 'lib/client-editor.js'].map(file => readFile(path.join(base, file), 'utf8')))
  assert.match(floating, /setAttribute\('data-dsh-better-sidebar'/)
  assert.match(native, /'data-dsh-native-tab-host': ''/)
  assert.match(text, /className=\{css.editorMd\}/)
  assert.match(compiled, /"editorMd": "nArs4W_editorMd"/)
})
