/**
 * Keep a fixed-position floating element anchored to a trigger.
 *
 * A portaled panel is positioned from its anchor's viewport rect, which stops
 * being true the moment anything scrolls or the window resizes. This owns that
 * one concern: measure the anchor, offset the panel below or above it, clamp
 * the result inside the viewport, and re-run on scroll (capture phase, so
 * scrollers nested inside the page are caught too), on resize, and on the
 * panel's own size changes while the element is open.
 * @module @deepseek-ai/dsh-client-ui-primitives/useAnchoredPosition
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { overlayTopMargin } from './overlay-top-margin.ts'

/** Inputs for {@link useAnchoredPosition}. */
export interface AnchoredPositionOptions {
  /** Whether the floating element is mounted and should track its anchor. */
  open: boolean
  /** The element the panel is placed from. */
  anchorRef: RefObject<HTMLElement | null>
  /** The floating element, measured so the clamp uses real dimensions. */
  panelRef: RefObject<HTMLElement | null>
  /** Which anchor edge the panel hangs from: below it (`bottom`, the default) or above it (`top`). */
  side?: 'top' | 'bottom'
  /** Which anchor edge the panel lines up with: its left edge (`start`, the default) or its right edge (`end`). */
  align?: 'start' | 'end'
  /** Distance kept between the anchor edge named by `side` and the panel. */
  gap: number
  /** Distance kept between the panel and each viewport edge; the frame's overlay inset widens the top margin. */
  margin: number
  /** Constrain a scrollable picker to the available side of its anchor. */
  maxHeight?: number
  /** Give a picker the width of its field, within the visible viewport. */
  matchAnchorWidth?: boolean
}

/**
 * Track an anchor and return the panel's fixed coordinates.
 * @param options - the open state, the two refs, the placement side and alignment, and the gap/margin distances.
 * @returns `left`/`top` for the panel, or `null` before the first measurement.
 */
export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null {
  const { open, anchorRef, panelRef, side = 'bottom', align = 'start', gap, margin, maxHeight, matchAnchorWidth = false } = options
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      /* v8 ignore start -- geometry read from real layout: jsdom reports zero
         offset sizes, so the positive-size clamp arms are exercised by browser
         scenarios rather than unit tests. */
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const panel = panelRef.current
      const viewport = window.visualViewport
      const viewLeft = viewport?.offsetLeft ?? 0
      const viewTop = viewport?.offsetTop ?? 0
      const viewWidth = viewport?.width ?? window.innerWidth
      const viewHeight = viewport?.height ?? window.innerHeight
      const maxWidth = Math.max(0, viewWidth - 2 * margin)
      if (panel && maxHeight !== undefined) {
        panel.style.maxWidth = `${maxWidth}px`
        if (matchAnchorWidth) panel.style.width = `${Math.min(maxWidth, rect.width)}px`
      }
      const width = panel?.offsetWidth ?? 0
      let height = panel?.offsetHeight ?? 0
      let left = align === 'end' ? rect.right - width : rect.left
      const topMargin = Math.max(viewTop + margin, overlayTopMargin(margin, rect, gap))
      const above = rect.top - gap - topMargin
      const below = viewTop + viewHeight - margin - rect.bottom - gap
      const natural = maxHeight === undefined ? height : Math.min(maxHeight, (panel?.scrollHeight ?? 0) + height - (panel?.clientHeight ?? 0))
      const flip = natural > 0 && (side === 'bottom' ? natural > below && above > below : natural > above && below > above)
      const up = side === 'top' ? !flip : flip
      if (panel && maxHeight !== undefined) {
        panel.style.maxHeight = `${Math.max(0, Math.min(maxHeight, viewHeight - 2 * margin, Math.max(120, up ? above : below)))}px`
        height = panel.offsetHeight
      }
      let top = up ? rect.top - gap - height : rect.bottom + gap
      if (width > 0) left = Math.max(viewLeft + margin, Math.min(left, viewLeft + viewWidth - width - margin))
      if (height > 0) top = Math.max(topMargin, Math.min(top, viewTop + viewHeight - height - margin))
      /* v8 ignore stop */
      setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top })
    }
    // The first run measures the panel in the same commit that opened it, so
    // the clamp uses real dimensions before anything paints.
    place()
    let frame: number | undefined
    const schedule = (): void => {
      if (frame !== undefined) return
      frame = window.requestAnimationFrame(() => { frame = undefined; place() })
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    // The panel's own height changes without either event — a status line
    // appearing inside it, or a `resize: vertical` textarea dragged taller —
    // and a stale clamp would let a panel near the bottom edge cross the
    // margin it is supposed to respect. The guard keeps the hook usable where
    // `ResizeObserver` is absent, which is how jsdom runs.
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(schedule)
      observer.observe(panel)
      if (anchorRef.current) observer.observe(anchorRef.current)
    }
    return () => {
      observer?.disconnect()
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
    }
  }, [open, anchorRef, panelRef, side, align, gap, margin, maxHeight, matchAnchorWidth])
  return position
}
