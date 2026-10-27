/**
 * Built-in picker details for well-known models, keyed by the model id their
 * vendor publishes. Strength ratings run from 1 to 5 and are editorial
 * starting points; prices are the vendor's own list prices as recorded by the
 * public price source (US dollars per million tokens, 2026-10-25), never a
 * reseller's. Users override any field from the Models settings page, and a
 * price refresh replaces the recorded prices.
 */

/** Description keys under the `preset.` locale prefix. */
export type PresetBlurb =
  | 'hardest' | 'complex' | 'everyday' | 'quick' | 'reasoning' | 'multimodal' | 'balanced' | 'cheapest'
  | 'longContext' | 'highspeed' | 'coding' | 'chinese' | 'value' | 'agents' | 'light' | 'agentTasks'
  | 'budget' | 'realtime'

/** Every description key, in dictionary order. */
export const PRESET_BLURBS: readonly PresetBlurb[] = [
  'hardest', 'complex', 'everyday', 'quick', 'reasoning', 'multimodal', 'balanced', 'cheapest',
  'longContext', 'highspeed', 'coding', 'chinese', 'value', 'agents', 'light', 'agentTasks',
  'budget', 'realtime',
]

/** Monogram per vendor, so models of one family share a tile. */
const VENDOR_GLYPHS = {
  anthropic: 'A',
  openai: 'O',
  google: 'G',
  moonshotai: 'K',
  alibaba: 'Q',
  zhipuai: 'Z',
  minimax: 'M',
  deepseek: 'D',
  xai: 'X',
} as const

/** Price-source provider ids of the vendors with presets. */
export type PresetVendor = keyof typeof VENDOR_GLYPHS

/** One model's built-in picker details. */
export interface ModelPreset {
  /** Price-source provider id of the model's vendor. */
  readonly vendor: PresetVendor
  /** Description key under `preset.`. */
  readonly blurb: PresetBlurb
  /** Relative response speed, 1 (slowest) to 5 (fastest). */
  readonly speed: number
  /** Relative answer quality, 1 to 5. */
  readonly quality: number
  /** Typical wait for the first token with thinking off, in milliseconds. */
  readonly latencyMs: number
  /** Vendor list price in US dollars per million tokens. */
  readonly price: { readonly input: number; readonly output: number; readonly cacheRead?: number }
  /**
   * Reasoning levels the vendor's API accepts, in escalation order, as pi-ai's
   * model data (1.3.0, 2026-10-25) records them — or, for a model newer than
   * that data, as the vendor's own model listing reports them. Where a route
   * advertises a broader generic list, the picker offers only these. DeepSeek's
   * own adapter declares its models' levels, so DeepSeek presets carry none.
   */
  readonly efforts?: readonly string[]
}

/** Speed, quality, and first-token wait by size tier. */
const TIERS = {
  top: { speed: 1, quality: 5, latencyMs: 2600 },
  large: { speed: 2, quality: 5, latencyMs: 1800 },
  mid: { speed: 4, quality: 4, latencyMs: 900 },
  small: { speed: 5, quality: 3, latencyMs: 450 },
} as const

function preset(
  vendor: PresetVendor, blurb: PresetBlurb, tier: keyof typeof TIERS,
  input: number, output: number, cacheRead?: number, efforts?: string,
): ModelPreset {
  return {
    vendor,
    blurb,
    ...TIERS[tier],
    price: cacheRead === undefined ? { input, output } : { input, output, cacheRead },
    ...efforts === undefined ? {} : { efforts: efforts.split(' ') },
  }
}

