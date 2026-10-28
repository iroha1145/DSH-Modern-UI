/** Composer model selection injection and inline label extension. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelPickerSettings } from '../model-settings.ts'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'

export type { ModelLabelOwner } from '@deepseek-ai/dsh-client-ui-model-selection/client'

/** Injected business face of the composer model seat. */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  available: boolean
  /** Reactive sources the renderer binds as `useModelDirectory` and `useModelPicker`. */
  hooks: {
    /** The session's shared directory store (same instance the /model popup reads). */
    modelDirectory: SnapshotStore<ModelDirectoryState>
    /** The picker's settings section (user overrides and fetched prices); undefined until loaded. */
    modelPicker: SnapshotStore<ModelPickerSettings | undefined>
  }
  /** Ensure the shared advisory catalog is loaded (errors land on the store). */
  load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns the Host outcome, or undefined when this Session cannot select a model.
   */
  select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
}
