/** Conversation preferences stored in the Host user-settings document: busy-state Enter and the collapsed View tabs. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'modern-ui'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Field carrying the ids of Views collapsed into the tab row's More menu. */
export const COLLAPSED_VIEWS_FIELD = 'collapsedViews'

/** Default collapses nothing: every registered View takes a tab until the header's width budget folds it. */
export const DEFAULT_COLLAPSED_VIEWS: readonly string[] = []

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Ids of Views collapsed into More, registered or not; Chat is never collapsed. Absence collapses nothing. */
  collapsedViews?: readonly string[]
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsFields = {
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [COLLAPSED_VIEWS_FIELD]: z.array(z.string()).default([...DEFAULT_COLLAPSED_VIEWS]),
}

/** Schema for shared configuration values. */
export const ConversationSettingsSchema = z.object(ConversationSettingsFields)
