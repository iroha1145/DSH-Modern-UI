import { describe, expect, it } from 'vitest'
import { completeSvgPath } from '../../packages/modern-ui/src/svg-path'

describe('completeSvgPath', () => {
  it.each([
    '',
    ' \t\r\n',
    'M0 0',
    'm.5-.6 1 2 3 4z',
    'M1e-2+3E+1L.5.6 1.2 2.3',
    'M0,0L3,4,6,8 H9 10 V11 12 h-1 v+2zM2 3l4 5Z',
    'M0 0C1 2 3 4 5 6 7 8 9 10 11 12s1 2 3 4Q1 2 3 4t5 6',
    'M0 0A5 6 30 0110 20 5 6 30 10-5-.6z',
    'M0 0a-5 +6 -30 01.5.6',
    'M0 0A0 0 0 0,0 3 4ZzL1 2',
    'M0 0H1e38h1e-999',
    'M0 0H3.4028234663852886e38',
    'M0 0H-3.4028234663852886e38',
  ])('preserves complete data verbatim: %s', value => {
    expect(completeSvgPath(value)).toBe(value)
  })

  it.each([
    ['M', undefined],
    ['M4', undefined],
    ['L3 4', undefined],
    ['Z', undefined],
    ['M,0 0', undefined],
    ['M0,,0', undefined],
    ['M0 0L3', 'M0 0'],
    ['M0 0L3 4.', 'M0 0'],
    ['M0 0L3. 4', 'M0 0'],
    ['M0 0L3 4 5', 'M0 0L3 4'],
    ['M0 0L3 4,', 'M0 0L3 4'],
    ['M0 0,L3 4', 'M0 0'],
    ['M0 0L3 4,,5 6', 'M0 0L3 4'],
    ['M0 0C1 2 3 4 5', 'M0 0'],
    ['M0 0Q1 2 3', 'M0 0'],
    ['M0 0L3 4 5 6e-', 'M0 0L3 4'],
    ['M0 0L3 4e+ L5 6', 'M0 0'],
    ['M0 0A5 5 0 01', 'M0 0'],
    ['M0 0A5 5 0 0210 20L3 4', 'M0 0'],
    ['M0 0A5 5 0 +1 0 3 4', 'M0 0'],
    ['M0 0A5 5 0.01 0 3 4', 'M0 0'],
    ['M0 0A5 5 0 01.5', 'M0 0'],
    ['M0 0L3 4Z5 6', 'M0 0L3 4Z'],
    ['M0 0L3 4M5', 'M0 0L3 4'],
    ['M0 0L3 4H1e999', 'M0 0L3 4'],
    ['M0 0L3 4H1e39', 'M0 0L3 4'],
    ['M0 0L3 4H3.40282356e38', 'M0 0L3 4'],
    ['M0 0L3 4H-3.40282356e38', 'M0 0L3 4'],
    ['M0 0L3 4H3.402823466385289e38', 'M0 0L3 4'],
    ['M0 0L3 4H-3.402823466385289e38', 'M0 0L3 4'],
    ['M0 0\vL3 4', 'M0 0'],
    ['M0 0\u00a0L3 4', 'M0 0'],
  ])('stops at the first incomplete or invalid segment: %s', (value, expected) => {
    expect(completeSvgPath(value)).toBe(expected)
  })

  it('retains the original whole-input character and strict length boundaries', () => {
    for (const value of [null, 3, {}, 'M0 0<script>', 'M0 0R3 4', 'M0 0NaN', 'M0 0Infinity', 'M0 0;L3 4']) {
      expect(completeSvgPath(value)).toBeUndefined()
    }
    const maximal = `M0 0${' '.repeat(19995)}`
    expect(maximal).toHaveLength(19999)
    expect(completeSvgPath(maximal)).toBe(maximal)
    expect(completeSvgPath(`${maximal} `)).toBeUndefined()
    const manySegments = `M0 0${'l1 1'.repeat(4998)}`
    expect(completeSvgPath(manySegments)).toBe(manySegments)
    expect(completeSvgPath(`${manySegments}L`)).toBe(manySegments)
  })
})
