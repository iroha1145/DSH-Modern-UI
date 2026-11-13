/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconEllipsisOutlineRegular, Menu, Tooltip } from '@iroha1145/dsh-modern-ui/primitives'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps, ConversationViewActionsOwnerProps,
} from '../contract/slots.ts'
import { resolveActiveView } from '../view-selection.ts'
import { FIXED_VIEW_ID } from '../view-pins.ts'
import { viewTabIds } from './view-tab-ids.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

type ViewsMoreMenuProps =
  Omit<ConversationViewActionsOwnerProps, 'onDismiss'>
  & Pick<ConversationSessionHeaderSlotProps, 'renderSlot' | 't'>
  & { readonly label: string; readonly current: boolean; readonly allEntries: ConversationViewActionsOwnerProps['entries']; readonly hasEntryActions: boolean }

/** Own pin actions share the More menu with the original extension actions. */
export function ViewsMoreMenu({ label, current, entries, allEntries, hasEntryActions, onOpen, onPinnedChange, renderSlot, t }: ViewsMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const onDismiss = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={onDismiss} portal autoFocus className={css.viewsMoreAnchor} listClassName={css.viewsMoreMenu}
      anchor={(
        <Tooltip label={label} portal>
          <Button size="sm" className={clsx(css.viewsMore, current && css.viewsMoreActive)} data-conversation-views-menu aria-label={label} aria-haspopup="menu" aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}>
            <IconEllipsisOutlineRegular size={13} />
          </Button>
        </Tooltip>
      )}>
      <div className={css.viewPinGroup} role="group" aria-label={t('session.tabVisibility')} data-view-pin-section>
        {allEntries.filter(entry => entry.id !== FIXED_VIEW_ID).map(entry => (
          <button key={entry.id} type="button" role="menuitem" className={css.viewPinAction}
            data-view-pin-action={entry.id}
            onClick={() => { onPinnedChange(entry.id, !entry.pinned); onDismiss() }}>
            {t(entry.pinned ? 'session.hideTab' : 'session.showTab', { name: entry.label })}
          </button>
        ))}
      </div>
      {!hasEntryActions && entries.map(entry => (
        <button key={entry.id} type="button" role="menuitem" className={css.viewPinAction}
          data-view-open-action={entry.id} onClick={() => { onDismiss(); onOpen(entry.id) }}>
          {entry.label}
        </button>
      ))}
      {renderSlot('conversation.session.header.views.actions', { entries, onOpen, onPinnedChange, onDismiss })}
    </Menu>
  )
}

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * The session header's "more" menu on official 0.2.2-rc.2 and later. There the official plugins that used to put
 * a button of their own into `conversation.session.header.utilities` (copy the session as Markdown, download the
 * Session log, feedback, open in an app) add rows to the context-menu service under the `sessionHeader` target
 * instead, and the header shows that service's button; the button hides itself while nothing is registered.
 * Earlier releases register no such Factory, so nothing renders there and their utilities buttons stay as they
 * are. The installed typings predate the Factory.
 * @param renderFactorySlot - the header entry's Factory renderer.
 * @param sessionId - the Session the menu acts on.
 * @param label - the button's accessible name and tooltip.
 * @param className - the header's icon-button class.
 * @returns the button, or nothing on a Host without the Factory.
 */
