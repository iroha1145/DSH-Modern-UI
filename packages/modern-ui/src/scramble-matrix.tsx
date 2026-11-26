/**
 * Scrambled dot-matrix loader: the centre pulses and ripples outwards while scattered dots flare and cool.
 * Timings follow a frame-by-frame measurement of the reference animation: the centre fires every two thirds
 * of a second, the ring front moves one dot per 0.2 s and fades with distance, and a flare lights at once,
 * dims over about 1.3 s and leaves a faint tail for another two seconds.
 */
import type { CSSProperties } from 'react'
import css from './scramble-matrix.module.css'

const SIZE = 5
const CENTER = (SIZE - 1) / 2
const RING_STEP_MS = 200
const FLARE_MIN_MS = 5200
const FLARE_SPREAD_MS = 2400

/** Ring brightness by distance from the centre, sampled from the reference grid. */
const RING_PEAKS: readonly (readonly [distance: number, peak: number])[] = [
  [0, 1],
  [1, 0.69],
  [Math.SQRT2, 0.43],
  [2, 0.25],
  [Math.sqrt(5), 0.2],
  [2 * Math.SQRT2, 0.12],
]

function ringPeak(distance: number): number {
  return RING_PEAKS.find(([ring]) => Math.abs(ring - distance) < 0.01)?.[1] ?? 0
}

/** mulberry32 with a fixed seed: every render and every instance share one scattered schedule. */
function sequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

interface Dot {
  readonly id: string
  readonly center: boolean
  readonly style: CSSProperties
}

const DOTS: readonly Dot[] = (() => {
  const next = sequence(0x5eed)
  return Array.from({ length: SIZE * SIZE }, (_, index) => {
    const row = Math.floor(index / SIZE)
    const column = index % SIZE
    const distance = Math.hypot(row - CENTER, column - CENTER)
    // Each dot flares on its own cycle; a negative delay starts it part-way through, so a fresh mount is
    // already scattered and the whole grid never lines up into a visible repeat.
    const cycle = Math.round(FLARE_MIN_MS + next() * FLARE_SPREAD_MS)
    const phase = Math.round(next() * cycle)
    return {
      id: `${row}-${column}`,
      center: distance === 0,
      style: {
        '--ring-delay': `${Math.round(Math.max(0, distance - 1) * RING_STEP_MS)}ms`,
        '--ring-peak': `${Math.round(ringPeak(distance) * 100)}%`,
        '--flare-cycle': `${cycle}ms`,
        '--flare-delay': `${-phase}ms`,
      } as CSSProperties,
    }
  })
})()

/**
 * Decorative loader; the caller owns the accessible status text.
 * @returns a 5 × 5 grid whose centre ripples while the other dots flare at scattered times.
 */
export function ScrambleMatrix() {
  return (
    <span className={css.matrix} aria-hidden="true" data-matrix-variant="scramble">
      {DOTS.map(dot => (
        <i key={dot.id} data-center={dot.center || undefined} style={dot.style} />
      ))}
    </span>
  )
}
