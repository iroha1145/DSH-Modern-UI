import { expect, test } from 'vitest'
import {
  StreamingHighlightSession,
  highlightLines,
  highlightLinesAsync,
  highlightToHtml,
  isGrammarLoaded,
  subscribeGrammarLoaded,
} from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight.ts'

test('large completed source uses the plain synchronous fallback and retains all text asynchronously', async () => {
  const source = Array.from({ length: 20 }, (_, index) => `const text${index} = "${'a'.repeat(945)}"`).join('\n')
  expect(highlightToHtml(source, 'ts')).toBeUndefined()
  expect(highlightLines(source, 'ts')).toBeUndefined()
  const lines = await highlightLinesAsync(source, 'ts', new AbortController().signal)
  expect(lines?.map(line => line.map(span => span.text).join('')).join('\n')).toBe(source)
  expect(highlightToHtml('const small = 42', 'ts')).toContain('--shiki-')
})

test('async chunks preserve multiline grammar state and streamed prefix identity', async () => {
  const source = ['const text = `first', ...Array.from({ length: 95 }, (_, i) => `line ${i} with content`), 'last`', 'const number = 42'].join('\n')
  const session = new StreamingHighlightSession()
  let prefix = ''
  let firstLine: unknown
  for (const line of source.split('\n')) {
    prefix += `${line}\n`
    const lines = session.update(prefix, 'ts')
    firstLine ??= lines?.[0]
    expect(lines?.[0]).toBe(firstLine)
  }
  const asynchronous = await highlightLinesAsync(prefix, 'ts', new AbortController().signal)
  expect(asynchronous).toEqual(session.update(prefix, 'ts'))
})

test('cancelling a yielded job discards its partial result, including without scheduler.yield', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'scheduler')
  Object.defineProperty(globalThis, 'scheduler', { value: undefined, configurable: true })
  try {
    const controller = new AbortController()
    const result = highlightLinesAsync('const text = 42\n'.repeat(200), 'ts', controller.signal)
    setTimeout(() => controller.abort(), 0)
    expect(await result).toBeUndefined()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'scheduler', descriptor)
    else Reflect.deleteProperty(globalThis, 'scheduler')
  }
})

test('a slower line finishes its grammar state before coloring later lines', async () => {
  const source = `const value = "${'a'.repeat(450)}"; /*\ninside comment\n*/ const n = 1;`
  for (let run = 0; run < 3; run++) {
    const lines = await highlightLinesAsync(source, 'ts', new AbortController().signal)
    expect(lines?.[1]).toEqual([{ text: 'inside comment', style: { color: 'var(--shiki-token-comment)' } }])
  }
})

test('lazy grammar notifications follow normalized aliases and unsubscribe cleanly', async () => {
  let unrelated = 0
  let aliases = 0
  let disposed = 0
  const unwatchTs = subscribeGrammarLoaded('TS', () => unrelated++)
  const unwatchPy = subscribeGrammarLoaded('PY', () => aliases++)
  const unwatchDisposed = subscribeGrammarLoaded('python', () => disposed++)
  unwatchDisposed()
  try {
    expect(highlightToHtml('print(42)', 'py')).toBeUndefined()
    await expect.poll(() => isGrammarLoaded('python')).toBe(true)
    expect(aliases).toBe(1)
    expect(unrelated).toBe(0)
    expect(disposed).toBe(0)
    expect(highlightToHtml('print(42)', 'PY')).toContain('--shiki-')
  } finally {
    unwatchTs()
    unwatchPy()
  }
})
