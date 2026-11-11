import { afterAll, describe, expect, test, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bg, fg, onColor, radius, space } from '../../packages/modern-ui/src/vendor/openui/components/style.ts'
import { G } from '../../packages/modern-ui/src/vendor/openui/components/svg.tsx'
import { axisFraction, domainTicks, niceDomain, stackAreas, valueDomain } from '../../packages/modern-ui/src/vendor/openui/components/chart-math.ts'

vi.stubGlobal('React', React)
afterAll(() => vi.unstubAllGlobals())

describe('model-authored style values', () => {
  test('spacing keeps the 4px scale and caps finite values before multiplication', () => {
    expect([0, 1, 3, 1000, 1e308, -1].map(space)).toEqual(['0px', '4px', '12px', '4000px', '4000px', '0px'])
    expect(space(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(space(Number.NaN)).toBeUndefined()
  })
  test('prototype keys never become CSS functions or transform argument arrays', () => {
    for (const key of ['constructor', 'toString', '__proto__']) {
      expect(typeof fg(key)).toBe('string')
      expect(typeof bg(key)).toBe('string')
      expect(radius(key)).toBeUndefined()
      expect(() =>
        renderToStaticMarkup(React.createElement(G.component, { props: { children: [], transform: `${key}(1)` }, renderNode: () => null })),
      ).not.toThrow()
    }
    expect(fg('ink')).toBe('var(--iui-ink)')
    expect(bg('success')).toBe('var(--iui-success-soft)')
    expect(bg('src("https://example.invalid/image")')).toBeUndefined()
    expect(bg('url("https://example.invalid/image")')).toBeUndefined()
    expect(bg('oklch(70% 0.12 140)')).toBe('oklch(70% 0.12 140)')
  })
  test('only opaque parsed colors replace the surrounding foreground', () => {
    for (const value of ['rgba(0,0,0,0.05)', 'rgb(0 0 0 / 90%)', 'rgba(255,255,255,.99)', '#0001', '#ffffff88']) expect(onColor(value)).toEqual({})
    expect(onColor('#000f').color).toBe('#ffffff')
    expect(onColor('#ffffffff').color).toBe('#0d0d0d')
    expect(onColor('rgba(0, 0, 0, 1)').color).toBe('#ffffff')
    expect(onColor('rgb(100% 100% 100% / 100%)').color).toBe('#0d0d0d')
    expect(onColor('rgb(0 0 0 / junk)')).toEqual({})
    for (const invalid of ['rgb(0 0 0 1)', 'rgba(0,0,0 / 1)', 'rgb(0%,0,0)']) expect(onColor(invalid)).toEqual({})
  })
})

describe('chart finite axes', () => {
  test('finite endpoints always have finite enclosing bounds, bounded ticks and monotone positions', () => {
    const values = [-Number.MAX_VALUE, -1e308, -1, -Number.MIN_VALUE, 0, Number.MIN_VALUE, 1e-320, 1, 1e308, Number.MAX_VALUE]
    for (const min of values)
      for (const max of values) {
        if (min > max) continue
        const domain = niceDomain(min, max)
        expect(Object.values(domain).every(Number.isFinite)).toBe(true)
        expect(domain.lo).toBeLessThanOrEqual(min)
        expect(domain.hi).toBeGreaterThanOrEqual(max)
        expect(domain.hi).toBeGreaterThan(domain.lo)
        const ticks = domainTicks(domain)
        expect(ticks.length).toBeGreaterThanOrEqual(2)
        expect(ticks.length).toBeLessThanOrEqual(14)
        expect(ticks.every(Number.isFinite)).toBe(true)
        expect(axisFraction(min, domain.lo, domain.hi)).toBeLessThanOrEqual(axisFraction(max, domain.lo, domain.hi))
      }
  })
  test('overflowing differences retain a centered zero, fixed-range expansion and stable held axes', () => {
    const domain = niceDomain(-1e308, 1e308)
    expect(axisFraction(0, domain.lo, domain.hi)).toBe(0.5)
    expect(valueDomain(-5e307, 5e307, domain)).toBe(domain)
    expect(valueDomain(0, 75, null, { min: 50, max: 100 }).lo).toBe(0)
    expect(valueDomain(50, 80, { lo: 60, hi: 100, step: 10 }).lo).toBeLessThanOrEqual(50)
    expect(domainTicks(niceDomain(-0.6, 0.6))).toContain(0)
  })
  test('a large sign crossing interpolates without overflowing the difference', () => {
    const [area] = stackAreas([[1e308], [-1e308]])
    expect(area.bands.flat(2).every(Number.isFinite)).toBe(true)
    expect(area.edge.flat().some(([x, y]) => x === 0.5 && y === 0)).toBe(true)
  })
})
