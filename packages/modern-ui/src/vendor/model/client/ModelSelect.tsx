/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * The trigger shows the selected model's vendor tile, its name, and, while
 * the model thinks, a bulb with the effort. It opens one popover above
 * itself, aligned to its end:
 *
 * - a column header and the provider-grouped model list, with group headings
 *   only when more than one provider serves models. Each row shows the vendor
 *   tile, the name, a one-line description, and speed / quality / cost meters
 *   from the model's picker profile (built-in presets, the user's overrides,
 *   and fetched prices). Search appears above eight models and keeps focus
 *   while ↑/↓ move the highlight. Pointing at a row lights its meters and
 *   dims the other rows.
 * - the thinking switch when the selected model can stop thinking, its effort
 *   levels as pills while it thinks.
 * - a footer with the highlighted model's estimated first-token wait, scaled
 *   by the effort, and its price per million tokens.
 *
 * Keys: Enter, Space, ↓, or ↑ on the trigger opens; ↑/↓, Home, and End move
 * the highlight; Enter picks; Tab and Shift+Tab cycle through the list, the
 * switches, and the effort pills; ←/→ change the effort; Escape closes back to
 * the trigger. Picking another model keeps the effort in use when the target
 * offers it (or keeps thinking off), else applies its catalog default, so a
 * composer pick always states an effort. A rejected selection or web-search
 * switch announces through the shared Toast anchored to the composer card;
 * the in-popover strip with Retry remains the catalog-load surface. While a
 * selection is pending, the trigger shows a spinner in place of its chevron
 * and the pending row shows one in place of its check.
 */
import {
  IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCloseFillRegular, IconDataOutlineRegular,
  IconThinkOutlineRegular, IconWarningOutlineRegular, Input, isMobileDevice,
  MenuGroup, MenuSurface, observeStickyMenuGroups, rankByName, StateDot, Switch, Toast,
} from '@iroha1145/dsh-modern-ui/primitives'
import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-session-controller/types'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelLabelOwner, ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'
import { orderModelProviders } from './provider-order.ts'
import {
  EFFORT_SHORT, isOffEffort, preferredEffort, profileOf, thinkingLatency, visibleEfforts, type ModelProfile,
} from './profiles.ts'
import { VendorMarkIcon } from './VendorMarkIcon.tsx'
import { formatPrice } from './format-price.ts'

/** Catalogs above this many models show search. */
const SEARCH_THRESHOLD = 8

/** Meter segment indexes. */
const SEGMENTS = [0, 1, 2, 3, 4] as const

