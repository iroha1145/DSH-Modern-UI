import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const repo = resolve(import.meta.dirname, '../..')
const bundle = await build({
  absWorkingDir: repo,
  stdin: {
    contents: `export { MarkdownText } from './vendor/primitives/markdown/MarkdownText.tsx'; export { renderTexToReact } from './vendor/primitives/markdown/katex.tsx';`,
    resolveDir: resolve(repo, 'packages/modern-ui/src'),
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'shiki', 'katex'],
  plugins: [
    {
      name: 'test-css',
      setup(builder) {
        builder.onLoad({ filter: /Tooltip\.tsx$/ }, () => ({ contents: 'export const Tooltip = ({children}) => children', loader: 'js' }))
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js' }))
      },
    },
  ],
})
const file = resolve(import.meta.dirname, `.markdown-resources-${process.pid}.mjs`)
await writeFile(file, bundle.outputFiles[0].text)
const { MarkdownText, renderTexToReact } = await import(pathToFileURL(file).href)
await rm(file)
const dom = new JSDOM('<body></body>', { url: 'https://host.test/app/' })
const keys = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'IS_REACT_ACT_ENVIRONMENT']
const previous = Object.getOwnPropertyDescriptors(globalThis)
for (const key of keys)
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] })
afterAll(() => {
  dom.window.close()
  for (const key of keys) {
    if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
    else delete globalThis[key]
  }
})
function mounted(element) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return {
    container,
    close() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }

test('a remounted package image requests fresh bytes while remote images keep authored URLs', () => {
  const target = 'https://host.test/app/api/modern-ui/plugin-document-image?document=bundle%3Aone&path=a%20b.png'
  const source = () => {
    const view = mounted(
      createElement(MarkdownText, { labels, text: '![local](a.png)\n\n![remote](https://cdn.test/a.png)', pathImages: { resolve: () => target } }),
    )
    try {
      return [...view.container.querySelectorAll('img')].map(image => image.src)
    } finally {
      view.close()
    }
  }
  const first = source(),
    second = source()
  assert.notEqual(first[0], second[0])
  for (const url of [first[0], second[0]]) {
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('document'), 'bundle:one')
    assert.equal(parsed.searchParams.get('path'), 'a b.png')
    assert.ok(parsed.searchParams.get('load'))
  }
  assert.equal(first[1], 'https://cdn.test/a.png')
  assert.equal(second[1], first[1])
})

test('KaTeX clamps authored rule dimensions and still renders ordinary formulae', () => {
  const rule = mounted(renderTexToReact(String.raw`\rule{999999em}{999999em}`, true))
  try {
    const dimensions = [...rule.container.querySelectorAll('[style]')].flatMap(node =>
      [...node.getAttribute('style').matchAll(/([\d.]+)em/g)].map(match => Number(match[1])),
    )
    assert.ok(dimensions.some(value => value === 20))
    assert.ok(
      dimensions.every(value => value <= 21),
      JSON.stringify(dimensions),
    )
    assert.equal(rule.container.querySelector('.katex-error'), null)
  } finally {
    rule.close()
  }
  const normal = mounted(renderTexToReact(String.raw`\frac{x^2 + 1}{\sqrt{y}}`, false))
  try {
    assert.ok(normal.container.querySelector('.katex-html'))
    assert.equal(normal.container.querySelector('.katex-error'), null)
  } finally {
    normal.close()
  }
})

test('KaTeX macro recursion and invalid commands remain recoverable within the existing expansion limit', () => {
  const source = String.raw`\def\a{\a}\a`
  const recursion = mounted(renderTexToReact(source, true))
  try {
    assert.ok(recursion.container.querySelector('.katex-error'))
    assert.equal(recursion.container.textContent, source)
  } finally {
    recursion.close()
  }
  const fallback = mounted(renderTexToReact(String.raw`\notACommand{x}\rule{999999em}{999999em}`, true))
  try {
    assert.match(fallback.container.querySelector('.katex-html').textContent, /\\notACommand/)
    const dimensions = [...fallback.container.querySelectorAll('[style]')].flatMap(node =>
      [...node.getAttribute('style').matchAll(/([\d.]+)em/g)].map(match => Number(match[1])),
    )
    assert.ok(dimensions.some(value => value === 20))
    assert.ok(
      dimensions.every(value => value <= 21),
      JSON.stringify(dimensions),
    )
  } finally {
    fallback.close()
  }
})
