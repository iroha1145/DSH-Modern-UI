/**
 * The speed setting of the third-party Codex subscription plugin (`dsh-codex-subscription`).
 *
 * That plugin puts its speed choice inside a model picker of its own, which Modern UI's picker replaces. The setting
 * itself lives in the plugin's preferences, behind two RPC endpoints the plugin serves for its own client; this module
 * reads and writes it there so the choice stays reachable beside Modern UI's model button. The endpoints are private to
 * that plugin: any reply that is missing or shaped differently reads as "not there", and the control stays hidden.
 * Written against version 3.2.9.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Provider id of the models the Codex subscription plugin serves. */
export const CODEX_PROVIDER = 'openai-codex'

const MODES = ['standard', 'fast', 'ultrafast'] as const

/** Values of the plugin's `speedMode` preference. */
export type CodexSpeedMode = (typeof MODES)[number]

/** What is known about the plugin's speed preference. */
export interface CodexSpeedState {
  /** `unknown` before the first reply; `absent` when the plugin did not answer in the expected shape. */
  readonly status: 'unknown' | 'ready' | 'absent'
  /** The stored preference; a model that lacks the mode runs at standard speed (see {@link effectiveCodexSpeed}). */
  readonly mode: CodexSpeedMode
  /** Whether the host accepts preference writes. */
  readonly writable: boolean
  /** Models with a fast mode, or undefined while the plugin's catalog has not said. */
  readonly fastModels: readonly string[] | undefined
  /** Models with an ultrafast mode. */
  readonly ultrafastModels: readonly string[]
  /** The mode being saved; shown as chosen until the plugin answers. */
  readonly pending: CodexSpeedMode | undefined
}

/** Result of one write. */
export type CodexSpeedOutcome =
  | { readonly ok: true /** Saved to the profile, but the running plugin keeps the old value until DSH restarts. */; readonly restartRequired: boolean }
  | { readonly ok: false; readonly message: string }

/** Call one of the plugin's preference endpoints; resolves with the transport's raw reply. */
export type CodexPreferenceCall = (endpoint: 'preferences/status' | 'preferences/update', payload: Record<string, unknown>) => Promise<unknown>

/** The speed preference as the model seat uses it. */
export interface CodexSpeed {
  readonly store: SnapshotStore<CodexSpeedState>
  /** Read the preference again; the plugin sends no change events, so callers ask when it matters. */
  readonly refresh: () => void
  /** Invalidate requests from the previous connection and reload if the preference was in use. */
  readonly reset: () => void
  /** Save a mode. */
  readonly choose: (mode: CodexSpeedMode) => Promise<CodexSpeedOutcome>
}

const UNKNOWN: CodexSpeedState = {
  status: 'unknown',
  mode: 'standard',
  writable: false,
  fastModels: undefined,
  ultrafastModels: [],
  pending: undefined,
}
const ABSENT: CodexSpeedState = { ...UNKNOWN, status: 'absent' }

const stringList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? (value as readonly string[]) : undefined

/** The fields of a preferences reply this module reads; the plugin sends many more. */
interface PreferencesReply {
  readonly speedMode?: unknown
  readonly writable?: unknown
  readonly fastModels?: unknown
  readonly ultrafastModels?: unknown
  /** False when a write reached the profile but not the running plugin. */
  readonly liveSynced?: unknown
}

/** Unpack the transport's `{ ok, value }` envelope. */
function unwrap(reply: unknown): PreferencesReply {
  const envelope = (reply ?? {}) as { ok?: unknown; value?: unknown; error?: { message?: unknown } }
  if (envelope.ok !== true) {
    throw new Error(typeof envelope.error?.message === 'string' ? envelope.error.message : 'Codex preferences are unavailable')
  }
  if (envelope.value === null || typeof envelope.value !== 'object') throw new Error('Unexpected Codex preferences reply')
  return envelope.value as PreferencesReply
}

