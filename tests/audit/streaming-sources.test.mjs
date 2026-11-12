import { afterAll, afterEach, describe, expect, test } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { build } from './helpers/client-build.mjs'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
const rootDirectory = resolve(import.meta.dirname, '../..')
const bundle = await build({
  entryPoints: [resolve(rootDirectory, 'packages/modern-ui/src/vendor/primitives/markdown/MarkdownText.tsx')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'shiki', 'katex'],
  jsx: 'automatic',
  plugins: [
    {
      name: 'test-css',
      setup(b) {
        b.onLoad({ filter: /markdown[/\\]parse\.ts$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8')).replace(
            'export function parseGfm(text: string): Root {',
            'export function parseGfm(text: string): Root { globalThis.__sourceParseWork?.push(text.length);',
          ),
          loader: 'ts',
        }))
        b.onLoad({ filter: /Tooltip\.tsx$/ }, () => ({ contents: 'export const Tooltip = ({children}) => children', loader: 'js' }))
        b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js' }))
      },
    },
  ],
})
const bundlePath = resolve(import.meta.dirname, '.streaming-sources-' + process.pid + '.mjs')
await writeFile(bundlePath, bundle.outputFiles[0].text)
const { MarkdownText } = await import(pathToFileURL(bundlePath).href)
await rm(bundlePath)
const dom = new JSDOM('<body></body>', { url: 'https://example.test/' })
const globals = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__sourceParseWork']
const previous = Object.getOwnPropertyDescriptors(globalThis)
for (const key of globals)
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key] })
afterAll(() => {
  dom.window.close()
  for (const key of globals) {
    if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
    else delete globalThis[key]
  }
})

const labels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes', citations: { sources: 'Sources', source: 'Source' } }
const cleanups = []
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()))
function documentView(citations = true, codeRenderer) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return {
    container,
    render(text, streaming = true) {
      act(() => root.render(createElement(MarkdownText, { text, streaming, labels, citations, codeRenderer })))
    },
    links: () => [...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
  }
}

