/** Running Turn clock isolated from the transcript's render cycle. */
import { memo, useEffect, useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'
import { RunningWhaleTail } from './RunningWhaleTail.tsx'
import a11yCss from './accessibility.module.css'
import css from './RunningStatus.module.css'

/** What the running Turn is doing right now, as the status row names it. */
export type RunningPhase = 'thinking' | 'tools' | 'responding' | 'working'

interface RunningStatusProps {
  readonly phase?: RunningPhase
  /** An existing reasoning disclosure or process group already displays this activity. */
  readonly activityVisible?: boolean
  readonly startTime: number | undefined
  /** Freeze the shown duration while the Client cannot observe the Session. */
  readonly paused: boolean
  readonly t: ChatViewSlotProps['t']
}

/**
 * Show live elapsed time after the current Turn's content without announcing ticks.
 * @param props - Current Turn start time, pause state, and localized copy.
 * @returns the matrix loading indicator; mount only while the Session is running.
 */
export const RunningStatus = memo(function RunningStatus({ startTime, paused, phase = 'working', activityVisible = true, t }: RunningStatusProps) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined || paused) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime, paused])
  const duration = startTime === undefined ? undefined
    : formatRunDuration(Math.max(0, now - startTime), t).map(part => part.text).join('')
  const label = t(`chat.activity.${phase}`)
  return (
    <div className={css.running} data-modern-running={phase}>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{label}</span>
      <span className={css.runningContent}>
        {activityVisible && <RunningWhaleTail />}
        {activityVisible && <span className={css.label} data-loading-label>{label}</span>}
        {duration !== undefined && <span className={css.elapsed} data-loading-elapsed>{duration}</span>}
      </span>
    </div>
  )
})
