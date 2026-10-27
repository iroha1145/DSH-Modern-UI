/** Pin choices for the Conversation View tabs, saved in the `collapsedViews` Host setting. */
import { createSnapshotStore, shallowEqual, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { COLLAPSED_VIEWS_FIELD, DEFAULT_COLLAPSED_VIEWS, type ConversationSettings } from '../submission-settings.ts'

/** View whose tab always shows and never enters the customization list. */
export const FIXED_VIEW_ID = 'chat'

/** Unpinned View ids, their only mutation, and the release of the settings subscription. */
export interface ViewPins {
  /** Unpinned (collapsed) View ids; ids of Views that are not registered stay listed. */
  readonly unpinned: ObservableSnapshot<readonly string[]>
  readonly saveFailed: ObservableSnapshot<boolean>
  /**
   * Pin or unpin one View tab; the fixed View is ignored. A pinned tab still
   * enters More when the header's width budget cannot hold it.
   * @param id - View id.
   * @param pinned - Whether the tab is manually pinned.
   */
  readonly setPinned: (id: string, pinned: boolean) => void
  /** Release the subscription to the accepted settings section. */
  readonly dispose: () => void
}

/**
 * Create the View pin list over the Host settings section. It adopts every
 * accepted `collapsedViews` list without writing it back; a pin change
 * publishes locally before the durable write starts. The snapshot keeps its
 * reference until the list changes.
 * @param host - configuration form of the `modern-ui` settings namespace.
 * @returns Unpinned View ids, the pin mutation, and the subscription release.
 */
export function createViewPins(host: ConfigForm<ConversationSettings>): ViewPins {
  const store = createSnapshotStore<{ readonly unpinned: readonly string[]; readonly failed: boolean }>({ unpinned: DEFAULT_COLLAPSED_VIEWS, failed: false })
  let disposed = false
  let generation = 0
  const adopt = (): void => {
    if (disposed) return
    const section = host.getSnapshot().value
    if (section === undefined) return
    const saved = section.collapsedViews ?? DEFAULT_COLLAPSED_VIEWS
    if (!shallowEqual(store.getSnapshot().unpinned, saved)) store.set({ ...store.getSnapshot(), unpinned: saved })
  }
  const save = async (next: readonly string[], current: number): Promise<void> => {
    let accepted = false
    try { accepted = await host.set(COLLAPSED_VIEWS_FIELD, next) }
    catch { /* The latest failed transport rolls back to the accepted form below. */ }
    if (disposed || generation !== current) return
    if (!accepted) {
      adopt()
      store.set({ ...store.getSnapshot(), failed: true })
    }
  }
  const unsubscribe = host.subscribe(adopt)
  adopt()
  return {
    unpinned: { getSnapshot: () => store.getSnapshot().unpinned, subscribe: listener => store.subscribe(listener) },
    saveFailed: { getSnapshot: () => store.getSnapshot().failed, subscribe: listener => store.subscribe(listener) },
    setPinned: (id, pinned) => {
      if (disposed) return
      const current = store.getSnapshot().unpinned
      if (id === FIXED_VIEW_ID || pinned !== current.includes(id)) return
      const next = pinned ? current.filter(entry => entry !== id) : [...current, id]
      store.set({ unpinned: next, failed: false })
      void save(next, ++generation)
    },
    dispose: () => { disposed = true; unsubscribe() },
  }
}
