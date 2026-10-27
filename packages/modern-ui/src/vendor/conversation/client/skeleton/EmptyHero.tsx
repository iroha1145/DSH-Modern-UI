// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import type { ReactNode, RefObject } from 'react'
import {
  FishLogo, IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@iroha1145/dsh-modern-ui/primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationContentProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), styled as Cloud-Monitor's .plain-button.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseRegular className={css.folder} size={15} />
        : <IconFolderOpenRegular className={css.folder} size={15} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationContentProps['renderSlot']
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome (Cloud-Monitor .page-heading style).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, children }: HeroShellProps) {
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          <div className={css.kickerRow}>
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.brandMark }, { fallback: <FishLogo size={34} className={css.brandMark} /> })}
            <span className={css.kickerText}>{t('hero.kicker')}</span>
            <span className={css.previewBadge}>{t('hero.preview')}</span>
          </div>
          <h1 className={css.greetingHello}>{t('hero.headline')}</h1>
          <p className={css.greetingSub}>{t('hero.description')}</p>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
