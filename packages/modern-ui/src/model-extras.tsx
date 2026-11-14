/**
 * The composer's model seat: Modern UI's model picker and, beside it, a menu for settings that belong to the selected
 * model's provider.
 *
 * Subscription plugins bring settings of their own (a context size, a fast mode). They used to reach the composer by
 * adding rows to the official model menu, or by replacing the model picker outright; neither works once Modern UI
 * owns the picker. The seat therefore declares `conversation.input.model.parameters` and shows whatever plugins
 * register there in a menu of its own, next to the model button:
 *
 * - The button appears only while something has rows for the selected model. Rows that do not apply render nothing
 *   (the contract plugins already follow), so the rows stay mounted while the menu is closed and the button follows
 *   what they rendered.
 * - Closing the menu remounts the rows: an expanded list, or a key listener a row left on the document, ends with it.
 * - The Codex subscription plugin offers no rows; its speed setting is read and written through that plugin's own
 *   preferences (model-extras-codex.ts) and shown here while a Codex model is selected.
 * - Official 0.2.2-rc.2 adds session options that are not about a provider (`conversation.input.model.options`,
 *   where its Team mode switch registers). They follow the provider's rows in the same menu; the provider heading
 *   shows only while something of the provider's rendered. With session options alone, the button is named for
 *   them, and it is left out of a phone-width composer, whose row has no room for it beside the access mode and
 *   the model name.
 *
 * Keys: Enter or Space on the button opens; ↑/↓, Home and End move across the rows (menu items, and the switches
 * of session options); Escape closes back to the button (a row may take the first Escape to fold its own list); Tab
 * visits row controls, then leaves and closes.
 */
import { SegmentedTrack } from './segmented-control.tsx'
import {
  Component,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  focusWithoutRing,
  IconSlidersTwoOutlineRegular,
  IconWarningOutlineRegular,
  MenuSurface,
  Toast,
  useDismissOnOutsidePointer,
} from '@iroha1145/dsh-modern-ui/primitives'
import type { ModelCatalogModel } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ObservableSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ModelSelect } from './vendor/model/client/ModelSelect.tsx'
import type { ModelLabelOwner, ModelSelectInjected } from './vendor/model/client/slots.ts'
import { useDismissBehindModal } from './vendor/primitives/useDismissBehindModal.ts'
import { CODEX_PROVIDER, codexSpeedChoices, effectiveCodexSpeed, type CodexSpeed, type CodexSpeedMode, type CodexSpeedState } from './model-extras-codex.ts'
import css from './model-extras.module.css'

/** What the seat hands to rows registered in `conversation.input.model.parameters`. */
export interface ModelParametersOwner {
  /** Provider of the selected model. */
  provider: ModelLabelOwner['provider']
  /** The selected model. */
  model: ModelCatalogModel
  /** The session takes no changes (removed, not active, or not live): rows show their values and change nothing. */
  locked: boolean
  /** Close the menu and return focus to its button. */
  dismiss: () => void
  /** Tell the user that a change did not go through. */
  reportFailure: (message: string) => void
  /** Ref for a row's main button; kept for rows written against the official menu, which tracked its rows by ref. */
  itemRef: Ref<HTMLButtonElement>
  /** Class of a full-width row: a label on the left, its value on the right. */
  cellClassName: string
  /** Class of a row's label. */
  labelClassName: string
  /** Class of a row's value. */
  valueClassName: string
}

/** What the seat hands to rows registered in `conversation.input.model.options`; the official owner's shape. */
export interface ModelOptionsOwner {
  /** The session takes no changes: rows show their values and change nothing. */
  locked: boolean
  /** Close the menu and return focus to its button, before a row opens another overlay. */
  dismiss: () => void
  /** Tell the user that a change did not go through. */
  reportFailure: (message: string) => void
}

/** Injected face of the model seat: the picker's, plus what the provider menu reads. */
export interface ModelSeatInjected extends Omit<ModelSelectInjected, 'hooks'> {
  hooks: ModelSelectInjected['hooks'] & {
    /** How many plugins registered rows; with none, the seat mounts nothing for them. */
    modelParameters: ObservableSnapshot<number>
    /** How many plugins registered session options. */
    modelOptions: ObservableSnapshot<number>
    /** The Codex subscription plugin's speed preference. */
    codexSpeed: SnapshotStore<CodexSpeedState>
  }
  /** Read and write the Codex speed preference. The same object for every session and render. */
  codex: Pick<CodexSpeed, 'refresh' | 'choose'>
}

