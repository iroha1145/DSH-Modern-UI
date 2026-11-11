import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckCircleOutlineRegular } from './icons/index.tsx'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none. */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000

/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Hovering an actionable banner or focusing an action pauses its remaining lifetime.
 * Completion calls the latest onDone handler; fully faded actions receive no input.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon); ignored
 * under `tone="success"`, which brings its own glyph.
 * @param props.tone - 'success' renders the design's circled green check as
 * the leading glyph; omitted, the icon seat keeps its warning tint.
 * @param props.actions - optional inline actions continuing the sentence:
 * each renders its plain-text `prefix` (a connective like 或) followed by its
 * localized `label` as blue clickable text, flowing after `text` as one
 * sentence. Each press is the owner's to handle (e.g. undo the reported
 * change, then unmount the toast). Banners without actions stay click-through.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3000.
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @returns the floating banner.
 */
export function Toast({ text, icon, tone, anchor, holdMs = HOLD_MS, actions, onDone }: {
  text: string
  icon?: ReactNode
  tone?: 'success'
  anchor?: HTMLElement | null
  holdMs?: number
  actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
  onDone: () => void
}) {
  const latestOnDone = useRef(onDone)
  const banner = useRef<HTMLDivElement>(null)
  const lifetime = useRef({ holdMs, remaining: holdMs + FADE_MS, finished: false })
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  useEffect(() => {
    if (lifetime.current.holdMs !== holdMs) lifetime.current = { holdMs, remaining: holdMs + FADE_MS, finished: false }
    const state = lifetime.current
    if (paused || state.finished) return
    const start = performance.now()
    const timer = setTimeout(() => {
      state.finished = true
      state.remaining = 0
      latestOnDone.current()
    }, state.remaining)
    return () => {
      clearTimeout(timer)
      state.remaining = Math.max(0, state.remaining - (performance.now() - start))
    }
  }, [holdMs, paused])
  useLayoutEffect(() => {
    const element = banner.current
    if (element === null) return
    let previousWidth = -1
    let previousLeft = -1
    const measure = (): void => {
      const viewport = window.visualViewport
      const width = viewport?.width ?? document.documentElement.clientWidth
      const offset = viewport?.offsetLeft ?? 0
      if (width !== previousWidth) {
        element.style.setProperty('--dsh-toast-viewport-width', `${width}px`)
        previousWidth = width
      }
      const half = element.getBoundingClientRect().width / 2
      const margin = Math.min(24, width / 2)
      const rect = anchor?.getBoundingClientRect()
      const center = rect === undefined ? offset + width / 2 : rect.left + rect.width / 2
      const left = Math.max(offset + margin + half, Math.min(center, offset + width - margin - half))
      if (left !== previousLeft) {
        element.style.left = `${left}px`
        previousLeft = left
      }
    }
    measure()
    // A sidebar can move the anchor without resizing it. Track while mounted,
    // independently of the lifetime timer (including while an action has focus).
    const track = (): void => {
      measure()
      frame = requestAnimationFrame(track)
    }
    let frame = requestAnimationFrame(track)
    return () => { cancelAnimationFrame(frame) }
  }, [anchor])
  return createPortal(
    <div
      ref={banner}
      className={css.toast}
      role="alert"
      data-interactive={actions !== undefined && actions.length > 0 || undefined}
      data-paused={paused || undefined}
      onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true) }}
      onPointerLeave={() => { setHovered(false) }}
      onFocus={() => { setFocused(true) }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
      style={{
        '--dsh-toast-hold': `${String(holdMs)}ms`,
      } as CSSProperties}
    >
      {tone === 'success'
        ? <span className={`${css.icon} ${css.success}`} aria-hidden><IconCheckCircleOutlineRegular /></span>
        : icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>
        {text}
        {actions?.map(action => (
          <Fragment key={action.label}>
            {action.prefix}
            <button type="button" className={css.action} onClick={action.onClick}>
              {action.label}
            </button>
          </Fragment>
        ))}
      </span>
    </div>,
    document.body,
  )
}
