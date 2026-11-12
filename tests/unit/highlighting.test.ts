import { beforeAll, expect, test } from 'vitest'
import { splitLines } from 'shiki/core'
import {
  StreamingHighlightSession,
  highlightLines,
  highlightLinesAsync,
  highlightToHtml,
} from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight-tokenizer.ts'

import { withinHighlightBudget } from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight-language.ts'
import { registerGrammar } from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight-engine.ts'
import typescript from '@shikijs/langs/typescript'
import json from '@shikijs/langs/json'
beforeAll(() => {
  registerGrammar(typescript, 'typescript')
  registerGrammar(json, 'json')
})

test('native line splitting preserves Shiki CR, LF, CRLF and terminal-line budget semantics', async () => {
  for (const code of ['', 'a', 'a\n', 'a\r', 'a\r\n', 'a\rb\nc\r\nd', '\n\n', '\r\n\r\n']) {
    expect(code.split(/\r?\n/)).toEqual(splitLines(code).map(([line]) => line))
    expect(withinHighlightBudget(code)).toBe(true)
    const lines = await highlightLinesAsync(code, 'json', new AbortController().signal)
    expect(lines?.map(line => line.map(span => span.text).join('')).join('\n')).toBe(
      splitLines(code)
        .map(([line]) => line)
        .join('\n'),
    )
  }
  expect(withinHighlightBudget('a\n'.repeat(80))).toBe(false)
  expect(withinHighlightBudget('a\r\n'.repeat(80))).toBe(false)
  expect(withinHighlightBudget('a\r'.repeat(80))).toBe(true)
})

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

test('worker grammar registration preserves aliases and does not change completed TypeScript output', async () => {
  const before = highlightToHtml('const answer=42', 'TS')
  const grammar = structuredClone((await import('@shikijs/langs/python')).default)
  registerGrammar(grammar, 'python')
  expect(highlightToHtml('print(42)', 'PY')).toContain('--shiki-')
  expect(highlightToHtml('const answer=42', 'ts')).toBe(before)
})

const lineText = (lines: readonly (readonly { text: string }[])[] | undefined) => lines?.map(line => line.map(span => span.text).join('')).join('\n')
const colored = (line: readonly { style: object }[] | undefined) => line?.some(span => Object.keys(span.style).length > 0) ?? false

test('a long line arriving mid-stream keeps the colored prefix and colors the following lines', async () => {
  const head = Array.from({ length: 30 }, (_, index) => `const value${index} = ${index}`)
  const long = `const sql = "${'select a, b from t where x = 1 and '.repeat(12)}"`
  const tail = Array.from({ length: 10 }, (_, index) => `const after${index} = ${index}`)
  const source = [...head, long, ...tail].join('\n')
  expect(long.length).toBeGreaterThan(400)
  const session = new StreamingHighlightSession()
  for (let end = 12; end < source.length + 12; end += 12) {
    const code = source.slice(0, end)
    const lines = session.update(code, 'ts')
    expect(lines, `plain fallback at ${end}`).toBeDefined()
    expect(lineText(lines)).toBe(code)
    if (code.length > head.join('\n').length + 1) expect(colored(lines?.[0])).toBe(true)
  }
  const final = session.update(source, 'ts')
  expect(final).toEqual(await highlightLinesAsync(source, 'ts', new AbortController().signal))
  expect(colored(final?.[head.length])).toBe(true)
  expect(colored(final?.[head.length + 3])).toBe(true)
})

test('a fence first highlighted when it is already long catches up frame by frame', async () => {
  const lines = Array.from({ length: 260 }, (_, index) => `const item${index} = compute(${index}, "label ${index}")`)
  const session = new StreamingHighlightSession()
  let code = lines.slice(0, 200).join('\n') + '\n'
  const first = session.updateFrame(code, 'ts')
  if (first === undefined) throw new Error('late start must not fall back to plain text')
  expect(first.settled).toBe(false)
  expect(first.appended.length).toBeGreaterThan(0)
  expect(first.appended.length).toBeLessThan(200)
  expect(first.tail.length).toBeGreaterThan(80)
  expect(colored(first.tail[0])).toBe(false)
  expect(colored(first.appended[0])).toBe(true)
  expect(lineText(session.update(code, 'ts'))).toBe(code)
  let frames = 1
  for (let index = 200; index < lines.length; index++) {
    code += `${lines[index]}\n`
    const frame = session.updateFrame(code, 'ts')
    frames += 1
    if (frame?.settled) break
  }
  expect(frames).toBeLessThan(8)
  expect(session.updateFrame(code, 'ts')?.settled).toBe(true)
  const settled = session.update(code, 'ts')
  expect(settled).toEqual(await highlightLinesAsync(code, 'ts', new AbortController().signal))
})
