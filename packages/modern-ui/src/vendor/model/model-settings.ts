/**
 * Picker details shared by the Host settings schema and the browser surfaces:
 * the settings namespace this plugin owns, a user's overrides of one model's
 * picker details, and the last prices read from the public price source.
 * Pure declarations, so both halves import them without a runtime edge.
 */

/** Settings namespace owned by the model picker: this plugin's profile entry id. */
export const MODEL_PICKER_NAMESPACE = 'modern-ui'

/** One model's user-edited picker details; every field overrides the built-in preset. */
export interface ModelPickerOverride {
  /** One-line description under the model name. */
  description?: string
  /** Relative response speed, 1 (slowest) to 5 (fastest). */
  speed?: number
  /** Relative answer quality, 1 to 5. */
  quality?: number
  /** Relative price, 1 (cheapest) to 5 (most expensive). */
  cost?: number
  /** Typical wait for the first token with thinking off, in milliseconds. */
  latencyMs?: number
  /** Input price in US dollars per million tokens. */
  priceInput?: number
  /** Output price in US dollars per million tokens. */
  priceOutput?: number
  /** Effort ids the picker offers: a subset of the levels the model advertises. */
  efforts?: string[]
  /** The tile's mark: a vendor mark id, or {@link LETTER_ICON} for the name's first letter. */
  icon?: string
}

/** The icon choice that keeps the first-letter tile even when a vendor mark matches. */
export const LETTER_ICON = 'letter'

/** One model's price as last read from the public price source. */
export interface FetchedModelPrice {
  /** Input price in US dollars per million tokens. */
  input: number
  /** Output price in US dollars per million tokens. */
  output: number
  /** Cached-input price in US dollars per million tokens, when listed. */
  cacheRead?: number
  /** Price-source provider id the figures came from. */
  provider: string
}

/** The picker's settings section. */
export interface ModelPickerSettings {
  /** User overrides keyed by model id; routes serving the same id share them. */
  models?: Record<string, ModelPickerOverride>
  /** Prices read from the public price source, keyed by model id. */
  prices?: Record<string, FetchedModelPrice>
  /** ISO time of the last successful price read. */
  pricesUpdatedAt?: string
}