function sessionHeaderMenu(
  renderFactorySlot: ConversationSessionHeaderProps['renderFactorySlot'],
  sessionId: SessionId,
  label: string,
  className: string | undefined,
): ReactNode {
  const render = renderFactorySlot as unknown as (
    name: 'contextMenu.button',
    props: { target: { kind: 'sessionHeader'; value: { sessionId: SessionId } }; label: string; className?: string | undefined; size?: 'sm' },
  ) => ReactNode
  return render('contextMenu.button', { target: { kind: 'sessionHeader', value: { sessionId } }, label, className, size: 'sm' })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, hideChrome, useSessions, useConversationViews, useStore,
  renderSlot, renderFactorySlot, open, selectView, setPinned, t, useEntryPins, useEntryActions, usePinSaveFailed,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const pinSaveFailed = usePinSaveFailed(value => value)
  const unpinned = useEntryPins(ids => ids)
  const hasEntryActions = useEntryActions(registered => registered)
  const hasMenu = hasEntryActions || tabs.some(tab => tab.id !== FIXED_VIEW_ID)
  const showTabs = !hideChrome && tabs.length > 1
  const tabRow = useRef<HTMLDivElement>(null)
  const [visibleViewLimit, setVisibleViewLimit] = useState(1)
  // Observe only the available row width; individual tabs are not measured.
  useLayoutEffect(() => {
    const row = tabRow.current
    if (row === null || !hasMenu) return
    const updateLimit = (): void => {
      setVisibleViewLimit(Math.max(1, Math.floor((row.clientWidth - 48) / 120)))
    }
    updateLimit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateLimit)
    observer.observe(row)
    return () => { observer.disconnect() }
  }, [showTabs, hasMenu])
  const { visibleTabs, moreTabs } = useMemo(() => {
    const preferred = [
      ...tabs.filter(tab => tab.id === FIXED_VIEW_ID),
      ...tabs.filter(tab => tab.id !== FIXED_VIEW_ID && !unpinned.includes(tab.id)),
    ]
    const visibleTabs = hasMenu ? preferred.slice(0, visibleViewLimit) : preferred
    // An opened overflow view needs a resident tab and name without changing its pin preference.
    if (active !== undefined && !visibleTabs.some(tab => tab.id === active.id)) visibleTabs.push(active)
    const visibleIds = new Set(visibleTabs.map(tab => tab.id))
    return { visibleTabs, moreTabs: tabs.filter(tab => !visibleIds.has(tab.id)) }
  }, [tabs, unpinned, hasMenu, visibleViewLimit, active])
  const currentInMore = moreTabs.some(tab => tab.id === active?.id)
  const focusAfterMenu = useRef(false)
  const focusedTab = useRef<HTMLButtonElement | null>(null)
  useLayoutEffect(() => {
    const focusRemoved = focusedTab.current !== null && !focusedTab.current.isConnected
      && document.activeElement === document.body
    if (!focusAfterMenu.current && !focusRemoved) return
    focusAfterMenu.current = false
    focusedTab.current = null
    const target = active ?? visibleTabs[0]
    if (target !== undefined) {
      const ids = viewTabIds(sessionId, target.id)
      const destination = document.getElementById(ids.tab) ?? document.getElementById(ids.panel)
      // The panel is the whole transcript; moving focus to it must not scroll a long conversation.
      destination?.focus({ preventScroll: true })
    }
  }, [visibleTabs, active, sessionId, showTabs])
  const openFromMenu = (id: string): void => {
    focusAfterMenu.current = true
    selectView(id)
  }
  return (
    <>
      {pinSaveFailed && <span role="alert">{t('settings.saveFailed')}</span>}
      <div className={css.titleRow}>
        {!hideChrome && (
          <>
            <div className={css.titleCluster}>
              <span className={css.headerStatusDot} aria-hidden="true" />
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = last
                    ? (
                      <span className={clsx(css.crumb, summary.subagent && css.crumbSubagent, css.crumbCurrent)}>
                        {summary.displayTitle}
                      </span>
                    )
                    : (
                      <button
                        type="button"
                        className={clsx(css.crumb, summary.subagent && css.crumbSubagent)}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerUtilities}>
              {renderSlot('conversation.session.header.utilities', {})}
              {sessionHeaderMenu(renderFactorySlot, sessionId, t('header.more'), css.headerMenuButton)}
            </div>
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
      {showTabs && (
        <div ref={tabRow} className={css.tabs}>
          <div className={css.viewTabs} role="tablist" aria-label={t('session.tabVisibility')} data-conversation-tabs="">
            {visibleTabs.map(viewTab => (
              <button
                key={viewTab.id}
                type="button"
                role="tab"
                id={viewTabIds(sessionId, viewTab.id).tab}
                aria-controls={viewTabIds(sessionId, viewTab.id).panel}
                aria-selected={viewTab.id === active?.id}
                tabIndex={viewTab.id === (active?.id ?? visibleTabs[0]?.id) ? 0 : -1}
                onFocus={event => { focusedTab.current = event.currentTarget }}
                onBlur={event => {
                  if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) focusedTab.current = null
                }}
                onKeyDown={event => {
                  const index = visibleTabs.findIndex(tab => tab.id === viewTab.id)
                  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1
                    : event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length
                      : event.key === 'ArrowLeft' ? (index - 1 + visibleTabs.length) % visibleTabs.length : undefined
                  if (nextIndex === undefined) return
                  event.preventDefault()
                  const next = visibleTabs[nextIndex]
                  if (next === undefined) return
                  selectView(next.id)
                  document.getElementById(viewTabIds(sessionId, next.id).tab)?.focus()
                }}
                className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                onClick={() => { selectView(viewTab.id) }}
              >
                <Tooltip label={viewTab.label} portal><span className={css.tabLabel}>{viewTab.label}</span></Tooltip>
              </button>
            ))}
          </div>
          {hasMenu && (
            <ViewsMoreMenu
              label={currentInMore && active !== undefined ? t('session.moreViewsCurrent', { name: active.label }) : t('session.moreViews')}
              current={currentInMore}
              t={t}
              hasEntryActions={hasEntryActions}
              allEntries={tabs.map(viewTab => ({
                id: viewTab.id, label: viewTab.label,
                pinned: !unpinned.includes(viewTab.id), active: viewTab.id === active?.id,
              }))}
              entries={moreTabs.map(viewTab => ({
                id: viewTab.id, label: viewTab.label,
                pinned: !unpinned.includes(viewTab.id), active: viewTab.id === active?.id,
              }))}
              onOpen={openFromMenu}
              onPinnedChange={setPinned}
              renderSlot={renderSlot}
            />
          )}
        </div>
      )}
    </>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}

