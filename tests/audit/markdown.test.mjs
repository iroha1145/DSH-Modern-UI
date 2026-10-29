import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'

const root = resolve(import.meta.dirname, '../..')
async function load(relative) {
  const result = await build({ entryPoints: [resolve(process.env.AUDIT_SOURCE_ROOT ?? root, relative)], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external', jsx: 'automatic', plugins: [{ name: 'css', setup(b) { b.onLoad({ filter: /Tooltip\.tsx$/ }, () => ({ contents: 'export const Tooltip = ({children}) => children', loader: 'js' })); b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js' })) } }] })
  // Import from the repository so external packages resolve to its pinned dependencies.
  const file = resolve(root, 'tests/audit', `.markdown-${process.pid}-${Math.random()}.mjs`)
  await writeFile(file, result.outputFiles[0].text)
  try { return await import(pathToFileURL(file).href) } finally { await rm(file) }
}
const base = 'packages/modern-ui/src/vendor/'
const { parseGfm, parseGfmWithMath } = await load(base + 'primitives/markdown/parse.ts')
const { diffTotals } = await load(base + 'primitives/DiffBlock.tsx')
const { quoteRule } = await load(base + 'message-quotes/quote-rule.ts')
const { processActivity } = await load(base + 'chat/client/conversation-nodes/process-activity.ts')
const withoutPosition = node => JSON.parse(JSON.stringify(node, (key, value) => key === 'position' ? undefined : value))

for (const source of ['**“A”****“B”**', '**研究对象:**DeepSeek', '＊＊加粗＊＊', '*＊加粗**', '**注意…**Next', '**第1章—**Introduction']) {
  test(`CommonMark boundary remains intentional: ${source}`, () => {
    assert.deepEqual(withoutPosition(parseGfm(source)), withoutPosition(fromMarkdown(source)))
    assert.deepEqual(withoutPosition(parseGfmWithMath(source)), withoutPosition(parseGfm(source)))
  })
}
test('existing CJK punctuation extension works in both grammars', () => {
  for (const parse of [parseGfm, parseGfmWithMath]) assert.equal(parse('**研究对象：**DeepSeek').children[0].children[0].type, 'strong')
})
test('CRLF and LF content have no spurious diff', () => {
  assert.deepEqual(diffTotals([{path: 'a', oldText: 'a\r\nb\r\n', newText: 'a\nb\n'}]), {added: 0, removed: 0})
  assert.deepEqual(diffTotals([{path: 'a', oldText: 'a\r\nb\r\n', newText: 'a\nc\n'}]), {added: 1, removed: 1})
})
test('quote separators retain original offsets and CRLF text', () => {
  for (const newline of ['\n', '\r\n']) {
    const text = `before${newline}${newline}> quote${newline}${newline}after`
    const first = quoteRule.match(text, 0)
    assert.equal(first.id, 'text')
    assert.equal(first.data.text, newline + newline)
    assert.equal(first.start, 6)
    const quote = quoteRule.match(text, first.end)
    assert.equal(quote.id, 'quote')
    assert.equal(quote.data.text, 'quote')
    assert.equal(quoteRule.match(text, quote.end).data.display, ' ')
  }
})
function reasoning(text) {
  return processActivity([{kind: 'assistant-step', data: {status: 'running', blocks: [{kind: 'reasoning', text}]}}]).runningDetail
}
test('reasoning detail removes strong markup but preserves globs and inline code', () => {
  assert.equal(reasoning('**Searching** src/**/*.ts and `a ** b`'), 'Searching src/**/*.ts and `a ** b`')
  assert.equal(reasoning('Use ** and a\\*\\*b'), 'Use ** and a\\*\\*b')
  assert.equal(reasoning('**检查：**目录'), '检查：目录')
})


test('copy confirmation clears its timer on unmount and ignores late clipboard completion', async () => {
  const { JSDOM } = await import('jsdom')
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://example.test/'})
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement']) Object.defineProperty(globalThis, key, {configurable: true, value: dom.window[key]})
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { CodeBlock } = await load(base + 'primitives/markdown/CodeBlock.tsx')
  let finish
  Object.defineProperty(dom.window.navigator, 'clipboard', {value: {writeText: () => new Promise(resolve => { finish = resolve })}})
  const timers = new Set()
  dom.window.setTimeout = callback => { timers.add(callback); return callback }
  dom.window.clearTimeout = callback => timers.delete(callback)
  try {
    for (const late of [false, true]) {
      const root = createRoot(document.getElementById('root'))
      await React.act(async () => root.render(React.createElement(CodeBlock, {code: 'hello', copyLabel: 'Copy', copiedLabel: 'Copied'})))
      await React.act(async () => document.querySelector('button').click())
      if (!late) {
        await React.act(async () => finish())
        assert.equal(timers.size, 1)
        assert.equal(document.querySelector('button').textContent, 'Copied')
      }
      await React.act(async () => root.unmount())
      if (late) await React.act(async () => finish())
      assert.equal(timers.size, 0)
    }
  } finally {
    dom.window.close()
    for (const key of ['window', 'document', 'navigator', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]
    }
  }
})



test('reasoning preserves multiple glob paths and word-internal exponent stars', () => {
  for (const text of ['Search src/**/a.ts and test/**/b.ts', 'Search src/**/*.ts and test/**/*.js', 'Compute 2**3**2 and a**b**c', 'Use `src/**/a.ts` and `test/**/b.ts`']) assert.equal(reasoning(text), text)
  assert.equal(reasoning('**Search** src/**/a.ts and test/**/b.ts'), 'Search src/**/a.ts and test/**/b.ts')
  assert.equal(reasoning('**outer __inner__ outer**'), 'outer inner outer')
})
test('long streamed reasoning keeps a bounded preview', t => {
  for (const size of [1000, 10000, 50000]) {
    const text = '**word** '.repeat(Math.ceil(size / 9)).slice(0,size)
    const samples = []
    let preview
    for (let iteration=0; iteration<5; iteration++) {
      const start=performance.now(); preview=reasoning(text); samples.push(performance.now()-start)
    }
    assert.ok([...preview].length <= 160)
    assert.ok(preview.endsWith('…'))
    t.diagnostic(`${size} chars: median ${samples.sort((a,b)=>a-b)[2].toFixed(3)}ms`)
  }
})

test('status parsing happens after truncation and keeps oversized grapheme clusters literal', () => {
  const longBold = '**' + 'x'.repeat(10000) + '**'
  const preview = reasoning(longBold)
  assert.ok(preview.startsWith('**'), 'a closing marker outside the preview must not affect parsing')
  assert.equal(preview.length, 160)
  assert.ok(preview.endsWith('…'))
  const cluster = '**a' + '\u0301'.repeat(2000) + '**'
  assert.equal(reasoning(cluster), cluster)
})
