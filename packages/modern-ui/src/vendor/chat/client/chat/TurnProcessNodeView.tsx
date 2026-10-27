import { memo } from 'react'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconPauseOutlineRegular, IconWarningOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import { turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

/** Settled Turn duration and process disclosure above its content. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const open = !turnProcess.foldable || turnProcess.open
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn?.status !== 'closed') return null
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const reason = turn.end?.data.reason.kind
  const completed = reason === 'completed'
  const stopped = reason !== undefined && !completed && reason !== 'error'
  const elapsedMs = turn.start === undefined || turn.end === undefined ? undefined
    : Math.max(1000, turn.end.time - turn.start.time)
  const duration = elapsedMs === undefined || stopped || reason === 'error' ? undefined
    : formatRunDuration(elapsedMs, t)
  // Only a normal completion receives a duration and success mark.
  const label = stopped ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : duration === undefined ? t('message.turnProcess.worked')
        : t('message.turnProcess.took')
  const announcement = stopped ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : t('message.turnProcess.worked')
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-process-outcome={completed ? 'completed' : reason === 'error' ? 'failed' : 'stopped'}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.resultIcon} aria-hidden="true">
          {completed ? <IconCheckOutlineRegular size={14} />
            : reason === 'error' ? <IconWarningOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
        </span>
        <span className={css.label}>
          {label}
          {duration?.map((part, index) => (
            <span key={index} className={part.numeric ? css.durationNumber : undefined}>{part.text}</span>
          ))}
        </span>
        {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>
    </>
  )
})
