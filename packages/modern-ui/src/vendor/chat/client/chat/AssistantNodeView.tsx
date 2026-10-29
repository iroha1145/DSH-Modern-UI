import { memo, useCallback, useMemo } from 'react'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { isAnswerStep } from '../contract/turn-process.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { MarkdownScope, type MarkdownNavigationInjected } from '../../../../markdown-scope.tsx'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<PresentationInjected> & MarkdownNavigationInjected
  & PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images' | 'conversation.chat.message.code'>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions,
  usePresentation, useChat, renderSlot, renderSlotChain, t, cwd, openExternalLink,
}: AssistantNodeViewProps) {
  const data = node.data
  const toolsRunning = useChat(snapshot => snapshot.legacy.runningCalls.length > 0)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const spec = turnProcess?.spec
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    const closing = tail?.closing?.finalNode.seq
    if (turn?.status !== 'closed' || data.finalNode === undefined || closing === undefined) return undefined
    // Every reply of the answer resolves produced-file mentions at the closing reply, as the closing reply does.
    if (closing !== data.finalNode.seq && (spec === undefined || !isAnswerStep(spec, data))) return undefined
    return { turn, seq: closing, openFile }
  }, [data, openFile, spec, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const keepReplies = usePresentation(policy => policy.foldedReplies === 'all')
  // A kept reply row stays visible while the folded Turn hides its inline reasoning; so does every answer Step.
  // A reasoning row already folds through its seat and group.
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && groupPart !== 'reasoning'
    && (keepReplies || (isAnswerStep(turnProcess.spec, data) && turnProcess.spec.inlineReasoning))
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <MarkdownScope cwd={cwd} openFile={openFile} openExternalLink={openExternalLink} t={t}>
    <AssistantMarkdown
      blocks={data.blocks}
      groupPart={groupPart}
      useDisclosure={useDisclosure}
      streaming={data.status === 'running'}
      toolsRunning={toolsRunning}
      reasoningStopped={data.status === 'interrupted' || (turn?.status === 'closed' && turn.end?.data.reason.kind !== 'completed')}
      textInteractionSource={data.status === 'settled' && data.finalNode?.messageId !== undefined}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      reasoningHidden={reasoningHidden}
      useGroupAction={useGroupAction}
      usePresentation={usePresentation}
      renderSlot={renderSlot}
      renderSlotChain={renderSlotChain}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
    </MarkdownScope>
  )
})
