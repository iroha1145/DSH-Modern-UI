/**
 * State and actions of the Models settings card where a user edits what the
 * composer's model picker shows for each model: description, speed, quality
 * and cost ratings, first-token wait, prices, the reasoning levels the
 * picker offers, and the tile's mark. The controller joins the settings form and the shared model
 * catalog into one observable projection, owns the open editor's draft, and
 * performs every write, so the card stays presentational.
 *
 * An editor field left blank inherits the composition, fetched, built-in, or catalog
 * value; saving edits only touched user fields against their opening baseline.
 * Concurrent edits to the same field are refused; unrelated fields are retained. Price refreshes replace the fetched
 * prices and their timestamp in one write.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalogModel, ModelReasoningEffort } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FetchedModelPrice, ModelPickerOverride, ModelPickerSettings } from '../../model-settings.ts'
import type { ModelCatalogState } from '../catalog.ts'
import { fetchPrices, type PricedModel } from '../price-source.ts'
import { glyphFor, type PresetBlurb } from '../presets.ts'
import { presetEfforts, profileOf, type PriceSource } from '../profiles.ts'
import { orderModelProviders } from '../provider-order.ts'
import type { VendorMark } from '../vendor-marks.ts'

/** How long a price refresh may wait for the public price source, in milliseconds; the dictionaries say 30 seconds. */
const PRICE_TIMEOUT_MS = 30_000

/** The abort reason of a price read that ran out of time, so it is told apart from a disposal. */
const TIMED_OUT = Symbol('price read timed out')

/** Plain non-negative decimals; signs, exponents, and separators other than a point are refused. */
const DECIMAL = /^(?:\d+\.?\d*|\.\d+)$/

/** The only rating texts the editor offers. */
const RATING = /^[1-5]$/

/** Rating fields, in the order an override lists them. */
const RATING_FIELDS = ['speed', 'quality', 'cost'] as const

/** Price fields, in the order an override lists them. */
const PRICE_FIELDS = ['priceInput', 'priceOutput'] as const

/** Editable override keys; one changed key is one Host field operation. */
const OVERRIDE_FIELDS = ['description', 'speed', 'quality', 'cost', 'latencyMs', 'priceInput', 'priceOutput', 'efforts', 'icon'] as const

/** The editor fields a user types or picks; blank means inherit. The icon holds a mark id or the letter choice. */
export type DraftField = 'description' | 'speed' | 'quality' | 'cost' | 'latency' | 'priceInput' | 'priceOutput' | 'icon'

/** The open editor's text per field and the effort ids left checked. */
export interface ModelDraft extends Record<DraftField, string> {
  /** Effort ids the picker keeps offering, in catalog order. */
  readonly efforts: readonly string[]
}

/** One catalog model as the card lists it. */
export interface ModelRowState {
  /** Model id, shared by every route serving the model. */
  readonly id: string
  /** Catalog display name. */
  readonly name: string
  /** Tile monogram; empty when the name has no letter or digit. */
  readonly glyph: string
  /** Vendor mark drawn instead of the monogram; undefined keeps the letter. */
  readonly mark: VendorMark | undefined
  /** Effective speed rating, 1 to 5. */
  readonly speed: number | undefined
  /** Effective quality rating, 1 to 5. */
  readonly quality: number | undefined
  /** Effective cost rating, 1 to 5. */
  readonly cost: number | undefined
  /** Effective input price in US dollars per million tokens. */
  readonly priceInput: number | undefined
  /** Effective output price in US dollars per million tokens. */
  readonly priceOutput: number | undefined
  /** Layer the price came from; undefined when the model has none. */
  readonly priceSource: PriceSource | undefined
  /** Whether the user layer holds an override for this model. */
  readonly customized: boolean
}

/** One reasoning level the editor lets the user keep or hide. */
export interface EffortChoiceState {
  /** Adapter-owned effort id. */
  readonly id: string
  /** The name the picker shows: its localized short name, else the adapter's. */
  readonly name: string
  /** Whether the picker keeps offering this level. */
  readonly checked: boolean
  /** True for the only level still offered, which cannot be unchecked. */
  readonly locked: boolean
}

