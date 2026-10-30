import { describe, expect, test } from 'vitest'
import { parseGfm, parseGfmWithMath } from '../../packages/modern-ui/src/vendor/primitives/markdown/parse.ts'
import { grammarForHint, highlightLines, highlightToHtml, supportsHighlighting } from '../../packages/modern-ui/src/vendor/primitives/markdown/highlight.ts'
import { headTailCap } from '../../packages/modern-ui/src/vendor/primitives/head-tail-cap.ts'
import { fileSizeText } from '../../packages/modern-ui/src/vendor/primitives/file-size.ts'
import { rankByName } from '../../packages/modern-ui/src/vendor/primitives/rank-by-name.ts'
import { relativeTime } from '../../packages/modern-ui/src/vendor/primitives/relative-time.ts'

const types = (text: string, parse = parseGfm): string[] => parse(text).children.map(node => node.type)

describe('markdown grammars', () => {
  test('the streaming arm keeps a $$ block as a paragraph; the settled arm makes it math', () => {
    const source = '$$\nx^2\n$$'
    expect(types(source)).toEqual(['paragraph'])
    expect(types(source, parseGfmWithMath)).toEqual(['math'])
  })

  test('both arms parse GFM tables and task lists', () => {
    const source = '| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done'
    expect(types(source)).toEqual(['table', 'list'])
    expect(types(source, parseGfmWithMath)).toEqual(['table', 'list'])
  })

  test('a single tilde stays literal, as in ranges', () => {
    const paragraph = parseGfm('10~20 and ~~gone~~').children[0]
    expect(JSON.stringify(paragraph)).not.toContain('"delete","children":[{"type":"text","value":"20')
    expect(JSON.stringify(paragraph)).toContain('"type":"delete"')
  })

  test('a lone dollar amount is not text math in the settled arm', () => {
    expect(JSON.stringify(parseGfmWithMath('价格 $115.36亿，**同比** 增长 $3'))).not.toContain('inlineMath')
    expect(JSON.stringify(parseGfmWithMath('Euler: $e^{i\\pi}+1=0$'))).toContain('inlineMath')
  })

  test('CJK-adjacent strong markers still emphasize', () => {
    expect(JSON.stringify(parseGfm('这是**“重点”**内容'))).toContain('"type":"strong"')
  })
})

describe('syntax highlighting', () => {
  test('resolves aliases case-insensitively and rejects unknown hints', () => {
    expect(grammarForHint('TS')).toBe(grammarForHint('typescript'))
    expect(grammarForHint(undefined)).toBeUndefined()
    expect(supportsHighlighting('definitely-not-a-language')).toBe(false)
    expect(supportsHighlighting('json')).toBe(true)
  })

  test('highlights eagerly bundled grammars to css-variable HTML', () => {
    const html = highlightToHtml('const a = 1', 'ts')
    expect(html).toContain('<pre')
    expect(html).toContain('--shiki-')
    expect(highlightToHtml('x', 'definitely-not-a-language')).toBeUndefined()
  })

  test('returns one run list per source line without the trailing terminator line', () => {
    const lines = highlightLines('{"a": 1}\n[2]\n', 'json')
    expect(lines).toHaveLength(2)
    expect(lines?.[0]?.map(span => span.text).join('')).toBe('{"a": 1}')
    expect(lines?.[1]?.every(span => typeof span.style.color === 'string')).toBe(true)
  })
})

describe('small display helpers', () => {
  test('headTailCap splits the visible budget and caps only when collapsed', () => {
    expect(headTailCap(100, 9, false)).toEqual({ hidden: 91, capped: true, headLines: 5, tailLines: 4 })
    expect(headTailCap(100, 9, true).capped).toBe(false)
    expect(headTailCap(5, 9, false).capped).toBe(false)
  })

  test.each([
    [0, '0B'], [1023, '1023B'], [1024, '1.0KB'], [10 * 1024, '10KB'], [1536 * 1024, '1.5MB'], [20 * 1024 ** 3, '20GB'],
  ])('fileSizeText(%d) is %s', (bytes, text) => {
    expect(fileSizeText(bytes)).toBe(text)
  })

  test('relativeTime picks the largest whole unit and clamps future times to now', () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now + 5000, now)).toEqual({ unit: 'now', n: 0 })
    expect(relativeTime(now - 125_000, now)).toEqual({ unit: 'minutes', n: 2 })
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 })
    expect(relativeTime(now - 45 * 86_400_000, now)).toEqual({ unit: 'months', n: 1 })
    expect(relativeTime(now - 800 * 86_400_000, now)).toEqual({ unit: 'years', n: 2 })
  })

  test('rankByName puts prefix matches first, then word-boundary alignments, then input order', () => {
    const items = [{ name: 'my-plan' }, { name: 'plan-mode' }, { name: 'p-l-a-n' }, { name: 'other' }, { name: 'planner' }]
    expect(rankByName(items, 'plan').map(item => item.name)).toEqual(['plan-mode', 'planner', 'p-l-a-n', 'my-plan'])
    expect(rankByName(items, '')).toBe(items)
  })

  test('rankByName also matches the label', () => {
    expect(rankByName([{ name: 'x1', label: 'Settings' }, { name: 'set' }], 'SET').map(item => item.name)).toEqual(['x1', 'set'])
  })
})
