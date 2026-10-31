// The OpenUI block with the real @openuidev/react-lang Renderer and the vendored component library in jsdom:
// streaming lifecycle, what a @ToAssistant click proposes, state across the fence closing, partial and
// oversized programs, and the data components whose numbers must stay exact.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'SVGElement',
  'MutationObserver',
  'Event',
  'getComputedStyle',
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
  })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = id => clearTimeout(id)
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback
  }
  observe() {
    this.callback([])
  }
  disconnect() {}
}
// Charts measure their container; jsdom lays nothing out.
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 600
  },
})
let fetches = []
globalThis.fetch = async url => {
  fetches.push(String(url))
  return { ok: true, status: 200, json: async () => ({}) }
}

const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React

const source = path.join(repo, 'packages/modern-ui/src')
const result = await build({
  absWorkingDir: repo,
  tsconfigRaw: {},
  stdin: {
    contents: "export { OpenUIBlock } from './vendor/intelligent/client/OpenUIBlock.tsx'; export { numberText } from './vendor/openui/components/table.tsx'",
    resolveDir: source,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'test-resources',
      setup(builder) {
        builder.onResolve({ filter: /@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'stub' }))
        builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'style' }))
        builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents:
            "const React = require('react'); export const CodeBlock = ({code}) => React.createElement('pre', {'data-source': true}, code); export const TextShimmer = ({children}) => React.createElement('span', null, children)",
          loader: 'js',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'style' }, args => ({
          contents: args.path.endsWith('.module.css') ? 'export default new Proxy({}, { get: (_, key) => key })' : '',
          loader: 'js',
        }))
      },
    },
  ],
})
const loaded = new Module(path.join(source, 'openui-block.test.cjs'))
loaded.paths = Module._nodeModulePaths(repo)
loaded._compile(result.outputFiles[0].text, loaded.id)
const { OpenUIBlock, numberText } = loaded.exports

/** Mount one block with a recording composer; `update` re-renders it with new stream state. */
async function mount(code, { streaming = false, closed = true, composer = '' } = {}) {
  const calls = { setDraft: [], submit: 0, insertText: [] }
  const input = { phase: 'plain', draft: composer, attachmentIds: [] }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const props = state => ({
    code: state.code,
    lang: 'openui-lang',
    streaming: state.streaming,
    closed: state.closed,
    settled: !state.streaming,
    labels: {},
    matched: {},
    t: key => key,
    useTheme: select => select({ active: { colorScheme: 'light' } }),
    useInput: select => select(input),
    useSession: select => select({ removed: false, subagent: null }),
    useAccess: () => true,
    inputActions: {
      setDraft: text => calls.setDraft.push(text),
      submit: () => {
        calls.submit += 1
      },
      insertText: text => {
        calls.insertText.push(text)
        return true
      },
      captureInsertion: () => ({}),
    },
  })
  const update = async next => {
    await act(async () => {
      root.render(React.createElement(OpenUIBlock, props(next)))
    })
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
  await update({ code, streaming, closed })
  const block = () => host.querySelector('[data-openui-block]')
  return { host, calls, update, block, unmount: () => act(() => root.unmount()) }
}

const click = async element =>
  act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
const button = (host, label) => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === label)

