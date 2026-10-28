// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/**
 * Reasoning-level declarations for pi-ai model rows the installed catalog does
 * not describe. The rules are the patched Models page's (`ModelListEditor`'s
 * `reasoningLevelsFor`, `ModelReasoningEfforts`'s `withEfforts`, the store's
 * `reasoningLevelChoices`), lifted out of the official editor so a card beside
 * it can apply them to the stored `models` list:
 *
 * - a row declares its own levels when the installed catalog does not describe
 *   its id (a model newer than the catalog), or when it already carries a
 *   declaration, so a stored declaration is never invisible or unrepairable;
 * - behind an installed catalog an absent field restores the catalog's levels,
 *   so turning reasoning off stores `false` rather than removing the field;
 * - the levels offered come from the owning namespace's schema, the same place
 *   the adapter reads the accepted keys from.
 */

/** Levels a model offers when the switch is turned on, where the schema lists them: Off plus the common OpenAI-compatible trio. */
export const INITIAL_LEVELS = ['off', 'low', 'medium', 'high'] as const

/** Any dict key resolves the same schema node; the probe route only names the position. */
const PROBE_ROUTE = '\0probe'

/** The wire value a level sends; `null` is the Off entry that sends nothing. */
export type EffortWire = string | null

/** Declared levels in their stored order, each with the value sent for it. */
export type EffortEntries = ReadonlyArray<readonly [string, EffortWire]>

/** One stored model row as drafted (hidden fields included). */
export type ModelRowDraft = Readonly<Record<string, unknown>>

/** The schema operations the level reader needs (the settings-owned service satisfies it). */
export interface SchemaReader {
  rehydrate(serialized: unknown): SchemaNodeLike
  nodeAtPath(root: SchemaNodeLike, path: readonly string[]): SchemaNodeLike | undefined
}

/** The parts of a rehydrated schemastery node the level reader inspects. */
export interface SchemaNodeLike {
  readonly type?: string
  readonly list?: readonly SchemaNodeLike[] | undefined
  readonly sKey?: SchemaNodeLike | undefined
  readonly value?: unknown
}

/**
 * Convert a stored `models` value into row records without dropping hidden fields.
 * @param value - the `models` value of one route, or anything else.
 * @returns the rows; non-object rows become empty records, a non-array becomes no rows.
 */
export function modelDrafts(value: unknown): readonly ModelRowDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry => (typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry as ModelRowDraft : {}))
}

/**
 * Read a nested value by object keys.
 * @param value - value to traverse.
 * @param path - object keys.
 * @returns the resolved value, or undefined when the path is absent.
 */
export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Read the declared levels from a row in their stored order.
 * @param model - model row as drafted.
 * @returns the entries; empty for a valueless field, and `undefined` when the field is absent or `false`.
 */
export function readEfforts(model: ModelRowDraft): EffortEntries | undefined {
  const value = model['reasoningEfforts']
  if (value === null) return []
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.entries(value as Record<string, unknown>).map(([level, wire]) => [level, typeof wire === 'string' ? wire : null] as const)
}

/**
 * Whether a row carries its own declaration (a level dict or an explicit `false`).
 * @param model - model row as drafted.
 * @returns whether `reasoningEfforts` is present.
 */
export function declaresEfforts(model: ModelRowDraft): boolean {
  return model['reasoningEfforts'] !== undefined
}

/** The wire value a level sends unless its row says otherwise. */
export function defaultValue(level: string): EffortWire {
  return level === 'off' ? null : level
}

/**
 * Replace a row's declared levels, preserving every other field. Behind an
 * installed catalog an absent field would restore the catalog's levels, so
 * turning reasoning off stores `false`.
 * @param model - model row as drafted.
 * @param entries - the levels to write in row order, or `undefined` to turn reasoning off.
 * @returns the replacement row.
 */
export function withEfforts(model: ModelRowDraft, entries: EffortEntries | undefined): ModelRowDraft {
  return { ...model, reasoningEfforts: entries === undefined ? false : Object.fromEntries(entries) }
}

/**
 * The entries a model offers when its switch turns on.
 * @param levels - the levels the schema offers, in escalation order.
 * @returns Off plus the common trio, restricted to what the schema lists.
 */
export function initialEntries(levels: readonly string[]): EffortEntries {
  return INITIAL_LEVELS.filter(level => levels.includes(level)).map(level => [level, defaultValue(level)] as const)
}

/**
 * Keep or drop one level in a declaration. Levels the schema lists keep its
 * escalation order; a stored level the schema does not list keeps its place at
 * the end, so an edit never drops it. Existing wire spellings survive.
 * @param entries - the declaration as stored.
 * @param level - the level the user ticked or unticked.
 * @param levels - the levels the schema offers, in escalation order.
 * @param checked - whether the level is offered after the edit.
 * @returns the replacement declaration.
 */
export function toggledLevel(entries: EffortEntries, level: string, levels: readonly string[], checked: boolean): EffortEntries {
  const wires = new Map(entries)
  if (checked) { if (!wires.has(level)) wires.set(level, defaultValue(level)) }
  else wires.delete(level)
  const ordered: Array<readonly [string, EffortWire]> = []
  for (const candidate of levels) if (wires.has(candidate)) ordered.push([candidate, wires.get(candidate) ?? null])
  for (const [stored, wire] of wires) if (!levels.includes(stored)) ordered.push([stored, wire])
  return ordered
}

/**
 * The reasoning levels a pi-ai model row may declare, read out of the owning
 * namespace's own schema: the levels the card offers and the keys the adapter
 * accepts in `reasoningEfforts` come from the same `Config`.
 * @param serialized - the namespace view's serialized schema envelope.
 * @param schema - schema operations.
 * @returns the levels in the schema's escalation order, or an empty list when the schema has none.
 */
export function reasoningLevelChoices(serialized: unknown, schema: SchemaReader): readonly string[] {
  if (serialized === undefined || serialized === null) return []
  const node = schema.nodeAtPath(schema.rehydrate(serialized), ['providers', PROBE_ROUTE, 'models', '0', 'reasoningEfforts'])
  const dict = (node?.list ?? []).find(branch => branch.type === 'dict')
  return (dict?.sKey?.list ?? []).map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** One stored row the card lets the user declare levels for. */
export interface DeclarableModel {
  /** Position in the stored `models` list. */
  readonly index: number
  /** Model id as stored. */
  readonly id: string
  /** Display name as stored, when one exists. */
  readonly name: string | undefined
  /** The declared levels; `undefined` while reasoning is off (absent or `false`). */
  readonly efforts: EffortEntries | undefined
}

/**
 * The rows of one route that declare their own levels: every row the
 * installed catalog does not describe, and every row that already carries a
 * declaration. Until the catalog answer arrives only declared rows show, so a
 * control never appears and then vanishes.
 * @param models - the route's stored `models` value.
 * @param catalogIds - ids the installed catalog describes; `undefined` while unknown.
 * @returns the declarable rows in stored order.
 */
export function declarableModels(models: unknown, catalogIds: ReadonlySet<string> | undefined): readonly DeclarableModel[] {
  const rows: DeclarableModel[] = []
  modelDrafts(models).forEach((model, index) => {
    const id = model['id']
    if (typeof id !== 'string' || id.trim().length === 0) return
    if (!declaresEfforts(model) && (catalogIds === undefined || catalogIds.has(id))) return
    const name = model['name']
    rows.push({ index, id, name: typeof name === 'string' && name.length > 0 ? name : undefined, efforts: readEfforts(model) })
  })
  return rows
}
