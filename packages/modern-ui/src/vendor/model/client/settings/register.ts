/**
 * Registration of the Models settings card for the model picker's per-model
 * details. The card joins the Models page's footer list, edits the picker's
 * settings section through the settings forms, and reads the shared model
 * catalog the picker itself uses.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Models page's SlotMap merge (the 'settings.models.footer' list).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { ModelPickerSettingsController, type ModelPickerSettingsDeps } from './controller.ts'
import { ModelPickerSettingsCard } from './ModelPickerSettingsCard.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type ModelSettingsKey } from './locales.ts'

export type { ModelPickerSettingsDeps } from './controller.ts'
export type { ModelSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models settings card where the model picker's per-model details are edited. */
    modelSettings: ModelSettingsKey
  }
}

/** Dictionary namespace owned by the card. */
const NS = 'modelSettings'

/**
 * Register the picker-details card: its dictionaries, its controller over the
 * settings form and the shared catalog, and its place in the Models page's
 * footer list. Everything leaves with the calling scope.
 * @param ctx - a client context with `slots`, `locale`, and the services behind `deps`.
 * @param deps - the picker's settings form, the shared catalog, and the card's collaborators.
 */
export function registerModelPickerSettings(ctx: ClientContext, deps: ModelPickerSettingsDeps): void {
  const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'ui-model-selection: settings dictionaries')
  const controller = new ModelPickerSettingsController(deps)
  ctx.effect(() => () => { controller.dispose() }, 'ui-model-selection: settings card')
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'model-picker-details',
    order: 10,
    locale: NS,
    inject: () => controller.face,
  }, ModelPickerSettingsCard))
}
