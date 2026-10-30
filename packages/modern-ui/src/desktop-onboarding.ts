/**
 * The official Desktop onboarding ends by writing its display choices into the Chat namespace (`ui-chat`); both
 * "enter" and "skip" go through that write. This bundle disables the `ui-chat` entry to own the conversation, so the
 * namespace is not served and the write can never succeed: the overlay would stay open for good. The bundle patch
 * therefore composes the onboarding as skipped (`cordis.patch.yml`, `ui-settings-account`), which keeps the overlay
 * closed and goes away with the bundle. Progress saved in the user layer still wins over that composition — an onboarding
 * begun before this bundle, or this patch, was selected — so it is re-inherited here, the same record a skip leaves.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Namespace of the account plugin entry that stores the Desktop onboarding progress. */
export const ONBOARDING_NAMESPACE = 'ui-settings-account'
/** Namespace the onboarding writes its display choices to; served only while the official Chat entry runs. */
export const CHAT_NAMESPACE = 'ui-chat'
/** The progress fields the account plugin declares for the onboarding. */
export const ONBOARDING_FIELDS = ['version', 'step', 'purpose', 'process', 'completion', 'usage', 'developerTools'] as const

type Progress = Partial<Record<typeof ONBOARDING_FIELDS[number], unknown>>

/**
 * Select the user-layer progress fields that hold an unfinished onboarding over this bundle's skipped composition.
 * @param chat - the Chat namespace snapshot; while it is served the official onboarding can finish on its own.
 * @param onboarding - the account namespace snapshot.
 * @returns the fields to re-inherit, empty when nothing is stranded or the snapshots are not settled.
 */
export function strandedOnboarding(chat: Pick<ConfigFormSnapshot<unknown>, 'status'>, onboarding: ConfigFormSnapshot<Progress>): string[] {
  if (chat.status !== 'unavailable' || onboarding.status !== 'ready' || !onboarding.writable) return []
  const base = onboarding.base as Progress | undefined
  if (onboarding.value?.step === 'done' || base?.step !== 'done') return []
  const user = onboarding.user as Progress | undefined
  return user === undefined || user === null ? [] : ONBOARDING_FIELDS.filter(field => Object.hasOwn(user, field))
}

/** Re-inherit stranded onboarding progress once per client lifetime; a refused write is left as it stands. */
export function installDesktopOnboarding(ctx: Context): void {
  const chat = ctx.configForms.get(CHAT_NAMESPACE)
  const onboarding = ctx.configForms.get<Progress>(ONBOARDING_NAMESPACE)
  let attempted = false
  const check = (): void => {
    if (attempted) return
    const fields = strandedOnboarding(chat.getSnapshot(), onboarding.getSnapshot())
    if (fields.length === 0) return
    attempted = true
    // `unset` over an inherited field stores the composed value, so the record matches a skip.
    onboarding.mutate(fields.map(field => ({ op: 'unset', path: [field] })))
      .then(accepted => { if (!accepted) ctx.logger.warn('desktop onboarding: the Host refused to re-inherit the skipped onboarding') })
      .catch(() => { ctx.logger.warn('desktop onboarding: could not re-inherit the skipped onboarding') })
  }
  ctx.effect(() => {
    const disposers = [chat.subscribe(check), onboarding.subscribe(check)]
    check()
    return () => { for (const dispose of disposers) dispose() }
  }, 'modern-ui: stranded desktop onboarding')
}
