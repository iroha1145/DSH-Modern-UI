import { describe, expect, test } from 'vitest'
import { chatViewDefinition } from '../../packages/modern-ui/src/vendor/chat/client/conversation-nodes/chat-snapshot-builder.ts'
import type { ChatSnapshot } from '../../packages/modern-ui/src/vendor/chat/client/contract/snapshot.ts'
import { ConversationNodeAssembler } from '../../packages/modern-ui/src/vendor/conversation/client/conversation/assembler.ts'
import type { ConversationNodeDefinition, ConversationViewDefinition } from '../../packages/modern-ui/src/vendor/conversation/client/contract/conversation.ts'

// The Chat builder is driven through the real assembler so Turn/Step locations and the timeline are the
// engine's own; only the Chat payloads are synthetic. A `row/add` event carries a whole Chat Node and a
// `row/edit` event replaces its payload.

type Entry = Parameters<ConversationNodeAssembler['append']>[0]
type Data = Record<string, unknown>

const event = (seq: number, type: string, data: Data = {}): Entry => ({ type: 'event', event: { seq, type, time: seq, data } }) as unknown as Entry
const turn = (seq: number, number: number) => event(seq, 'turn/start', { turn: number })
const step = (seq: number, t: number, s: number) => event(seq, 'step/start', { turn: t, step: s })
const turnEnd = (seq: number, number: number) => event(seq, 'turn/end', { turn: number })

interface Row {
  readonly kind: string
  readonly visibility?: 'visible' | 'hidden'
  readonly groupTree?: string
  readonly data: Data
}
const row = (seq: number, id: string, value: Row) => event(seq, 'row/add', { id, row: value })
const edit = (seq: number, id: string, data: Data) => event(seq, 'row/edit', { id, data })

const rows: ConversationNodeDefinition<Row> = {
  kind: 'row',
  target: 'chat',
  match: e => {
    const data = e.data as unknown as Data
    if (e.type === 'row/add') return { id: String(data.id), role: 'start' }
    if (e.type === 'row/edit') return { id: String(data.id), role: 'update' }
    return null
  },
  start: (_context, match) => (match.event.data as unknown as { row: Row }).row,
  update: (context, match) => ({ ...context.state, data: (match.event.data as unknown as { data: Data }).data }),
  buildViewNode: context => {
    const start = context.start
    const state = context.state
    if (start === undefined || state === undefined) return null
    return {
      key: context.key,
      kind: state.kind,
      id: context.id,
      target: 'chat',
      data: state.data,
      anchorSeq: start.event.seq,
      location: start.location,
      visibility: state.visibility ?? 'visible',
      ...(state.groupTree === undefined ? {} : { groupTree: state.groupTree }),
    } as never
  },
}

const user = (seq: number, text: string): Row => ({
  kind: 'user',
  groupTree: 'exchange',
  data: { seq, content: [{ type: 'text', text }], source: { kind: 'user' } },
})
const finalNode = (text: string) => ({ type: 'assistant', blocks: [{ kind: 'text', text }] })
const assistant = (t: number, s: number, text: string, status = 'settled'): Row => ({
  kind: 'assistant-step',
  data: { status, turn: t, step: s, time: 0, blocks: [{ kind: 'text', text }], ...(status === 'running' ? {} : { finalNode: finalNode(text) }) },
})
const command = (name: string): Row => ({ kind: 'command', groupTree: 'exchange', data: { name } })

function chat() {
  const engine = new ConversationNodeAssembler(
    { entries: () => [rows as ConversationNodeDefinition], fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition as unknown as ConversationViewDefinition] },
  )
  const snapshot = () => engine.snapshot('chat') as ChatSnapshot
  const ids = () => snapshot().order.map(key => snapshot().nodes.get(key)?.id)
  const isActive = () => chatViewDefinition.isActive?.(snapshot())
  return { engine, snapshot, ids, isActive }
}

function oneTurn() {
  const harness = chat()
  harness.engine.replaceWindow(
    [
      turn(1, 1),
      row(2, 'prompt', user(2, 'Explain the build')),
      step(3, 1, 1),
      row(4, 'system', { kind: 'system-prompt', data: {} }),
      row(5, 'answer', assistant(1, 1, 'It bundles the client.')),
      row(6, 'retired', { ...assistant(1, 1, 'superseded'), visibility: 'hidden' }),
      row(7, 'perm', command('permission')),
      event(8, 'step/end', { turn: 1, step: 1 }),
      turnEnd(9, 1),
    ],
    false,
  )
  harness.engine.activateTarget('chat')
  return harness
}

