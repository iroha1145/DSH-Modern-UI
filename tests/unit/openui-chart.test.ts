import { describe, expect, test } from 'vitest'
import { bar, curve, makeFormat, stepDigits } from '../../packages/modern-ui/src/vendor/openui/components/chart-math.ts'

describe('chart number formats', () => {
  test('small non-zero values never read as 0, on ticks or in tooltips', () => {
    const number = makeFormat('number', undefined)
    const digits = stepDigits(0.0005)
    expect([0, 0.0005, 0.001, 0.0015].map(tick => number(tick, true, digits))).toEqual(['0', '0.0005', '0.001', '0.0015'])
    expect(number(0.001)).toBe('0.001')
    expect(number(0.0012345)).toBe('0.00123')
    expect(makeFormat('percent', undefined)(0.05)).toBe('0.05%')
    expect(makeFormat('currency', 'usd')(0.001)).toBe('$0.001')
  })

  test('larger values keep their existing shapes', () => {
    const number = makeFormat('number', undefined)
    expect(number(1234.567)).toBe('1,234.57')
    expect(number(2500, true, stepDigits(2500))).toBe('2.5K')
    expect(number(2.5, true, stepDigits(2.5))).toBe('2.5')
    expect(makeFormat('currency', 'EUR')(1_240_000_000)).toBe('€1.24B')
    expect(number(0)).toBe('0')
  })

  test('tick precision follows the step', () => {
    expect([1000, 5, 2.5, 0.25, 0.0005].map(stepDigits)).toEqual([0, 0, 1, 2, 4])
  })
})

describe('chart geometry', () => {
  const ys = (path: string) => [...path.matchAll(/[\d.]+,([\d.]+)/g)].map(match => Number(match[1]))

  test('a line through three or more points is a smooth curve that does not overshoot', () => {
    const path = curve([
      [0, 0],
      [10, 10],
      [20, 10],
      [30, 30],
    ])
    expect(path.startsWith('M0.0,0.0C')).toBe(true)
    expect(path.endsWith('30.0,30.0')).toBe(true)
    expect(path.match(/C/g)).toHaveLength(3)
    // The flat middle stretch stays flat: its control points sit at y = 10.
    expect(ys(path.split('C')[2])).toEqual([10, 10, 10])
    expect(Math.min(...ys(path))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys(path))).toBeLessThanOrEqual(30)
  })

  test('two points stay a straight segment', () => {
    expect(
      curve([
        [0, 5],
        [10, 15],
      ]),
    ).toBe('M0.0,5.0L10.0,15.0')
  })

  test('bars round only the corners away from the baseline, never more than they can hold', () => {
    expect(bar(0, 10, 40, 90, true)).toBe('M0,100V18A8,8 0 0 1 8,10H32A8,8 0 0 1 40,18V100Z')
    expect(bar(0, 0, 40, 90, false)).toBe('M0,0V82A8,8 0 0 0 8,90H32A8,8 0 0 0 40,82V0Z')
    expect(bar(0, 97, 40, 3, true)).toContain('A3,3')
    expect(bar(0, 100, 40, 0, true)).toBe('M0,100H40V100H0Z')
  })
})
