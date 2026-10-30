import { describe, expect, test } from 'vitest'
import { strandedOnboarding } from '../../packages/modern-ui/src/desktop-onboarding.ts'

const skipped = { version: 1, step: 'done', purpose: null, process: 'standard', completion: 'skipped', usage: 'compact', developerTools: false }
const begun = { version: 1, step: 'process', purpose: 'both', process: 'standard', completion: null, usage: 'compact', developerTools: false }
const snapshot = (user: Record<string, unknown> | undefined, overrides: Record<string, unknown> = {}) => ({
  status: 'ready' as const,
  value: { ...skipped, ...user },
  base: skipped,
  user,
  revision: 3,
  writable: true,
  ...overrides,
})
const unserved = { status: 'unavailable' as const }

describe('stranded desktop onboarding', () => {
  test('progress saved over the skipped composition is re-inherited field by field', () => {
    expect(strandedOnboarding(unserved, snapshot(begun))).toEqual(Object.keys(begun))
    expect(strandedOnboarding(unserved, snapshot({ step: 'credit' }))).toEqual(['step'])
  })

  test('nothing is touched while the official Chat namespace is served or not yet settled', () => {
    expect(strandedOnboarding({ status: 'ready' }, snapshot(begun))).toEqual([])
    expect(strandedOnboarding({ status: 'loading' }, snapshot(begun))).toEqual([])
    expect(strandedOnboarding(unserved, snapshot(begun, { status: 'loading' }))).toEqual([])
    expect(strandedOnboarding(unserved, snapshot(begun, { writable: false }))).toEqual([])
  })

  test('a finished onboarding, or a profile without the skipped composition, stays as it is', () => {
    expect(strandedOnboarding(unserved, snapshot({ ...begun, step: 'done', completion: 'completed' }))).toEqual([])
    expect(strandedOnboarding(unserved, snapshot(undefined))).toEqual([])
    expect(strandedOnboarding(unserved, snapshot(begun, { base: { ...skipped, step: 'welcome' } }))).toEqual([])
  })
})
