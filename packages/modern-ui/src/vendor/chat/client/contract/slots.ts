/**
 * Chat-owned Slot declarations and composed component props: Modern's copy of the patched rc.3
 * contract. The SlotMap, SessionStandardProps, factory and Context augmentations stay with the
 * official rc.4 declarations (`@deepseek-ai/dsh-client-ui-chat/client`, reached through the
 * official ui-tool types), so this file only exports the prop and hook types the vendored
 * implementation composes; the patch-only `conversation.chat.message.code` chain is declared in
 * `src/contracts.ts`. Dictionaries live in the `modern-chat` namespace.
 */
import type { RefObject } from 'react'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type {
  CommandNode, CompactionSummaryNode, ConversationLocationDataStore, ConversationTurnDataMap,
  ConversationGroupData, GroupSnapshot,
  MessageImageLoader, MessageImageSource, MessageImagesOwnerProps, RenderEntry, TurnLocation, UserTextFacts, UserTextInput,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  EntryKeyOf, HostObservable, InjectFace, KeyedSnapshotSelectorHook, PropsLocale, PropsRenderSlots, PropsRuntime,
  PropsRenderFactories, PropsStore, SlotHookFactory, SlotMap, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownLabels } from '@iroha1145/dsh-modern-ui/primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the Session-scope access Hook (`useAccess`) the Chat entries read.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { createChatStore } from '../stores.ts'
import type { ChatPresentationPolicy } from '../presentation-policy.ts'
import type { FlowMotionRows } from '../chat/flow-motion.ts'
import type { ToolCallId } from './store.ts'
import type { ChatConversationViewNode, ChatNode, ChatNodeKind } from './chat-nodes.ts'
import type {
  ChatNodeProcessSource, ChatNodeSource, ChatSnapshot, ChatTurnProcessPresentation,
} from './snapshot.ts'
import type { TurnProcessSpec } from './turn-process.ts'
import type { PerformanceUsageMode } from '../../chat-settings.ts'
import type { TextInteractionGesture } from '../../../conversation/client/contract/text-interaction.ts'
import type {} from '../../../../quotes.ts'

/** Selector hook over the current Conversation binding's Chat target. */
export type UseChat = SnapshotSelectorHook<ChatSnapshot>

/** Runtime props whose Session-level Chat selector reads Modern's own snapshot type (the official augmentation types it against the rc.4 shape). */
export type ModernRuntime<Name extends keyof SlotMap & string, EntryKey extends EntryKeyOf<Name> = EntryKeyOf<Name>> =
  Omit<PropsRuntime<Name, EntryKey>, 'useChat'> & { useChat: UseChat }

/** File drag actions the image preview context exposes; rc.4's official primitives no longer type them. */
import type { FileDragActions } from '../../../primitives/file-drag-actions.ts'
export type { FileDragActions }

/** Per-key selector hook over one Chat Node. */
export type UseChatNode = KeyedSnapshotSelectorHook<ChatConversationViewNode | undefined>

/** Per-key selector hook over one Chat Node's Turn-process presentation. */
export type UseChatNodeProcess = KeyedSnapshotSelectorHook<ChatTurnProcessPresentation | undefined>

/**
 * Selector hook over the live presentation policy. Callers select one field or
 * a derived conclusion, never the whole policy, so a mode change re-renders
 * only components whose selected value changed.
 */
export type UsePresentation = SnapshotSelectorHook<ChatPresentationPolicy>

/** Where in a file an open should land. */
export interface OpenFileOptions {
  /** 1-based line to reveal; absent = the file's beginning. */
  readonly line?: number
}

/** Owner currency of the completed-Turn extension chain. */
export interface TurnTailOwnerProps {
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
}

/** Owner currency of finalized-assistant actions. */
export interface AssistantActionOwnerProps {
  messageId: MessageId
}

/** Stable quota failure codes retained in the Session log; both raise the frame-wide notice. */
export type QuotaNoticeCode = 'QUOTA' | 'ACCOUNT_QUOTA'

