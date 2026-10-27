/**
 * Picker profile of one catalog model — its built-in preset, the user's
 * overrides, and the last price refresh combined into what a picker row
 * shows — plus the effort helpers the thinking switch and effort pills share.
 * Effort levels always come from the catalog: the adapter advertises what
 * the model accepts, a preset narrows a generic list to the vendor's own
 * levels, and a user's effort list narrows it instead.
 */
import type { ModelCatalogModel, ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { LETTER_ICON, type ModelPickerSettings } from '../model-settings.ts'
import type { ModelKey } from './locales.ts'
import { glyphFor, presetFor, type ModelPreset, type PresetBlurb } from './presets.ts'
import { autoMark, isVendorMark, type VendorMark } from './vendor-marks.ts'

/** Effort ids that switch thinking off. */
const OFF_EFFORTS: ReadonlySet<string> = new Set(['off', 'none'])

/** Localized short names of the effort ids adapters commonly advertise; others show the catalog name. */
export const EFFORT_SHORT: ReadonlyMap<string, ModelKey> = new Map<string, ModelKey>([
  ['off', 'effort.short.off'],
  ['none', 'effort.short.none'],
  ['minimal', 'effort.short.minimal'],
  ['low', 'effort.short.low'],
  ['medium', 'effort.short.medium'],
  ['high', 'effort.short.high'],
  ['xhigh', 'effort.short.xhigh'],
  ['max', 'effort.short.max'],
])

/** First-token wait multiplier of the weakest thinking level; each stronger level multiplies it again, up to the cap. */
const THINKING_BASE = 1.6
const THINKING_STEP = 1.55
const THINKING_CAP = 8

/** Highest output price (US dollars per million tokens) of cost tiers 1 to 4; anything above is tier 5. */
const COST_TIER_TOPS = [1, 3, 8, 20] as const

/** Which layer supplied a profile's price. */
export type PriceSource = 'user' | 'fetched' | 'preset'

/** What one picker row shows for a model. */
export interface ModelProfile {
  /** Tile monogram; empty when the name has no letter or digit. */
  readonly glyph: string
  /** Vendor mark drawn instead of the monogram; undefined keeps the letter. */
  readonly mark: VendorMark | undefined
  /** The user's description, else the catalog's when no preset blurb applies. */
  readonly description: string | undefined
  /** Built-in description key, shown when the user wrote none. */
  readonly blurb: PresetBlurb | undefined
  /** Relative response speed, 1 to 5. */
  readonly speed: number | undefined
  /** Relative answer quality, 1 to 5. */
  readonly quality: number | undefined
  /** Relative price, 1 to 5: the user's rating, else derived from the output price. */
  readonly cost: number | undefined
  /** Typical first-token wait with thinking off, in milliseconds. */
  readonly latencyMs: number | undefined
  /** Input price in US dollars per million tokens. */
  readonly priceInput: number | undefined
  /** Output price in US dollars per million tokens. */
  readonly priceOutput: number | undefined
  /** Layer the prices came from; undefined when the model has none. */
  readonly priceSource: PriceSource | undefined
  /** Effort levels the picker offers, in catalog order. */
  readonly efforts: readonly ModelReasoningEffort[]
}

/**
 * Cost rating from an output price.
 * @param output - output price in US dollars per million tokens.
 * @returns 1 (cheapest) to 5.
 */
export function costTier(output: number): number {
  const index = COST_TIER_TOPS.findIndex(top => output <= top)
  return index === -1 ? 5 : index + 1
}

/**
 * The levels a model offers before any user choice: the advertised levels its
 * preset names, or every advertised level when the preset names none of them
 * or the model has no preset levels.
 * @param modelId - provider-owned model id.
 * @param advertised - the levels the catalog advertises for it.
 * @returns the default levels in catalog order.
 */
export function presetEfforts(modelId: string, advertised: readonly ModelReasoningEffort[]): readonly ModelReasoningEffort[] {
  const known = presetFor(modelId)?.efforts
  if (known === undefined) return advertised
  const kept = advertised.filter(effort => known.includes(effort.id))
  return kept.length === 0 ? advertised : kept
}

/**
 * The tile's mark: the user's choice, else the automatic one. Choosing the
 * letter, or a mark id this build does not know, keeps the monogram or the
 * automatic mark respectively.
 * @param model - the exact catalog entry.
 * @param preset - the model's preset, when it has one.
 * @param icon - the user's stored choice, if any.
 * @returns the mark id, or undefined for the monogram.
 */
function markOf(model: ModelCatalogModel, preset: ModelPreset | undefined, icon: string | undefined): VendorMark | undefined {
  if (icon === LETTER_ICON) return undefined
  if (icon !== undefined && isVendorMark(icon)) return icon
  return autoMark(model.id, model.name, preset)
}

/**
 * Combine a catalog model with its preset, the user's overrides, and fetched prices.
 * Precedence per field: the user's value, then a fetched price, then the preset,
 * then the catalog. A user's effort list narrows the catalog's levels and is
 * ignored when nothing it names is advertised; without one, the preset's levels apply.
 * @param model - the exact catalog entry.
 * @param settings - the picker's settings section, when loaded.
 * @returns the row's profile.
 */
export function profileOf(model: ModelCatalogModel, settings: ModelPickerSettings | undefined): ModelProfile {
  const preset = presetFor(model.id)
  const user = settings?.models?.[model.id]
  const fetched = settings?.prices?.[model.id]
  const userPrice = user?.priceInput !== undefined || user?.priceOutput !== undefined
  const priceInput = user?.priceInput ?? fetched?.input ?? preset?.price.input
  const priceOutput = user?.priceOutput ?? fetched?.output ?? preset?.price.output
  const priceSource: PriceSource | undefined = userPrice
    ? 'user'
    : fetched !== undefined ? 'fetched' : preset === undefined ? undefined : 'preset'
  const advertised = model.reasoning?.efforts ?? []
  const wanted = user?.efforts === undefined ? undefined : new Set(user.efforts)
  const narrowed = wanted === undefined ? [] : advertised.filter(effort => wanted.has(effort.id))
  return {
    glyph: glyphFor(model.name, user?.icon === LETTER_ICON ? undefined : preset),
    mark: markOf(model, preset, user?.icon),
    description: user?.description ?? (preset === undefined ? model.description : undefined),
    blurb: user?.description === undefined ? preset?.blurb : undefined,
    speed: user?.speed ?? preset?.speed,
    quality: user?.quality ?? preset?.quality,
    cost: user?.cost ?? (priceOutput === undefined ? undefined : costTier(priceOutput)),
    latencyMs: user?.latencyMs ?? preset?.latencyMs,
    priceInput,
    priceOutput,
    priceSource,
    efforts: narrowed.length === 0 ? presetEfforts(model.id, advertised) : narrowed,
  }
}

/**
 * Whether an effort id switches thinking off.
 * @param effort - effort id.
 * @returns true for `off` and `none`.
 */
export function isOffEffort(effort: string): boolean {
  return OFF_EFFORTS.has(effort)
}

/**
 * The levels the picker shows: the profile's offered levels plus the current
 * one when the user's list hides it, so the shown state stays truthful.
 * @param offered - the profile's offered levels.
 * @param advertised - every level the catalog advertises.
 * @param current - the selection's effort id.
 * @returns visible levels in catalog order.
 */
export function visibleEfforts(
  offered: readonly ModelReasoningEffort[],
  advertised: readonly ModelReasoningEffort[],
  current: string | undefined,
): readonly ModelReasoningEffort[] {
  if (current === undefined || offered.some(effort => effort.id === current)) return offered
  const shown = new Set([...offered.map(effort => effort.id), current])
  return advertised.filter(effort => shown.has(effort.id))
}

/**
 * The thinking level a model switch or a thinking-on gesture applies: the
 * level in use when the target offers it, so a chosen strength survives the
 * switch, else the catalog default, else `high`, `medium`, or the strongest.
 * @param efforts - levels the picker offers for the target model.
 * @param catalogDefault - the target model's catalog default.
 * @param carried - the effort in use before the switch or gesture.
 * @returns an effort id, or undefined when the model advertises no thinking level.
 */
export function preferredEffort(
  efforts: readonly ModelReasoningEffort[],
  catalogDefault: string | undefined,
  carried: string | undefined,
): string | undefined {
  const thinking = efforts.filter(effort => !isOffEffort(effort.id))
  const ids = new Set(thinking.map(effort => effort.id))
  for (const candidate of [carried, catalogDefault, 'high', 'medium']) {
    if (candidate !== undefined && ids.has(candidate)) return candidate
  }
  return thinking.at(-1)?.id
}

/**
 * First-token wait under a thinking level: the base wait times a factor that
 * grows with the level's rank among the thinking levels.
 * @param latencyMs - base wait with thinking off.
 * @param efforts - levels the picker offers.
 * @param effort - the selected effort id.
 * @returns milliseconds, or undefined without a base wait.
 */
export function thinkingLatency(
  latencyMs: number | undefined,
  efforts: readonly ModelReasoningEffort[],
  effort: string | undefined,
): number | undefined {
  if (latencyMs === undefined) return undefined
  if (effort === undefined || isOffEffort(effort)) return latencyMs
  const rank = efforts.filter(level => !isOffEffort(level.id)).findIndex(level => level.id === effort)
  return latencyMs * Math.min(THINKING_BASE * THINKING_STEP ** Math.max(rank, 0), THINKING_CAP)
}
