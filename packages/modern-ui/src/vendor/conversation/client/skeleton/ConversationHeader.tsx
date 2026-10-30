/** Resident conversation navigation and Session-specific header content. */
import { useCallback, useRef } from 'react'
import clsx from 'clsx'
import type { ConversationHeaderProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import css from './ConversationRoot.module.css'

/**
 * Keeps global navigation available before a Session exists.
 * @param props - Optional Session sources and authorized header slots.
 * @returns The persistent header with any selected Session's title and views.
 */
export function ConversationHeader({ sessionId, useSession, useConversation, renderSlot }: ConversationHeaderProps) {
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  // The active wide layout floats the header over the transcript; the panel root
  // pads its scrollport by this block size (ConversationRoot.module.css).
  const headerObserver = useRef<{ observer: ResizeObserver; root: HTMLElement } | null>(null)
  const headerResizeRef = useCallback((header: HTMLElement | null): void => {
    const previous = headerObserver.current
    previous?.observer.disconnect()
    previous?.root.style.removeProperty('--dsh-conversation-header-height')
    headerObserver.current = null
    const root = header?.closest<HTMLElement>('[data-phase]') ?? null
    if (header === null || root === null) return
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--dsh-conversation-header-height', `${header.getBoundingClientRect().height}px`)
    })
    observer.observe(header)
    headerObserver.current = { observer, root }
  }, [])
  const blank = session === undefined || conversation === undefined
    || (session.blank && conversationPhase(session, conversation) === 'blank')
  return (
    <header ref={headerResizeRef} className={clsx(css.header, blank && css.headerBlank, sessionId === undefined && css.headerSessionless)} data-window-drag>
      <div className={css.headerLeading} data-conversation-header-leading="">
        {renderSlot('conversation.header.leading', {})}
      </div>
      {sessionId === undefined
        ? <div className={css.titleRow} />
        : renderSlot('conversation.session.header', { hideChrome: blank })}
    </header>
  )
}
