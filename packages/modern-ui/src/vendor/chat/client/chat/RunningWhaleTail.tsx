/** Modern UI replaces the scan matrix with its scrambled dot matrix (src/scramble-matrix.tsx). */
import { ScrambleMatrix } from '../../../../scramble-matrix.tsx'

/**
 * Decorative matrix; RunningStatus owns the single accessible announcement.
 * @returns the scrambled dot-matrix loader shared by the status row, process headers and reasoning rows.
 */
export function RunningWhaleTail() {
  return <ScrambleMatrix />
}