/** The notice on display; `seq` keys remounts so an unretained later notice restarts its transient display. */
export interface QuotaNoticeState {
  /** Stable failure code retained in the Session log. */
  code: QuotaNoticeCode
  /** Per-publication sequence; the host keys its surface by it. */
  seq: number
}

/** Original model-provided reasoning offered to the expanded Body Slot. */
export interface ReasoningBodyOwnerProps {
  /** Complete or streaming reasoning text. */
  readonly text: string
  /** Whether the reasoning tail is still streaming. */
  readonly running: boolean
}

/** Session-independent original or derived display input to the Content Factory. */
export interface ReasoningContentInput extends ReasoningBodyOwnerProps {
  /** Localized Markdown controls, used unchanged when supplied; omission uses Chat's defaults. */
  readonly labels?: MarkdownLabels
}

/** Owner currency of one quota notice offered to the frame-wide chain. */
export interface QuotaNoticeOwnerProps {
  /** Stable failure code retained in the Session log. */
  code: QuotaNoticeCode
  /** Provider-neutral notice copy in the active locale. */
  message: string
  /** Take the notice down. */
  dismiss: () => void
  /**
   * Prevent later quota failures from replacing this notice. Dismissal clears
   * all holds; releasing the last hold resumes future notices without replay.
   * Callers must release on unmount.
   * @returns idempotent release that cannot clear another hold.
   */
  keepOpen: () => () => void
}

/** Quota notice host share: the notice on display and its dismissal. */
export interface QuotaNoticeInjected {
  hooks: {
    /** The notice on display, or none. */
    notice: HostObservable<QuotaNoticeState | null>
  }
  /** Take the notice down. */
  dismissNotice: () => void
  /**
   * Acquire a hold with the lifecycle defined by QuotaNoticeOwnerProps.keepOpen.
   * @returns idempotent release, or a no-op when no notice is live.
   */
  keepNoticeOpen: () => () => void
}

/** Full props of the Chat-owned frame-wide quota notice host. */
export type QuotaNoticeHostProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'modern-chat'>
  & PropsRenderSlots<'shell.quota-notice'>
  & InjectFace<QuotaNoticeInjected>

/** Optional prose file-mention provider consumed by Chat. */
export interface ChatFileMentions {
  /**
   * Resolve prose links for one closing Turn.
   * @param owner - closing-Turn identity and file opener.
   * @param sessionId - viewed Session, including when history is inherited from a fork.
   * @returns link resolver when available.
   */
  forClosing(owner: TurnTailOwnerProps, sessionId: SessionId): MarkdownFileMentions | undefined
}


/** Hook constrained to business data published on the current Chat Node's Turn. */
export type UseChatNodeTurnData = <Key extends Extract<keyof ConversationTurnDataMap, string>>(
  key: Key,
) => Readonly<ConversationTurnDataMap[Key]> | undefined

/**
 * Subscribe to enclosing-Turn resets and own one initially collapsed disclosure.
 * Each invocation has independent open state; display-mode changes do not reset it.
 * @returns the current open state, explicit setter, and toggle action.
 */
export type UseDisclosure = () => {
  readonly expanded: boolean
  /** @param open - whether this disclosure is expanded. */
  readonly setExpanded: (open: boolean) => void
  readonly toggle: () => void
}

/**
 * Searchable process hiding bound to the current node render's viewport.
 * @param hidden - desired hidden state.
 * @param reveal - browser-find and focus-protection callback.
 * @returns the stable process-container ref.
 */
export type UseGroupAction = (hidden: boolean, reveal: () => void) => RefObject<HTMLDivElement>

/**
 * Plain header visibility bound to the flow's viewport, including growth on reveal.
 * @param ref - stable header element.
 * @param hidden - desired hidden state.
 */
export type UseGroupHeaderAction = (ref: RefObject<HTMLElement | null>, hidden: boolean) => void

/** Viewport capability supplied once for each rendered Chat flow. */
export interface ChatFlowHookContext {
  readonly motion: FlowMotionRows
}

/** Flow-wide behavior hooks bound to one viewport, independently of Session identity. */
export interface ChatFlowInjected {
  hooks: {
    groupAction: SlotHookFactory<'conversation.chat.flow', UseGroupAction>
    groupHeaderAction: SlotHookFactory<'conversation.chat.flow', UseGroupHeaderAction>
  }
}

