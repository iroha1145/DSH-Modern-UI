/** Agents view entry: the current Session's agent family as a live tree. */
import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { NS } from '../locales.ts'
import { AgentTree } from './AgentTree.tsx'
import css from './AgentTree.module.css'
import { deriveAgentTree } from './model.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

const NO_SESSIONS: readonly SessionId[] = []

/** Business callbacks supplied by the view registration. */
export interface AgentsViewInjected {
  /** Show one agent's Session in the main view. */
  openSession: (sessionId: SessionId) => void
  /** Read one Session's projections, so a catalog the list did not carry loads. */
  refreshProjections: (sessionId: SessionId) => void
}

/** Full props of the Agents view entry. */
export type AgentsViewProps =
  PropsRuntime<'conversation.view'> & InjectFace<AgentsViewInjected> & PropsLocale<typeof NS>

/**
 * Render the family of the current Session, rooted at its top ancestor. The
 * clock advances once a second only while an agent in the family runs.
 * @param props - Session standard props, the injected navigation, and the translator.
 * @returns the tree, or a loading notice until the root Session is listed.
 */
export function AgentsView({
  sessionId, useSession, useSessions, useSessionStatus, openSession, refreshProjections, t,
}: AgentsViewProps) {
  const byId = useSessions(state => state.byId)
  const projectionsBySession = useSessions(state => state.projectionsBySession)
  const statuses = useSessionStatus(value => value)
  const currentParentId = useSession(session => session.subagent?.address.parentSessionId)
  const model = useMemo(() => deriveAgentTree({
    currentSessionId: sessionId,
    currentParentId,
    list: { byId, projectionsBySession },
    statuses,
  }), [sessionId, currentParentId, byId, projectionsBySession, statuses])
  const unread = model?.unread ?? NO_SESSIONS
  useEffect(() => {
    // A started read moves its Session out of the unread set, so a failed read
    // is not retried from here.
    for (const id of unread) refreshProjections(id)
  }, [unread, refreshProjections])
  const running = model?.running === true
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [running])
  if (model === undefined) return <p className={css.loading}>{t('loading.label')}</p>
  return <AgentTree key={model.root.id} root={model.root} now={now} t={t} onOpen={openSession} />
}