/** Values the picker would use for each blank editor field. */
export interface ModelPlaceholders {
  /** Built-in description key, when the model has a preset. */
  readonly blurb: PresetBlurb | undefined
  /** Catalog description, when no preset applies. */
  readonly description: string | undefined
  /** Inherited speed rating. */
  readonly speed: number | undefined
  /** Inherited quality rating. */
  readonly quality: number | undefined
  /** Inherited cost rating. */
  readonly cost: number | undefined
  /** Inherited first-token wait in seconds, or empty text. */
  readonly latency: string
  /** Inherited input price, or empty text. */
  readonly priceInput: string
  /** Inherited output price, or empty text. */
  readonly priceOutput: string
  /** The mark the automatic choice draws; undefined when it falls back to the letter. */
  readonly mark: VendorMark | undefined
}

/** The open editor of one model. */
export interface ModelEditorState {
  /** Model id being edited. */
  readonly id: string
  /** Catalog display name, for the editor's accessible name. */
  readonly name: string
  /** The monogram the letter choice draws. */
  readonly glyph: string
  /** The staged field texts. */
  readonly draft: ModelDraft
  /** What each blank field falls back to. */
  readonly placeholders: ModelPlaceholders
  /** Levels the user may hide; empty when the model offers no choice. */
  readonly efforts: readonly EffortChoiceState[]
  /** Fields whose text cannot be written. */
  readonly invalid: { readonly latency: boolean; readonly priceInput: boolean; readonly priceOutput: boolean }
  /** Whether saving would change what is stored. */
  readonly dirty: boolean
  /** Whether the user layer holds an override that restoring would remove. */
  readonly customized: boolean
  /** Whether the last write was refused. */
  readonly failed: boolean
  /** Whether another writer changed a field this editor would replace. */
  readonly conflicted: boolean
}

/** Why the last price refresh did not complete. */
export type PriceFailure =
  | { readonly kind: 'read'; readonly message: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'save' }

/** The price refresh's progress. */
export interface PricesState {
  /** Whether a refresh is reading or saving. */
  readonly busy: boolean
  /** Why the last refresh did not complete; undefined while none failed. */
  readonly failure: PriceFailure | undefined
  /** ISO time of the last successful refresh. */
  readonly updatedAt: string | undefined
}

/** Everything the card renders. */
export interface ModelSettingsState {
  /** False while the settings section is loading or not served; the card renders nothing. */
  readonly available: boolean
  /** Whether the settings document accepts writes. */
  readonly writable: boolean
  /** Whether a model write is in flight. */
  readonly saving: boolean
  /** The shared catalog's load state; rows already listed stay while it refreshes. */
  readonly catalog: { readonly loading: boolean; readonly error: string | undefined }
  /** Catalog models, deduplicated by id. */
  readonly rows: readonly ModelRowState[]
  /** The open editor, when one row is expanded. */
  readonly editor: ModelEditorState | undefined
  /** The price refresh. */
  readonly prices: PricesState
}

/** What the card's slot registration injects: the observable state and every action. */
export interface ModelSettingsFace {
  hooks: {
    /** Card state bound by the renderer as useModelSettings. */
    modelSettings: SnapshotStore<ModelSettingsState>
  }
  /** Ensure the shared catalog is loaded; failures land on the state. */
  loadCatalog: () => void
  /**
   * Resolve a built-in description key in the active language.
   * @param key - preset description key.
   * @returns the localized description.
   */
  blurb: (key: PresetBlurb) => string
  /** Open the model's editor, or close it when it is already open. */
  toggleModel: (id: string) => void
  /** Stage one field's text in the open editor. */
  editField: (field: DraftField, text: string) => void
  /** Keep or hide one reasoning level in the open editor. */
  toggleEffort: (effort: string, checked: boolean) => void
  /** Write the open editor's draft. */
  saveModel: () => void
  /** Clear the open model's override. */
  restoreModel: () => void
  /** Close the open editor, discarding its draft. */
  cancelEdit: () => void
  /** Read prices from the public price source and store them. */
  refreshPrices: () => void
}

