/** One vendor mark as a decorative inline SVG that takes the tile's text color. */
import type { ReactNode } from 'react'
import { VENDOR_MARKS, type VendorMark } from './vendor-marks.ts'

/**
 * Draw a vendor mark in `currentColor`.
 * @param props - the mark id and an optional class for sizing.
 * @returns the hidden-from-assistive-technology SVG.
 */
export function VendorMarkIcon({ mark, className }: { mark: VendorMark; className?: string | undefined }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true" focusable="false">
      {VENDOR_MARKS[mark].map((shape, index) => typeof shape === 'string'
        ? <path key={index} d={shape} />
        : <path key={index} d={shape.d} fillOpacity={shape.opacity} />)}
    </svg>
  )
}
