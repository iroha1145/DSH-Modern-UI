/**
 * State and writes of the reasoning-declaration block the plugin adds to every
 * pi-ai provider card on the Models settings page. The block reads the route's
 * stored `models` list from the shared settings form, asks the adapter which
 * ids its installed catalog describes, and writes one row's `reasoningEfforts`
 * back through the same form with the revision it read, so a concurrent edit
 * elsewhere is refused rather than overwritten.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, ConfigFormSnapshot, SettingsDescribeFace, SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  initialEntries, modelDrafts, readEfforts, reasoningLevelChoices, toggledLevel, valueAt, withEfforts,
  type ModelRowDraft, type SchemaReader,
} from './reasoning-declaration.ts'

/** What the controller needs from the client runtime. */
export interface ReasoningDeclarationDeps {
  /** The settings namespace the form and the provider cards belong to (`llm-pi-ai`). */
  readonly namespace: string
  /** That namespace's shared settings form: the stored user layer and the revision-fenced write. */
  readonly form: ConfigForm<unknown>
  /** The shared describe mirror, read for the namespace's serialized schema. */
  readonly describe: SettingsDescribeFace
  /** Settings-owned schema operations. */
  readonly schema: SchemaReader
  /**
   * Ask the adapter which ids its installed catalog describes for one route.
   * @param provider - the route id.
   * @returns the ids, or `undefined` when discovery refused.
   */
  readonly discoverCatalog: (provider: string) => Promise<readonly string[] | undefined>
}

/** One stored row addressed for a write. */
export interface ModelTarget {
  /** The route id, for the per-route busy and refusal marks. */
  readonly provider: string
  /** Path of the route's profile inside the namespace section. */
  readonly settingsPath: readonly string[]
  /** Position in the stored `models` list. */
  readonly index: number
}

/** The block's own state beside the shared form. */
export interface ReasoningDeclarationState {
  /** Installed-catalog ids per route; `null` once discovery refused, absent while unasked or pending. */
  readonly catalogs: Readonly<Record<string, readonly string[] | null>>
  /** The route whose write is in flight. */
  readonly saving: string | undefined
  /** The route whose last write the Host refused. */
  readonly refused: string | undefined
}

/** What the slot registration injects: the observable sources and the actions. */
export interface ReasoningDeclarationFace {
  hooks: {
    /** The pi-ai settings form's snapshot, bound by the renderer as useForm. */
    form: ObservableSource<ConfigFormSnapshot<unknown>>
    /** The describe mirror's snapshot, bound as useMirror. */
    mirror: ObservableSource<SettingsMirrorSnapshot>
    /** The block's own state, bound as useDeclaration. */
    declaration: SnapshotStore<ReasoningDeclarationState>
  }
  /**
   * The levels one namespace schema offers, cached per serialized schema.
   * @param serialized - the namespace view's schema envelope.
   * @returns the levels in escalation order; empty when the schema has none.
   */
  levels: (serialized: unknown) => readonly string[]
  /** Start the installed-catalog read for a route unless it already answered. */
  loadCatalog: (provider: string) => void
  /** Turn one row's reasoning on (Off plus the common trio) or off (`false`). */
  setReasoning: (target: ModelTarget, on: boolean) => void
  /** Keep or drop one level in a row's declaration. */
  toggleLevel: (target: ModelTarget, level: string, checked: boolean) => void
}

/** A plain snapshot source; the form and the mirror are class instances, so their methods are wrapped rather than handed over unbound. */
export interface ObservableSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The reasoning-declaration block's controller (one per Models page). */
export class ReasoningDeclarationController {
  readonly store: SnapshotStore<ReasoningDeclarationState> = createSnapshotStore<ReasoningDeclarationState>({ catalogs: {}, saving: undefined, refused: undefined })
  private readonly levelCache = new WeakMap<object, readonly string[]>()
  private readonly pending = new Set<string>()
  private disposed = false
  readonly face: ReasoningDeclarationFace

  constructor(private readonly deps: ReasoningDeclarationDeps) {
    this.face = {
      hooks: {
        form: { getSnapshot: () => deps.form.getSnapshot(), subscribe: listener => deps.form.subscribe(listener) },
        mirror: { getSnapshot: () => deps.describe.getSnapshot(), subscribe: listener => deps.describe.subscribe(listener) },
        declaration: this.store,
      },
      levels: serialized => this.levels(serialized),
      loadCatalog: provider => { this.loadCatalog(provider) },
      setReasoning: (target, on) => { void this.write(target, model => withEfforts(model, on ? initialEntries(this.levelsOfForm()) : undefined)) },
      toggleLevel: (target, level, checked) => {
        void this.write(target, model => withEfforts(model, toggledLevel(readEfforts(model) ?? [], level, this.levelsOfForm(), checked)))
      },
    }
  }

  /** Stop reacting to late discovery answers. */
  dispose(): void {
    this.disposed = true
  }

  private levels(serialized: unknown): readonly string[] {
    if (typeof serialized !== 'object' || serialized === null) return []
    const cached = this.levelCache.get(serialized)
    if (cached !== undefined) return cached
    const levels = reasoningLevelChoices(serialized, this.deps.schema)
    this.levelCache.set(serialized, levels)
    return levels
  }

  /** The levels the form's namespace offers, read from the mirror's current view. */
  private levelsOfForm(): readonly string[] {
    return this.levels(this.deps.describe.getSnapshot().view?.namespaces.find(candidate => candidate.ns === this.deps.namespace)?.schema)
  }

  private loadCatalog(provider: string): void {
    if (this.pending.has(provider) || this.store.getSnapshot().catalogs[provider] !== undefined) return
    this.pending.add(provider)
    void this.deps.discoverCatalog(provider).then(ids => {
      this.pending.delete(provider)
      if (this.disposed) return
      this.store.set({ ...this.store.getSnapshot(), catalogs: { ...this.store.getSnapshot().catalogs, [provider]: ids === undefined ? null : [...ids] } })
    }, () => {
      this.pending.delete(provider)
      if (this.disposed) return
      this.store.set({ ...this.store.getSnapshot(), catalogs: { ...this.store.getSnapshot().catalogs, [provider]: null } })
    })
  }

  /**
   * Replace one stored row and write the route's whole `models` list back, as
   * the official editor does, fenced by the revision the row was read at.
   */
  private async write(target: ModelTarget, replace: (model: ModelRowDraft) => ModelRowDraft): Promise<void> {
    const snapshot = this.deps.form.getSnapshot()
    const path = [...target.settingsPath, 'models']
    const models = modelDrafts(valueAt(snapshot.user, path))
    if (models[target.index] === undefined) return
    const next = models.map((model, at) => at === target.index ? replace(model) : model)
    const ops: SettingsPathOpView[] = [{ op: 'set', path, value: structuredClone(next) as JsonValue }]
    this.store.set({ ...this.store.getSnapshot(), saving: target.provider, refused: undefined })
    let accepted = false
    try {
      accepted = await (snapshot.revision === undefined ? this.deps.form.mutate(ops) : this.deps.form.mutate(ops, snapshot.revision))
    } finally {
      if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), saving: undefined, refused: accepted ? undefined : target.provider })
    }
  }
}