/** Stable sources and capabilities bound to one rendered Chat Node. */
export interface ChatNodeHookContext {
  readonly turnData: ConversationLocationDataStore<ConversationTurnDataMap> | undefined
  readonly disclosureReset: ObservableSnapshot<number>
  readonly useGroupAction: UseGroupAction
}

/** Slot-level Hook factories for keyed Chat renderers. */
export interface ChatNodeInjected {
  hooks: {
    turnData: SlotHookFactory<'conversation.chat.node', UseChatNodeTurnData>
    disclosure: SlotHookFactory<'conversation.chat.node', UseDisclosure>
    groupAction: SlotHookFactory<'conversation.chat.node', UseGroupAction>
  }
}

/** Stable owner currency delivered to a keyed Chat renderer. */
export interface ChatNodeOwnerProps {
  /** Renderer-owned Node portion selected by the grouping Definition. */
  groupPart?: string
  cwd?: string | undefined
  openFile: (path: string, options?: OpenFileOptions) => void
  inspectCall: ((callId: ToolCallId) => void) | undefined
  forkAt: (seq: number) => void
  /** Session-authorized image loader supplied by the Chat view. */
  loadImage: MessageImageLoader
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
  /** Turn-process state when this Node belongs to a projected Turn. */
  turnProcess?: TurnProcessOwnerProps | undefined
}

/** Authored assistant code fence and its localized controls, available to code presenters. */
export interface MessageCodeOwnerProps {
  readonly code: string
  readonly lang: string | undefined
  readonly streaming: boolean
  /** The authored fenced block has a matching closing delimiter. */
  readonly closed: boolean
  /** The assistant message completed normally, rather than being stopped or still streaming. */
  readonly settled: boolean
  readonly labels: MarkdownCodeLabels
}

/** One attachment in the original user-message display order. */
export type UserContentAttachment =
  | { readonly type: 'image'; readonly image: MessageImageSource }
  | { readonly type: 'file'; readonly file: FileAttachmentRef }

/** Prepared user contents without row identity, admission state, time, or actions. */
export interface UserContentData {
  readonly text: string
  readonly attachments: readonly UserContentAttachment[]
  /** Blocks not represented by text or attachment presentation. */
  readonly extraBlocks: readonly unknown[]
  /** Labels displayed in the caller-provided reference summary. */
  readonly referenceLabels?: readonly string[]
}

/** Public content rendering input; reference renderers own their injected actions. */
export interface UserContentInput extends Pick<ChatNodeOwnerProps, 'loadImage'>,
  Pick<UserTextInput, 'interactive' | 'ellipsis'> {
  readonly content: UserContentData
  /** Transform inputs passed unchanged to UserText, separate from summary and rendering props. */
  readonly facts: Readonly<Partial<UserTextFacts>>
}

/** Shared presentation state for one Turn-process answer generation. */
export interface TurnProcessOwnerProps {
  /** Process content eligible to share one Turn-level disclosure. */
  readonly hasContent: boolean
  readonly spec: TurnProcessSpec
  readonly foldable: boolean
  readonly open: boolean
  setOpen(open: boolean): void
}

/** Shared presentation policy source for renderers that depend on the work-details mode. */
export interface PresentationInjected {
  hooks: {
    /** Live presentation policy derived from the accepted work-details mode. */
    presentation: ObservableSnapshot<ChatPresentationPolicy>
  }
}

/** Full props of one keyed Chat renderer. */
export type ChatNodeViewProps<Kind extends ChatNodeKind = ChatNodeKind> =
  ModernRuntime<'conversation.chat.node', Kind> & PropsLocale<'modern-chat'> & PropsRenderFactories

/** Command-row owner share. */
export interface CommandRowOwnerProps {
  node: CommandNode
  compaction?: CompactionSummaryNode
}

/** Full props of a registered command row. */
export type CommandRowProps = ModernRuntime<'conversation.chat.commandview'>

/** Shared Chat store handle. */
export type ChatStore = ReturnType<typeof createChatStore>

