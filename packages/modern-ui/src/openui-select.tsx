import { Check, ChevronDown } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PickerPopover } from './openui-picker-popover'
import { observeScrollHints } from './scroll-hints'
import scrollHints from './scroll-hints.module.css'
import { useUiLocale, useUiText } from './vendor/openui/components/ui-text'

interface OpenUiSelectProps {
  value: string
  choices: { value: string; label: string }[]
  label?: string
  placeholder?: string
  onChange: (value: string) => void
}

/** Select-only combobox: browsing options does not change the bound value until committed. */
export function OpenUiSelect({ value, choices, label, placeholder, onChange }: OpenUiSelectProps) {
  const text = useUiText()
  const locale = useUiLocale()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const search = useRef({ text: '', at: 0 })
  const selected = choices.findIndex(option => option.value === value)
  const active = Math.min(activeIndex, choices.length - 1)
  const shown = selected >= 0 ? choices[selected].label : (placeholder ?? text.choose)

  const show = (index = Math.max(selected, 0)) => {
    setActiveIndex(index)
    search.current = { text: '', at: 0 }
    setOpen(true)
  }
  const commit = (index: number) => {
    const option = choices[index]
    if (option) onChange(option.value)
    setOpen(false)
  }
  useLayoutEffect(() => {
    if (choices.length === 0) setOpen(false)
  }, [choices.length])
  useLayoutEffect(() => {
    if (!open) return
    const option = panel.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
    const viewport = panel.current
    if (!viewport || !option) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < viewport.scrollTop + 6) viewport.scrollTop = top - 6
    else if (bottom > viewport.scrollTop + viewport.clientHeight - 6) viewport.scrollTop = bottom - viewport.clientHeight + 6
  }, [open, active])
  useLayoutEffect(() => {
    if (open && panel.current) return observeScrollHints(panel.current)
  }, [open])

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return
    if (Date.now() - search.current.at >= 700) search.current.text = ''
    const key = event.key
    if (key === 'Tab') {
      if (open) commit(active)
      return
    }
    if (key === 'Enter' || (key === ' ' && search.current.text === '')) {
      event.preventDefault()
      if (open) commit(active)
      else show()
      return
    }
    if (key === 'ArrowUp' && event.altKey && open) {
      event.preventDefault()
      commit(active)
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) {
      event.preventDefault()
      const from = open ? active : Math.max(selected, 0)
      const delta = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : key === 'PageDown' ? 10 : -10
      const next = key === 'Home' ? 0 : key === 'End' ? choices.length - 1 : !open ? from : Math.min(choices.length - 1, Math.max(0, from + delta))
      setActiveIndex(next)
      setOpen(true)
      search.current = { text: '', at: 0 }
      return
    }
    if (key.length !== 1 || event.altKey) return
    event.preventDefault()
    const now = Date.now()
    const query = (now - search.current.at < 700 ? search.current.text : '') + key.toLocaleLowerCase(locale)
    search.current = { text: query, at: now }
    const repeated = [...query].every(character => character === query[0])
    const prefix = repeated ? query[0] : query
    const from = open ? active : selected
    const start = repeated ? from + 1 : Math.max(0, from)
    for (let offset = 0; offset < choices.length; offset++) {
      const index = (start + offset + choices.length) % choices.length
      if (choices[index].label.trim().toLocaleLowerCase(locale).startsWith(prefix)) {
        setActiveIndex(index)
        break
      }
    }
    setOpen(true)
  }

  return (
    <div className="iui-field">
      {label && (
        <label className="iui-label" htmlFor={id}>
          {label}
        </label>
      )}
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className="iui-input iui-select"
        value={value}
        disabled={choices.length === 0}
        aria-label={label ? undefined : (placeholder ?? text.selection)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        onClick={() => {
          if (open) setOpen(false)
          else show()
        }}
        onKeyDown={keyDown}
      >
        <span className={selected < 0 ? 'iui-select-placeholder' : undefined}>{shown}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <PickerPopover
          anchorRef={trigger}
          panelRef={panel}
          onDismiss={() => setOpen(false)}
          matchAnchorWidth
          id={`${id}-options`}
          role="listbox"
          aria-label={label ?? placeholder ?? text.selection}
          className={`iui-select-popup ${scrollHints.viewport}`}
        >
          {choices.map((option, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive: Select-only combobox keyboard navigation remains on its trigger.
            // biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space are handled by the owning combobox.
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Duplicate option values are permitted; options carry no independent state.
              key={`${option.value}-${index}`}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === selected}
              className={`iui-select-option${index === active ? ' is-active' : ''}`}
              data-option-index={index}
              onPointerMove={() => setActiveIndex(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                commit(index)
                trigger.current?.focus({ preventScroll: true })
              }}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={16} aria-hidden="true" />}
            </div>
          ))}
        </PickerPopover>
      )}
    </div>
  )
}
