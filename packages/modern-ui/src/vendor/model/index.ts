/**
 * Model selection plugin, node half: the picker's settings section. The
 * browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration, and reads and writes this section
 * through the settings forms; the Host only declares and validates it.
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FetchedModelPrice, ModelPickerOverride } from './model-settings.ts'

export type { FetchedModelPrice, ModelPickerOverride, ModelPickerSettings } from './model-settings.ts'

/** Strength scales run from 1 to 5. */
const strength = z.natural().min(1).max(5)

/** US dollars per million tokens. */
const price = z.number().min(0)

/** Picker details projected to the browser. */
export interface Config {
  /** User overrides keyed by model id. */
  models: Volatile<Record<string, ModelPickerOverride>>
  /** Prices last read from the public price source, keyed by model id. */
  prices: Volatile<Record<string, FetchedModelPrice>>
  /** ISO time of the last successful price read. */
  pricesUpdatedAt: Volatile<string | undefined>
}

/** Live picker details; every field is editable from the Models settings page. */
export const Config = z.object({
  models: z.dict(z.object({
    description: z.string(),
    speed: strength,
    quality: strength,
    cost: strength,
    latencyMs: z.natural(),
    priceInput: price,
    priceOutput: price,
    efforts: z.array(z.string()),
    icon: z.string(),
  })).default({}).volatile(),
  prices: z.dict(z.object({
    input: price.required(),
    output: price.required(),
    cacheRead: price,
    provider: z.string().required(),
  })).default({}).volatile(),
  pricesUpdatedAt: z.string().volatile(),
})

/** Expose the section to the settings forms without an automatic page.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
