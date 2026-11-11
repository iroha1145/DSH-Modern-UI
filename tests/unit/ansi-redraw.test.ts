import { expect, test } from 'vitest'
import { parseAnsiLines } from '../../packages/modern-ui/src/vendor/primitives/ansi.ts'

const text = (source: string): string =>
  parseAnsiLines(source)
    .map(line => line.map(span => span.text).join(''))
    .join('\n')

test.each([
  ['界\u0301X', '界\u0301X'],
  ['界X\rA', 'A X'],
  ['界\u0301X\rA', 'A X'],
  ['😀\uFE0FX\rA', 'A X'],
  ['界\u0301X\bZ', '界\u0301Z'],
  ['界\u0301\bA', ' A'],
  ['界\u0301X\r\u001b[Kdone', 'done'],
  ['e\u0301X\rA', 'AX'],
])('terminal redraw preserves columns: %j', (source, expected) => {
  expect(text(source)).toBe(expected)
})

test('combining marks retain their lead cell color across a later SGR change', () => {
  const line = parseAnsiLines('\u001b[31m界\u001b[32m\u0301X\bZ')[0]
  expect(line.map(span => span.text).join('')).toBe('界\u0301Z')
  expect(line[0].text).toBe('界\u0301')
  expect(line[0].style?.color).toBe('var(--dsw-alias-state-error-primary)')
  expect(line.at(-1)?.style?.color).toBe('var(--dsw-alias-state-success-primary)')
})