describe('Chat snapshot builder', () => {
  test('orders visible rows by anchor and keeps hidden ones readable but out of the order', () => {
    const { snapshot, ids } = oneTurn()
    expect(ids()).toEqual(['prompt', 'answer'])
    const hidden = snapshot()
      .nodes.values()
      .map(node => node.id)
    expect(hidden).toEqual(expect.arrayContaining(['system', 'retired', 'perm']))
  })

  test('indexes rows by their engine-resolved turn and step', () => {
    const { snapshot } = oneTurn()
    const keyOf = (id: string) =>
      snapshot()
        .nodes.values()
        .find(node => node.id === id)?.key
    expect(snapshot().locations.getTurn(1)).toEqual([keyOf('prompt'), keyOf('answer')])
    expect(snapshot().locations.getStep(1, 1)).toEqual([keyOf('answer')])
    expect(snapshot().timeline.turnOrder).toEqual([1])
  })

  test('navigation anchors each turn on its prompt with bounded previews', () => {
    const { snapshot } = oneTurn()
    const [item] = snapshot().navigation.items()
    expect(item).toMatchObject({ turn: 1, prompt: 'Explain the build', response: 'It bundles the client.' })
    expect(snapshot().nodes.get(item?.anchorKey as string)?.id).toBe('prompt')
  })

  test('the compatibility slice carries settled nodes and the running partial', () => {
    const { engine, snapshot } = oneTurn()
    // Hidden settled Assistants stay so the composer stats keep their step counts; the slice filters on
    // visibility alone, so the permission command (only out of Chat rows) is still contributed.
    expect(snapshot().legacy.nodes).toEqual([
      user(2, 'Explain the build').data,
      finalNode('It bundles the client.'),
      finalNode('superseded'),
      { name: 'permission' },
    ])
    expect(snapshot().legacy.partial).toBeNull()
    engine.append(turn(10, 2))
    engine.append(step(11, 2, 1))
    engine.append(row(12, 'live', assistant(2, 1, 'Work', 'running')))
    engine.flush()
    expect(snapshot().legacy.partial).toMatchObject({ turn: 2, step: 1, blocks: [{ kind: 'text', text: 'Work' }] })
  })

  test('a content-only change keeps the order array and other rows; a new row changes the order', () => {
    const { engine, snapshot, ids } = oneTurn()
    const order = snapshot().order
    const prompt = snapshot().nodes.get(order[0] as string)
    engine.append(edit(10, 'answer', assistant(1, 1, 'It bundles and minifies the client.').data))
    engine.flush()
    expect(snapshot().order).toBe(order)
    expect(snapshot().nodes.get(order[0] as string)).toBe(prompt)
    expect(snapshot().navigation.items()[0]?.response).toBe('It bundles and minifies the client.')
    engine.append(turn(11, 2))
    engine.append(row(12, 'second', user(12, 'And the host?')))
    engine.flush()
    expect(snapshot().order).not.toBe(order)
    expect(ids()).toEqual(['prompt', 'answer', 'second'])
    expect(
      snapshot()
        .navigation.items()
        .map(item => item.turn),
    ).toEqual([1, 2])
  })

  test('long prompts are clipped for the navigation rail', () => {
    const { engine, snapshot } = chat()
    engine.replaceWindow([turn(1, 1), row(2, 'long', user(2, `${'word '.repeat(40)}end`))], false)
    engine.activateTarget('chat')
    const prompt = snapshot().navigation.items()[0]?.prompt ?? ''
    expect(prompt.length).toBeLessThanOrEqual(50)
    expect(prompt.endsWith('…')).toBe(true)
  })

  test('only non-command rows count as conversation activity', () => {
    const { engine, isActive } = chat()
    engine.replaceWindow([row(1, 'model', command('model'))], false)
    engine.activateTarget('chat')
    expect(isActive()).toBe(false)
    engine.append(turn(2, 1))
    engine.append(row(3, 'prompt', user(3, 'Hi')))
    engine.flush()
    expect(isActive()).toBe(true)
  })
})
