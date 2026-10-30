import { describe, expect, test } from 'vitest'
import { ConversationNodeAssembler } from '../../packages/modern-ui/src/vendor/conversation/client/conversation/assembler.ts'
import type {
  ConversationNodeDefinition,
  ConversationViewBuilder,
  ConversationViewDefinition,
  ConversationViewNode,
} from '../../packages/modern-ui/src/vendor/conversation/client/contract/conversation.ts'

// The assembler is exercised with synthetic Definitions and events: it is target-neutral, and only the
// boundary events (turn/step start and end) carry engine meaning.

type Entry = Parameters<ConversationNodeAssembler['append']>[0]
type Data = Record<string, unknown>

const event = (seq: number, type: string, data: Data = {}): Entry => ({ type: 'event', event: { seq, type, time: seq, data } }) as unknown as Entry
const transient = (seq: number, attemptId: string, text: string): Entry =>
  ({ type: 'transient', event: { seq, type: 'assistant/live-chunk', time: seq, data: { attemptId, turn: 1, step: 1, chunk: { text } } } }) as unknown as Entry

interface NoteState {
  readonly text: string
  readonly edits: number
  readonly previous: string | undefined
}

/** Notes start on `note/add`, change on `note/edit`, and are hidden while their text is empty. */
const notes: ConversationNodeDefinition<NoteState> = {
  kind: 'note',
  target: 'list',
  match: e => {
    const data = e.data as unknown as Data
    if (e.type === 'note/add') return { id: String(data.id), role: 'start' }
    if (e.type === 'note/edit') return { id: String(data.id), role: 'update' }
    return null
  },
  start: (_context, match, reader) => ({
    text: String((match.event.data as unknown as Data).text),
    edits: 0,
    previous: reader.previous<NoteState>('note')?.id,
  }),
  update: (context, match) => ({ ...context.state, text: String((match.event.data as unknown as Data).text), edits: context.state.edits + 1 }),
  publication: match => (match.event.type === 'note/edit' ? 'animation-frame' : 'immediate'),
  buildViewNode: context => {
    if (context.state === undefined || context.state.text === '') return null
    const location = context.start?.location
    return {
      key: context.key,
      kind: 'note',
      id: context.id,
      target: 'list',
      data: {
        text: context.state.text,
        edits: context.state.edits,
        previous: context.state.previous,
        where: location?.kind === 'step' ? `${location.turn.turn}.${location.step.step}` : location?.kind,
      },
    }
  },
}

/** Live chunks of one attempt become a draft until the durable message settles them. */
const drafts: ConversationNodeDefinition<{ readonly text: string }> = {
  kind: 'draft',
  target: 'list',
  match: e => {
    const data = e.data as unknown as Data
    if (e.type === 'assistant/live-chunk') return { id: String(data.attemptId), role: 'start' }
    if (e.type === 'assistant/message') return { id: String(data.attemptId), role: 'start' }
    return null
  },
  start: (context, match) => ({ text: textOf(match.event.data as unknown as Data, context.state?.text) }),
  update: (context, match) => ({ text: textOf(match.event.data as unknown as Data, context.state.text) }),
  buildViewNode: context =>
    context.matches.length === 0
      ? null
      : {
          key: context.key,
          kind: 'draft',
          id: context.id,
          target: 'list',
          data: { text: context.state?.text, final: context.matches.some(m => m.event.type === 'assistant/message') },
        },
}
function textOf(data: Data, previous = ''): string {
  if (typeof data.content === 'string') return data.content
  return previous + String((data.chunk as Data).text)
}

interface Snapshot {
  readonly nodes: ReadonlyMap<string, ConversationViewNode>
  readonly turns: readonly number[]
}

/** Records every builder call so tests can tell full replacements from incremental upserts. */
function recordingView(target: string, calls: { kind: 'replace' | 'apply'; keys: string[] }[]): ConversationViewDefinition<ConversationViewNode, Snapshot> {
  return {
    target,
    isActive: snapshot => snapshot.nodes.size > 0,
    create(): ConversationViewBuilder<ConversationViewNode, Snapshot> {
      let nodes = new Map<string, ConversationViewNode>()
      return {
        empty: { nodes, turns: [] },
        replace: input => {
          calls.push({ kind: 'replace', keys: input.nodes.map(node => node.key) })
          nodes = new Map(input.nodes.map(node => [node.key, node]))
          return { nodes, turns: input.timeline.turnOrder }
        },
        apply: input => {
          calls.push({ kind: 'apply', keys: input.upserts.map(node => node.key) })
          nodes = new Map(nodes)
          for (const node of input.upserts) nodes.set(node.key, node)
          return { nodes, turns: input.timeline.turnOrder }
        },
      }
    },
  }
}

