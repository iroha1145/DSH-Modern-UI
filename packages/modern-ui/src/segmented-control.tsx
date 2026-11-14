import clsx from 'clsx'
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import css from './segmented-control.module.css'

interface SegmentedTrackProps extends HTMLAttributes<HTMLDivElement> {
  count: number
  selectedIndex: number
  /** Streaming option lists snap into place; settled user selections can slide. */
  animate?: boolean
}

/** Visual track only. Callers retain their radio/tab/menu semantics and keyboard behavior. */
export const SegmentedTrack = forwardRef<HTMLDivElement, SegmentedTrackProps>(function SegmentedTrack(
  { count, selectedIndex, animate = true, className, style, children, ...attributes },
  ref,
) {
  const selected = selectedIndex >= 0 && selectedIndex < count
  return (
    <div
      {...attributes}
      ref={ref}
      className={clsx(css.track, className)}
      data-segmented-track=""
      style={{ ...style, '--dsh-segment-count': Math.max(1, count) } as CSSProperties}
    >
      {selected && (
        <span
          aria-hidden="true"
          data-segment-indicator=""
          data-static={animate ? undefined : ''}
          className={css.indicator}
          style={{ '--dsh-segment-index': selectedIndex } as CSSProperties}
        />
      )}
      {children}
    </div>
  )
})