/** What the controller needs from the plugin that registers the card. */
export interface ModelPickerSettingsDeps {
  /** The picker's settings section. */
  form: ConfigForm<ModelPickerSettings>
  /** The shared model catalog's observable state. */
  catalog: SnapshotStore<ModelCatalogState>
  /** Ensure the shared catalog is loaded. */
  loadCatalog: () => void
  /**
   * Resolve a built-in description key in the active language.
   * @param key - preset description key.
   * @returns the localized description.
   */
  blurb: (key: PresetBlurb) => string
  /**
   * Name a reasoning level the way the picker does.
   * @param id - adapter-owned effort id.
   * @param fallback - the adapter's display name.
   * @returns the localized short name, or the fallback for uncommon ids.
   */
  effortName: (id: string, fallback: string) => string
  /** The fetch used for price refreshes; defaults to the browser's. */
  fetcher?: typeof fetch | undefined
  /** The clock stamped onto a price refresh; defaults to the system time. */
  now?: (() => Date) | undefined
}

/** A settings field value, shaped so a path write accepts it as JSON. */
type PriceJson = { [K in keyof FetchedModelPrice]: FetchedModelPrice[K] }

/** One listed model: the first catalog entry names it, and every route's levels count. */
interface ListedModel {
  readonly model: ModelCatalogModel
  readonly efforts: readonly ModelReasoningEffort[]
  /** The levels offered without a user choice: the preset's, else all. */
  readonly defaults: readonly ModelReasoningEffort[]
}

/** What the card renders while the section cannot be edited. */
const HIDDEN: ModelSettingsState = {
  available: false,
  writable: false,
  saving: false,
  catalog: { loading: false, error: undefined },
  rows: [],
  editor: undefined,
  prices: { busy: false, failure: undefined, updatedAt: undefined },
}

/**
 * List the catalog's models: providers in the picker's order, models in
 * catalog order, each id once. The first occurrence names the model; the
 * reasoning levels of every route serving the id are gathered, so the
 * editor can offer what any of them advertises.
 * @param catalog - the shared catalog, when loaded.
 * @returns one entry per model id.
 */
function listModels(catalog: ModelCatalogState['value']): ListedModel[] {
  if (catalog === null) return []
  const listed = new Map<string, { model: ModelCatalogModel; efforts: ModelReasoningEffort[] }>()
  for (const group of orderModelProviders(catalog.groups)) {
    for (const model of group.models) {
      let entry = listed.get(model.id)
      if (entry === undefined) {
        entry = { model, efforts: [] }
        listed.set(model.id, entry)
      }
      for (const effort of model.reasoning?.efforts ?? []) {
        if (!entry.efforts.some(known => known.id === effort.id)) entry.efforts.push(effort)
      }
    }
  }
  return [...listed.values()].map(entry => ({ ...entry, defaults: presetEfforts(entry.model.id, entry.efforts) }))
}

/**
 * Every route and model pair of the catalog, for a price refresh. Ids are not
 * deduplicated: the price source tries each route that serves a model.
 * @param catalog - the shared catalog, when loaded.
 * @returns the pairs, providers in the picker's order.
 */
function pricedModels(catalog: ModelCatalogState['value']): PricedModel[] {
  if (catalog === null) return []
  return orderModelProviders(catalog.groups).flatMap(group => group.models.map(model => ({ provider: group.id, model: model.id })))
}

/**
 * Whether a stored entry holds anything restoring would remove. The Host
 * reads an absent level list back as an empty array, which narrows nothing,
 * so a bare `efforts: []` is not an override.
 * @param entry - one model's stored entry.
 * @returns true when the entry sets at least one field.
 */
function holdsOverride(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  return Object.entries(entry).some(([key, value]) =>
    value !== undefined && !(key === 'efforts' && Array.isArray(value) && value.length === 0))
}

/**
 * Whether the user layer overrides a model.
 * @param user - the raw user layer of the settings section.
 * @param id - model id.
 * @returns true when the user layer holds an entry for the model that sets a field.
 */
function hasUserOverride(user: unknown, id: string): boolean {
  if (typeof user !== 'object' || user === null) return false
  const models: unknown = (user as { models?: unknown }).models
  return typeof models === 'object' && models !== null && Object.hasOwn(models, id)
    && holdsOverride((models as Record<string, unknown>)[id])
}

/** One model's fields in a Host-provided composition or raw user layer. */
function layerOverride(layer: unknown, id: string): ModelPickerOverride | undefined {
  if (typeof layer !== 'object' || layer === null) return undefined
  const models: unknown = (layer as ModelPickerSettings).models
  if (typeof models !== 'object' || models === null || !Object.hasOwn(models, id)) return undefined
  return (models as Record<string, ModelPickerOverride>)[id]
}