describe('streaming source frontiers', () => {
  test('does not show an unfinished named-link address', () => {
    const view = documentView(false)
    view.render('- [Research comparison](https://example.com/research/long-address')
    expect(view.container.textContent).toBe('Research comparison')
    expect(view.links()).toEqual([])
  })
  test('does not reveal a pending definition title as body text', () => {
    const view = documentView()
    view.render('正文[1]。\n\n[1]: https://example.com/report "来源标题')
    expect(view.container.textContent).not.toContain('https://')
    expect(view.links()).toEqual([])
  })
  test('resolves frozen references when a complete definition arrives', () => {
    const view = documentView()
    let text = ''
    for (const chunk of ['正文[1]。', '\n\n第二段。', '\n\n第三段。', '\n\n[1]: https://example.com "文章标题"']) {
      text += chunk
      view.render(text)
    }
    expect(view.container.querySelector('[data-citation-kind="source"]')?.getAttribute('href')).toBe('https://example.com')
    expect(view.container.textContent).not.toContain('[1]')
  })
  test('never freezes a partial destination into an active citation', () => {
    const view = documentView()
    const prefix = '正文[1]。\n\n第二段。\n\n'
    view.render(prefix)
    view.render(`${prefix}[1]: https://e`)
    expect(view.links()).toEqual([])
    view.render(`${prefix}[1]: https://example.com "文章标题"`)
    expect(view.links()).toEqual(['https://example.com', 'https://example.com'])
  })

  test.each(['', '\n', '\r\n'])('keeps a bare destination pending at EOF with suffix %j', suffix => {
    const view = documentView()
    const text = `正文[1]。\n\n[1]: https://example.com${suffix}`
    view.render(text)
    expect(view.links()).toEqual([])
    view.render(text, false)
    expect(view.links()).toEqual(['https://example.com', 'https://example.com'])
  })

  test('commits a multiline title character by character without exposing the address', () => {
    const view = documentView()
    let text = '正文[1]。\n\nSecond.\n\nThird.\n\n[1]:'
    const suffix = ' https://example.com/report\n  "Multi\nline \\"title\\""'
    for (const char of suffix) {
      text += char
      view.render(text)
      expect(view.container.textContent).not.toContain('https://')
      if (text !== `正文[1]。\n\nSecond.\n\nThird.\n\n[1]:${suffix}`) expect(view.links()).toEqual([])
    }
    expect(view.links()).toEqual(['https://example.com/report', 'https://example.com/report'])
    const html = view.container.innerHTML
    view.render(text, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test.each([1, 3, 13, 200])('matches settled markup for reference definitions across chunks of %i characters', size => {
    const view = documentView()
    const text = 'Result [1][2]. Repeat [1].\n\nSecond.\n\nThird.\n\n[1]: https://one.test "One"\n[2]: https://two.test "Two"'
    for (let end = size; end < text.length; end += size) view.render(text.slice(0, end))
    view.render(text)
    const html = view.container.innerHTML
    expect(view.container.querySelectorAll('[data-citation-kind="source"]')).toHaveLength(2)
    view.render(text, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test('definitions frozen before references still resolve new paragraphs', () => {
    const view = documentView()
    let text = '[named]: https://named.test "Named"\n[1]: https://one.test "One"\n\nFirst.\n\nSecond.\n\nThird.'
    view.render(text)
    text += '\n\nSee [named] and [1].'
    view.render(text)
    expect(view.links()).toEqual(['https://named.test', 'https://one.test', 'https://one.test'])
    const html = view.container.innerHTML
    view.render(text, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test.each([String.raw`a\]b`, String.raw`x\!y`, String.raw`a\\b`])('resolves authored escaped labels across a frozen boundary: %s', label => {
    const view = documentView(false)
    const prefix = `[${label}]: https://example.com "Title"\n\nFirst.\n\nSecond.\n\nThird.`
    view.render(prefix)
    view.render(`${prefix}\n\nReference [${label}].`)
    expect(view.links()).toEqual(['https://example.com'])
    const html = view.container.innerHTML
    view.render(`${prefix}\n\nReference [${label}].`, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test('does not turn a pending inline label into a code block or move earlier fence offsets', () => {
    const received = []
    const view = documentView(false, (input, fallback) => {
      received.push(input)
      return fallback
    })
    const prefix = '```txt\noriginal code\n```\n\n'
    view.render(prefix)
    view.render(`${prefix}   [Research](`)
    expect(received.every(input => input.code === 'original code' && input.closed)).toBe(true)
    expect(view.container.querySelectorAll('pre')).toHaveLength(1)
    expect(view.links()).toEqual([])
    expect(view.container.textContent).toContain('Research')
    view.render(`${prefix}   [Research](\n\n\`\`\`js\nnext code\n\`\`\``)
    expect(received.at(-1)).toMatchObject({ code: 'next code', closed: true })
  })

  test('withdraws a committed title when a same-line suffix proves it invalid', () => {
    const view = documentView()
    const text = '正文[1]。\n\nSecond.\n\nThird.\n\n[1]: https://example.com "Title"'
    view.render(text)
    expect(view.container.querySelector('[data-citation-sources]')).not.toBeNull()
    view.render(`${text} invalid`)
    expect(view.container.querySelector('[data-citation-sources]')).toBeNull()
    const html = view.container.innerHTML
    view.render(`${text} invalid`, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test('retains first definitions, numeric conflicts, and protocol safety', () => {
    const view = documentView()
    const text =
      'First [1], conflict [1](https://conflict.test), [2], [3], [mail](mailto:a@example.com).\n\nSecond.\n\nThird.\n\n[1]: https://first.test "First"\n[1]: https://last.test "Last"\n[2]: javascript:alert(1) "Unsafe"\n[3]: /relative "Local"'
    view.render(text)
    expect(view.container.querySelectorAll('[data-citation-kind="source"]')).toHaveLength(1)
    expect(view.links()).toEqual(['https://first.test', 'https://conflict.test', 'mailto:a@example.com', 'https://first.test'])
    const html = view.container.innerHTML
    view.render(text, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test.each(['[label](https://unfinished', '[1]: https://example.com "unfinished', '```md\n[1]: https://e', '\\[label](https://e'])(
    'settled completion, cancellation and failure flush the original source: %s',
    text => {
      const codeRenderer = input => createElement('pre', {}, input.code)
      const view = documentView(true, codeRenderer)
      view.render(text)
      view.render(text, false)
      const fresh = documentView(true, codeRenderer)
      fresh.render(text, false)
      expect(view.container.innerHTML).toBe(fresh.container.innerHTML)
    },
  )

  test('holds definitions inside quote and list containers without touching their content', () => {
    for (const prefix of ['> ', '- ']) {
      const view = documentView()
      const continuation = prefix === '> ' ? '> ' : '  '
      const source = `Result [1].\n\n${prefix}[1]: https://example.com\n${continuation}"Multiline\n${continuation}title`
      view.render(source)
      expect(view.container.textContent).not.toContain('https://')
      expect(view.links()).toEqual([])
      view.render(`${source}"`)
      const html = view.container.innerHTML
      view.render(`${source}"`, false)
      expect(view.container.innerHTML).toBe(html)
    }
  })

  test('replacement and separate documents do not retain source or footnote labels', () => {
    const first = documentView()
    first.render('See [1] and [^n].\n\n[1]: https://one.test "One"\n\n[^n]: Note')
    const second = documentView()
    second.render('See [1] and [^n].')
    expect(second.links()).toEqual([])
    first.render('See [1] and [^n].')
    expect(first.links()).toEqual([])
    expect(first.container.innerHTML).toBe(second.container.innerHTML)
  })

  test('footnotes resolve across the frozen boundary and update while their body grows', () => {
    const view = documentView()
    let text = 'Result [^n].\n\nSecond.\n\nThird.'
    view.render(text)
    text += '\n\n[^n]: Note'
    view.render(text)
    expect(view.container.textContent).not.toContain('[^n]')
    text += ' continues.\n\n    Another paragraph.'
    view.render(text)
    expect(view.container.textContent).toContain('Another paragraph.')
    const html = view.container.innerHTML
    view.render(text, false)
    expect(view.container.innerHTML).toBe(html)
  })

  test('codeRenderer receives original code and fence closure after reference cache refresh', () => {
    const received = []
    const view = documentView(true, (input, fallback) => {
      received.push(input)
      return fallback
    })
    const prefix = 'Result [1].\n\nSecond.\n\n[1]: https://one.test "One"\n\n'
    view.render(`${prefix}\`\`\`ts\nconst x = '[1]: https://e'`)
    expect(received.at(-1)).toMatchObject({ code: "const x = '[1]: https://e'", closed: false })
    view.render(`${prefix}\`\`\`ts\nconst x = '[1]: https://e'\n\`\`\``)
    expect(received.at(-1)).toMatchObject({ code: "const x = '[1]: https://e'", closed: true })
  })

  test('definition commits reparse once; subsequent prose and footnote tokens only parse the tail', () => {
    const view = documentView()
    let text = Array.from({ length: 600 }, (_, index) => `Paragraph ${index}: source [1] and note [^n].`).join('\n\n')
    view.render(text)
    globalThis.__sourceParseWork = []
    text += '\n\n[1]: https://one.test "One"'
    view.render(text)
    const commitWork = globalThis.__sourceParseWork.reduce((a, b) => a + b, 0)
    expect(commitWork).toBeGreaterThan(text.length)
    text += '\n\n[^n]: N'
    view.render(text)
    globalThis.__sourceParseWork = []
    for (let index = 0; index < 80; index++) {
      text += 'x'
      view.render(text)
    }
    const lengths = globalThis.__sourceParseWork
    expect(Math.max(...lengths)).toBeLessThan(500)
    console.info(
      `Source parsing work: definition commit ${commitWork} characters; 80 footnote chunks ${lengths.reduce((a, b) => a + b, 0)} characters; document ${text.length} characters.`,
    )
    globalThis.__sourceParseWork = undefined
  })
})
