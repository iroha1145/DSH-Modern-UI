/** Composer context-occupancy meter: a ring and percentage below the card fed by the
 * `contextPressure` projection, with a click-open "context window" panel: the
 * reading (`used / window (percent)`), a segmented bar, and one row per
 * `contextBreakdown` category plus the free space, each with its token count
 * and share of the window. The title line folds the rows away.
 * Renders nothing until a provider reports both pressure and a route
 * capacity. */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { Tooltip, useAnchoredPosition, useDismissOnOutsidePointer } from '@iroha1145/dsh-modern-ui/primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { contextOccupancy } from '../context-occupancy.ts'
import { barWeights, contextReading, formatShare, type ContextSliceKey } from '../../../../context-details.ts'
import css from './ContextMeter.module.css'

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Row label and tint per panel category; the tint is shared by swatch and bar segment. */
const ROWS: Record<ContextSliceKey, { label: 'context.system' | 'context.tools' | 'context.messages' | 'context.free'; color: string }> = {
  system: { label: 'context.system', color: css.colorSystem },
  tools: { label: 'context.tools', color: css.colorTools },
  messages: { label: 'context.messages', color: css.colorMessages },
  free: { label: 'context.free', color: css.colorFree },
}

/**
 * Format a token count for the compact context panel.
 * @param value - token count.
 * @param t - Conversation locale seat with shared compact-number templates.
 * @returns Compact localized count using K or M when needed.
 */
function formatTokens(value: number, t: ComposerBarProps['t']): string {
  const rounded = Math.max(0, Math.round(value))
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (rounded < 1_000) return String(rounded)
  if (rounded < 1_000_000) return t('number.thousand', { value: scaled(rounded / 1_000) })
  return t('number.million', { value: scaled(rounded / 1_000_000) })
}

export interface ContextMeterProps {
  useProjection: UseProjection
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

export function ContextMeter({ useProjection, t }: ContextMeterProps) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  // The breakdown rows stay shown until the reader folds them; the choice lasts while the composer is mounted.
  const [expanded, setExpanded] = useState(true)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const context = contextOccupancy(pressure)
  const available = context !== null
  const position = useAnchoredPosition({
    open: open && available,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: 8,
    margin: 12,
  })
  useDismissOnOutsidePointer(rootRef, open && available, setOpen, panelRef)

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  useEffect(() => {
    if (!open || !available) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [available, open])

  if (context === null) return null
  const percent = context.percent
  const reading = `${percent}%`
  const panel = contextReading({ window: context.contextWindow, used: context.usedTokens, breakdown })
  const bar = barWeights(panel)

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={t('context.aria', { percent: reading })} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={t('context.aria', { percent: reading })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.track} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.fill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
          <span>{reading}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          aria-label={t('context.title')}
        >
          <button
            type="button"
            className={css.header}
            aria-expanded={expanded}
            aria-label={`${t('context.title')}, ${t(expanded ? 'context.collapse' : 'context.expand')}`}
            onClick={() => { setExpanded(!expanded) }}
          >
            <span className={css.title}>{t('context.title')}</span>
            {/* `~`: usedTokens prefers projectedTokens, whose surface delta is
                heuristically repriced on top of the provider-anchored sample. */}
            <span className={css.figures}>
              {`~${formatTokens(context.usedTokens, t)} / ${formatTokens(context.contextWindow, t)} (${reading})`}
            </span>
            <svg className={css.chevron} viewBox="0 0 16 16" width="12" height="12" aria-hidden>
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className={css.bar} aria-hidden>
            {bar.segments.map(segment => (
              <span
                key={segment.key}
                className={segment.key === 'total' ? css.segment : `${css.segment} ${ROWS[segment.key].color}`}
                style={{ flexGrow: segment.tokens }}
              />
            ))}
            <span className={css.free} style={{ flexGrow: bar.free }} />
          </div>
          {expanded && (
            <dl className={css.rows}>
              {panel.slices.map(slice => (
                <div key={slice.key} className={css.row}>
                  <dt>
                    <span className={`${css.swatch} ${ROWS[slice.key].color}`} aria-hidden />
                    {t(ROWS[slice.key].label)}
                  </dt>
                  <dd className={css.tokens}>
                    {slice.key === 'free' ? formatTokens(slice.tokens, t) : `~${formatTokens(slice.tokens, t)}`}
                  </dd>
                  <dd className={css.share}>{formatShare(slice.tokens, panel.window)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