/** Full props of the model seat. */
export type ModelSeatProps = InjectFace<ModelSeatInjected> &
  Pick<PropsRuntime<'conversation.input.model'>, 'locked' | 'useProjection'> &
  PropsLocale<'modern-model'> &
  Omit<PropsRenderSlots<'conversation.input.model.label' | 'conversation.input.model.parameters' | 'conversation.input.model.options'>, 'SessionProvider'>

const GAP = 8
const MARGIN = 12
/** After the rows remount, how long they may stay empty before the button leaves (a row may load before it renders). */
const SETTLE_MS = 400
/** The closed menu stays laid out so its rows keep rendering; it is invisible and inert. */
const CLOSED: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
const ITEMS = '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"]), [data-session-options] [role="switch"]:not(:disabled):not([aria-disabled="true"])'
/** What counts as a rendered row: wrappers the slot renderer leaves around an empty entry do not. */
const CONTENT = 'button, input, select, textarea, a[href], [role^="menuitem"], [tabindex]'
const TABBABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]'
/** Rows that take keys themselves; the marker is the one rows written for the official menu already carry. */
const OWN_KEYS = 'input, textarea, select, [contenteditable], [data-model-parameters-fields]'

/** A plugin's rows must not take the model seat down with them. */
class Rows extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Render the provider menu: its button while there is something to show, and the menu.
 * @param props - the seat's props.
 * @returns the button and the portaled menu.
 */