/** Only explicitly stored user fields become inputs; resolve expressions through the accepted value. */
function userOverride(settings: ModelPickerSettings, user: unknown, id: string): ModelPickerOverride | undefined {
  const own = layerOverride(user, id)
  const resolved = settings.models?.[id]
  if (own === undefined || resolved === undefined) return undefined
  return Object.fromEntries(OVERRIDE_FIELDS.filter(key => Object.hasOwn(own, key)).map(key => [key, resolved[key]]))
}

/** Clearing a user model field restores its composition value, ahead of fetched prices and presets. */
function inheritedSettings(settings: ModelPickerSettings, base: unknown, id: string): ModelPickerSettings {
  const { models: _models, ...rest } = settings
  const inherited = layerOverride(base, id)
  return inherited === undefined ? rest : { ...rest, models: { [id]: inherited } }
}

/**
 * The levels the draft keeps. Levels the catalog no longer advertises are
 * ignored, and a draft that keeps none counts as keeping the defaults, as the picker does.
 * @param advertised - every level the model's routes advertise.
 * @param ids - effort ids the draft keeps.
 * @param defaults - the levels offered without a user choice.
 * @returns the kept levels in catalog order.
 */
function chosenEfforts(
  advertised: readonly ModelReasoningEffort[],
  ids: readonly string[],
  defaults: readonly ModelReasoningEffort[],
): readonly ModelReasoningEffort[] {
  const kept = advertised.filter(effort => ids.includes(effort.id))
  return kept.length === 0 ? defaults : kept
}

/** Whether two level lists, both in catalog order, name the same levels. */
function sameLevels(a: readonly ModelReasoningEffort[], b: readonly ModelReasoningEffort[]): boolean {
  return a.length === b.length && a.every((effort, index) => effort.id === b[index]?.id)
}

/** A stored number as editor text, or empty text when unset. */
function amountField(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/** A stored wait in milliseconds as editor text in seconds, or empty text when unset. */
function secondsField(milliseconds: number | undefined): string {
  return milliseconds === undefined ? '' : String(milliseconds / 1000)
}

/**
 * The editor text a stored override produces.
 * @param stored - the model's stored override, if any.
 * @param entry - the listed model: every advertised level and the defaults.
 * @returns the draft that saves back the same override.
 */
function draftOf(stored: ModelPickerOverride | undefined, entry: Pick<ListedModel, 'efforts' | 'defaults'>): ModelDraft {
  return {
    description: stored?.description ?? '',
    speed: amountField(stored?.speed),
    quality: amountField(stored?.quality),
    cost: amountField(stored?.cost),
    latency: secondsField(stored?.latencyMs),
    priceInput: amountField(stored?.priceInput),
    priceOutput: amountField(stored?.priceOutput),
    efforts: chosenEfforts(entry.efforts, stored?.efforts ?? [], entry.defaults).map(effort => effort.id),
    icon: stored?.icon ?? '',
  }
}

/**
 * Read editor text as a plain non-negative decimal.
 * @param text - what the user typed.
 * @returns undefined for blank text, NaN for anything unreadable, else the number.
 */
function parseAmount(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return DECIMAL.test(trimmed) && Number.isFinite(Number(trimmed)) ? Number(trimmed) : Number.NaN
}

/** What a draft writes, and which of its fields cannot be written. */
interface BuiltOverride {
  /** The non-blank, valid fields in a fixed order, so equal overrides serialize alike. */
  readonly override: ModelPickerOverride
  /** Fields holding text that is not a usable number. */
  readonly invalid: { latency: boolean; priceInput: boolean; priceOutput: boolean }
}

/**
 * Turn a draft into the override it would store. Blank fields are left out,
 * the wait is stored in whole milliseconds, and keeping exactly the default
 * levels adds no effort list.
 * @param draft - the staged editor text.
 * @param entry - the listed model: every advertised level and the defaults.
 * @returns the override and the fields that could not be read.
 */
function buildOverride(draft: ModelDraft, entry: Pick<ListedModel, 'efforts' | 'defaults'>): BuiltOverride {
  const override: ModelPickerOverride = {}
  const invalid = { latency: false, priceInput: false, priceOutput: false }
  const description = draft.description.trim()
  if (description !== '') override.description = description
  for (const field of RATING_FIELDS) {
    if (RATING.test(draft[field])) override[field] = Number(draft[field])
  }
  const seconds = parseAmount(draft.latency)
  if (seconds !== undefined) {
    const milliseconds = Math.round(seconds * 1000)
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 1) override.latencyMs = milliseconds
    else invalid.latency = true
  }
  for (const field of PRICE_FIELDS) {
    const price = parseAmount(draft[field])
    if (price === undefined) continue
    if (Number.isNaN(price)) invalid[field] = true
    else override[field] = price
  }
  const chosen = chosenEfforts(entry.efforts, draft.efforts, entry.defaults)
  if (!sameLevels(chosen, entry.defaults)) override.efforts = chosen.map(effort => effort.id)
  if (draft.icon !== '') override.icon = draft.icon
  return { override, invalid }
}

