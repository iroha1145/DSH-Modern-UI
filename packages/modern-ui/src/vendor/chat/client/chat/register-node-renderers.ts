import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PerformanceUsageMode } from '../../chat-settings.ts'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import { NS } from '../locale.ts'
import { compat } from '../compat.ts'
import { AssistantNodeView } from './AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from './CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, SteeringMessageNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView, type SteeringBatchesInjected,
} from './MessageItem.tsx'
import { MessageImages } from '../../../attachment/client/MessageImages.tsx'
import type { MarkdownNavigationInjected } from '../../../../markdown-scope.tsx'
import { DefaultReasoningBody, ReasoningContent } from './ReasoningContent.tsx'
import { MessageCode } from './MessageCode.tsx'
import { SystemPromptNodeView } from './SystemPromptRow.tsx'
import { TurnProcessNodeView } from './TurnProcessNodeView.tsx'
import { TurnTailNodeView } from './TurnTailNodeView.tsx'
import { TurnTriggerNodeView } from './TurnTriggerNodeView.tsx'

/**
 * Register this package's business renderers behind the keyed Chat Node seat.
 * Renderers whose output depends on the work-details mode receive the policy
 * through their own registration; the seat and the other renderers do not.
 * @param ctx - owning UI Conversation context.
 * @param performanceUsage - live statistics detail preference.
 * @param presentation - live presentation policy.
 * @param navigation - Modern's external-link opener for Markdown in assistant rows.
 */
export function registerChatNodeRenderers(
  ctx: Context,
  performanceUsage: ObservableSnapshot<PerformanceUsageMode>,
  presentation: ObservableSnapshot<ChatPresentationPolicy>,
  navigation: MarkdownNavigationInjected,
): void {
  ctx.effect(() => ctx.slots.registerFactory({
    name: 'conversation.chat.reasoning.content',
    scope: 'root',
    // The official factory declaration fixes the `chat` namespace; Modern's dictionary lives in modern-chat.
    locale: NS as unknown as 'chat',
  }, compat(ReasoningContent)))
  ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({
    name: 'conversation.chat.reasoning.body',
    priority: 100,
  }, compat(DefaultReasoningBody)))
  ctx.slots.inject('conversation.chat.message.code', () => ctx.slots.register({
    name: 'conversation.chat.message.code',
    priority: 100,
    select: () => ({}),
  }, compat(MessageCode)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'user', locale: NS }, compat(UserMessageNodeView)))
  // Modern's steering view reads the batch boundaries its conversation owner derives.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'steering', locale: NS,
    inject: (sessionId): SteeringBatchesInjected => ({ hooks: { steeringBatches: ctx.uiConversation.binding(sessionId).target('modern-steering') } }),
  }, compat(SteeringMessageNodeView)))
  // Modern's own image gallery outranks the official attachment registration into the same slot.
  ctx.slots.inject('conversation.chat.message.images', () => ctx.slots.register({
    name: 'conversation.chat.message.images', priority: -100,
  }, compat(MessageImages)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', locale: NS }, compat(ContextMessageNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-trigger', locale: NS }, compat(TurnTriggerNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'system-prompt', locale: NS }, compat(SystemPromptNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'assistant-step',
    locale: NS,
    children: {
      'conversation.chat.reasoning.body': { kind: 'single', scope: 'session' },
      'conversation.chat.message.images': { kind: 'single', scope: 'session' },
      'conversation.chat.message.code': { kind: 'chain', scope: 'session' },
    },
    inject: () => ({ hooks: { presentation }, openExternalLink: navigation.openExternalLink }),
  }, compat(AssistantNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'command',
    locale: NS,
    children: { 'conversation.chat.commandview': { kind: 'keyed', scope: 'session' } },
  }, compat(CommandNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'manual-compaction', locale: NS }, compat(ManualCompactionNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'compaction', locale: NS }, compat(CompactionNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'model-retry', locale: NS }, compat(RetryNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', locale: NS }, compat(TurnErrorNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-max-tokens', locale: NS }, compat(TurnMaxTokensNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-process', locale: NS }, compat(TurnProcessNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-tail',
    locale: NS,
    inject: () => ({ hooks: { performanceUsage } }),
    children: {
      'conversation.chat.turnTail': { kind: 'list', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    },
  }, compat(TurnTailNodeView)))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'unknown', locale: NS }, compat(UnknownNodeView)))
}
