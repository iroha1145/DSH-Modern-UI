// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE.
/**
 * Sidebar shell: Cloud-Monitor floating frosted-glass navigation (.feel-navigation).
 * Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts and the upper
 * controls enter the rail from the same horizontal offset on one fade that
 * ends with the slide.
 */
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import clsx from 'clsx'
import {
  FishLogo, IconCloseOutlineRegular, IconAppsAddOutlineRegular,
  IconNewChatOutlineMedium, IconNewChatOutlineRegular, IconPanelLeftOutlineRegular,
  isDarwinDesktop, Menu, ShortcutKeys, Toast, Tooltip, useModalLayer, writeClipboard,
} from '@iroha1145/dsh-modern-ui/primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarPanelActionsOwnerProps, SidebarPanelMetadata, SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps,
} from './contract/slots.ts'
import { FIXED_PANEL_ID } from './panel-pins.ts'
import { MobileHeader } from './MobileHeader.tsx'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 */
const SCROLLBAR_LINGER_MS = 2000

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & Pick<SidebarSectionOwnerProps, 'wide'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel' | 'trackEntryClick'>
  & PropsRenderSlots<'sidebar.panellist'>

/** Analytics category of an official panel; other panels are never reported. */
function officialEntry(id: string): 'plugin' | 'cron' | undefined {
  if (id === 'plugins') return 'plugin'
  return id === 'schedules' ? 'cron' : undefined
}

/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, wide, usePanelInfo, selectPanel, trackEntryClick, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.panelRow, active && css.panelActive)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          const entry = officialEntry(id)
          if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar' })
          selectPanel(id)
        }}
      >
        <span className={css.panelGlyph} aria-hidden="true">
          {renderSlot('sidebar.panellist', { size: wide ? 17 : 18, active }, { only: id })}
        </span>
        {wide && (
          <span className={clsx(css.panelTitle, css.wide)}>
            {label}
          </span>
        )}
      </button>
    </Tooltip>
  )
}

type PanelMoreMenuProps =
  Pick<SidebarSectionOwnerProps, 'wide'>
  & Omit<SidebarPanelActionsOwnerProps, 'onDismiss'>
  & PropsRenderSlots<'sidebar.panellist.actions'>
  & Pick<InjectFace<SidebarRootInjected>, 'trackEntryClick'>
  & { readonly label: string }

