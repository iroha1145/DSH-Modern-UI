/** Scan variant from https://transitions.dev/detail.html?t=matrix-dot-loader. */
import type { CSSProperties } from 'react'

const CYCLE = 1200

/**
 * Decorative matrix; RunningStatus owns the single accessible announcement.
 * @returns The original sixteen-dot scan grid.
 */
export function RunningWhaleTail() {
  return (
    <span className="t-matrix" data-variant="scan" aria-hidden="true"
      style={{ '--matrix-cycle': `${CYCLE}ms`, flexShrink: 0 } as CSSProperties}>
      {Array.from({ length: 16 }, (_, index) => (
        <i key={index} style={{ '--d': Math.round((index % 4) * (CYCLE / 10)) } as CSSProperties} />
      ))}
    </span>
  )
}
