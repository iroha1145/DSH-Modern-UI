/** Placement of the citation preview card relative to its chip, within the message column. */

/** Viewport-coordinate rectangle edges. */
export interface PreviewRect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** Measurements the placement depends on, all in viewport coordinates. */
export interface PreviewPlacementInput {
  /** The chip the card describes. */
  readonly anchor: PreviewRect
  /** Message column; the card never extends past its left and right edges. */
  readonly column: Pick<PreviewRect, 'left' | 'right'>
  /** Measured card size under the width cap from {@link citationPreviewMaxWidth}. */
  readonly size: { readonly width: number; readonly height: number }
  readonly viewport: { readonly width: number; readonly height: number }
  /** Lowest card top, below any reserved frame strip. */
  readonly topInset: number
  /** Distance kept between the chip and the card. */
  readonly gap: number
}

/** Resolved card position. */
export interface PreviewPlacement {
  readonly left: number
  readonly top: number
}

/** Smallest distance kept between the card and a viewport edge. */
const EDGE = 8

/** Horizontal range the card may occupy: the column, inside the viewport edges. */
function horizontalRange(column: Pick<PreviewRect, 'left' | 'right'>, viewportWidth: number): { min: number; max: number } {
  const min = Math.max(column.left, EDGE)
  return { min, max: Math.max(min, Math.min(column.right, viewportWidth - EDGE)) }
}

/**
 * Bound the card's width so its text wraps inside the message column.
 * @param column - Message column edges in viewport coordinates.
 * @param viewportWidth - Viewport width in pixels.
 * @param preferred - Width the card takes when the column is wide enough.
 * @returns Widest allowed card width in pixels: the preferred width, or the column's width inside the viewport edges when that is smaller.
 */
export function citationPreviewMaxWidth(column: Pick<PreviewRect, 'left' | 'right'>, viewportWidth: number, preferred: number): number {
  const { min, max } = horizontalRange(column, viewportWidth)
  return Math.min(preferred, max - min)
}

/**
 * Place the card below its chip when it fits, otherwise above, keeping it inside the message column and viewport.
 * @param input - Chip, column, card size (measured under {@link citationPreviewMaxWidth}), viewport, top inset, and chip-to-card gap.
 * @returns Fixed-position coordinates. When neither side has room the card takes the side with more space, clamped to the viewport.
 */
export function placeCitationPreview(input: PreviewPlacementInput): PreviewPlacement {
  const { anchor, column, size, viewport, topInset, gap } = input
  const { min, max } = horizontalRange(column, viewport.width)
  const left = Math.min(Math.max(anchor.left, min), max - Math.min(size.width, max - min))
  const below = anchor.bottom + gap
  const above = anchor.top - gap - size.height
  const bottomLimit = viewport.height - EDGE - size.height
  const room = { below: viewport.height - EDGE - below, above: anchor.top - gap - topInset }
  const preferBelow = below <= bottomLimit || (above < topInset && room.below >= room.above)
  const top = preferBelow ? below : above
  return { left, top: Math.min(Math.max(top, topInset), Math.max(topInset, bottomLimit)) }
}
