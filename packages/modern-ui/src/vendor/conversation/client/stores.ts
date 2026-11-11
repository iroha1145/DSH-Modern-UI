/** Per-session Conversation store shared by the shell body and header. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationStoreState } from './contract/views.ts'
import type { DraftInput, DraftSnapshot } from './contract/draft-editor.ts'
import { parseStoredDraft } from './draft.ts'
import type { FailedInputSend } from './contract/input.ts'

const CONVERSATION_STORE_KEY = 'dsh.conversation'
const FAILED_SENDS_KEY = `${CONVERSATION_STORE_KEY}.failed-sends`

/** Read failed semantic messages without pretending runtime attachment objects survived reload. */
export function readFailedInputSends(sessionId: SessionId): readonly FailedInputSend[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw: unknown = JSON.parse(localStorage.getItem(`${FAILED_SENDS_KEY}.${sessionId}`) ?? '[]')
    if (!Array.isArray(raw)) return []
    const activeDraft = JSON.stringify(readConversationDraft(sessionId))
    return raw.flatMap((value: unknown, index) => {
      if (typeof value !== 'object' || value === null || !('draft' in value)) return []
      const draft = parseStoredDraft(value.draft)
      if (draft === undefined) return []
      const count = 'attachmentCount' in value && typeof value.attachmentCount === 'number'
        && Number.isSafeInteger(value.attachmentCount) && value.attachmentCount >= 0 ? value.attachmentCount : 0
      // A live restoration may have succeeded while its active-draft storage write failed.
      const restored = 'restored' in value && value.restored === true && JSON.stringify(draft) === activeDraft
      return [{ id: index + 1, draft, attachmentCount: count, missingAttachments: count, ...restored ? { restored: true } : {} }]
    })
  } catch { return [] }
}

/** Keep recovery separate from the active draft and view store's independently mounted writer. */
export function writeFailedInputSends(sessionId: SessionId, records: readonly FailedInputSend[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    const key = `${FAILED_SENDS_KEY}.${sessionId}`
    if (records.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(records.map(({ draft, attachmentCount, restored }) => ({ draft, attachmentCount, ...restored === true ? { restored: true } : {} }))))
  } catch { /* Storage may be unavailable; the live recovery list remains usable. */ }
}

/** Recoveries can settle while no view is mounted to mirror the active draft. */
export function writeRecoveredConversationDraft(sessionId: SessionId, draft: DraftSnapshot): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const key = `${CONVERSATION_STORE_KEY}.${sessionId}`
    let raw: unknown
    try { raw = JSON.parse(localStorage.getItem(key) ?? '{}') } catch { raw = {} }
    const stored = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
    localStorage.setItem(key, JSON.stringify({ ...stored, draft }))
    return true
  } catch { return false }
}

/** Declared write set for the Conversation shell. */
type ConversationActions = {
  setDraft: (draft: ConversationStoreState, text: DraftInput) => void
  setView: (draft: ConversationStoreState, view: string) => void
  openView: (draft: ConversationStoreState, view: string, focus: string) => void
  completeViewRequest: (draft: ConversationStoreState) => void
}

/**
 * Declare per-session draft persistence and View selection.
 * @returns the store handle.
 */
export function createConversationStore(): EngineStoreHandle<ConversationStoreState, ConversationActions> {
  return defineStore({
    init: (): ConversationStoreState => ({ draft: '', view: null, viewRequest: null }),
    persist: CONVERSATION_STORE_KEY,
    actions: {
      setDraft: (d, text: DraftInput) => { d.draft = text },
      setView: (d, view: string) => { d.view = view },
      openView: (d, view: string, focus: string) => {
        d.view = view
        d.viewRequest = { view, focus }
      },
      completeViewRequest: (d) => { d.viewRequest = null },
    },
  })
}

/**
 * Read a Session's draft before its input source is published to React.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns saved semantic content, or an empty document when storage is absent or invalid.
 */
export function readConversationDraft(sessionId: SessionId): DraftSnapshot {
  const empty: DraftSnapshot = { text: '', references: [] }
  try {
    if (typeof localStorage === 'undefined') return empty
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`)
    if (raw === null) return empty
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null || !('draft' in stored)) return empty
    return parseStoredDraft(stored.draft) ?? empty
  } catch (_error: unknown) {
    // Unavailable browser storage or malformed JSON has no usable saved draft.
    return empty
  }
}

/**
 * Read the persisted View preference before the Slot store is materialized.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns the preferred View id, or null when storage has no usable value.
 */
export function readConversationViewPreference(sessionId: SessionId): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(`${CONVERSATION_STORE_KEY}.${sessionId}`)
    if (raw === null) return null
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null || !('view' in stored)) return null
    return typeof stored.view === 'string' ? stored.view : null
  } catch {
    return null
  }
}