/** Read the fields this module uses, with the plugin's own defaults for anything else. */
function stateOf(value: PreferencesReply): CodexSpeedState {
  if (!MODES.some(mode => mode === value.speedMode) || typeof value.writable !== 'boolean') throw new Error('Unexpected Codex preferences reply')
  return {
    status: 'ready',
    mode: MODES.find(mode => mode === value.speedMode) ?? 'standard',
    writable: value.writable === true,
    fastModels: stringList(value.fastModels),
    ultrafastModels: stringList(value.ultrafastModels) ?? [],
    pending: undefined,
  }
}

/**
 * Track the plugin's speed preference.
 * @param call - transport for the plugin's preference endpoints.
 * @returns the observable state, a re-read, and the write.
 */
export function createCodexSpeed(call: CodexPreferenceCall): CodexSpeed {
  const store = createSnapshotStore<CodexSpeedState>(UNKNOWN)
  // The newest request wins: a read that started before a write must not overwrite what the write returned.
  let generation = 0
  let used = false
  const publish = (next: CodexSpeedState): void => {
    if (JSON.stringify(next) !== JSON.stringify(store.getSnapshot())) store.set(next)
  }
  const refresh = (): void => {
    if (store.getSnapshot().pending !== undefined) return
    used = true
    const current = ++generation
    void (async () => {
      let reply: unknown
      try {
        reply = await call('preferences/status', {})
      } catch {
        // Keep a known value visible during a transport failure, but require a successful read before more writes.
        if (current === generation) {
          const before = store.getSnapshot()
          publish(before.status === 'ready' ? { ...before, writable: false } : ABSENT)
        }
        return
      }
      let next = ABSENT
      try {
        next = stateOf(unwrap(reply))
      } catch {
        /* Missing plugin, denied access, or an incompatible reply invalidates previous capabilities. */
      }
      if (current === generation) publish(next)
    })()
  }
  const choose = async (mode: CodexSpeedMode): Promise<CodexSpeedOutcome> => {
    const before = store.getSnapshot()
    if (before.status !== 'ready' || !before.writable || before.pending !== undefined) return { ok: false, message: 'Codex preferences are not writable' }
    const current = ++generation
    publish({ ...before, pending: mode })
    try {
      const value = unwrap(await call('preferences/update', { speedMode: mode }))
      if (current !== generation) return { ok: false, message: 'The Codex connection changed' }
      // The host may normalize the value; its reply is the state.
      publish(stateOf(value))
      return { ok: true, restartRequired: value.liveSynced === false }
    } catch (error) {
      if (current === generation) {
        publish({ ...before, writable: false, pending: undefined })
        refresh()
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
  const reset = (): void => {
    generation += 1
    publish(UNKNOWN)
    if (used) refresh()
  }
  return { store, refresh, choose, reset }
}

/** The plugin's built-in answer for a model while its catalog has not listed the fast ones. */
const fastByName = (model: string): boolean => /^gpt-5\.(?:5|6)(?:$|-)/u.test(model) || model === 'gpt-5.4' || model === 'gpt-6-astra'

/**
 * The speeds a Codex model offers.
 * @param state - the plugin's speed preference.
 * @param model - id of the selected Codex model.
 * @returns standard plus the faster modes the model has; empty when it has none or the plugin is not there.
 */
export function codexSpeedChoices(state: CodexSpeedState, model: string): readonly CodexSpeedMode[] {
  if (state.status !== 'ready') return []
  const fast = state.fastModels?.includes(model) ?? fastByName(model)
  const ultrafast = state.ultrafastModels.includes(model)
  if (!fast && !ultrafast) return []
  return ['standard', ...(fast ? ['fast' as const] : []), ...(ultrafast ? ['ultrafast' as const] : [])]
}

/**
 * The speed a model actually runs at: the stored mode when the model has it, standard otherwise.
 * @param state - the plugin's speed preference.
 * @param choices - the model's speeds from {@link codexSpeedChoices}.
 * @returns the mode to show as chosen.
 */
export function effectiveCodexSpeed(state: CodexSpeedState, choices: readonly CodexSpeedMode[]): CodexSpeedMode {
  const wanted = state.pending ?? state.mode
  return choices.includes(wanted) ? wanted : 'standard'
}
