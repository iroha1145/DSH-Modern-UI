import { describe, expect, it } from 'vitest'
import { controlDetails } from '../../packages/modern-ui/src/vendor/tool/client/tool/models/control-details-model.ts'

// `send_message` and `interrupt_agent` name their target with `agent` from official 0.2.2-rc.2 on; records written
// before it use `agent_id`. Without a target the receipt has no title and the text match fails, so the card falls
// back to the generic one.
describe('subagent control receipts name their target on either argument', () => {
  const t = (key: string) => key

  it.each([['agent'], ['agent_id']])('send_message reads %s', argument => {
    const args = { [argument]: 'reviewer', message: 'look at the diff' }
    const delivered = controlDetails('send_message', args, 'message delivered to agent reviewer', undefined, t)
    expect(delivered?.expandedSummary).toBe('reviewer')
    const accepted = controlDetails('send_message', args, '{"status":"accepted"}', { status: 'accepted' }, t)
    expect(accepted?.expandedSummary).toBe('reviewer')
  })

  it.each([['agent'], ['agent_id']])('interrupt_agent reads %s', argument => {
    const details = controlDetails('interrupt_agent', { [argument]: 'reviewer' }, 'interrupt requested for agent reviewer', undefined, t)
    expect(details?.expandedSummary).toBe('reviewer')
  })

  it('a result naming another agent is not taken for this receipt', () => {
    expect(controlDetails('send_message', { agent: 'reviewer' }, 'message delivered to agent someone-else', undefined, t)).toBeNull()
  })
})