/** One editor's immutable opening values and locally touched fields. */
interface OpenModel {
  id: string
  draft: ModelDraft
  baseline: ModelPickerOverride
  baselineUser: string | undefined
  touched: ReadonlySet<keyof ModelDraft>
}

/** Observable state and actions of the Models settings card. */
export class ModelPickerSettingsController {
  /** The card's observable state. */
  private readonly store: SnapshotStore<ModelSettingsState>
  private readonly unsubscribe: (() => void)[]
  private open: OpenModel | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private pricing = false
  private priceFailure: PriceFailure | undefined
  private abort: AbortController | undefined
  private disposed = false
  /** What the card's slot registration injects; every member is stable for the controller's lifetime. */
  readonly face: ModelSettingsFace

  /**
   * @param deps - the settings form, the shared catalog, and the card's collaborators.
   */
  constructor(private readonly deps: ModelPickerSettingsDeps) {
    this.store = createSnapshotStore(this.project())
    this.unsubscribe = [
      deps.form.subscribe(() => { this.publish() }),
      deps.catalog.subscribe(() => { this.publish() }),
    ]
    this.face = {
      hooks: { modelSettings: this.store },
      loadCatalog: () => { deps.loadCatalog() },
      blurb: key => deps.blurb(key),
      toggleModel: (id) => { this.toggleModel(id) },
      editField: (field, text) => { this.editField(field, text) },
      toggleEffort: (effort, checked) => { this.toggleEffort(effort, checked) },
      saveModel: () => { void this.saveModel() },
      restoreModel: () => { void this.restoreModel() },
      cancelEdit: () => { this.cancelEdit() },
      refreshPrices: () => { void this.refreshPrices() },
    }
  }

  /** Stop listening, and abandon a price read still in flight. */
  dispose(): void {
    this.disposed = true
    this.abort?.abort()
    for (const off of this.unsubscribe) off()
  }

  /** Republish the projection; a disposed controller stays as it was last published. */
  private publish(): void {
    if (this.disposed) return
    this.store.set(this.project())
  }

  /** The open editor with the catalog entry it edits, or undefined when none is open or the model left the catalog. */
  private current(): (OpenModel & { entry: ListedModel }) | undefined {
    if (this.open === undefined) return undefined
    const entry = this.entryFor(this.open.id)
    return entry === undefined ? undefined : { ...this.open, entry }
  }

  /** The composition layer also owns the reasoning levels a blank user choice inherits. */
  private entryFor(id: string): ListedModel | undefined {
    const entry = listModels(this.deps.catalog.getSnapshot().value).find(listed => listed.model.id === id)
    if (entry === undefined) return undefined
    const inherited = layerOverride(this.deps.form.getSnapshot().base, id)
    return { ...entry, defaults: chosenEfforts(entry.efforts, inherited?.efforts ?? [], entry.defaults) }
  }