/** Type into a controlled input the way React observes it. */
async function type(element, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set
  await act(async () => {
    setter.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('a complete program that arrives with the closing fence renders instead of falling back to source', async () => {
  const view = await mount('root =', { streaming: true, closed: false })
  assert.equal(view.block().dataset.state, 'streaming')
  await view.update({ code: 'root = Col([Text("FINAL VALID")])', streaming: true, closed: true })
  assert.equal(view.block().dataset.state, 'complete')
  assert.match(view.host.textContent, /FINAL VALID/)
  assert.equal(view.host.querySelector('[data-source]'), null)
  await view.unmount()
})

test('a Form button proposes the shown defaults of its fields without sending', async () => {
  const view = await mount(
    'root = Form([Input("Alice", "Name"), Select("Postgres", ["Postgres", "SQLite"], "DB"), Button("Submit", @ToAssistant("Build plan"))])',
  )
  await click(button(view.host, 'Submit'))
  assert.deepEqual(view.calls.setDraft, ['Build plan\n\n- Name: Alice\n- DB: Postgres'])
  assert.equal(view.calls.submit, 0)
  await view.unmount()
})

test('literal and bound fields of one Form both reach the proposal after an edit', async () => {
  const code = '$db = "Postgres"\nroot = Form([Input("Alpha", "Project"), Select($db, ["Postgres", "SQLite"], "DB"), Button("Go", @ToAssistant("Plan it"))])'
  const view = await mount(code)
  await click(button(view.host, 'Go'))
  await type(view.host.querySelector('input'), 'Beta')
  await click(button(view.host, 'Go'))
  assert.deepEqual(view.calls.setDraft, ['Plan it\n\n- Project: Alpha\n- DB: Postgres', 'Plan it\n\n- Project: Beta\n- DB: Postgres'])
  await view.unmount()
})

test('a value the reader set while the fence streamed survives the fence closing', async () => {
  const code = '$n = 5\nroot = Col([Slider($n, 0, 100, 1, "N"), Text("value " + $n)])'
  const view = await mount(code, { streaming: true, closed: false })
  await type(view.host.querySelector('input[type="range"]'), '100')
  assert.match(view.host.textContent, /value 100/)
  await view.update({ code, streaming: true, closed: true })
  assert.match(view.host.textContent, /value 100/)
  assert.equal(view.host.querySelector('input[type="range"]').value, '100')
  await view.unmount()
})

test('an unresolved reference or an unterminated string marks a finished block as partial', async () => {
  const missing = await mount('root = Col([Text("Visible"), missing])')
  assert.equal(missing.block().dataset.state, 'partial')
  assert.match(missing.host.textContent, /Visible/)
  await missing.unmount()
  const unterminated = await mount('root = Col([Text("Visible"), Text("cut)])')
  assert.equal(unterminated.block().dataset.state, 'partial')
  await unterminated.unmount()
})

test('a fence the answer never closed keeps its source once the answer ends', async () => {
  const view = await mount('<div>never closed', { streaming: false, closed: false })
  assert.equal(view.block().dataset.state, 'incomplete')
  assert.ok(view.host.querySelector('[data-source]'))
  await view.unmount()
})

test('nested loops past the expansion budget are never evaluated', async () => {
  const view = await mount('root = Col([grid])\ngrid = Col(@Each(@Range(0, 1000), "i", row))\nrow = Row(@Each(@Range(0, 1000), "j", Text("x")))')
  assert.equal(view.block().dataset.state, 'tooLarge')
  assert.equal(view.host.querySelector('.iui-root'), null)
  await view.unmount()
})

test('an Image whose address fails shows a placeholder and never searches with its alt text', async () => {
  fetches = []
  const view = await mount('root = Col([Image("https://example.invalid/private.png", "INTERNAL_TEST_caption")])')
  await act(async () => {
    view.host.querySelector('img').dispatchEvent(new dom.window.Event('error'))
  })
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 700))
  })
  assert.deepEqual(fetches, [])
  await view.unmount()
  const search = await mount('root = Col([SearchImage("Golden Gate Bridge")])')
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 700))
  })
  assert.ok(fetches.length > 0 && fetches.every(url => /^https:\/\/(\w+\.wikipedia\.org|commons\.wikimedia\.org)\//.test(url)))
  await search.unmount()
})

test('tables keep small numbers visible', () => {
  assert.deepEqual([0.001, 0.0004, 1.234567, 12000, -0.000012345].map(numberText), ['0.001', '0.0004', '1.2346', '12,000', '-1.23e-5'])
})

test('a stacked chart draws negative values below zero instead of flattening them', async () => {
  const view = await mount('root = Col([Chart("bar", [{k: "Q1", gain: 100, loss: -40}], "k", ["gain", "loss"], "number", null, true)])')
  // The outer segment is a path with rounded corners; its height is the span of the y coordinates it visits.
  const extent = shape => {
    if (shape.tagName === 'rect') return Number(shape.getAttribute('height'))
    const ys = [...shape.getAttribute('d').matchAll(/M[-\d.]+,([-\d.]+)|V([-\d.]+)|A(?:[-\d.]+[ ,]){6}([-\d.]+)/g)].map(match =>
      Number(match[1] ?? match[2] ?? match[3]),
    )
    return Math.max(...ys) - Math.min(...ys)
  }
  const heights = [...view.host.querySelectorAll('rect[fill], path[fill]')]
    .filter(shape => shape.getAttribute('fill').startsWith('var(--iui-chart'))
    .map(extent)
  assert.equal(heights.length, 2)
  assert.ok(
    heights.every(height => height > 0),
    `segment heights ${heights}`,
  )
  assert.ok(Math.abs(heights[0] / heights[1] - 2.5) < 0.05, `gain/loss ratio ${heights}`)
  await view.unmount()
})

test('an HtmlView frame allows the data: images its inner policy promises', async () => {
  const view = await mount('root = Col([HtmlView("<img src=\'data:image/gif;base64,R0lGODlhAQABAAAAACw=\'>", 80)])')
  const outer = view.host.querySelector('iframe').getAttribute('srcdoc')
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(outer)[1]
  assert.match(policy, /img-src data: blob:/)
  assert.match(policy, /default-src 'none'/)
  assert.match(policy, /frame-src 'none'/)
  await view.unmount()
})
