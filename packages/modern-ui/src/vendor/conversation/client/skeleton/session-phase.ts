import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { parentAvailability } from '../../../../host-contract.ts'

/** Select only the lifecycle result needed by shell chrome. */
export function blankConversation(session: SessionSnapshot | undefined, hasActiveTargets: boolean | undefined): boolean {
  return session === undefined || hasActiveTargets === undefined
    || (session.blank && !hasActiveTargets && !session.running && !session.promptAttempted)
}

/** Preserve replay, failed-open, removed and continuable-child layout behavior. */
export function mainPanelPhase(
  sessionId: string | undefined,
  session: SessionSnapshot | undefined,
  hasActiveTargets: boolean | undefined,
  summaryBlank: boolean | undefined,
): 'settling' | 'hero' | 'active' {
  const blank = session === undefined || hasActiveTargets === undefined
    || !(hasActiveTargets || (!session.blank && !session.awaitingFirstTurn) || session.running || session.promptAttempted)
  const parentPending = session?.subagent?.address.mode === 'continuable'
    && parentAvailability(session.subagent) === undefined
  if (sessionId !== undefined && ((blank && session?.openState === 'loading' && summaryBlank !== true) || parentPending)) return 'settling'
  return sessionId === undefined || (blank && (session?.openState === 'open' || summaryBlank === true)) ? 'hero' : 'active'
}
