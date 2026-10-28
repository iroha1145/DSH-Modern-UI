import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { hasAssistantReplyContent } from './assistant-content.ts'

/** Current process range and finalized answer boundary derived from one Turn. */
export interface TurnProcessSpec {
  readonly turn: number
  /** Stable control-node anchor source, including currently ineligible evidence. */
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  /** Reply-bearing durable Assistant messages outside the answer Steps. */
  readonly messageCount: number
  /** Durable non-subagent Tool calls recorded by this Turn. */
  readonly toolCallCount: number
  /** Tool calls whose configured name identifies a subagent delegation. */
  readonly subagentCount: number
}

/**
 * Compare immutable Turn-process specifications by their published fields.
 * @param left - previous specification.
 * @param right - next specification.
 * @returns whether both values describe the same process presentation.
 */
export function sameTurnProcessSpec(left: TurnProcessSpec, right: TurnProcessSpec): boolean {
  return left.turn === right.turn
    && left.controlAnchorSeq === right.controlAnchorSeq
    && left.processStartSeq === right.processStartSeq
    && left.answerAnchorSeq === right.answerAnchorSeq
    && left.answerStep === right.answerStep
    && left.inlineReasoning === right.inlineReasoning
    && left.messageCount === right.messageCount
    && left.toolCallCount === right.toolCallCount
    && left.subagentCount === right.subagentCount
}

/**
 * Whether a settled Step's reply ended a model response: reply content and no Tool call. A normal Turn has one, in
 * its last Step; input admitted afterwards, such as a finished subagent or a teammate message, opens further Steps.
 * @param blocks - the Step's settled Assistant blocks.
 * @returns whether the Step is a closing reply.
 */
export function isClosingReply(blocks: readonly AssistantBlock[]): boolean {
  return hasAssistantReplyContent(blocks) && !blocks.some(block => block.kind === 'tool-call')
}

/**
 * Whether an Assistant Step's reply belongs to the Turn's answer and stays outside the folded process: the answer
 * Step, or a later closing reply. Rows are classified by Step, not anchor, because a streamed reply anchors at its
 * first visible chunk, before its final message.
 * @param spec - the Turn's process specification.
 * @param data - the Step's Assistant data.
 * @returns whether the Step's reply row is part of the answer.
 */
export function isAnswerStep(
  spec: Pick<TurnProcessSpec, 'answerStep'>,
  data: { readonly step: number; readonly blocks: readonly AssistantBlock[] },
): boolean {
  return spec.answerStep !== null
    && (data.step === spec.answerStep || (data.step > spec.answerStep && isClosingReply(data.blocks)))
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/**
 * Keep live, stopped, and failed Turns open.
 * @param node - Node carrying the owning Turn.
 * @returns whether whole-Turn collapse is unavailable.
 */
export function turnProcessAlwaysOpen(node: ChatNode | undefined): boolean {
  const location = node?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return false
  const reason = location.turn.end?.data.reason.kind
  return location.turn.status === 'open' || reason === 'aborted' || reason === 'interrupted' || reason === 'error'
}
