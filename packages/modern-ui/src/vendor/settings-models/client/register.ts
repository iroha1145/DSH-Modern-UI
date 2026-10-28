/**
 * Registration of the reasoning-declaration block: its dictionaries, its
 * controller over the pi-ai settings form, the describe mirror and the
 * adapter's catalog discovery, and its place in every pi-ai provider card
 * (`settings.models.provider-card`, keyed by the namespace the Models page
 * dispatches with). Everything leaves with the calling scope.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Models page's SlotMap merge (the 'settings.models.provider-card' seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { ReasoningDeclarationController, type ReasoningDeclarationDeps } from './controller.ts'
import { ReasoningDeclarationCard } from './ReasoningDeclarationCard.tsx'
import { en, ja, es, fr, de, ru, pt, zh } from './locales.ts'

export type { ReasoningDeclarationDeps } from './controller.ts'

/** The settings namespace whose provider cards carry the block. */
export const PI_AI_NAMESPACE = 'llm-pi-ai'

/** Dictionary namespace owned by the block. */
const NS = 'modern-reasoning'

/**
 * Register the block for the owning scope's lifetime. The entry sits at the
 * plugin's shading priority so a later official companion registered at the
 * default priority under the same key would be shaded, not collided with.
 * @param ctx - a client context with `slots` and `locale`.
 * @param deps - the pi-ai settings form, the describe mirror, schema operations and catalog discovery.
 */
export function registerReasoningDeclaration(ctx: ClientContext, deps: ReasoningDeclarationDeps): void {
  const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'modern-ui: reasoning declaration dictionaries')
  const controller = new ReasoningDeclarationController(deps)
  ctx.effect(() => () => { controller.dispose() }, 'modern-ui: reasoning declaration controller')
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: PI_AI_NAMESPACE,
    priority: -100,
    locale: NS,
    inject: () => controller.face,
  }, ReasoningDeclarationCard))
}
