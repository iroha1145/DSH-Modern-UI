/** Token and active-duration figures shared by the subagent catalog and the Agents view. */
import type { SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'

/**
 * Compact token count shared in shape with the conversation stats strip.
 * @param value - non-negative token count.
 * @param t - `subagent` namespace translate.
 * @returns the count, scaled to thousands or millions past 999.
 */
export function formatTokens(value: number, t: TranslateNS<typeof NS>): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1_000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/**
 * Sum the four disjoint durable provider-usage buckets.
 * @param usage - one Session's `tokenUsage` projection value.
 * @returns the total, or undefined while the value is unknown.
 */
export function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Whole active-turn duration of one descriptor-backed child. An open turn
 * advances to `now` only while the child runs; otherwise it stops at the
 * same-cut `active.through`.
 * @param timing - the child's `subagentTiming` projection value.
 * @param running - whether the child currently runs.
 * @param now - current wall-clock time in milliseconds.
 * @returns milliseconds, or undefined without a timing value.
 */
export function activeDuration(
  timing: SessionProjectionMap['subagentTiming'] | undefined,
  running: boolean,
  now: number,
): number | undefined {
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = running ? now : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/**
 * Format a duration with decreasing visual precision at larger scales.
 * @param ms - duration in milliseconds.
 * @param t - `subagent` namespace translate.
 * @returns the compact localized duration.
 */
export function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/**
 * Preserve exact whole seconds for hover and accessible naming.
 * @param ms - duration in milliseconds.
 * @param t - `subagent` namespace translate.
 * @returns the compact form below one day, otherwise days through seconds.
 */
export function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}