  private project(): ModelSettingsState {
    const form = this.deps.form.getSnapshot()
    const settings = form.value
    if (form.status !== 'ready' || settings === undefined) return HIDDEN
    const catalog = this.deps.catalog.getSnapshot()
    const rows = listModels(catalog.value).map(({ model }): ModelRowState => {
      const profile = profileOf(model, settings)
      return {
        id: model.id,
        name: model.name,
        glyph: profile.glyph,
        mark: profile.mark,
        speed: profile.speed,
        quality: profile.quality,
        cost: profile.cost,
        priceInput: profile.priceInput,
        priceOutput: profile.priceOutput,
        priceSource: profile.priceSource,
        customized: hasUserOverride(form.user, model.id),
      }
    })
    return {
      available: true,
      writable: form.writable,
      saving: this.saving,
      catalog: {
        loading: catalog.value === null && catalog.status !== 'error',
        error: catalog.status === 'error' ? catalog.error ?? '' : undefined,
      },
      rows,
      editor: this.editorState(settings, form.user, form.base),
      prices: { busy: this.pricing, failure: this.priceFailure, updatedAt: settings.pricesUpdatedAt },
    }
  }

  private editorState(settings: ModelPickerSettings, user: unknown, base: unknown): ModelEditorState | undefined {
    const current = this.current()
    if (current === undefined) return undefined
    const { id, draft, entry } = current
    const inherited = profileOf(entry.model, inheritedSettings(settings, base, id))
    const chosen = chosenEfforts(entry.efforts, draft.efforts, entry.defaults)
    const built = buildOverride(draft, entry)
    const latest = buildOverride(draftOf(userOverride(settings, user, id), entry), entry).override
    return {
      id,
      name: entry.model.name,
      glyph: glyphFor(entry.model.name, undefined),
      draft,
      placeholders: {
        blurb: inherited.blurb,
        description: inherited.description,
        speed: inherited.speed,
        quality: inherited.quality,
        cost: inherited.cost,
        latency: secondsField(inherited.latencyMs),
        priceInput: amountField(inherited.priceInput),
        priceOutput: amountField(inherited.priceOutput),
        mark: inherited.mark,
      },
      // One level offers no choice, so the field appears only for models with several.
      efforts: entry.efforts.length < 2
        ? []
        : entry.efforts.map((effort) => {
          const checked = chosen.some(kept => kept.id === effort.id)
          return { id: effort.id, name: this.deps.effortName(effort.id, effort.name), checked, locked: checked && chosen.length === 1 }
        }),
      invalid: built.invalid,
      dirty: OVERRIDE_FIELDS.some(field => current.touched.has(field === 'latencyMs' ? 'latency' : field)
        && JSON.stringify(built.override[field]) !== JSON.stringify(current.baseline[field])
        && JSON.stringify(built.override[field]) !== JSON.stringify(latest[field])),
      customized: hasUserOverride(user, id),
      failed: this.failed,
      conflicted: this.conflicted,
    }
  }

  private toggleModel(id: string): void {
    if (this.saving) return
    if (this.open?.id === id) {
      this.open = undefined
    } else {
      const entry = this.entryFor(id)
      const { value: settings, user } = this.deps.form.getSnapshot()
      if (entry === undefined || settings === undefined) return
      const draft = draftOf(userOverride(settings, user, id), entry)
      this.open = {
        id, draft, baseline: buildOverride(draft, entry).override,
        baselineUser: JSON.stringify(layerOverride(user, id)), touched: new Set(),
      }
    }
    this.failed = false
    this.conflicted = false
    this.publish()
  }

  private editField(field: DraftField, text: string): void {
    const current = this.current()
    if (current === undefined || this.saving) return
    this.open = { ...current, draft: { ...current.draft, [field]: text }, touched: new Set([...current.touched, field]) }
    this.failed = false
    this.conflicted = false
    this.publish()
  }

  private toggleEffort(effort: string, checked: boolean): void {
    const current = this.current()
    if (current === undefined || this.saving) return
    const kept = new Set(chosenEfforts(current.entry.efforts, current.draft.efforts, current.entry.defaults).map(level => level.id))
    if (checked) kept.add(effort)
    else kept.delete(effort)
    const efforts = current.entry.efforts.filter(level => kept.has(level.id)).map(level => level.id)
    // At least one level must stay on offer.
    if (efforts.length === 0) return
    this.open = { ...current, draft: { ...current.draft, efforts }, touched: new Set([...current.touched, 'efforts']) }
    this.failed = false
    this.conflicted = false
    this.publish()
  }

  private cancelEdit(): void {
    if (this.saving) return
    this.open = undefined
    this.failed = false
    this.conflicted = false
    this.publish()
  }

