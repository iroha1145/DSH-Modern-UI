/** Related questions the assistant proposes at the end of an answer; a click asks one as the next message. */
import { useMemo, useState } from 'react'
import { IconChevronRightOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { parseFollowups } from './parse-followups.ts'
import './locales.ts'
import css from './Followups.module.css'

type FollowupsProps = PropsRuntime<'modern.conversation.chat.message.code'> & PropsLocale<'modern-intelligent'> & { matched: object }

/**
 * Render a closed `followups` fence as a localized list of questions.
 * An empty composer sends the clicked question at once: the draft is replaced by the question and submitted
 * through the Session's input actions, so it queues behind a running turn exactly like a typed message.
 * Busy submission phases disable the rows. A composer that holds text, attachments, or a command receives
 * the question at its caret without discarding the draft. A rejected insertion shows a retry notice.
 * A row stays inert after its question was sent, so a double click cannot send it twice;
 * the other rows remain available.
 * @param props - Fence source and stream state from the code chain, the Session's input actions and hooks, and localized copy.
 * @returns The related section, or nothing while the fence is open, empty, or the Session cannot take a prompt.
 */
export function Followups({ code, closed, inputActions, useInput, useSession, useAccess, t }: FollowupsProps) {
  const questions = useMemo(() => parseFollowups(code), [code])
  const busy = useInput(input => input.phase === 'adjudicating' || input.phase === 'submitting')
  const composerFree = useInput(input => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  const writable = useSession(session => !session.removed && (session.subagent === null
    || (session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true)))
  const allowed = useAccess('session/prompt')
  const [insertionRejected, setInsertionRejected] = useState(false)
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set())
  if (!closed || questions.length === 0 || !writable || !allowed) return null
  const ask = (question: string): void => {
    if (busy || asked.has(question)) return
    setInsertionRejected(false)
    if (!composerFree) {
      // The editor may reject an insertion if its state changed since this render.
      setInsertionRejected(!inputActions.insertText(question, inputActions.captureInsertion()))
      return
    }
    inputActions.setDraft(question)
    inputActions.submit()
    setAsked(previous => new Set(previous).add(question))
  }
  return <section className={css.related} data-followups aria-label={t('related')}>
    <div className={css.heading} aria-hidden="true">{t('related')}</div>
    <ul className={css.list}>{questions.map(question =>
      <li key={question} className={css.item}>
        <button
          type="button"
          className={css.row}
          disabled={busy}
          aria-disabled={busy || asked.has(question) ? true : undefined}
          onClick={() => { ask(question) }}
        >
          <span className={css.question}>{question}</span>
          <IconChevronRightOutlineRegular size={16} className={css.chevron} />
        </button>
      </li>,
    )}</ul>
    {insertionRejected && <p className={css.notice} role="status">{t('insertRejected')}</p>}
  </section>
}
