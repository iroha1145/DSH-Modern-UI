// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/**
 * Keyed sidebar-tab registration for the plan preview. The official ui-plan
 * package keeps the tab type, the resource provider, the chip title, the cards
 * and the chip; the Modern body shadows only its `sidebar.right.pane.tab`
 * entry under the same key at a lower priority.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `sidebar.right.pane.tab` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { PlanPreview } from './PlanPreview.tsx'
import { planNavigation } from './navigation.ts'

/** The tab type id the official ui-plan package registers its preview under. */
export const PLAN_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-plan'

/** Shadows the official entry (priority 0) under the same key; the lowest priority renders. */
export const PLAN_PREVIEW_PRIORITY = -100

/**
 * Register the Modern plan preview body for the owning plugin lifetime.
 * @param ctx - plugin context carrying the slot registry.
 */
export function registerPlanPreview(ctx: Context): void {
  const t = ctx.locale.bind('modern-chat')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: PLAN_PREVIEW_ID, priority: PLAN_PREVIEW_PRIORITY, locale: 'modern-plan',
    inject: () => ({
      hooks: { sessions: ctx.sessions.list },
      navigation: (address: string) => planNavigation(ctx, address, {
        open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'),
        dialog: t('image.dialog'), close: t('image.close'),
      }),
    }),
  }, PlanPreview))
}
