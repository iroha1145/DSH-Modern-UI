import { describe, expect, it } from 'vitest'
import { barWeights, contextReading, formatShare } from '../../packages/modern-ui/src/context-details.ts'

describe('context window panel', () => {
  const breakdown = { systemTokens: 4_600, toolsTokens: 44_000, messageTokens: 32_600 }

  it('lists the host categories, then the free space left in the window', () => {
    const reading = contextReading({ window: 200_000, used: 92_000, breakdown })
    expect(reading.slices).toEqual([
      { key: 'system', tokens: 4_600 },
      { key: 'tools', tokens: 44_000 },
      { key: 'messages', tokens: 32_600 },
      { key: 'free', tokens: 108_000 },
    ])
  })

  it('drops empty rows and keeps only free space without a breakdown', () => {
    expect(contextReading({ window: 1_000, used: 0, breakdown: { systemTokens: 0, toolsTokens: 0, messageTokens: 0 } }).slices).toEqual([
      { key: 'free', tokens: 1_000 },
    ])
    expect(contextReading({ window: 1_000, used: 400 }).slices).toEqual([{ key: 'free', tokens: 600 }])
  })

  it('never reports negative free space when occupancy passes the window', () => {
    const reading = contextReading({ window: 1_000, used: 1_500, breakdown })
    expect(reading.used).toBe(1_000)
    expect(reading.slices.find(slice => slice.key === 'free')).toBeUndefined()
  })

  it('scales the bar so the colored part matches the ring reading exactly', () => {
    const bar = barWeights(contextReading({ window: 200_000, used: 92_000, breakdown }))
    const filled = bar.segments.reduce((total, segment) => total + segment.tokens, 0)
    expect(filled).toBeCloseTo(92_000, 6)
    expect(bar.free).toBe(108_000)
    expect(bar.segments.map(segment => segment.key)).toEqual(['system', 'tools', 'messages'])
  })

  it('draws one neutral segment without a breakdown and none at zero occupancy', () => {
    expect(barWeights(contextReading({ window: 1_000, used: 250 })).segments).toEqual([{ key: 'total', tokens: 250 }])
    expect(barWeights(contextReading({ window: 1_000, used: 0, breakdown })).segments).toEqual([])
  })

  it('formats a share of the window at one decimal place', () => {
    expect(formatShare(4_800, 200_000)).toBe('2.4%')
    expect(formatShare(0, 200_000)).toBe('0.0%')
    expect(formatShare(10, 0)).toBe('0.0%')
  })
})