/** Built-in details keyed by lower-case model id. */
const PRESETS: ReadonlyMap<string, ModelPreset> = new Map<string, ModelPreset>([
  ['claude-fable-5-1', preset('anthropic', 'hardest', 'top', 10, 50, 0.25, 'minimal low medium high xhigh max')],
  ['claude-opus-5-5', preset('anthropic', 'complex', 'large', 4, 20, 0.2, 'low medium high xhigh max')],
  ['claude-sonnet-5-5', preset('anthropic', 'everyday', 'mid', 2, 10, 0.1, 'low medium high xhigh max')],
  ['claude-haiku-5-5', preset('anthropic', 'quick', 'small', 0.1, 0.5, 0.01, 'off low medium high xhigh max')],
  ['gpt-6-astra', preset('openai', 'reasoning', 'top', 10, 50, 1, 'low medium high xhigh max')],
  ['gpt-6.1-sol', preset('openai', 'everyday', 'mid', 2, 10, 0.1, 'low medium high xhigh max')],
  ['gpt-6-luna', preset('openai', 'quick', 'small', 0.1, 0.5, 0.01)],
  ['gemini-4-argon', preset('google', 'multimodal', 'large', 2, 10, 0.1, 'low medium high')],
  ['gemini-3.8-flash', preset('google', 'balanced', 'mid', 0.75, 3.75, 0.075, 'low medium high')],
  ['gemini-flash-lite-latest', preset('google', 'cheapest', 'small', 0.3, 2.5, 0.03, 'minimal low medium high')],
  ['kimi-k3.1-pro', preset('moonshotai', 'longContext', 'large', 2, 10, 0.2, 'low high max')],
  ['kimi-k3.1-pro-highspeed', preset('moonshotai', 'highspeed', 'mid', 4, 20, 0.2)],
  ['kimi-k3', preset('moonshotai', 'complex', 'large', 3, 15, 0.3, 'low high max')],
  ['kimi-k2.7-code', preset('moonshotai', 'coding', 'mid', 0.95, 4, undefined, 'minimal low medium high')],
  ['qwen3.8-max', preset('alibaba', 'chinese', 'large', 2, 6, 0.25, 'low medium xhigh')],
  ['qwen3.8-flash', preset('alibaba', 'value', 'small', 0.15, 0.47, 0.016, 'low medium xhigh')],
  ['glm-5.3', preset('zhipuai', 'agents', 'large', 1.19516, 4.18306, 0.29879, 'low high max')],
  ['glm-5.3-flash', preset('zhipuai', 'light', 'small', 0.11952, 0.41831, 0.03436, 'low high max')],
  ['minimax-m3', preset('minimax', 'agentTasks', 'mid', 0.3, 1.2, 0.06)],
  ['minimax-m3.1-flash', preset('minimax', 'budget', 'small', 0.15, 0.6, 0.015)],
  ['deepseek-v4-pro', preset('deepseek', 'reasoning', 'large', 0.66, 1.98, 0.022)],
  ['deepseek-flash', preset('deepseek', 'everyday', 'mid', 0.15, 0.6, 0.003)],
  ['grok-4.7', preset('xai', 'realtime', 'large', 2, 6, 0.5, 'low medium high xhigh')],
])

/** Other published ids of the same model. */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['k3', 'kimi-k3'],
  ['k3.1-pro', 'kimi-k3.1-pro'],
  ['k3.1-pro-highspeed', 'kimi-k3.1-pro-highspeed'],
  ['deepseek-v4-flash', 'deepseek-flash'],
  ['deepseek-v4.1-flash', 'deepseek-flash'],
])

/** The id a preset lookup tries: last path segment, lower case. */
function normalize(modelId: string): string {
  return modelId.slice(modelId.lastIndexOf('/') + 1).toLowerCase()
}

/**
 * Find a model's built-in details: the exact id, a known alias, or the id
 * without a trailing release-date suffix (`-0813`, `-20251001`).
 * @param modelId - provider-owned model id; a `vendor/model` route id also matches.
 * @returns the preset, or undefined for models without one.
 */
export function presetFor(modelId: string): ModelPreset | undefined {
  const id = normalize(modelId)
  const direct = PRESETS.get(ALIASES.get(id) ?? id)
  if (direct !== undefined) return direct
  const undated = id.replace(/-\d{4}(?:\d{4})?$/, '')
  return undated === id ? undefined : PRESETS.get(ALIASES.get(undated) ?? undated)
}

/**
 * The tile monogram: the vendor's letter for preset models, otherwise the
 * first letter or digit of the display name.
 * @param modelName - catalog display name.
 * @param preset - the model's preset, when it has one.
 * @returns one upper-case character, or an empty string for names without one.
 */
export function glyphFor(modelName: string, preset: ModelPreset | undefined): string {
  if (preset !== undefined) return VENDOR_GLYPHS[preset.vendor]
  const match = /[\p{L}\p{N}]/u.exec(modelName)
  return match === null ? '' : match[0].toUpperCase()
}
