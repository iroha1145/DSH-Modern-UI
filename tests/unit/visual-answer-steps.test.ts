import { describe, expect, test } from 'vitest'
import { hasVisualReply, isAnswerStep } from '../../packages/modern-ui/src/vendor/chat/client/contract/turn-process.ts'
import { ChatTurnProcessProjector } from '../../packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process-presentation.ts'
import { turnProcessDefinition } from '../../packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process.ts'
import { hasOpenUIFence } from '../../packages/modern-ui/src/vendor/intelligent/client/openui-source.ts'

// Shaped after a real staged answer: three visualizations, each followed by web searches before the next one, so the
// first two segments share their Steps with Tool calls and only the third is the closing reply.

type Block = { readonly kind: string; readonly text?: string; readonly name?: string }

const chart = (title: string) => `\`\`\`openui-lang\nroot = Card([title])\ntitle = TextContent("${title}")\n\`\`\``
const reasoning = (text: string): Block => ({ kind: 'reasoning', text })
const text = (body: string): Block => ({ kind: 'text', text: body })
const tool = (name: string): Block => ({ kind: 'tool-call', name })

const steps: { readonly step: number; readonly blocks: readonly Block[]; readonly finalNode: { readonly seq: number } }[] = [
  { step: 1, blocks: [reasoning('plan three segments'), text(`第 1 段\n\n${chart('含量')}\n\n先查资料。`), tool('web_search')], finalNode: { seq: 21 } },
  { step: 2, blocks: [reasoning('read the page'), tool('web_fetch')], finalNode: { seq: 30 } },
  { step: 3, blocks: [reasoning('check half-life'), text('查到了官方口径。'), tool('web_search')], finalNode: { seq: 36 } },
  { step: 4, blocks: [reasoning('draw the curve'), text(`第 2 段\n\n${chart('衰减')}`), tool('web_fetch')], finalNode: { seq: 44 } },
  { step: 5, blocks: [reasoning('build the tool'), text(`第 3 段\n\n${chart('计算器')}`)], finalNode: { seq: 50 } },
]

describe('hasOpenUIFence', () => {
  test('counts closed openui-lang fences and openui fences written in openui-lang', () => {
    expect(hasOpenUIFence(chart('x'))).toBe(true)
    expect(hasOpenUIFence('Intro\n\n~~~~ OpenUI-Lang\nroot = Col([])\n~~~~\n')).toBe(true)
    expect(hasOpenUIFence('```openui\n// sizing\nroot = Card([])\n```')).toBe(true)
    expect(hasOpenUIFence('Intro\r\n\r\n```openui-lang\r\nroot = Col([])\r\n```\r\n')).toBe(true)
  })

  test('ignores streaming fences, prose mentions, HTML openui fences and fences nested in other code', () => {
    expect(hasOpenUIFence('```openui-lang\nroot = Card([])')).toBe(false)
    expect(hasOpenUIFence('Write a ```openui-lang fence next time.')).toBe(false)
    expect(hasOpenUIFence('```openui\n<section>Old</section>\n```')).toBe(false)
    expect(hasOpenUIFence('````markdown\n```openui-lang\nroot = Card([])\n```\n````')).toBe(false)
    expect(hasOpenUIFence('```ts\nconst a = 1\n```\n\nplain')).toBe(false)
  })

  test('only reply text counts, not reasoning', () => {
    expect(hasVisualReply([reasoning(chart('draft')) as never, text('Done.') as never])).toBe(false)
    expect(hasVisualReply([text(chart('final')) as never])).toBe(true)
  })
})

function turn() {
  return {
    turn: 1,
    status: 'closed',
    start: { seq: 6 },
    steps: steps.map(data => ({ step: data.step, status: 'closed', data: { get: () => data } })),
    data: { get: () => undefined },
  }
}

function buildSpec() {
  const location = turn()
  const context = {
    state: {
      turn: 1,
      controlAnchorSeq: 6,
      assistantStartByStep: new Map(steps.map(data => [data.step, data.finalNode.seq - 1])),
      messageCountByStep: new Map(steps.filter(data => data.blocks.some(block => block.kind === 'text')).map(data => [data.step, 1])),
      messageCount: 4,
      toolCallCount: 4,
      subagentCount: 0,
    },
    start: { location: { kind: 'turn', turn: location } },
    matches: [],
    current: new Map(),
  }
  const result = turnProcessDefinition.buildLocationData?.(context as never, 'turn', undefined)
  if (result?.kind !== 'turn') throw new Error('turn-process data expected')
  return { spec: result.value as never as Parameters<typeof isAnswerStep>[0] & Record<string, unknown>, location }
}

describe('staged visualizations stay outside the folded process', () => {
  test('every Step whose reply carries a visualization joins the answer; narration-only Steps stay process', () => {
    const { spec } = buildSpec()
    expect(spec.answerStep).toBe(5)
    expect(steps.map(data => isAnswerStep(spec, data as never))).toEqual([true, false, false, true, true])
    // Step 3's narration is the only reply left in the fold; the visual Steps' reasoning folds with the answer's.
    expect(spec.messageCount).toBe(1)
    expect(spec.inlineReasoning).toBe(true)
  })

  test('the fold still has content while Tools or narration remain, and none when only visual segments do', () => {
    const { spec, location } = buildSpec()
    const nodes = (members: readonly (typeof steps)[number][], tools: boolean) => {
      const values = [
        { key: 'input', kind: 'user', anchorSeq: 10, groupTree: 'input', data: {} },
        { key: 'control', kind: 'turn-process', anchorSeq: 6.5, groupTree: 'turn', data: spec },
        ...members.map(data => ({ key: `step-${data.step}`, kind: 'assistant-step', anchorSeq: data.finalNode.seq - 1, data })),
        ...(tools ? [{ key: 'tool', kind: 'tool-call', anchorSeq: 22, data: {} }] : []),
      ].map(node => ({ target: 'chat', id: node.key, visibility: 'visible', location: { kind: 'turn', turn: location }, ...node }))
      const byKey = new Map(values.map(node => [node.key, node]))
      return {
        order: [...byKey.keys()],
        locations: { getTurn: () => [...byKey.keys()] },
        nodes: { get: (key: string) => byKey.get(key) },
        control: byKey.get('control'),
      }
    }
    const presentation = (members: readonly (typeof steps)[number][], tools: boolean) => {
      const f = nodes(members, tools)
      const projector = new ChatTurnProcessProjector()
      projector.replace(f.order, f.locations as never, f.nodes as never)
      return projector.get(f.control as never)
    }
    expect(presentation(steps, true)?.hasExternalProcess).toBe(true)
    expect(presentation([steps[0], steps[2], steps[4]], false)?.hasExternalProcess).toBe(true)
    expect(presentation([steps[0], steps[3], steps[4]], false)?.hasExternalProcess).toBe(false)
  })
})
