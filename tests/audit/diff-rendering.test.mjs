import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, relative, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const repo = resolve(import.meta.dirname, '../..')
const bundle = await build({
  absWorkingDir: repo,
  tsconfigRaw: {},
  stdin: {
    resolveDir: resolve(repo, 'packages/modern-ui/src'),
    loader: 'tsx',
    contents: `export {DiffBlock,diffTotals} from './vendor/primitives/DiffBlock.tsx'; export {FileMutationRow} from './vendor/tool/client/tool/toolviews/file-mutation-row.tsx';`,
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'measure-diff-work',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'icons', namespace: 'stub' }))
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const IconEditOutlineRegular=()=>null', loader: 'js' }))
        builder.onLoad({ filter: /ToolRow\.tsx$/ }, () => ({
          contents: `export function ToolRow(props){ globalThis.__diffRows.push(props); return null }`,
          loader: 'js',
        }))
        builder.onLoad({ filter: /Tooltip\.tsx$/ }, () => ({ contents: 'export const Tooltip=({children})=>children', loader: 'js' }))
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,key)=>key})', loader: 'js' }))
        builder.onLoad({ filter: /(?:DiffBlock|file-mutation-row)\.tsx$/ }, async args => {
          let contents = process.env.DIFF_RENDER_BASELINE_REF
            ? execFileSync('git', ['show', process.env.DIFF_RENDER_BASELINE_REF + ':' + relative(repo, args.path).replaceAll('\\', '/')], {
                cwd: repo,
                encoding: 'utf8',
              })
            : await readFile(args.path, 'utf8')
          contents = contents
            .replace('return structuredPatch(', 'return (globalThis.__diffPatches++, structuredPatch(')
            .replace('const hunks = structuredPatch(', 'const hunks = (globalThis.__diffPatches++, structuredPatch(')
            .replace('maxEditLength: MAX_DIFF_EDIT_LENGTH })?.hunks', 'maxEditLength: MAX_DIFF_EDIT_LENGTH }))?.hunks')
          return { contents, loader: 'tsx', resolveDir: dirname(args.path) }
        })
      },
    },
  ],
})
const file = resolve(import.meta.dirname, `.diff-rendering-${process.pid}.mjs`)
await writeFile(file, bundle.outputFiles[0].text)
const { DiffBlock, diffTotals, FileMutationRow } = await import(pathToFileURL(file).href)
await rm(file)
const dom = new JSDOM('<body></body>')
const keys = ['window', 'document', 'Node', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__diffPatches', '__diffRows']
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
function view() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  return {
    container,
    render(element) {
      act(() => root.render(element))
    },
    close() {
      act(() => root.unmount())
      container.remove()
    },
  }
}
const labels = {
  copy: 'Copy',
  copied: 'Copied',
  collapse: 'Collapse',
  expand: n => `Show ${n}`,
  collapseAria: 'Collapse',
  expandAria: n => `Show ${n}`,
  title: 'Code',
  wrap: 'Wrap',
  unwrap: 'Unwrap',
}

test('visible diff totals and expanded rows share one patch calculation and invalidate changed content', () => {
  const diff = { path: 'a.ts', oldText: 'before\r\ncontext\r\n', newText: 'after\ncontext\n' }
  const diffs = [diff]
  const current = view()
  globalThis.__diffPatches = 0
  try {
    assert.deepEqual(diffTotals(diffs), { added: 1, removed: 1 })
    current.render(createElement(DiffBlock, { diffs, labels }))
    assert.equal(current.container.querySelectorAll('.add').length, 1)
    assert.equal(current.container.querySelectorAll('.del').length, 1)
    assert.equal(globalThis.__diffPatches, 1, 'summary and expanded body compute the patch once')
    for (let i = 0; i < 10; i++) current.render(createElement(DiffBlock, { diffs, labels, className: String(i) }))
    assert.equal(globalThis.__diffPatches, 1)
    diff.newText = 'next\nextra\ncontext\n'
    assert.deepEqual(diffTotals([diff]), { added: 2, removed: 1 })
    current.render(createElement(DiffBlock, { diffs: [diff], labels }))
    assert.equal(globalThis.__diffPatches, 2)
    assert.equal(current.container.querySelectorAll('.add').length, 2)
    assert.match(current.container.textContent, /extra/)
  } finally {
    current.close()
  }
})

test('parent rerenders retain a frozen file mutation model and a new block refreshes it', () => {
  const current = view()
  globalThis.__diffRows = []
  const block = {
    name: 'edit',
    phase: 'start',
    callId: 'a',
    argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'before', new_string: 'after' }),
    args: { has: () => false, complete: () => false, text: () => undefined },
  }
  const props = { toolName: 'edit', block, t: key => key }
  try {
    current.render(createElement(FileMutationRow, props))
    const first = globalThis.__diffRows.at(-1).diff
    for (let i = 0; i < 10; i++) {
      current.render(createElement(FileMutationRow, { ...props, cwd: `/workspace/${i}` }))
      assert.equal(globalThis.__diffRows.at(-1).diff, first)
    }
    current.render(
      createElement(FileMutationRow, {
        ...props,
        block: { ...block, argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'before', new_string: 'next' }) },
      }),
    )
    assert.notEqual(globalThis.__diffRows.at(-1).diff, first)
    assert.equal(globalThis.__diffRows.at(-1).diff.card.diffs[0].newText, 'next')
  } finally {
    current.close()
  }
})
