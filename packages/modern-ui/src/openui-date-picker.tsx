import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { PickerPopover } from './openui-picker-popover.tsx'
import { useUiLocale, useUiText } from './vendor/openui/components/ui-text.ts'
import styles from './openui-date-picker.module.css'

const DAY = 86_400_000
// Use UTC calendar arithmetic, including years 0001–0099 (Date.UTC treats them as 1901–1999).
function dayOf(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  return date.getTime() / DAY
}
function parse(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null
  const result = dayOf(year, month - 1, day)
  return new Date(result * DAY).toISOString().slice(0, 10) === value ? result : null
}
function iso(day: number) {
  return new Date(day * DAY).toISOString().slice(0, 10)
}
const FIRST = dayOf(1, 0, 1)
const LAST = dayOf(9999, 11, 31)
function monthMove(day: number, months: number) {
  const date = new Date(day * DAY)
  const first = dayOf(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  const next = new Date(first * DAY)
  const end = dayOf(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)
  return Math.min(end, first + date.getUTCDate() - 1)
}

export function OpenUiDatePicker({
  value,
  onChange,
  label,
  min,
  max,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  min?: string
  max?: string
}) {
  const text = useUiText()
  const locale = useUiLocale()
  const id = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const emitted = useRef<string | null>(null)
  const focusGrid = useRef(false)
  const [draft, setDraft] = useState(value)
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(false)
  const low = min ? (parse(min) ?? FIRST) : FIRST
  const high = max ? (parse(max) ?? LAST) : LAST
  const clamp = (day: number) => Math.max(low, Math.min(high, day))
  const now = new Date()
  const initial = clamp(parse(value) ?? dayOf(now.getFullYear(), now.getMonth(), now.getDate()))
  const [focused, setFocused] = useState(initial)
  const parsed = parse(draft)
  const valid = draft === '' || (parsed !== null && parsed >= low && parsed <= high)
  const error = (touched || draft === value) && !valid
  const monthDate = new Date(focused * DAY)
  const first = dayOf(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1)
  // Sunday-first ordering is explicit and matches the displayed column headers.
  const start = first - new Date(first * DAY).getUTCDay()
  const monthFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' })
  const fullFormat = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' })
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })

  useEffect(() => {
    if (emitted.current === value) {
      emitted.current = null
      return
    }
    setDraft(value)
    setTouched(false)
    const day = parse(value)
    if (day !== null) {
      focusGrid.current = !!panelRef.current?.querySelector('[data-day]:focus')
      setFocused(day)
    }
  }, [value])
  useEffect(() => {
    if (!open) return
    const day = Math.max(low, Math.min(high, focused))
    if (day !== focused && low <= high) setFocused(day)
    else if (focusGrid.current) {
      const cell = panelRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)
      cell?.focus()
      focusGrid.current = false
      // Placement updates visibility in a layout-effect render; initial passive effects may run before it.
      if (cell && document.activeElement !== cell) {
        const previous = document.activeElement
        const frame = requestAnimationFrame(() => {
          if (document.activeElement === previous) cell.focus()
        })
        return () => cancelAnimationFrame(frame)
      }
    }
  }, [open, focused, low, high])

  const write = (next: string) => {
    setDraft(next)
    const day = parse(next)
    const committed = day !== null && day >= low && day <= high ? next : ''
    emitted.current = committed
    onChange(committed)
  }
  const select = (day: number) => {
    write(iso(day))
    setTouched(false)
    setOpen(false)
    buttonRef.current?.focus()
  }
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = Number(event.currentTarget.dataset.day)
    let next: number
    const weekday = new Date(current * DAY).getUTCDay()
    switch (event.key) {
      case 'ArrowLeft':
        next = current - 1
        break
      case 'ArrowRight':
        next = current + 1
        break
      case 'ArrowUp':
        next = current - 7
        break
      case 'ArrowDown':
        next = current + 7
        break
      case 'Home':
        next = current - weekday
        break
      case 'End':
        next = current + 6 - weekday
        break
      case 'PageUp':
        next = monthMove(current, event.shiftKey ? -12 : -1)
        break
      case 'PageDown':
        next = monthMove(current, event.shiftKey ? 12 : 1)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
    const target = clamp(next)
    if (target === focused) panelRef.current?.querySelector<HTMLButtonElement>(`[data-day="${target}"]`)?.focus()
    else {
      focusGrid.current = true
      setFocused(target)
    }
  }
  const toggle = () => {
    if (!open) {
      focusGrid.current = true
      setFocused(clamp(parsed ?? initial))
    }
    setOpen(!open)
  }
  return (
    <div className={styles.field}>
      {label && (
        <label className="iui-label" htmlFor={id}>
          {label}
        </label>
      )}
      <div ref={anchorRef} className={styles.control}>
        <input
          id={id}
          className="iui-input"
          type="text"
          inputMode="text"
          placeholder="YYYY-MM-DD"
          aria-label={label || text.date}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          aria-invalid={error || undefined}
          value={draft}
          onChange={event => {
            setTouched(false)
            write(event.target.value)
          }}
          onBlur={() => setTouched(true)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !valid) {
              event.preventDefault()
              setTouched(true)
            }
            if (event.key === 'ArrowDown' && event.altKey) {
              event.preventDefault()
              if (!open) toggle()
            }
          }}
        />
        <button
          ref={buttonRef}
          type="button"
          className={styles.trigger}
          aria-label={text.chooseDate}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-calendar` : undefined}
          onClick={toggle}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>
      <span id={`${id}-hint`} className={styles.hint}>
        {text.dateFormat}
        {min && parse(min) !== null ? ` · ≥ ${min}` : ''}
        {max && parse(max) !== null ? ` · ≤ ${max}` : ''}
      </span>
      {error && (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {text.invalidDate}
        </span>
      )}
      {open && (
        <PickerPopover
          id={`${id}-calendar`}
          role="dialog"
          aria-label={label || text.chooseDate}
          anchorRef={anchorRef}
          returnFocusRef={buttonRef}
          panelRef={panelRef}
          onDismiss={() => setOpen(false)}
          className={styles.panel}
          style={{ width: 320 }}
          onKeyDown={event => {
            if (event.key !== 'Tab') return
            // The official modal traps Tab at document bubble phase; this body portal
            // owns its internal order until an endpoint explicitly returns to the field.
            event.stopPropagation()
            const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])') ?? [])
            if (event.shiftKey && event.target === buttons[0]) {
              event.preventDefault()
              setOpen(false)
              buttonRef.current?.focus()
            } else if (!event.shiftKey && event.target === buttons.at(-1)) {
              // A body portal has its own Tab scope in browsers with native popovers. Resume
              // the document's tab order after the field rather than after the body portal.
              const modal = buttonRef.current?.closest<HTMLElement>('[role="dialog"][aria-modal="true"]')
              const scope = modal ?? document
              const candidates = Array.from(scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable=true]'))
                .filter(
                  element =>
                    element.tabIndex >= 0 &&
                    !element.matches(':disabled') &&
                    !element.closest('[hidden], [inert], [aria-hidden=true]') &&
                    !panelRef.current?.contains(element) &&
                    element.getClientRects().length > 0 &&
                    getComputedStyle(element).visibility !== 'hidden',
                )
                .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity))
              const next = candidates[candidates.indexOf(buttonRef.current as HTMLButtonElement) + 1] ?? (modal ? candidates[0] : undefined)
              if (next) event.preventDefault()
              setOpen(false)
              ;(next ?? buttonRef.current)?.focus()
            }
          }}
        >
          <div className={styles.header}>
            <button
              type="button"
              aria-label={text.previousMonth}
              disabled={low > high || first <= dayOf(new Date(low * DAY).getUTCFullYear(), new Date(low * DAY).getUTCMonth(), 1)}
              onClick={() => setFocused(clamp(monthMove(focused, -1)))}
            >
              ‹
            </button>
            <span aria-live="polite">{monthFormat.format(monthDate)}</span>
            <button
              type="button"
              aria-label={text.nextMonth}
              disabled={low > high || monthMove(first, 1) > high}
              onClick={() => setFocused(clamp(monthMove(focused, 1)))}
            >
              ›
            </button>
          </div>
          <table className={styles.calendar} aria-label={monthFormat.format(monthDate)}>
            <thead>
              <tr>
                {Array.from({ length: 7 }, (_, n) => (
                  <th key={dayOf(2024, 0, 7 + n)} scope="col">
                    {weekdayFormat.format(new Date(dayOf(2024, 0, 7 + n) * DAY))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }, (_, row) => start + row * 7).map(week => (
                <tr key={week}>
                  {Array.from({ length: 7 }, (_, col) => {
                    const day = week + col
                    const date = new Date(day * DAY)
                    const disabled = day < low || day > high
                    return (
                      <td key={day}>
                        <button
                          type="button"
                          data-day={day}
                          tabIndex={day === focused && !disabled ? 0 : -1}
                          disabled={disabled}
                          aria-label={fullFormat.format(date)}
                          aria-pressed={parsed === day}
                          data-outside={date.getUTCMonth() !== monthDate.getUTCMonth() || undefined}
                          onKeyDown={move}
                          onClick={() => select(day)}
                        >
                          {date.getUTCDate()}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              write('')
              setTouched(false)
              setOpen(false)
              buttonRef.current?.focus()
            }}
          >
            {text.clearDate}
          </button>
        </PickerPopover>
      )}
    </div>
  )
}
