/** Adapted presentation contracts: session/model ownership remains with the official rc.4 plugin. */
import type { ChatNodeKind, ChatNodeViewProps as OfficialNodeProps, ChatViewSlotProps as OfficialViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import type {} from '../../../../contracts.ts'
export type * from '@deepseek-ai/dsh-client-ui-chat/client'
export type { MessageCodeOwnerProps } from '../../../../contracts.ts'
export type ChatNodeViewProps<K extends ChatNodeKind> = Omit<OfficialNodeProps<K>, 't'> & PropsLocale<'modern-chat'>
export type ChatViewSlotProps = Omit<OfficialViewProps, 't'> & PropsLocale<'modern-chat'>
export type UsePresentation = SnapshotSelectorHook<ChatPresentationPolicy>
export interface PresentationInjected { hooks: { presentation: ObservableSnapshot<ChatPresentationPolicy> } }
