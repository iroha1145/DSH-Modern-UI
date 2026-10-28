/** Standard text interactions and quote presentation supplied by the Modern Conversation owner. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { QuoteSelectionAction } from './vendor/message-quotes/QuoteSelection.tsx'
import { QuotedUserText } from './vendor/message-quotes/QuotedUserText.tsx'
import { quoteRule } from './vendor/message-quotes/quote-rule.ts'
import { en, zh, ja, es, fr, de, ru, pt, NS, type MessageQuotesKey } from './vendor/message-quotes/locales.ts'

export type {
  TextInteractionDefinition, TextInteractionGesture, TextInteractionRequest,
  TextInteractionSurface, TextInteractionTrigger,
} from './quotes-contract.ts'
export type { ConversationInteractionRegistry } from './quotes-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { messageQuotes: MessageQuotesKey }
}

/** Register quote admission and sent-text presentation without creating another message projection. */
export function installQuotes(ctx: Context): void {
  ctx.inject(['uiConversation', 'sessions', 'slots', 'locale'], scope => {
    const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
    scope.effect(() => scope.locale.register(NS, dictionaries))
    scope.effect(() => scope.uiConversation.userText.register(quoteRule))
    scope.effect(() => scope.uiConversation.interactions.register({
      id: 'quote',
      onInteraction(request) {
        if (request.trigger !== 'selection' || request.readText() === null) return
        const binding = scope.sessions.binding(request.sessionId)
        if (binding === undefined) return
        const session = binding.session.getSnapshot()
        if (session.removed || (session.subagent !== null
          && (session.subagent.address.mode !== 'continuable' || session.subagent.parentAvailable !== true))) return
        request.open()
      },
    }))
    scope.slots.inject('conversation.chat.text-interaction', () => scope.slots.register({
      name: 'conversation.chat.text-interaction', key: 'quote', locale: NS,
    }, QuoteSelectionAction))
    scope.slots.inject('conversation.user.text.node', () => scope.slots.register({
      name: 'conversation.user.text.node', key: 'quote', priority: 100,
    }, QuotedUserText))
  })
}
