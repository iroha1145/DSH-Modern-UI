// The Tool row a jev_presentation_advice call renders, through the real GenericToolCard and ToolRow with the
// composed `modern-tool` dictionary: its own title, the outcome from the result metadata, never the raw tool name
// or the confidence. Presentation primitives are stubbed to print their text props; layout is not checked here.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const source = path.join(repo, 'packages/modern-ui/src')
// Components the Tool row modules import from the primitives package.
const PRIMITIVES = [
  'CodeBlock',
  'DiffBlock',
  'DisclosureRow',
  'MarkdownText',
  'ReadBlock',
  'SearchBlock',
  'Tag',
  'TerminalBlock',
  'TextShimmer',
  'WebBlock',
].concat(
  [
    'AgentPreset',
    'Api',
    'Branch',
    'Browse',
    'Check',
    'Checklist',
    'ChevronDown',
    'ChevronRight',
    'ChevronUp',
    'Clock',
    'Code',
    'CordisPlugin',
    'Edit',
    'Globe',
    'Goal',
    'Inspect',
    'Play',
    'Question',
    'Search',
    'Users',
    'Wrench',
  ].map(name => `Icon${name}OutlineRegular`),
)
const result = await build({
  absWorkingDir: repo,
  tsconfigRaw: {},
  stdin: {
    contents:
      "export { GenericToolCard } from './vendor/tool/client/tool/toolviews/GenericToolCard.tsx'; export * as tool from './vendor/tool/client/dictionaries.ts'; export { jevToolLocale } from './jev-tool-card.ts'",
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
          // Every primitive prints the strings and elements it was given, so the row's visible text survives.
          contents: `const React = require('react')
const show = props => Object.values(props ?? {}).filter(value => typeof value === 'string' || React.isValidElement(value))
const component = props => React.createElement('span', null, ...show(props))
export const diffTotals = () => ({ added: 0, removed: 0 })
${PRIMITIVES.map(name => `export const ${name} = component`).join('\n')}`,
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
const loaded = new Module(path.join(source, 'jev-tool-card.test.cjs'))
loaded.paths = Module._nodeModulePaths(repo)
loaded._compile(result.outputFiles[0].text, loaded.id)
const { GenericToolCard, tool, jevToolLocale } = loaded.exports

const args = { text: () => undefined, complete: () => false }
const summary = 'Three sources compared on method, findings and limits.'
const call = { name: 'jev_presentation_advice', argsRaw: JSON.stringify({ content_summary: summary }) }

/** Render one row in a language, with the dictionary tool-owner.ts registers for `modern-tool`. */
function row(block, language = 'zh') {
  const dictionary = { ...tool[language], ...jevToolLocale[language] }
  const t = key => dictionary[key] ?? key
  const html = renderToStaticMarkup(
    React.createElement(GenericToolCard, {
      toolName: 'jev_presentation_advice',
      block,
      cwd: '/work',
      home: '/home/me',
      openFile: () => {},
      inspect: undefined,
      useDisclosure: () => ({ expanded: false, toggle: () => {} }),
      t,
    }),
  )
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
}

const settled = meta => ({
  kind: 'tool-result',
  seq: 9,
  time: 2,
  callId: 'call-1',
  name: 'jev_presentation_advice',
  args,
  call,
  callTime: 1,
  content: [{ type: 'text', text: 'You could consider a table (Table) for the parts that compare items.' }],
  isError: false,
  meta,
  subCalls: [],
})

test('a running call shows the Jev title and the structure summary, not the raw tool name', () => {
  const text = row({ phase: 'start', callId: 'call-1', name: 'jev_presentation_advice', args, argsRaw: call.argsRaw })
  assert.match(text, /请 Jev 参谋呈现方式/)
  assert.match(text, /Three sources compared on method, findings and limits\./)
  assert.doesNotMatch(text, /jev_presentation_advice|工具调用/)
})

test('a settled call leads with the outcome; the confidence is never shown', () => {
  const zh = row(settled({ status: 'suggestion', presentation: 'table', confidence: 0.8 }))
  assert.match(zh, /请 Jev 参谋呈现方式/)
  assert.match(zh, /可考虑：表格 · Three sources compared/)
  assert.doesNotMatch(zh, /jev_presentation_advice|0\.8/)
  assert.match(
    row(settled({ status: 'no_suggestion', presentation: 'text', confidence: 0.9 }), 'en'),
    /Ask Jev about presentation .*No additional suggestion · Three sources/,
  )
  assert.match(row(settled({ status: 'already_consulted' }), 'de'), /Jev zur Darstellung befragen .*In diesem Durchgang schon gefragt · /)
  // An older record without metadata keeps the summary alone.
  assert.match(row(settled(undefined), 'ja'), /Jev に表示方法を相談 .*Three sources compared/)
  assert.doesNotMatch(row(settled(undefined), 'ja'), /候補/)
})
