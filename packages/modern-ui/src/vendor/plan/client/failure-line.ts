// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Localized plan-owned failures and unmodified external diagnostics. */
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { PlanPreviewKey } from './locales.ts'

/**
 * Explain a failed plan read in the current locale.
 * @param t - Modern plan namespace translator.
 * @param failure - Failure reported by the official resource provider.
 * @returns localized plan copy, or the external failure's diagnostic.
 */
export function planFailureLine(t: (key: PlanPreviewKey) => string, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'plan/invalid-address': return t('preview.invalidAddress')
    case 'plan/unavailable': return t('preview.historyUnavailable')
    case 'plan/not-found': return t('preview.notFound')
    // Transport failures, including plan/read-failed, retain the carrier's diagnostic.
    default: return failure.message
  }
}
