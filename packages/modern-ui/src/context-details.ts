/**
 * Context-window panel arithmetic for the composer's context ring.
 *
 * The host publishes `contextPressure` (occupancy, provider-anchored) and
 * `contextBreakdown` (system prompt / tools / conversation, heuristic). The
 * panel lists those three rows plus the free space left in the window, each
 * with its share of the window. Pure so it is unit-tested without a browser.
 *
 * The layout (title line with the reading, segmented bar, rows with token and
 * percent columns) follows zkforge/dsh-claude-desktop-theme (MIT); see
 * THIRD_PARTY_NOTICES.md.
 */

/** Panel rows in bar order; `free` is always last. */
export type ContextSliceKey = 'system' | 'tools' | 'messages' | 'free'

/** One priced slice of the window. */
export interface ContextSlice {
  readonly key: ContextSliceKey
  readonly tokens: number
}

/** What the panel reads from the host's two projections. */
export interface ContextSource {
  /** `contextPressure.contextWindow`. */
  readonly window: number
  /** `projectedTokens ?? pressureTokens`: the ring's own reading. */
  readonly used: number
  /** `contextBreakdown`, or undefined while the host has not published it. */
  readonly breakdown?: {
    readonly systemTokens: number
    readonly toolsTokens: number
    readonly messageTokens: number
  }
}

/** The panel's whole reading. */
export interface ContextReading {
  readonly window: number
  readonly used: number
  /** Every non-empty row in bar order, `free` last. */
  readonly slices: readonly ContextSlice[]
}

/** A non-negative finite count, or zero. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Build the panel's rows. Empty rows are left out; `free` is the window minus
 * the ring's occupancy, so the header, the ring and the free row agree.
 * @param source - the host's projections.
 * @returns the reading.
 */
export function contextReading(source: ContextSource): ContextReading {
  const window = count(source.window)
  const used = Math.min(count(source.used), window)
  const slices: ContextSlice[] = []
  const push = (key: ContextSliceKey, tokens: number) => {
    if (tokens > 0) slices.push({ key, tokens })
  }
  push('system', count(source.breakdown?.systemTokens))
  push('tools', count(source.breakdown?.toolsTokens))
  push('messages', count(source.breakdown?.messageTokens))
  push('free', window - used)
  return { window, used, slices }
}

/**
 * Bar weights. The heuristic rows and the provider-anchored occupancy differ,
 * so the rows only proportion the filled part: they are scaled to add up to
 * exactly the ring's occupancy, and the track takes the rest of the window.
 * Without a breakdown the filled part is one neutral segment.
 * @param reading - the panel's reading.
 * @returns the segments to draw (`total` when there is no breakdown) and the free weight.
 */
export function barWeights(reading: ContextReading): {
  segments: { key: ContextSliceKey | 'total'; tokens: number }[]
  free: number
} {
  const filled = reading.slices.filter(slice => slice.key !== 'free')
  const sum = filled.reduce((total, slice) => total + slice.tokens, 0)
  const free = Math.max(0, reading.window - reading.used)
  if (reading.used === 0) return { segments: [], free }
  if (sum === 0) return { segments: [{ key: 'total', tokens: reading.used }], free }
  const scale = reading.used / sum
  return { segments: filled.map(slice => ({ key: slice.key, tokens: slice.tokens * scale })), free }
}

/**
 * One row's share of the window at one decimal place.
 * @param tokens - row tokens.
 * @param window - session capacity.
 * @returns e.g. `4.8%`.
 */
export function formatShare(tokens: number, window: number): string {
  if (window <= 0) return '0.0%'
  return `${((Math.max(0, tokens) / window) * 100).toFixed(1)}%`
}
