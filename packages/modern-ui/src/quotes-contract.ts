/** Public type-only contract for consumers of Modern's text interaction owner. */
export type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationInteractionRegistry } from './vendor/conversation/client/conversation/interaction-registry.ts'
import type { TextInteractionSurface } from './vendor/conversation/client/contract/text-interaction.ts'

export type {
  TextInteractionDefinition, TextInteractionGesture, TextInteractionRequest,
  TextInteractionSurface, TextInteractionTrigger,
} from './vendor/conversation/client/contract/text-interaction.ts'
export type { ConversationInteractionRegistry } from './vendor/conversation/client/conversation/interaction-registry.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** Available while Modern's Conversation owner is selected. */
  interface UiConversation { readonly interactions: ConversationInteractionRegistry }
  /** Modern's input owner retains the legacy atomic quote action. */
  interface InputActions { insertQuote(text: string): boolean }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.chat.text-interaction': { kind: 'keyed'; scope: 'session'; owner: TextInteractionSurface }
  }
}