/** The panel list's More launcher: a panel-row button whose menu rows come from `sidebar.panellist.actions`. */
function PanelMoreMenu({ wide, label, entries, onOpen, onPinnedChange, trackEntryClick, renderSlot }: PanelMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const onDismiss = (): void => { setOpen(false) }
  return (
    <Menu open={open} onClose={onDismiss} portal autoFocus className={css.moreAnchor} listClassName={css.moreMenu}
      anchor={(
        <Tooltip label={label} delayMs={500} disabled={wide}>
          <button type="button" className={css.panelRow} aria-label={label} aria-haspopup="menu" aria-expanded={open}
            onClick={() => {
              trackEntryClick({ menu_name: 'more', position: 'sidebar' })
              setOpen(value => !value)
            }}>
            <span className={css.panelGlyph} aria-hidden="true"><IconAppsAddOutlineRegular size={wide ? 17 : 18} /></span>
            {wide && <span className={clsx(css.panelTitle, css.wide)}>{label}</span>}
          </button>
        </Tooltip>
      )}>
      {renderSlot('sidebar.panellist.actions', { entries, onOpen, onPinnedChange, onDismiss })}
    </Menu>
  )
}

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  useModernViewport,
  buildVersion: installedVersion,
  collapsed,
  width,
  startSession,
  toggleSidebar,
  selectPanel,
  setPinned,
  trackEntryClick,
  useRemoteAccess,
  useSessions,
  usePanels,
  useEntryPins,
  useEntryActions,
  useShortcuts,
  usePanelInfo,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const mobile = useModernViewport(snapshot => snapshot.mobile)
  const mobileTrigger = useRef<HTMLButtonElement>(null)
  const sidebarToggle = useRef<HTMLButtonElement>(null)
  const mobileReturnFocus = useRef<HTMLButtonElement | null>(null)
  const focusedMobileControl = useRef<HTMLElement | null>(null)
  const rememberMobileFocus = (event: FocusEvent<HTMLElement>): void => {
    if (mobile) focusedMobileControl.current = event.target
  }
  const leaveMobileFocus = (event: FocusEvent<HTMLElement>): void => {
    const next = event.relatedTarget
    if (next instanceof HTMLElement && !next.closest('[data-mobile-navigation], [data-mobile-drawer]')) {
      focusedMobileControl.current = null
    }
  }
  const closeMobileDrawer = () => { if (mobile && !collapsed) toggleSidebar() }
  const openMobileDrawer = () => {
    mobileReturnFocus.current = mobileTrigger.current
    mobileTrigger.current?.focus({ preventScroll: true })
    toggleSidebar()
  }
  const openPanel = (id: SidebarPanelMetadata['id']) => {
    selectPanel(id)
    closeMobileDrawer()
  }
  const panels = usePanels(snapshot => snapshot)
  const unpinned = useEntryPins(ids => ids)
  const activePanelId = usePanelInfo(info => info.activePanelId)
  const hasEntryActions = useEntryActions(registered => registered)
  const shortcut = useShortcuts(rows => rows.find(row => row.id === 'sidebar.left.toggle'))
  const newShortcut = useShortcuts(rows => rows.find(row => row.id === 'session.new'))
  const canStartSession = useRemoteAccess('session/create')
  const toggleLabel = collapsed ? t('toggle.open') : t('toggle.collapse')

  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const windowsTitlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const wide = mobile || (windowsTitlebar ? !collapsed : !collapsed || !settled)

  const openNewSession = (): void => {
    trackEntryClick({ menu_name: 'new_session', position: windowsTitlebar && collapsed ? 'titlebar' : 'sidebar' })
    startSession()
    closeMobileDrawer()
  }
  const captionTooltipSide = windowsTitlebar ? 'bottom' : 'right'

  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  const column = useRef<HTMLDivElement>(null)
  useModalLayer(column, mobile && !collapsed, closeMobileDrawer)
  const drawerWasOpen = useRef(mobile && !collapsed)
  useLayoutEffect(() => {
    if (drawerWasOpen.current && mobile && collapsed) {
      const active = document.activeElement
      const anotherDialog = active instanceof HTMLElement && active.closest('[role="dialog"]')
      if (!anotherDialog || column.current?.contains(active)) {
        (mobileReturnFocus.current ?? mobileTrigger.current)?.focus({ preventScroll: true })
      }
    }
    drawerWasOpen.current = mobile && !collapsed
  }, [mobile, collapsed])
  const wasMobile = useRef(mobile)
  useLayoutEffect(() => {
    if (wasMobile.current === mobile) return
    wasMobile.current = mobile
    const focused = document.activeElement
    if (mobile && collapsed && column.current?.contains(focused)) mobileTrigger.current?.focus({ preventScroll: true })
    if (!mobile) {
      const removedControl = focused === document.body && focusedMobileControl.current !== null
        && !focusedMobileControl.current.isConnected
      if (removedControl || (focused instanceof HTMLElement && focused.closest('[data-mobile-navigation]'))) {
        sidebarToggle.current?.focus({ preventScroll: true })
      }
      focusedMobileControl.current = null
    }
  }, [mobile, collapsed])
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  const buildVersion = installedVersion
  const [copiedToast, setCopiedToast] = useState<number | null>(null)
  const copyVersion = (version: string) => (): void => {
    void writeClipboard(version).then((ok) => {
      if (ok) setCopiedToast(seq => (seq ?? 0) + 1)
    })
  }

  const darwinDesktop = isDarwinDesktop()
  const windowsCaption = windowsTitlebar && !mobile
  const toggle = (
    <Tooltip label={toggleLabel} shortcutKeys={shortcut?.keys} delayMs={500} side={captionTooltipSide} portal={windowsCaption}>
      <button
        ref={sidebarToggle}
        type="button"
        data-sidebar-toggle=""
        className={clsx(css.iconButton, css.toggle)}
        aria-label={toggleLabel}
        aria-keyshortcuts={shortcut?.aria}
        onClick={() => { toggleSidebar() }}
      >
        <IconPanelLeftOutlineRegular className={css.panelIcon} size={wide || windowsTitlebar ? 16 : 18} />
        {!wide && renderSlot('sidebar.toggle.badge', {})}
      </button>
    </Tooltip>
  )
  const newSession = canStartSession && (
    <Tooltip label={t('session.new.label')} shortcutKeys={newShortcut?.keys} delayMs={500} side={captionTooltipSide} disabled={wide} portal={windowsCaption}>
      <button
        type="button"
        className={css.newSession}
        aria-label={t('session.new.label')}
        aria-keyshortcuts={newShortcut?.aria}
        onClick={openNewSession}
      >
        <span className={css.newSessionLabelMask}>
          <span className={css.newSessionContent}>
            {wide ? <IconNewChatOutlineMedium size={17} /> : <IconNewChatOutlineRegular size={windowsCaption ? 16 : 18} />}
            {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
          </span>
        </span>
        {wide && newShortcut !== undefined && newShortcut.keys.length > 0 && (
          <span className={css.newSessionShortcut} aria-hidden="true">
            <ShortcutKeys keys={newShortcut.keys} />
          </span>
        )}
      </button>
    </Tooltip>
  )

  return (
    <>
      {/* Fixed to the caption bar, so it reads first in tab order without moving on screen. */}
      {windowsCaption && (
        <div className={css.windowsCaption} data-sidebar-caption>
          {toggle}
          {collapsed && newSession}
        </div>
      )}
      {mobile && !collapsed && <div className={css.mobileBackdrop} aria-hidden="true" onClick={closeMobileDrawer} />}
      <div
        ref={column}
        onFocusCapture={rememberMobileFocus}
        onBlurCapture={leaveMobileFocus}
        hidden={collapsed && (mobile || (width === 0 && settled))}
        role={mobile && !collapsed ? 'dialog' : undefined}
        aria-modal={mobile && !collapsed ? true : undefined}
        aria-label={mobile ? t('mobile.sessions') : undefined}
        data-mobile-drawer={mobile || undefined}
        className={clsx(
          css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
          collapsed && wide && css.fading, !pointerInside && css.quietBars,
        )}
        style={!mobile && wide ? { width: collapsed ? Math.max(0, lastWideWidth.current - 16) : Math.max(0, width - 16) } : undefined}
        onPointerEnter={() => {
          cancelLinger()
          setPointerInside(true)
        }}
        onPointerLeave={() => { armLinger() }}
      >
        {mobile && <div className={css.mobileHeading}>
          <span className={css.brandMark} aria-hidden="true">
            {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <FishLogo size={24} /> })}
          </span>
          <h2>{t('mobile.sessions')}</h2>
          <button type="button" className={css.iconButton} onClick={closeMobileDrawer} aria-label={t('mobile.close')} data-modal-autofocus>
            <IconCloseOutlineRegular size={18} />
          </button>
        </div>}


        {darwinDesktop && <div hidden={mobile} className={css.topStrip} data-window-drag>{toggle}</div>}
        <div className={css.logoRow} hidden={mobile} data-window-drag>
          {wide && (() => {
            const identity = (
              <span className={css.brandIdentity} aria-hidden="true">
                <span className={css.brandMark}>
                  {renderSlot('sidebar.brand.mark', { size: 24 }, {
                    fallback: buildVersion === undefined
                      ? <FishLogo size={24} />
                      : (
                        <span className={css.copyVersion} data-copy-version onClick={copyVersion(buildVersion)}>
                          <FishLogo size={24} />
                        </span>
                      ),
                  })}
                </span>
                <span className={css.brandName}>
                  {renderSlot('sidebar.brand.name', {}, {
                    fallback: (
                      <span
                        className={clsx(css.fallbackBrandName, buildVersion !== undefined && css.copyVersion)}
                        data-copy-version={buildVersion !== undefined ? '' : undefined}
                        title={buildVersion}
                        onClick={buildVersion === undefined ? undefined : copyVersion(buildVersion)}>
                        {t('brand.name')}
                      </span>
                    ),
                  })}
                </span>
              </span>
            )
            return darwinDesktop || !canStartSession
              ? <span className={clsx(css.brand, css.wide)}>{identity}</span>
              : (
                <button
                  type="button"
                  className={clsx(css.brand, css.wide)}
                  aria-label={t('session.new.label')}
                  aria-keyshortcuts={newShortcut?.aria}
                  onClick={(event) => {
                    if ((event.target as Element).closest('[data-copy-version]') !== null) return
                    openNewSession()
                  }}
                >
                  {identity}
                </button>
              )
          })()}
          {!darwinDesktop && !windowsCaption && toggle}
        </div>

        {wide && <p hidden={mobile} className={clsx(css.navSectionLabel, css.wide)}>{t('panels.label')}</p>}

        {/* Cloud-Monitor .nav-list for New Session & Panels */}
        <nav className={css.panelList} aria-label={t('panels.label')}>
          {!(windowsCaption && collapsed) && newSession}

          {panels.filter(({ id }) => id === FIXED_PANEL_ID || !unpinned.includes(id)).map(({ id, label }) => (
            <PanelRow
              key={id}
              id={id}
              label={label}
              wide={wide}
              usePanelInfo={usePanelInfo}
              selectPanel={openPanel}
              trackEntryClick={trackEntryClick}
              renderSlot={renderSlot}
            />
          ))}
          {hasEntryActions && (
            <PanelMoreMenu
              wide={wide}
              label={t('panels.more')}
              entries={panels.filter(({ id }) => id !== FIXED_PANEL_ID)
                .map(({ id, label }) => ({ id, label, pinned: !unpinned.includes(id), active: id === activePanelId }))}
              onOpen={(id) => {
                const entry = officialEntry(id)
                if (entry !== undefined) trackEntryClick({ menu_name: entry, position: 'sidebar_more' })
                const panel = panels.find(candidate => candidate.id === id)
                if (panel !== undefined) openPanel(panel.id)
              }}
              onPinnedChange={setPinned}
              trackEntryClick={trackEntryClick}
              renderSlot={renderSlot}
            />
          )}
        </nav>

        {/* The browsing region fills the column between the controls and the foot. */}
        <div className={css.regionArea}>
          {renderSlot('sidebar.workspaces', {
            wide,
            expandSidebar: () => { if (collapsed) toggleSidebar() },
          })}
        </div>

        {copiedToast !== null && (
          <Toast key={copiedToast} tone="success" text={t('version.copied')} onDone={() => { setCopiedToast(null) }} />
        )}

        {/* Cloud-Monitor .sidebar-bottom: connection status bar + settings trigger */}
        <div className={css.footArea}>
          <div className={css.footerActions}>
            {renderSlot('sidebar.footer.action', { wide })}
          </div>
          <div className={css.settingsArea} data-modern-settings-seat data-rail={!wide || undefined}>
            {renderSlot('sidebar.settings', { wide })}
          </div>
        </div>
      </div>
      {mobile && <MobileHeader useSessions={useSessions} t={t}
        panelLabel={panels.find(panel => panel.id === activePanelId)?.label}
        expanded={!collapsed} canStartSession={canStartSession} triggerRef={mobileTrigger}
        onOpen={openMobileDrawer} onNew={openNewSession}
        onFocusCapture={rememberMobileFocus} onBlurCapture={leaveMobileFocus} />}

    </>
  )
}