  private async saveModel(): Promise<void> {
    const current = this.current()
    if (current === undefined || this.saving || !this.deps.form.getSnapshot().writable) return
    const { override, invalid } = buildOverride(current.draft, current.entry)
    if (invalid.latency || invalid.priceInput || invalid.priceOutput) return
    const { value: settings, user, revision } = this.deps.form.getSnapshot()
    if (settings === undefined) return
    const previous = buildOverride(draftOf(userOverride(settings, user, current.id), current.entry), current.entry).override
    const ops: SettingsPathOpView[] = []
    for (const field of OVERRIDE_FIELDS) {
      const draftField = field === 'latencyMs' ? 'latency' : field
      if (!current.touched.has(draftField)) continue
      const value = override[field]
      if (JSON.stringify(value) === JSON.stringify(current.baseline[field])) continue
      if (JSON.stringify(previous[field]) !== JSON.stringify(current.baseline[field])
        && JSON.stringify(previous[field]) !== JSON.stringify(value)) {
        this.failed = false
        this.conflicted = true
        this.publish()
        return
      }
      if (JSON.stringify(value) === JSON.stringify(previous[field])) continue
      const path = ['models', current.id, field]
      ops.push(value === undefined ? { op: 'unset', path } : { op: 'set', path, value })
    }
    if (ops.length > 0) await this.commit(ops, revision)
  }

  private async restoreModel(): Promise<void> {
    const current = this.current()
    if (current === undefined || this.saving || !this.deps.form.getSnapshot().writable) return
    const { user, revision } = this.deps.form.getSnapshot()
    if (JSON.stringify(layerOverride(user, current.id)) !== current.baselineUser) {
      this.failed = false
      this.conflicted = true
      this.publish()
      return
    }
    await this.commit([{ op: 'unset', path: ['models', current.id] }], revision)
  }

  /** Write one model's change; the editor closes when the Host accepts it and stays open, flagged, when it does not. */
  private async commit(ops: readonly SettingsPathOpView[], revision: number | undefined): Promise<void> {
    this.saving = true
    this.failed = false
    this.conflicted = false
    this.publish()
    const saved = await this.write(ops, revision)
    this.saving = false
    if (saved) this.open = undefined
    else if (this.deps.form.getSnapshot().revision !== revision) this.conflicted = true
    else this.failed = true
    this.publish()
  }

  /** One atomic write; a transport failure counts as a refusal. */
  private async write(ops: readonly SettingsPathOpView[], revision?: number): Promise<boolean> {
    try {
      return await (revision === undefined ? this.deps.form.mutate(ops) : this.deps.form.mutate(ops, revision))
    } catch {
      return false
    }
  }

  private async refreshPrices(): Promise<void> {
    if (this.pricing || this.saving || !this.deps.form.getSnapshot().writable) return
    const models = pricedModels(this.deps.catalog.getSnapshot().value)
    if (models.length === 0) return
    this.pricing = true
    this.priceFailure = undefined
    this.publish()
    this.priceFailure = await this.readPrices(models)
    this.pricing = false
    this.publish()
  }

  /**
   * Read the prices and store them with the time of the read.
   * @param models - every route and model pair of the catalog.
   * @returns why the refresh did not complete, or undefined when it did.
   */
  private async readPrices(models: readonly PricedModel[]): Promise<PriceFailure | undefined> {
    const abort = new AbortController()
    this.abort = abort
    const timer = setTimeout(() => { abort.abort(TIMED_OUT) }, PRICE_TIMEOUT_MS)
    let prices: Record<string, PriceJson>
    try {
      prices = await fetchPrices(models, this.deps.fetcher ?? globalThis.fetch.bind(globalThis), abort.signal)
    } catch (error: unknown) {
      if (abort.signal.reason === TIMED_OUT) return { kind: 'timeout' }
      return { kind: 'read', message: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      this.abort = undefined
    }
    if (this.disposed) return undefined
    const stamp = (this.deps.now ?? (() => new Date()))().toISOString()
    const saved = await this.write([
      { op: 'set', path: ['prices'], value: prices },
      { op: 'set', path: ['pricesUpdatedAt'], value: stamp },
    ])
    return saved ? undefined : { kind: 'save' }
  }
}
