/** Optional Remote contribution and reasoning-slot registration lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-cot-translation/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CotTranslationPreferences, CotTranslationSnapshot } from './vendor/translation/types.ts'
import { TranslationBody, type TranslationBodyInjected } from './vendor/translation/client/TranslationBody.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh } from './vendor/translation/client/locales.ts'

async function registerUi(ctx: Context, lifetime: AbortController): Promise<void> {
  let readTask: Promise<RemoteResult<CotTranslationSnapshot>> | undefined
  let updating: Promise<void> | undefined
  let acceptSnapshot: ((snapshot: CotTranslationSnapshot) => void) | undefined
  let revision = 0, lastReadRevision = -1, acceptedRevision = -1
  const isDisposed = (): boolean => lifetime.signal.aborted || ctx.fiber.uid === null
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled([readTask, updating])
  }, 'cot-translation: metadata queries')
  const invalidate = (): void => { revision += 1; refresh() }
  ctx.effect(() => [
    ctx.remote.$on('settings/document-updated', invalidate),
    ctx.remote.$on('llm/adapters-updated', invalidate),
    ctx.remote.$on('deepseek-account/session-expired', invalidate),
    ctx.remote.$on('deepseek-account/model-sign-in-required', invalidate),
    ctx.remote.$on('credentials/record-updated', invalidate),
    ctx.remote.$on('credentials/reference-updated', invalidate),
  ])
  ctx.on('connection/reset', invalidate)
  const read = async (): Promise<RemoteResult<CotTranslationSnapshot> | undefined> => {
    while (true) {
      const observed = revision
      lastReadRevision = observed
      readTask = ctx.remote.cotTranslation.limits(lifetime.signal)
      const result = await readTask
      if (isDisposed()) return undefined
      if (observed === revision) return result
    }
  }
  function refresh(): void {
    if (updating !== undefined || isDisposed()) return
    updating = (async () => {
      try {
        const result = await read()
        if (result !== undefined) {
          if (!result.ok) throw result.error
          if (acceptSnapshot === undefined) mount(result.value)
          else acceptSnapshot(result.value)
          acceptedRevision = lastReadRevision
        }
      } catch (_error) {
        if (!isDisposed()) ctx.logger.warn('cot-translation: could not refresh Host preferences and request limits')
      }
    })().finally(() => {
      updating = undefined
      if (revision !== lastReadRevision && !isDisposed()) refresh()
    })
  }
  const scope = ctx.configForms.get<CotTranslationPreferences>('cot-translation')
  ctx.effect(() => scope.subscribe(invalidate))
  refresh()
  await updating

  function mount(initial: CotTranslationSnapshot): void {
    const preferences = createSnapshotStore(initial.preferences)
    const translationLimit = createSnapshotStore(initial.maxTextChars)
    acceptSnapshot = snapshot => {
      preferences.set(snapshot.preferences)
      translationLimit.set(snapshot.maxTextChars)
    }
    const dictionaries = { en, zh, ja, es, fr, de, ru, pt }
    ctx.effect(() => ctx.locale.register(NS, dictionaries))
    const injected = (sessionId: SessionId): TranslationBodyInjected => ({
      hooks: { preferences, translationLocale: ctx.locale, translationLimit },
      translate: async (request, signal) => {
        if (acceptedRevision !== revision) refresh()
        while (updating !== undefined) await updating
        signal.throwIfAborted()
        const accepted = preferences.getSnapshot()
        if (isDisposed() || acceptedRevision !== revision || request.provider !== accepted.provider
          || (accepted.targetLanguage !== 'auto' && request.targetLanguage !== accepted.targetLanguage)
          || request.text.length > translationLimit.getSnapshot()) throw new Error('Translation preferences or limits changed')
        const result = await ctx.remote.cotTranslation.translate({ ...request, sessionId }, signal)
        if (!result.ok) throw result.error
        return result.value
      },
    })
    ctx.slots.inject('modern.conversation.chat.reasoning.body', () => ctx.slots.register({
      name: 'modern.conversation.chat.reasoning.body', locale: NS, priority: -100,
      inject: injected,
    }, TranslationBody))
  }
}

export function installReasoningTranslation(ctx: Context): void {
  ctx.inject(['remote.cotTranslation', 'remote', 'slots', 'locale', 'configForms'], child => {
    const lifetime = new AbortController()
    child.on('internal/plugin', fiber => { if (fiber === child.fiber && fiber.uid === null) lifetime.abort() })
    child.effect(() => () => lifetime.abort())
    // Keep setup outside the injection's async barrier: dependency withdrawal
    // must run the cancellation effect while the initial Remote read is pending.
    void registerUi(child, lifetime).catch(() => {
      if (!lifetime.signal.aborted) child.logger.warn('cot-translation: could not attach reasoning presentation')
    })
  })
}