function ModelExtras({ locked, useModelDirectory, useModelParameters, useModelOptions, useCodexSpeed, codex, t, renderSlot }: ModelSeatProps) {
  const state = useModelDirectory(snapshot => snapshot)
  const registered = useModelParameters(count => count)
  const sessionOptions = useModelOptions(count => count)
  const speed = useCodexSpeed(snapshot => snapshot)
  const id = useId()
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const rowsRef = useRef<HTMLDivElement | null>(null)
  const providerRowsRef = useRef<HTMLDivElement | null>(null)
  const itemRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const [filled, setFilled] = useState(false)
  const [providerFilled, setProviderFilled] = useState(false)
  const [generation, setGeneration] = useState(0)
  const settleUntil = useRef(0)
  const focusOnOpen = useRef<'row' | 'menu' | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)

  const accountName = t('provider.account')
  const { current, groups } = state
  const choice = useMemo(() => {
    const group = groups.find(candidate => candidate.id === current?.provider)
    const model = group?.models.find(candidate => candidate.id === current?.model)
    return group === undefined || model === undefined
      ? undefined
      : { provider: { id: group.id, name: group.id === 'deepseek-account' ? accountName : group.name }, model }
  }, [current?.provider, current?.model, groups, accountName])

  // The plugin sends no change events and its own settings page writes the same value: ask whenever a Codex model
  // becomes the selection, and again each time the menu opens.
  const codexModel = choice?.provider.id === CODEX_PROVIDER ? choice.model.id : undefined
  const { refresh, choose } = codex
  useEffect(() => {
    if (codexModel !== undefined) refresh()
  }, [codexModel, refresh])
  const speeds = codexModel === undefined ? [] : codexSpeedChoices(speed, codexModel)
  const chosenSpeed = effectiveCodexSpeed(speed, speeds)

  const hostsProviderRows = choice !== undefined && registered > 0
  const hostsOptions = sessionOptions > 0
  const hostsRows = hostsProviderRows || hostsOptions
  const mounted = speeds.length > 0 || hostsRows
  const visible = speeds.length > 0 || (hostsRows && filled)
  const shown = open && visible && !locked

  const close = useCallback((restoreFocus = false): void => {
    setOpen(false)
    settleUntil.current = performance.now() + SETTLE_MS
    setGeneration(value => value + 1)
    if (restoreFocus)
      queueMicrotask(() => {
        buttonRef.current?.focus()
      })
  }, [])
  const dismiss = useCallback((): void => {
    close()
  }, [close])

  const announce = useCallback((text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])

  // A session that stops taking changes, or rows that stop applying, end an open menu.
  useEffect(() => {
    if (open && !shown) close()
  }, [open, shown, close])
  useDismissOnOutsidePointer(rootRef, shown, dismiss, panelRef)
  useDismissBehindModal(buttonRef, shown, dismiss)
  useEffect(() => {
    if (!shown) return
    const leave = (event: FocusEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) !== true && panelRef.current?.contains(event.target) !== true) close()
    }
    document.addEventListener('focusin', leave)
    return () => {
      document.removeEventListener('focusin', leave)
    }
  }, [shown, close])

  // Whether the rows rendered anything is only visible in the DOM: an entry that does not apply returns null.
  useEffect(() => {
    const host = rowsRef.current
    if (!hostsRows || host === null) {
      setFilled(false)
      setProviderFilled(false)
      return
    }
    const has = (rows: Element | null): boolean => rows !== null && (rows.querySelector(CONTENT) !== null || (rows.textContent ?? '').trim() !== '')
    let timer: number | undefined
    const check = (): void => {
      window.clearTimeout(timer)
      // The provider's rows are told apart from session options: the heading and the button's name are the provider's.
      const any = has(host)
      const provider = has(providerRowsRef.current)
      if (any) setFilled(true)
      if (provider) setProviderFilled(true)
      if (any && provider) return
      const wait = settleUntil.current - performance.now()
      if (wait > 0) {
        timer = window.setTimeout(check, wait)
        return
      }
      if (!any) setFilled(false)
      if (!provider) setProviderFilled(false)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(host, { subtree: true, childList: true, characterData: true })
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [hostsRows])

  // Every commit: the menu mounts and unmounts with its content, apart from opening and closing.
  useLayoutEffect(() => {
    if (panelRef.current !== null) panelRef.current.inert = !shown
  })

  // The menu hangs from the edge facing the button, so rows that unfold grow it away from the button without a
  // second placement pass.
  useLayoutEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current
    const body = bodyRef.current
    if (!shown || button === null || panel === null || body === null) {
      setPlace(null)
      return
    }
    const put = (): void => {
      // The button can leave while the menu is open: a window narrowed to phone width hides it for session options.
      if (button.getClientRects().length === 0) {
        close()
        return
      }
      const rect = button.getBoundingClientRect()
      const width = document.documentElement.clientWidth
      const height = document.documentElement.clientHeight
      const natural = panel.offsetHeight - body.clientHeight + body.scrollHeight
      const above = rect.top - GAP - MARGIN
      const below = height - rect.bottom - GAP - MARGIN
      const down = natural > above && below > above
      const next: CSSProperties & { '--extras-room': string } = {
        right: Math.max(MARGIN, Math.min(width - rect.right, width - MARGIN - panel.offsetWidth)),
        ...(down ? { top: rect.bottom + GAP } : { bottom: height - rect.top + GAP }),
        '--extras-room': `${Math.max(down ? below : above, 0)}px`,
      }
      setPlace(previous => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
    }
    put()
    // The page can move the button without resizing anything: a scroll, or a layout change such as the conversation
    // opening above the composer. One rect read per frame while the menu is open follows all of them.
    let seen = button.getBoundingClientRect()
    let frame = window.requestAnimationFrame(function follow() {
      const rect = button.getBoundingClientRect()
      if (rect.left !== seen.left || rect.top !== seen.top) put()
      seen = rect
      frame = window.requestAnimationFrame(follow)
    })
    window.addEventListener('resize', put)
    const observer = new ResizeObserver(put)
    observer.observe(button)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', put)
    }
  }, [shown, close])

  // The keyboard goes into the menu once it is placed: to the first row after a key press, to the menu itself
  // (no focus ring) after a click.
  const placed = shown && place !== null
  useEffect(() => {
    const panel = panelRef.current
    if (!placed || panel === null || focusOnOpen.current === null) return
    const row = focusOnOpen.current === 'row' ? panel.querySelector<HTMLElement>(ITEMS) : null
    focusOnOpen.current = null
    if (row === null) focusWithoutRing(panel)
    else row.focus()
  }, [placed])

  // Rows keep the callback they were given, whatever language the next render speaks.
  const translate = useRef(t)
  translate.current = t
  const reportFailure = useCallback(
    (message: string): void => {
      announce(translate.current('error.action', { message }))
    },
    [announce],
  )
  const owner = useMemo(
    (): ModelParametersOwner | undefined =>
      choice === undefined
        ? undefined
        : {
            provider: choice.provider,
            model: choice.model,
            locked,
            dismiss: () => {
              close(true)
            },
            reportFailure,
            itemRef,
            cellClassName: css.cell,
            labelClassName: css.cellLabel,
            valueClassName: css.cellValue,
          },
    [choice, locked, close, reportFailure],
  )

  const optionsOwner = useMemo(
    (): ModelOptionsOwner => ({
      locked,
      // Focus goes back at once, as the official menu does it: the row may open another overlay right after.
      dismiss: () => {
        close()
        buttonRef.current?.focus()
      },
      reportFailure,
    }),
    [locked, close, reportFailure],
  )

  let rows: ReactNode = null
  if (hostsProviderRows && owner !== undefined) {
    // An entry whose registration went away between renders makes the binding throw; the menu simply has no rows.
    try {
      rows = renderSlot('conversation.input.model.parameters', owner)
    } catch {
      rows = null
    }
  }
  let options: ReactNode = null
  if (hostsOptions) {
    try {
      options = renderSlot('conversation.input.model.options', optionsOwner)
    } catch {
      options = null
    }
  }

  const show = (keyboard: boolean): void => {
    focusOnOpen.current = keyboard ? 'row' : 'menu'
    setOpen(true)
    if (codexModel !== undefined) refresh()
  }

  const pickSpeed = (mode: CodexSpeedMode): void => {
    if (mode === chosenSpeed || speed.pending !== undefined) return
    void choose(mode).then(outcome => {
      if (!outcome.ok) announce(t('extras.speed.failed', { message: outcome.message }))
      else if (outcome.restartRequired) announce(t('extras.speed.restart'))
    })
  }

  /**
   * Act on one key press while the menu is open.
   * @param event - the native key event.
   * @returns whether the menu took the key.
   */
  const takeKey = (event: globalThis.KeyboardEvent): boolean => {
    const panel = panelRef.current
    if (!shown || panel === null || event.defaultPrevented || event.isComposing || !(event.target instanceof Element)) return false
    const inMenu = panel.contains(event.target)
    if (event.key === 'Tab') {
      if (inMenu) {
        const controls = [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter(
          control => control.tabIndex >= 0 && control.getClientRects().length > 0 && !control.closest('[inert], [aria-hidden="true"]'),
        )
        const at = controls.indexOf(document.activeElement as HTMLElement)
        if (at === -1 && controls.length > 0) {
          event.preventDefault()
          controls[event.shiftKey ? controls.length - 1 : 0]?.focus()
          return true
        }
        if (at >= 0 && (event.shiftKey ? at > 0 : at < controls.length - 1)) return false
      }
      // At the edge, continue beside the trigger; close even if focus leaves the document.
      buttonRef.current?.focus()
      close()
      return false
    }
    if (event.key === 'Escape') {
      if (inMenu && event.target.closest('[data-model-parameters-fields]') !== null) return false
      event.preventDefault()
      close(true)
      return true
    }
    if (inMenu && event.target.closest(OWN_KEYS) !== null) return false
    const sideways = inMenu && event.target.closest('[data-speeds]') !== null
    const step =
      event.key === 'ArrowDown' || (sideways && event.key === 'ArrowRight')
        ? 1
        : event.key === 'ArrowUp' || (sideways && event.key === 'ArrowLeft')
          ? -1
          : undefined
    if (step === undefined && (!inMenu || (event.key !== 'Home' && event.key !== 'End'))) return false
    const items = [...panel.querySelectorAll<HTMLElement>(ITEMS)]
    if (items.length === 0) return false
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      step === undefined
        ? event.key === 'Home'
          ? 0
          : items.length - 1
        : at === -1
          ? step === 1
            ? 0
            : items.length - 1
          : (at + step + items.length) % items.length
    items[next]?.focus()
    return true
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (takeKey(event.nativeEvent)) event.stopPropagation()
  }
  // A row that removes or disables the control holding the focus leaves the focus on the page itself, outside both
  // handlers above; the menu still answers the keyboard there.
  const pageKey = useRef(takeKey)
  pageKey.current = takeKey
  useEffect(() => {
    if (!shown) return
    const onPageKey = (event: globalThis.KeyboardEvent): void => {
      if (event.target === document.body && !event.defaultPrevented) pageKey.current(event)
    }
    document.addEventListener('keydown', onPageKey)
    return () => {
      document.removeEventListener('keydown', onPageKey)
    }
  }, [shown])

  // Something of the selected model's provider is on show; otherwise the menu holds session options alone.
  const providerShown = speeds.length > 0 || providerFilled
  const title = t(providerShown ? 'extras.trigger' : 'extras.trigger.session')
  return (
    <span ref={rootRef} className={css.root}>
      {visible && (
        <button
          ref={buttonRef}
          type="button"
          className={css.trigger}
          aria-label={title}
          title={title}
          aria-haspopup="menu"
          aria-expanded={shown}
          aria-controls={shown ? `${id}-menu` : undefined}
          // Session options alone do not earn the button a place in a phone-width composer (model-extras.module.css).
          data-session-only={providerShown ? undefined : ''}
          disabled={locked}
          onKeyDown={onKeyDown}
          onClick={event => {
            if (shown) close(true)
            else show(event.detail === 0)
          }}
        >
          <IconSlidersTwoOutlineRegular size={16} />
        </button>
      )}
      {/* Portaled to body like the model menu, so the sidebar and column clips cannot crop it. */}
      {mounted &&
        createPortal(
          <MenuSurface
            ref={panelRef}
            id={`${id}-menu`}
            className={css.menu}
            style={shown && place !== null ? place : CLOSED}
            data-menu-positioned={placed}
            data-menu-side={place?.top !== undefined ? 'bottom' : 'top'}
            // Closed, it is only a holder for the rows: nothing on the page should take it for an open menu.
            role={shown ? 'menu' : undefined}
            aria-label={shown ? title : undefined}
            aria-hidden={shown ? undefined : true}
            tabIndex={shown ? -1 : undefined}
            onKeyDown={onKeyDown}
          >
            <div ref={bodyRef} className={clsx(css.body, 'scrollable')}>
              {choice !== undefined && providerShown && (
                <div className={css.heading} aria-hidden="true">
                  {t('extras.heading', { provider: choice.provider.name })}
                </div>
              )}
              {speeds.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: This groups menu items; a fieldset's legend cannot share the row with them.
                <div className={css.speed} role="group" aria-labelledby={`${id}-speed`} title={speed.writable ? undefined : t('extras.speed.readonly')}>
                  <span className={css.speedLabel} id={`${id}-speed`}>
                    {t('extras.speed.label')}
                  </span>
                  <SegmentedTrack className={css.pills} count={speeds.length} selectedIndex={speeds.indexOf(chosenSpeed)} data-speeds="">
                    {speeds.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        role="menuitemradio"
                        aria-checked={mode === chosenSpeed}
                        className={css.pill}
                        disabled={!speed.writable}
                        onClick={() => {
                          pickSpeed(mode)
                        }}
                      >
                        {t(`extras.speed.${mode}`)}
                      </button>
                    ))}
                  </SegmentedTrack>
                </div>
              )}
              {hostsRows && (
                <div ref={rowsRef} className={css.rows}>
                  <div ref={providerRowsRef} className={css.group}>
                    <Rows key={generation}>{rows}</Rows>
                  </div>
                  <div className={css.group} data-session-options="">
                    <Rows key={`options:${generation}`}>{options}</Rows>
                  </div>
                </div>
              )}
            </div>
          </MenuSurface>,
          document.body,
        )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => {
            setToast(null)
          }}
        />
      )}
    </span>
  )
}

/**
 * Render the composer's model seat.
 * @param props - the picker's props, plus the provider menu's sources and its child slot.
 * @returns the provider menu's button (while it has something to show) and the model picker.
 */
export function ModelSeat(props: ModelSeatProps) {
  return (
    <>
      {props.available && <ModelExtras {...props} />}
      <ModelSelect {...props} />
    </>
  )
}
