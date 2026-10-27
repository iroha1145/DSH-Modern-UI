// Switch: two-state toggle. `label` is required and has no default, so a render
// site cannot ship the control without an accessible name.

import { useLayoutEffect, useRef } from 'react'
import clsx from 'clsx'
import { createFeelSwitchMotion } from './feel-switch.ts'
import css from './Switch.module.css'

/**
 * Render a toggle switch.
 * @param props.checked - the current state; the control is fully controlled.
 * @param props.onChange - called with the state the click asks for.
 * @param props.label - localized accessible name, owned by the render site.
 * @param props.disabled - whether the control refuses input, such as a toggle a
 * deployment locks.
 * @param props.busy - a write is in flight: the switch reads as unavailable and
 * ignores clicks but stays focusable, so keyboard focus survives the save.
 * @param props.title - localized hover text, typically why the toggle is locked.
 * @param props.className - extra class for layout placement.
 * @returns the switch element.
 */
export function Switch({ checked, onChange, label, disabled = false, busy = false, title, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  busy?: boolean
  title?: string | undefined
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  className?: string | undefined
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const initial = useRef(checked)
  const motion = useRef<ReturnType<typeof createFeelSwitchMotion> | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const instance = createFeelSwitchMotion(element, initial.current)
    motion.current = instance
    return () => {
      instance.dispose()
      motion.current = null
    }
  }, [])
  useLayoutEffect(() => { motion.current?.to(checked) }, [checked])
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      aria-disabled={busy || undefined}
      className={clsx(css.switch, className)}
      onClick={() => { if (!busy) onChange(!checked) }}
    >
      <span className={css.thumb} />
    </button>
  )
}
