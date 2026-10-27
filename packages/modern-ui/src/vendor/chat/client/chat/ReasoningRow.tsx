/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { memo, useMemo } from 'react'
import { DisclosureRow, IconCheckOutlineRegular, IconPauseOutlineRegular, IconThinkOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatViewSlotProps, UseDisclosure, UsePresentation } from '../contract/slots.ts'
import { RunningWhaleTail } from './RunningWhaleTail.tsx'
import css from './ReasoningRow.module.css'

/**
 * Render reasoning collapsed without preview text; only explicit expansion mounts Markdown.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.usePresentation - live display-policy selector for this reasoning row.
 * @param props.useDisclosure - independent open state with enclosing-Turn resets.
 * @param props.renderSlot - framework renderer for the standard reasoning Body Slot.
 * @param props.t - conversation locale seat for the disclosure and running status.
 * @returns the reasoning disclosure.
 */
export const ReasoningRow = memo(function ReasoningRow({
  text, running, completed = !running, stopped = false, textInteractionSource = false, useDisclosure, renderSlot, t,
}: {
  text: string
  running: boolean
  /** Only a completed reasoning block receives the success check. */
  completed?: boolean
  /** Interrupted or unsuccessful enclosing Turn; never show a success check. */
  stopped?: boolean
  textInteractionSource?: boolean
  useDisclosure: UseDisclosure
  usePresentation: UsePresentation
  t: ChatViewSlotProps['t']
} & Pick<PropsRenderSlots<'modern.conversation.chat.reasoning.body'>, 'renderSlot'>) {
  const { expanded, toggle } = useDisclosure()
  const content = useMemo(() => expanded ? (
    <div className={css.thinkBody} data-text-interaction-source={textInteractionSource && !running ? '' : undefined}>
      {renderSlot('modern.conversation.chat.reasoning.body', { text, running })}
    </div>
  ) : undefined, [expanded, renderSlot, running, text, textInteractionSource])

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : stopped ? 'stopped' : completed ? 'ok' : 'idle'}
      data-expanded={expanded || undefined}
    >
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={running ? <RunningWhaleTail /> : stopped ? <IconPauseOutlineRegular />
          : completed ? <IconCheckOutlineRegular /> : <IconThinkOutlineRegular />}
        title={running ? t('chat.activity.thinking') : t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={toggle}
      >
        {content}
      </DisclosureRow>
    </div>
  )
})
