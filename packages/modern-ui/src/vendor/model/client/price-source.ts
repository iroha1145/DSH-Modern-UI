/**
 * Price refresh from the public price source (models.dev), which records
 * vendors' list prices in US dollars per million tokens. A model's price is
 * read from the provider its route bills through first, then from its preset
 * vendor; other providers listing the same id are never consulted. Entries
 * whose input and output are both zero are plan-included or unpriced, so
 * they are skipped rather than shown as free.
 */
import type { FetchedModelPrice } from '../model-settings.ts'
import { presetFor } from './presets.ts'

/** The public price source's full catalog document. */
export const PRICE_SOURCE_URL = 'https://models.dev/api.json'

/** Routes whose prices live under another price-source provider id. */
const ROUTE_VENDORS: ReadonlyMap<string, string> = new Map([
  ['deepseek-official', 'deepseek'],
  ['deepseek-account', 'deepseek'],
])

/** One catalog route and model whose price to look up. */
export interface PricedModel {
  /** Catalog provider (route) id. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Price-source providers to try for one model, most specific first. */
function vendorsOf(entry: PricedModel): string[] {
  const route = ROUTE_VENDORS.get(entry.provider) ?? entry.provider
  const vendor = presetFor(entry.model)?.vendor
  return vendor === undefined || vendor === route ? [route] : [route, vendor]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** One provider's listed price for a model id, matched exactly, then case-insensitively. */
function listed(source: Record<string, unknown>, provider: string, model: string): FetchedModelPrice | undefined {
  const models = record(record(source[provider])?.models)
  if (models === undefined) return undefined
  const key = Object.hasOwn(models, model)
    ? model
    : Object.keys(models).find(candidate => candidate.toLowerCase() === model.toLowerCase())
  const cost = key === undefined ? undefined : record(record(models[key])?.cost)
  const input = amount(cost?.input)
  const output = amount(cost?.output)
  if (input === undefined || output === undefined || (input === 0 && output === 0)) return undefined
  const cacheRead = amount(cost?.cache_read)
  return cacheRead === undefined ? { input, output, provider } : { input, output, cacheRead, provider }
}

/**
 * Read prices for catalog models out of a price-source document.
 * @param source - the parsed document; anything malformed yields no prices.
 * @param models - routes and models to price; the first route listing a model id wins.
 * @returns prices keyed by model id, only for models the source lists.
 */
export function pricesFrom(source: unknown, models: readonly PricedModel[]): Record<string, FetchedModelPrice> {
  const document = record(source)
  const prices: Record<string, FetchedModelPrice> = {}
  if (document === undefined) return prices
  for (const entry of models) {
    if (Object.hasOwn(prices, entry.model)) continue
    for (const vendor of vendorsOf(entry)) {
      const price = listed(document, vendor, entry.model)
      if (price !== undefined) {
        prices[entry.model] = price
        break
      }
    }
  }
  return prices
}

/**
 * Download the price-source document and read the catalog models' prices.
 * @param models - routes and models to price.
 * @param fetcher - the browser fetch (injected for tests).
 * @param signal - aborts the download.
 * @returns prices keyed by model id.
 * @throws when the download fails or the response is not JSON.
 */
export async function fetchPrices(
  models: readonly PricedModel[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Record<string, FetchedModelPrice>> {
  const response = await fetcher(PRICE_SOURCE_URL, {
    headers: { accept: 'application/json' },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const document: unknown = await response.json()
  return pricesFrom(document, models)
}
