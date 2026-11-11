/** Localized two-column selector shared by Chat preference rows. */
import { useId, useRef, useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@iroha1145/dsh-modern-ui/primitives'
import css from './PreferenceRow.module.css'

/**
 * Render a preference label and its menu; selection restores focus before publishing the new value.
 * @param props - localized copy, selected value, choices, and mutation callback.
 * @returns the settings row.
 */
export function PreferenceRow({ title, description, value, selectedLabel, options, onSelect }: {
  title: string
  description: string
  value: string
  selectedLabel: string
  options: readonly { id: string; label: string }[]
  onSelect: (value: string) => void
}) {
  const labelId = useId()
  const valueId = useId()
  const descriptionId = useId()
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLButtonElement>(null)
  const closeMenu = () => { setOpen(false) }
  const selectMode = (id: string) => {
    selectorRef.current?.focus({ preventScroll: true })
    closeMenu()
    onSelect(id)
  }
  const selector = (
    <button
      ref={selectorRef}
      type="button"
      className={css.selector}
      aria-labelledby={`${labelId} ${valueId}`}
      aria-describedby={descriptionId}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      <span id={valueId}>{selectedLabel}</span>
      <IconChevronDownOutlineRegular className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row} data-modern-preference>
      <div className={css.rowText}>
        <div id={labelId} className={css.title}>{title}</div>
        <div id={descriptionId} className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={options.map(option => ({ ...option, choice: 'radio' as const }))}
        selectedId={value}
        onSelect={selectMode}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