/** In-memory reader position resilient to transcript reflow. */
export interface ChatScrollPosition {
  readonly anchorKey: string
  readonly anchorTop: number
  readonly scrollTop: number
}

/** Shared settings source for the performance row, composer, and turn tail. */
export interface PerformanceUsageInjected {
  hooks: {
    /** Accepted performance and usage detail preference. */
    performanceUsage: ObservableSnapshot<PerformanceUsageMode>
  }
}

/** Business callbacks injected into the Chat view. */
export interface ChatViewInjected {
  /** Image preparation and failure callbacks owned by Modern's browser transfer service. */
  readonly fileDrag?: FileDragActions
  /** Dispatch one gesture to the Conversation plugin registry. */
  dispatchInteraction: (gesture: TextInteractionGesture) => string | null
  hooks: {
    /** Live plugin IDs; removed plugins dismiss their active surface. */
    interactionIds: ObservableSnapshot<readonly string[]>
    /** Live presentation policy derived from the accepted work-details mode. */
    presentation: ObservableSnapshot<ChatPresentationPolicy>
  }
  keyedHooks: {
    /** Resolve the stable source for one Chat Node key. */
    chatNode: (key: string) => ChatNodeSource
    /** Observe assembler-owned bottom membership for one Node. */
    chatNodeBottom: (key: string) => ObservableSnapshot<boolean>
    /** Resolve the stable Turn-process source for one Chat Node key. */
    chatNodeProcess: (key: string) => ChatNodeProcessSource
    /** Resolve one optional group without subscribing the root View to its data. */
    chatGroup: (key: string) => ObservableSnapshot<GroupSnapshot<ConversationGroupData<'chat'>> | undefined> | undefined
  }
  /** Open one HTTP(S) message link at the selected destination, using an external tab if Sidebar Browser is unavailable. */
  openExternalLink: (url: string) => void
  openFile: (path: string, options?: OpenFileOptions) => Promise<void>
  loadOlder: () => void
  /** Jump loader: page history back through seq; resolves when the window covers it. */
  loadThrough: (seq: SessionSeq) => Promise<void>
  loadImage: MessageImageLoader
  chatScroll: {
    save: (position: ChatScrollPosition | null) => void
    read: () => ChatScrollPosition | null
  }
  forkAt: (seq: number) => void
  fileMentions: (owner: TurnTailOwnerProps) => MarkdownFileMentions | undefined
}

/** Session-owned node sources shared with the view, plus the flow's connection state. */
export type ChatFlowDataInjected = Pick<ChatViewInjected, 'keyedHooks'> & {
  hooks: Pick<ChatViewInjected['hooks'], 'presentation'> & {
    /** Client connection lifecycle; the running clock pauses while it is not connected. */
    connectionState: ConnectionStateSource
  }
}

/** Ordered rows and reconciled local echoes rendered inside one Chat viewport. */
export interface ChatFlowOwnerProps extends Pick<ChatNodeOwnerProps,
  'cwd' | 'openFile' | 'inspectCall' | 'forkAt' | 'loadImage' | 'fileMentions'> {
  readonly entries: readonly RenderEntry[]
  readonly pendingInputs: readonly (PendingSubmission | InboxState['next-step'][number])[]
  readonly lastInputTurn: number | undefined
  readonly deferCollapse: boolean
}

/** Full props of the Chat-owned flow renderer. */
export type ChatFlowSlotProps =
  ModernRuntime<'conversation.chat.flow'>
  & PropsRenderSlots<'conversation.chat.node'>
  & PropsRenderFactories
  & PropsStore<ChatStore>
  & InjectFace<ChatFlowDataInjected>
  & PropsLocale<'modern-chat'>

/** Full Chat view props. */
export type ChatViewSlotProps =
  ModernRuntime<'conversation.view'>
  & PropsRenderSlots<'conversation.chat.flow' | 'conversation.chat.text-interaction'>
  & PropsStore<ChatStore>
  & InjectFace<ChatViewInjected>
  & PropsLocale<'modern-chat'>

/** Full props shared by the user and output image entries. */
export type MessageImagesProps =
  PropsRuntime<'conversation.chat.user.images' | 'conversation.chat.message.images'> & PropsRenderFactories