function assembler(definitions: ConversationNodeDefinition[], fallback?: ConversationNodeDefinition) {
  const calls: { kind: 'replace' | 'apply'; keys: string[] }[] = []
  const view = recordingView('list', calls)
  const engine = new ConversationNodeAssembler(
    { entries: () => definitions as ConversationNodeDefinition[], fallbackEntry: () => fallback },
    { entries: () => [view as ConversationViewDefinition] },
  )
  const snapshot = () => engine.snapshot('list') as Snapshot | undefined
  const texts = () => [...(snapshot()?.nodes.values() ?? [])].map(node => (node.data as Data).text)
  return { engine, calls, snapshot, texts }
}

const turn = (seq: number, number: number) => event(seq, 'turn/start', { turn: number })
const step = (seq: number, t: number, s: number) => event(seq, 'step/start', { turn: t, step: s })

describe('ConversationNodeAssembler', () => {
  test('a target materializes only once activated, then follows the loaded window', () => {
    const { engine, calls, snapshot, texts } = assembler([notes])
    expect(engine.replaceWindow([turn(1, 1), step(2, 1, 1), event(3, 'note/add', { id: 'a', text: 'first' })], false)).toBe('immediate')
    expect(engine.flush()).toBe(false)
    expect(snapshot()).toBeUndefined()
    expect(engine.activateTarget('list')).toBe(true)
    expect(engine.activateTarget('list')).toBe(false)
    expect(calls).toEqual([{ kind: 'replace', keys: [expect.any(String)] }])
    expect(texts()).toEqual(['first'])
    expect(snapshot()?.turns).toEqual([1])
    expect(engine.activityTargets()).toEqual(new Set(['list']))
  })

  test('events placed between boundaries resolve to their turn and step', () => {
    const { engine, snapshot } = assembler([notes])
    engine.replaceWindow(
      [
        event(1, 'note/add', { id: 'outside', text: 'before any turn' }),
        turn(2, 1),
        step(3, 1, 1),
        event(4, 'note/add', { id: 'inside', text: 'in step' }),
        event(5, 'step/end', { turn: 1, step: 1 }),
        event(6, 'turn/end', { turn: 1 }),
      ],
      false,
    )
    engine.activateTarget('list')
    const where = Object.fromEntries([...(snapshot()?.nodes.values() ?? [])].map(node => [node.id, (node.data as Data).where]))
    expect(where).toEqual({ outside: 'session', inside: '1.1' })
    expect(engine.openTurn()).toBeUndefined()
  })

  test('openTurn reports the latest loaded turn only while it is open', () => {
    const { engine } = assembler([notes])
    engine.replaceWindow([turn(1, 1)], false)
    expect(engine.openTurn()).toBe(1)
    engine.append(event(2, 'turn/end', { turn: 1 }))
    expect(engine.openTurn()).toBeUndefined()
    engine.append(turn(3, 2))
    expect(engine.openTurn()).toBe(2)
  })

  test('appends upsert only the changed node and keep other node identities', () => {
    const { engine, calls, snapshot, texts } = assembler([notes])
    engine.replaceWindow([turn(1, 1), event(2, 'note/add', { id: 'a', text: 'A' }), event(3, 'note/add', { id: 'b', text: 'B' })], false)
    engine.activateTarget('list')
    const before = snapshot()
    const [a, b] = [...(before?.nodes.values() ?? [])]
    expect(engine.append(event(4, 'note/edit', { id: 'b', text: 'B2' }))).toBe('animation-frame')
    expect(engine.flush()).toBe(true)
    expect(calls.at(-1)).toEqual({ kind: 'apply', keys: [b?.key] })
    expect(snapshot()?.nodes.get(a?.key as string)).toBe(a)
    expect(texts()).toEqual(['A', 'B2'])
    expect(snapshot()?.nodes.get(b?.key as string)?.data).toMatchObject({ edits: 1 })
    expect(engine.flush()).toBe(false)
  })

  test('a duplicate seq is ignored', () => {
    const { engine } = assembler([notes])
    engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' })], false)
    expect(engine.append(event(1, 'note/add', { id: 'a', text: 'again' }))).toBe('none')
  })

  test('the start function reads the nearest earlier context of a kind', () => {
    const { engine, snapshot } = assembler([notes])
    engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' }), event(2, 'note/add', { id: 'b', text: 'B' })], false)
    engine.activateTarget('list')
    engine.append(event(3, 'note/add', { id: 'c', text: 'C' }))
    engine.flush()
    const previous = Object.fromEntries([...(snapshot()?.nodes.values() ?? [])].map(node => [node.id, (node.data as Data).previous]))
    expect(previous).toEqual({ a: undefined, b: 'a', c: 'b' })
  })

  test('prepending older history replays a context from its earliest start and its dependents', () => {
    const { engine, snapshot } = assembler([notes])
    engine.replaceWindow([event(10, 'note/edit', { id: 'a', text: 'edited' }), event(11, 'note/add', { id: 'b', text: 'B' })], true)
    engine.activateTarget('list')
    expect(snapshot()?.nodes.size).toBe(1)
    expect([...(snapshot()?.nodes.values() ?? [])][0]?.data).toMatchObject({ text: 'B', previous: undefined })
    expect(engine.prepend([event(5, 'note/add', { id: 'a', text: 'original' })], false)).not.toBe('none')
    engine.flush()
    const nodes = [...(snapshot()?.nodes.values() ?? [])]
    expect(nodes.find(node => node.id === 'a')?.data).toMatchObject({ text: 'edited', edits: 1 })
    // b looked backwards for a note while starting, so the older a reaches it too.
    expect(nodes.find(node => node.id === 'b')?.data).toMatchObject({ text: 'B', previous: 'a' })
  })

  test('settling an assistant attempt retires its live chunks and applies the durable message', () => {
    const { engine, texts } = assembler([drafts])
    engine.replaceWindow([turn(1, 1), step(2, 1, 1)], false)
    engine.activateTarget('list')
    engine.append(transient(3, 'attempt-1', 'Hel'))
    engine.append(transient(4, 'attempt-1', 'lo'))
    engine.flush()
    expect(texts()).toEqual(['Hello'])
    const settled = event(5, 'assistant/message', { attemptId: 'attempt-1', turn: 1, step: 1, content: 'Hello, world' })
    expect(engine.settleAssistant('attempt-1' as never, settled as never)).toBe('immediate')
    engine.flush()
    expect(texts()).toEqual(['Hello, world'])
    expect(engine.settleAssistant('attempt-1' as never)).toBe('none')
  })

  test('a hidden context is withdrawn from a full replacement', () => {
    const { engine, texts } = assembler([notes])
    engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' }), event(2, 'note/add', { id: 'b', text: '' })], false)
    engine.activateTarget('list')
    expect(texts()).toEqual(['A'])
  })

  test('an exclusive claim keeps other definitions of the target and the fallback away', () => {
    const seen: string[] = []
    const claimer: ConversationNodeDefinition = {
      ...(notes as ConversationNodeDefinition),
      kind: 'claimer',
      match: e => (e.type === 'note/add' ? { id: 'claimed', role: 'start', exclusive: true } : null),
    }
    const fallback: ConversationNodeDefinition = {
      kind: 'fallback',
      target: 'list',
      match: e => {
        seen.push(e.type)
        return { id: String(e.seq), role: 'start' }
      },
      start: () => ({ text: 'fallback', edits: 0, previous: undefined }),
      update: context => context.state,
      buildViewNode: notes.buildViewNode as ConversationNodeDefinition['buildViewNode'],
    }
    const { engine, snapshot } = assembler([notes as ConversationNodeDefinition, claimer], fallback)
    engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' }), event(2, 'other/event', {})], false)
    engine.activateTarget('list')
    expect([...(snapshot()?.nodes.values() ?? [])].map(node => node.id).sort()).toEqual(['2', 'claimed'])
    expect(seen).toEqual(['other/event'])
  })

  test('two exclusive claims on one target are a definition error', () => {
    const claim = (kind: string): ConversationNodeDefinition => ({
      ...(notes as ConversationNodeDefinition),
      kind,
      match: () => ({ id: kind, role: 'start', exclusive: true }),
    })
    const { engine } = assembler([claim('one'), claim('two')])
    expect(() => engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' })], false)).toThrow(/both claim note\/add/)
  })

  test('rebuildRegistry picks up definitions registered after the window loaded', () => {
    const definitions: ConversationNodeDefinition[] = []
    const { engine, texts } = assembler(definitions)
    engine.replaceWindow([event(1, 'note/add', { id: 'a', text: 'A' })], false)
    engine.activateTarget('list')
    expect(texts()).toEqual([])
    definitions.push(notes as ConversationNodeDefinition)
    expect(engine.rebuildRegistry()).toBe('immediate')
    engine.activateTarget('list')
    engine.flush()
    expect(texts()).toEqual(['A'])
  })
})
