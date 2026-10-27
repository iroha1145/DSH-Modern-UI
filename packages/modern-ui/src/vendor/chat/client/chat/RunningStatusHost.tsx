/** Modern running status rendered into the official flow's running row while a Session runs. */
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatSnapshot } from '../contract/slots.ts'
import { RunningStatus, type RunningPhase } from './RunningStatus.tsx'

/** Registration-side face of the running status host. */
export interface RunningStatusHostInjected {
  hooks: {
    /** Connection recovery lifecycle bound as useConnectionState; the clock freezes while it is not connected. */
    connectionState: ConnectionStateSource
  }
}

type RunningStatusHostProps =
  Omit<PropsRuntime<'conversation.composer.dock'>, 't'>
  & PropsLocale<'modern-chat'>
  & InjectFace<RunningStatusHostInjected>

const FLOW = '[data-slot="conversation.chat.flow"]'
const OFFICIAL_RUNNING = '[data-chat-running]'

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
 * Start time of the latest Turn, the clock the official running row also uses.
 * @param snapshot - current Chat target snapshot.
 * @returns the Turn start time, or nothing before the first Turn anchor is loaded.
 */
export function latestTurnStart(snapshot: ChatSnapshot): number | undefined {
  const anchor = snapshot.navigation.items().at(-1)?.anchorKey
  const location = anchor === undefined ? undefined : snapshot.nodes.get(anchor)?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.start?.time : undefined
}

/**
 * The official Chat flow mounts its own running row (the blue "deep diving" clock) and offers
 * no slot for it; the Turn tail only exists once a Turn closes. The Modern styles hide that
 * row's own children, and this always-mounted composer-dock entry renders the patched status
 * (matrix, phase label, elapsed time) into the row through a portal, so the row keeps the
 * official flow's placement, spacing and entrance animation. The matrix and phase label stay in
 * every phase: the official process group header keeps its own static icon while reasoning
 * streams, so this row is the only live indicator a folded Turn shows. The clock pauses while
 * the connection is lost, as the patched flow did; the official rc.4 row no longer does.
 * @param props - session Chat selector, connection state and Modern locale from the dock slot.
 * @returns a hidden anchor in the dock plus the portal while the official row exists.
 */
export const RunningStatusHost = memo(function RunningStatusHost({ useChat, useConnectionState, t }: RunningStatusHostProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const phase = useChat(runningPhase)
  const startTime = useChat(latestTurnStart)
  const paused = useConnectionState(state => state === 'disconnected' || state === 'connecting')
  useEffect(() => {
    // The dock and the Chat flow share the Session panel; the nearest ancestor holding a flow
    // scopes the lookup to this Session, whatever the surrounding layout owner renders.
    let panel: HTMLElement | null = anchor.current?.parentElement ?? null
    while (panel !== null && panel.querySelector(FLOW) === null) panel = panel.parentElement
    if (panel === null) return
    const scope = panel
    const find = () => { setTarget(current => {
      const next = scope.querySelector<HTMLElement>(OFFICIAL_RUNNING)
      return next === current ? current : next
    }) }
    find()
    const view = scope.ownerDocument.defaultView
    if (view === null) return
    const observer = new view.MutationObserver(find)
    observer.observe(scope, { childList: true, subtree: true })
    return () => { observer.disconnect(); setTarget(null) }
  }, [])
  return (
    <>
      <span ref={anchor} hidden data-modern-running-host="" />
      {target !== null && createPortal(
        <RunningStatus startTime={startTime} paused={paused} phase={phase} t={t} />,
        target,
      )}
    </>
  )
})
