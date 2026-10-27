// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE.
/** Phone chat navigation: current title between the drawer and new-session actions. */
import type { FocusEventHandler, RefObject } from 'react'
import { IconNewChatOutlineRegular, IconPanelLeftOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

type MobileHeaderProps = Pick<SidebarRootComponentProps, 'useSessions' | 't'> & {
  panelLabel: string | undefined
  expanded: boolean
  canStartSession: boolean
  triggerRef: RefObject<HTMLButtonElement>
  onFocusCapture: FocusEventHandler<HTMLElement>
  onBlurCapture: FocusEventHandler<HTMLElement>
  onOpen: () => void
  onNew: () => void
}

/** Subscribe to the displayed title only; desktop sidebar subscriptions stay unchanged. */
export function MobileHeader({
  useSessions, t, panelLabel, expanded, canStartSession, triggerRef, onOpen, onNew, onFocusCapture, onBlurCapture,
}: MobileHeaderProps) {
  const sessionTitle = useSessions(state => Object.values(state.byId)
    .find(session => (session.retainedBy.mainView ?? 0) > 0)?.displayTitle)
  return (
    <nav className={css.mobileNavigation} aria-label={t('mobile.navigation')} data-mobile-navigation
      onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
      <button ref={triggerRef} type="button" aria-label={t('mobile.sessions')} aria-haspopup="dialog" aria-expanded={expanded}
        onClick={onOpen}>
        <IconPanelLeftOutlineRegular size={21} />
      </button>
      <span className={css.mobileCurrentTitle}>{panelLabel ?? sessionTitle ?? t('session.new')}</span>
      {canStartSession && <button type="button" onClick={onNew} aria-label={t('session.new.label')}>
        <IconNewChatOutlineRegular size={21} />
      </button>}
    </nav>
  )
}
