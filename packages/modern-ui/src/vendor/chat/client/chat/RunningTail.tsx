/** Modern running status contributed to the official Turn tail while the Turn is open. */
import { memo } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '../contract/slots.ts'
import { RunningStatus, type RunningPhase } from './RunningStatus.tsx'

type RunningTailProps = Omit<PropsRuntime<'conversation.chat.turnTail'>, 't'> & PropsLocale<'modern-chat'>

/**
 * Name the running Turn's current activity from the Chat snapshot, as the patched flow did.
 * @param snapshot - current Chat target snapshot.
 * @returns the phase the status row labels.
 */
export function runningPhase(snapshot: ChatSnapshot): RunningPhase {
  if (snapshot.legacy.runningCalls.length > 0) return 'tools'
  const block = snapshot.legacy.partial?.blocks.at(-1)
  if (block?.kind === 'reasoning' && block.text.trim() !== '') return 'thinking'
  if (block?.kind === 'text' || block?.kind === 'image') return 'responding'
  return 'working'
}

/**
 * The official flow's own running row is hidden by the Modern styles; this entry renders the
 * matrix loader, phase label and elapsed time in the Turn's tail instead. A live reasoning
 * disclosure or process group header already names the thinking activity, so the label and
 * matrix step aside for that phase and only the clock remains.
 * @param props - Turn tail owner props plus the session Chat selector and Modern locale.
 * @returns the running status for an open Turn; nothing once it closes.
 */
export const RunningTail = memo(function RunningTail({ turn, useChat, t }: RunningTailProps) {
  const phase = useChat(runningPhase)
  if (turn.status !== 'open') return null
  return (
    <RunningStatus startTime={turn.start?.time} paused={false} phase={phase} activityVisible={phase !== 'thinking'} t={t} />
  )
})