/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real (Menu primitive's measure pass). */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** A vendor tile's content: the vendor mark, or the monogram when none applies. */
function tileContent(profile: ModelProfile): ReactNode {
  return profile.mark === undefined ? profile.glyph : <VendorMarkIcon mark={profile.mark} />
}

/** One selectable model row. */
interface Row {
  readonly provider: ModelLabelOwner['provider']
  readonly model: ModelCatalogModel
  readonly profile: ModelProfile
}

/** Full composer model-seat props. */
export type ModelSelectProps =
  InjectFace<ModelSelectInjected>
  & Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'useProjection'>
  & PropsLocale<'modern-model'>
  & Omit<PropsRenderSlots<'modern.conversation.input.model.label'>, 'SessionProvider'>

function Meter({ value, column }: { value: number | undefined; column: number }) {
  return (
    <span className={css.meter} style={{ '--column': column } as CSSProperties}>
      {SEGMENTS.map(segment => (
        <span
          key={segment}
          className={css.segment}
          data-on={value !== undefined && segment < value ? '' : undefined}
          style={{ '--segment': segment } as CSSProperties}
        />
      ))}
    </span>
  )
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked, projections), injected face (directory and
 * picker-settings hooks, verbs), the label child slot, and the locale seat.
 * @returns the trigger and, while open, the popover.
 */
export function ModelSelect({
  locked, available, useModelDirectory, useModelPicker, load, select, t, renderSlot,
}: ModelSelectProps) {
  const state = useModelDirectory(snapshot => snapshot)
  const settings = useModelPicker(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [pointing, setPointing] = useState(false)
  const [selectionFocus, setSelectionFocus] = useState(false)
  // The in-popover error strip serves catalog loads (its Retry re-runs the
  // load); rejected selections announce through the transient toast instead.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<(HTMLDivElement | null)[]>([])
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)
  const id = useId()

  const accountProviderName = t('provider.account')
  const groups = useMemo(() => orderModelProviders(state.groups).map(group => ({
    id: group.id,
    provider: { id: group.id, name: group.id === 'deepseek-account' ? accountProviderName : group.name },
    models: group.models.map(model => ({ model, profile: profileOf(model, settings) })),
  })), [state.groups, accountProviderName, settings])
  const rows = useMemo(() => groups.flatMap(group => group.models.map(({ model, profile }): Row => ({
    provider: group.provider, model, profile,
  }))), [groups])
  const showSearch = rows.length > SEARCH_THRESHOLD
  const filteredGroups = useMemo(() => {
    const needle = showSearch ? query.trim() : ''
    return groups.map((group) => {
      const byModel = new Map(group.models.map(entry => [entry.model, entry.profile]))
      const ranked = rankByName(group.models.map(entry => entry.model), needle)
      return {
        ...group,
        rows: ranked.map((model): Row => ({ provider: group.provider, model, profile: byModel.get(model) as ModelProfile })),
      }
    }).filter(group => group.rows.length > 0)
  }, [groups, query, showSearch])
  const visible = useMemo(() => filteredGroups.flatMap(group => group.rows), [filteredGroups])

  const isCurrent = (row: Row): boolean =>
    state.current?.provider === row.provider.id && state.current.model === row.model.id
  const currentChoice = rows.find(isCurrent)
  const currentVisibleIndex = visible.findIndex(isCurrent)
  const activeIndex = Math.min(highlighted ?? Math.max(0, currentVisibleIndex), visible.length - 1)
  const reasoning = currentChoice?.model.reasoning
  const effort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const efforts = currentChoice === undefined
    ? []
    : visibleEfforts(currentChoice.profile.efforts, reasoning?.efforts ?? [], effort)
  const offLevel = efforts.find(level => isOffEffort(level.id))
  const thinkingLevels = efforts.filter(level => !isOffEffort(level.id))
  // An unstated effort is the provider's default, which thinks unless told otherwise.
  const thinking = effort === undefined || !isOffEffort(effort)
  const { pending } = state
  const busy = pending !== null

  const effortName = (effortId: string, fallback: string | undefined): string => {
    const key = EFFORT_SHORT.get(effortId)
    return key === undefined ? fallback ?? effortId : t(key)
  }
  const effortLabel = currentChoice === undefined
    ? undefined
    : reasoning === undefined
      ? state.retainedEffort
      : effort === undefined
        ? t('effort.providerDefault')
        : effortName(effort, reasoning.efforts.find(level => level.id === effort)?.name)
  const showsBulb = reasoning !== undefined && thinking && thinkingLevels.length > 0

  /** The effort picking `row` applies; see the module comment. */
  const effortFor = (row: Row): string | undefined => {
    if (row.model.reasoning === undefined) return undefined
    const levels = row.profile.efforts
    if (effort !== undefined && isOffEffort(effort)) {
      const off = levels.find(level => isOffEffort(level.id))
      if (off !== undefined) return off.id
    }
    return preferredEffort(levels, row.model.reasoning.defaultEffort, effort) ?? levels[0]?.id
  }

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      // The portaled card is outside the trigger subtree; check both.
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // Opening moves the keyboard into the popover: search on desktop devices
  // when shown, otherwise the list, so phones keep their keyboard closed.
  // The card measures itself hidden first and hidden elements refuse focus,
  // so this waits for the placed render. Only the open transition moves
  // focus; later renders leave it alone.
  const focusOnOpen = useRef(false)
  const placed = menuPos !== null
  useEffect(() => {
    if (!open || !placed || !focusOnOpen.current) return
    focusOnOpen.current = false
    if (showSearch && !isMobileDevice()) searchRef.current?.focus()
    else listRef.current?.focus()
  }, [open, placed, showSearch])

  useEffect(() => {
    const viewport = listRef.current
    if (!open || viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [open, filteredGroups])

  useLayoutEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, visible])

  // The portal needs viewport coordinates from the trigger and the card's
  // measured size before paint; slot content can resize without parent renders.
  useLayoutEffect(() => {
    if (!available || !open) { setMenuPos(null); return }
    // The trigger, the card, and its list are all mounted while the popover is open.
    const menu = menuRef.current as HTMLDivElement
    const list = listRef.current as HTMLDivElement
    const place = (): void => {
      const rect = (triggerRef.current as HTMLButtonElement).getBoundingClientRect()
      const MARGIN = 12
      const GAP = 8
      const lw = menu.offsetWidth
      // The card's natural height: its laid-out height with the list at full length.
      const lh = menu.offsetHeight - list.clientHeight + list.scrollHeight
      const above = rect.top - GAP - MARGIN
      const below = window.innerHeight - rect.bottom - GAP - MARGIN
      // Open upward like the composer's other menus; flip below only when the
      // card does not fit above and more room waits below.
      const down = lh > above && below > above
      const room = Math.max(down ? below : above, 0)
      let x = rect.right - lw
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN)
      const y = down ? rect.bottom + GAP : rect.top - GAP - Math.min(lh, room)
      setMenuPos(lh > 0
        ? { left: x, top: Math.max(y, MARGIN), '--picker-room': `${room}px` } as CSSProperties
        : { left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [available, open, state, query])

  if (!available) return null

  const announce = (text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }

  const show = (): void => {
    setSelectionFocus(false)
    setQuery('')
    setHighlighted(null)
    setPointing(false)
    focusOnOpen.current = true
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const settle = (result: Awaited<ReturnType<ModelSelectInjected['select']>>, closeOnSuccess: boolean): void => {
    if (result === undefined) return
    if (result.ok) {
      if (closeOnSuccess && rootRef.current !== null) {
        setSelectionFocus(true)
        close(true)
      }
      return
    }
    const { error } = result
    announce(error.code === 'session/writer-held'
      ? t('error.sessionInUse')
      : t('error.action', { message: `${error.code}: ${error.message}` }))
  }

  const submit = (selection: ModelSelection, closeOnSuccess: boolean): void => {
    lastActionRef.current = 'select'
    void select(selection).then((result) => { settle(result, closeOnSuccess) })
  }

  const pick = (row: Row | undefined): void => {
    if (row === undefined || busy) return
    if (isCurrent(row)) {
      setSelectionFocus(true)
      close(true)
      return
    }
    const reasoningEffort = effortFor(row)
    submit({
      provider: row.provider.id,
      model: row.model.id,
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }, true)
  }

  const chooseEffort = (next: string): void => {
    if (state.current === null || busy || next === effort) return
    submit({ provider: state.current.provider, model: state.current.model, reasoningEffort: next }, false)
  }

  // The switch renders only while the model offers both an off level and a thinking level.
  const toggleThinking = (on: boolean): void => {
    chooseEffort(on
      ? preferredEffort(thinkingLevels, reasoning?.defaultEffort, undefined) as string
      : (offLevel as (typeof efforts)[number]).id)
  }

  const moveHighlight = (next: number): void => {
    setPointing(false)
    setHighlighted(next)
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing) return
    const inSearch = event.target instanceof HTMLInputElement
    const count = visible.length
    if (count === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveHighlight((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
    } else if (!inSearch && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault()
      moveHighlight(event.key === 'Home' ? 0 : count - 1)
    } else if (event.key === 'Enter' || (!inSearch && event.key === ' ')) {
      event.preventDefault()
      pick(visible[activeIndex])
    }
  }

  const onEffortKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (busy) {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault()
      return
    }
    const index = thinkingLevels.findIndex(level => level.id === effort)
    const last = thinkingLevels.length - 1
    const target = event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last : undefined
    if (target === undefined) return
    event.preventDefault()
    const next = thinkingLevels[target] as (typeof thinkingLevels)[number]
    chooseEffort(next.id)
    const pills = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-effort]')]
    pills.find(pill => pill.dataset['effort'] === next.id)?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (!open) {
      if (event.target === triggerRef.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        show()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key !== 'Tab') return
    // During an effort save, use the focused pill as the group's single stop.
    // Other non-tab-stop controls keep the existing entry-at-either-end behavior.
    const focused = document.activeElement
    const focusedGroup = focused?.closest('[role="radiogroup"]') ?? null
    const stops = [...(menuRef.current as HTMLDivElement).querySelectorAll<HTMLElement>(
      'input, [role="listbox"], button:not([disabled])',
    )].filter(stop => !stop.hidden && (focusedGroup?.contains(stop) === true
      ? stop === focused
      : stop.tabIndex >= 0))
    if (stops.length === 0) return
    const at = stops.indexOf(focused as HTMLElement)
    event.preventDefault()
    const next = at === -1
      ? (event.shiftKey ? stops.length - 1 : 0)
      : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    stops[next]?.focus()
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && (
      rootRef.current?.contains(event.relatedTarget) === true
      || menuRef.current?.contains(event.relatedTarget) === true
    )) return
    close()
  }

  const waiting = currentChoice === undefined && state.status === 'loading'
  const modelLabel = waiting ? t('trigger.loading') : currentChoice?.model.name ?? t('trigger.fallback')
  const showsEffort = effortLabel !== undefined && (reasoning === undefined || showsBulb)
  const triggerTitle = showsEffort ? `${modelLabel} · ${effortLabel}` : modelLabel
  const triggerAria = waiting
    ? t('trigger.loading')
    : currentChoice === undefined
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  const renderModelLabel = (row: Row, placement: ModelLabelOwner['placement'], selected: boolean) => (
    <span data-provider-id={row.provider.id} data-model-id={row.model.id}>
      {renderSlot('modern.conversation.input.model.label', {
        provider: row.provider, model: row.model, placement, selected,
      }, { fallback: row.model.name })}
    </span>
  )
  /** A row's spoken description: its one-line description, then its ratings. */
  const describe = (description: string | undefined, profile: ModelProfile): string | undefined => {
    const parts = [
      ...description === undefined ? [] : [description],
      ...([
        ['column.speed', profile.speed], ['column.quality', profile.quality], ['column.cost', profile.cost],
      ] as const).flatMap(([label, value]) => value === undefined ? [] : [t('rating.value', { label: t(label), value })]),
    ]
    return parts.length === 0 ? undefined : parts.join(t('rating.separator'))
  }

  const shown = visible[activeIndex] ?? currentChoice
  const shownEffort = shown === undefined ? undefined : isCurrent(shown) ? effort : effortFor(shown)
  const latency = shown === undefined
    ? undefined
    : thinkingLatency(shown.profile.latencyMs, shown.profile.efforts, shownEffort)
  const price = shown?.profile.priceInput === undefined || shown.profile.priceOutput === undefined
    ? undefined
    : { input: formatPrice(shown.profile.priceInput), output: formatPrice(shown.profile.priceOutput) }
  const showGroups = filteredGroups.length > 1
  let optionIndex = 0

  const renderOption = (row: Row) => {
    const index = optionIndex++
    const selected = isCurrent(row)
    const { profile } = row
    const description = profile.description ?? (profile.blurb === undefined ? undefined : t(`preset.${profile.blurb}`))
    const rated = profile.speed !== undefined || profile.quality !== undefined || profile.cost !== undefined
    return (
      <div
        key={`${row.provider.id}/${row.model.id}`}
        ref={(node) => { optionRefs.current[index] = node }}
        id={`${id}-option-${index}`}
        role="option"
        aria-selected={selected}
        aria-disabled={busy || undefined}
        aria-labelledby={`${id}-option-${index}-name`}
        aria-description={describe(description, profile)}
        className={css.option}
        data-active={index === activeIndex ? '' : undefined}
        title={row.model.name}
        onPointerMove={() => {
          if (!pointing) setPointing(true)
          if (index !== activeIndex) setHighlighted(index)
        }}
        onClick={() => { pick(row) }}
      >
        <span className={css.glyph} aria-hidden="true">{tileContent(profile)}</span>
        <span className={css.text}>
          <span className={css.title}>
            <span className={css.name} id={`${id}-option-${index}-name`}>{renderModelLabel(row, 'option', selected)}</span>
            <span className={css.check} aria-hidden="true">
              {pending?.provider === row.provider.id && pending.model === row.model.id
                ? <StateDot state="ongoing" />
                : selected ? <IconCheckOutlineRegular /> : null}
            </span>
          </span>
          {description !== undefined && <span className={css.description} aria-hidden="true">{description}</span>}
        </span>
        {rated
          ? (
            <span className={css.meters} aria-hidden="true">
              <Meter value={profile.speed} column={0} />
              <Meter value={profile.quality} column={1} />
              <Meter value={profile.cost} column={2} />
            </span>
          )
          : <span className={css.unrated} aria-hidden="true">{t('option.unrated')}</span>}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
      onMouseDown={(event) => {
        // Pressing anything but the search field keeps focus where it is: WebKit
        // would blur a focused control before click, and a press on label text
        // would otherwise move focus out and close the popover.
        if (event.target instanceof Element && event.target.closest('input') === null) event.preventDefault()
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerTitle}
        aria-busy={busy}
        data-selection-focus={selectionFocus ? '' : undefined}
        onBlur={() => { setSelectionFocus(false) }}
        disabled={locked}
        onClick={() => { if (open) close(true); else show() }}
      >
        {currentChoice === undefined
          ? <IconDataOutlineRegular className={css.triggerIcon} size={16} />
          : <span className={clsx(css.glyph, css.triggerGlyph)} aria-hidden="true">{tileContent(currentChoice.profile)}</span>}
        <span className={css.triggerLabel}>
          {currentChoice === undefined ? modelLabel : renderModelLabel(currentChoice, 'trigger', true)}
        </span>
        {showsEffort && (
          <span className={css.triggerEffort}>
            <span className={css.triggerEffortInner}>
              {showsBulb && <IconThinkOutlineRegular className={css.bulb} size={14} />}
              <span className={css.triggerEffortText}>{effortLabel}</span>
            </span>
          </span>
        )}
        {busy
          ? <StateDot state="ongoing" />
          : <IconChevronDownOutlineRegular className={clsx(css.chevron, open && css.chevronOpen)} />}
      </button>

      {/* Portaled to body (Menu primitive's portal mode) so the sidebar and
          column overflow clips cannot crop the card; synthetic events still
          bubble through this React subtree, keeping onKeyDown/onBlur live. */}
      {open && createPortal(
        <MenuSurface
          ref={menuRef}
          id={`${id}-menu`}
          className={css.menu}
          style={menuPos ?? MEASURE_STYLE}
          role="dialog"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          <div className={css.head} aria-hidden="true">
            <span>{t('menu.model')}</span>
            <span className={css.columns}>
              <span>{t('column.speed')}</span>
              <span>{t('column.quality')}</span>
              <span>{t('column.cost')}</span>
            </span>
          </div>
          {showSearch && (
            <div className={css.searchRow}>
              <Input
                ref={searchRef}
                className={clsx(css.search, query !== '' && css.searchWithQuery)}
                type="text"
                role="combobox"
                aria-label={t('search.placeholder')}
                aria-controls={`${id}-models`}
                aria-expanded
                aria-autocomplete="list"
                aria-activedescendant={activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
                placeholder={t('search.placeholder')}
                value={query}
                readOnly={busy}
                onKeyDown={onListKeyDown}
                onChange={(event) => {
                  setQuery(event.target.value)
                  moveHighlight(0)
                }}
              />
              {query !== '' && (
                <button
                  type="button"
                  className={css.searchClear}
                  aria-label={t('search.clear')}
                  disabled={busy}
                  onClick={() => {
                    setQuery('')
                    moveHighlight(0)
                    searchRef.current?.focus()
                  }}
                >
                  <IconCloseFillRegular />
                </button>
              )}
            </div>
          )}
          {/* A background refresh keeps the listed models; only an empty list waits on the load. */}
          {state.status === 'loading' && rows.length === 0 && <div className={css.status}>{t('status.loading')}</div>}
          {state.error !== null && lastActionRef.current === 'load' && (
            <div className={css.error}>
              <span>{t('error.action', { message: state.error })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          )}
          {state.failures.map(failure => (
            <div className={css.warning} key={failure.id}>
              <span>{t('warning.groupLoad', {
                name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name, message: failure.message,
              })}</span>
              <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
            </div>
          ))}
          <div
            ref={listRef}
            id={`${id}-models`}
            className={clsx(css.list, 'scrollable')}
            role="listbox"
            aria-label={t('menu.model')}
            tabIndex={showSearch ? -1 : 0}
            aria-activedescendant={showSearch || activeIndex < 0 ? undefined : `${id}-option-${activeIndex}`}
            data-pointing={pointing ? '' : undefined}
            hidden={filteredGroups.length === 0}
            onKeyDown={onListKeyDown}
            onPointerLeave={() => { setPointing(false) }}
          >
            {showGroups
              ? filteredGroups.map(group => (
                <MenuGroup key={group.id} label={group.provider.name}>
                  {group.rows.map(renderOption)}
                </MenuGroup>
              ))
              : visible.map(renderOption)}
          </div>
          {state.status === 'ready' && filteredGroups.length === 0 && (
            <div className={css.empty} role="status">{t(rows.length === 0 ? 'empty.models' : 'search.empty')}</div>
          )}
          {(thinkingLevels.length > 0) && (
            <div className={css.settings}>
              {offLevel !== undefined && thinkingLevels.length > 0 && (
                <label className={css.toggle}>
                  <IconThinkOutlineRegular className={css.toggleIcon} size={16} />
                  <span className={css.toggleLabel}>{t('thinking.label')}</span>
                  <Switch
                    className={css.switch}
                    checked={thinking}
                    label={t('thinking.label')}
                    busy={busy}
                    onChange={toggleThinking}
                  />
                </label>
              )}
              {thinkingLevels.length > 1 && (
                <div className={css.fold} data-open={thinking ? '' : undefined} aria-hidden={thinking ? undefined : true}>
                  <div className={css.clip}>
                    <div className={css.effort}>
                      <span className={css.effortLabel} id={`${id}-effort`}>{t('menu.effort')}</span>
                      <div className={css.pills} role="radiogroup" aria-labelledby={`${id}-effort`} onKeyDown={onEffortKeyDown}>
                        {thinkingLevels.map((level, index) => {
                          const checked = level.id === effort
                          const entry = checked || (index === 0 && !thinkingLevels.some(other => other.id === effort))
                          return (
                            <button
                              key={level.id}
                              type="button"
                              role="radio"
                              aria-checked={checked}
                              data-effort={level.id}
                              tabIndex={entry ? 0 : -1}
                              className={css.pill}
                              title={level.description}
                              aria-disabled={busy || undefined}
                              disabled={!thinking}
                              onClick={() => { chooseEffort(level.id) }}
                            >
                              {effortName(level.id, level.name)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {shown !== undefined && (
            <div className={css.tray}>
              <span className={css.facts}>
                {latency !== undefined && (
                  <span className={css.fact}>
                    <b>{t('tray.seconds', { seconds: (latency / 1000).toFixed(1) })}</b>
                    {t('tray.firstToken')}
                  </span>
                )}
                <span className={css.fact} title={price === undefined ? undefined : t('tray.priceTitle', price)}>
                  {price === undefined ? t('tray.noPrice') : t('tray.price', price)}
                </span>
              </span>
              <span className={css.keys} aria-hidden="true">
                <kbd className={css.key}>{t('tray.keysMove')}</kbd>
                <kbd className={css.key}>{t('tray.keysPick')}</kbd>
              </span>
            </div>
          )}
        </MenuSurface>,
        document.body,
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
