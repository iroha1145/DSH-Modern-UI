// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Indexed recorded todo predecessors for root and nested Tool calls. */
import type {
  TodoItem,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The durable list preceding one Tool invocation; absent before the first loaded write. */
export interface TodoBaseline {
  readonly todos: readonly TodoItem[] | undefined
}

/** Session-owned call lookup, read only through the target's observable snapshot. */
export interface TodoHistory {
  /** @param callId - Root or nested call identity. @returns its recorded predecessor, when the start is loaded. */
  get(callId: string): TodoBaseline | undefined
}


declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap { 'tool-todo-history': TodoHistory }
}
