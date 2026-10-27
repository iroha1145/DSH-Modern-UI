import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ConversationPreviousContext, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import './steering-batches.css'

// Adapted from the MIT-licensed patched UI's inbox.ts and turn-process.ts.
// These definitions publish only our display metadata; the official Chat owns all message nodes.
interface InboxIdentity { readonly id: string; readonly source: { readonly kind: string } }
interface InboxSplice {
  readonly start: number
  readonly removedCount?: number
  readonly inserted: readonly InboxIdentity[]
  readonly outcome?: 'canceled'
}
type PendingState = { readonly kind: 'snapshot'; readonly ids: readonly InboxIdentity[] } | {
  readonly kind: 'splice'; readonly previous: PendingState; readonly start: number
  readonly removedCount: number; readonly inserted: readonly InboxIdentity[]
}
interface InboxState {
  readonly pending: PendingState
  readonly currentClaimed: ReadonlySet<string>
  readonly firstClaimedHuman: string | undefined
}
interface ProcessEvidence { readonly turn: number }
interface Marker { readonly messageId: string; readonly turn: number; readonly batchStart: boolean }
type Event = Parameters<ConversationNodeDefinition['match']>[0]

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap { 'modern-steering': ReadonlySet<string> }
}

const INBOX = 'modern-inbox-next-step'
const PROCESS = 'modern-process-evidence'
const EMPTY_PENDING: PendingState = { kind: 'snapshot', ids: [] }
const EMPTY_CLAIM: ReadonlySet<string> = new Set()

function materialize(state: PendingState): InboxIdentity[] {
  const splices: Extract<PendingState, { kind: 'splice' }>[] = []
  let current = state
  while (current.kind === 'splice') { splices.push(current); current = current.previous }
  const pending = [...current.ids]
  for (const splice of splices.reverse()) pending.splice(splice.start, splice.removedCount, ...splice.inserted)
  return pending
}

function applySplice(previous: ConversationPreviousContext<InboxState> | undefined, splice: InboxSplice): InboxState {
  const prior = previous?.state.pending ?? EMPTY_PENDING
  const removedCount = splice.removedCount ?? 0
  if (removedCount > 0 && splice.outcome !== 'canceled') {
    const pending = materialize(prior)
    const removed = pending.splice(splice.start, removedCount, ...splice.inserted)
    return { pending: { kind: 'snapshot', ids: pending },
      currentClaimed: new Set(removed.map(message => message.id)),
      firstClaimedHuman: removed.find(message => message.source.kind === 'user')?.id }
  }
  const claimed = previous?.state.currentClaimed ?? EMPTY_CLAIM
  const reinserted = splice.inserted.some(message => claimed.has(message.id))
  return {
    pending: { kind: 'splice', previous: prior, start: splice.start, removedCount, inserted: splice.inserted },
    currentClaimed: reinserted ? new Set([...claimed].filter(id => !splice.inserted.some(message => message.id === id))) : claimed,
    firstClaimedHuman: previous?.state.firstClaimedHuman,
  }
}

function processCoordinates(event: Event): ProcessEvidence & { readonly step: number } | undefined {
  if (event.type === 'assistant/message') {
    const visible = event.surfaceOp === 'append' && event.data.message.content.some(block => {
      if (block.type === 'tool-call') return false
      return block.type === 'text' || block.type === 'reasoning' ? block.text.trim() !== '' : true
    })
    return visible ? { turn: event.data.turn, step: event.data.step } : undefined
  }
  if (event.type === 'tool/call' || event.type === 'llm/retry'
    || (event.type === 'tool/result' && event.surfaceOp === 'append')) {
    return { turn: event.data.turn, step: event.data.step }
  }
  return undefined
}

export const inboxDefinition: ConversationNodeDefinition<InboxState> = {
  kind: INBOX,
  match: event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
    ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'agent/inbox/spliced') throw new Error('Expected an inbox splice')
    return applySplice(reader.previous<InboxState>(INBOX), match.event.data)
  },
  update: context => context.state,
  publication: () => 'none',
}

export const processDefinition: ConversationNodeDefinition<ProcessEvidence> = {
  kind: PROCESS,
  match: event => {
    const coordinates = processCoordinates(event)
    return coordinates === undefined ? null : { id: `${coordinates.turn}:${coordinates.step}`, role: 'start' }
  },
  start: (_context, match) => {
    const coordinates = processCoordinates(match.event)
    if (coordinates === undefined) throw new Error('Expected durable process evidence')
    return { turn: coordinates.turn }
  },
  update: context => context.state,
  publication: () => 'none',
}

export const markerDefinition: ConversationNodeDefinition<Marker> = {
  kind: 'modern-steering-marker',
  target: 'modern-steering',
  match: event => event.type === 'user/message' && event.surfaceOp === 'append' && event.data.source.kind === 'user'
    ? { id: String(event.data.id), role: 'start' } : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'user/message') throw new Error('Expected a human message')
    const messageId = String(match.event.data.id)
    const location = match.location
    const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : -1
    const claim = reader.previous<InboxState>(INBOX)?.state
    const evidence = reader.previous<ProcessEvidence>(PROCESS)?.state
    return { messageId, turn, batchStart: turn >= 0 && evidence?.turn === turn
      && claim?.firstClaimedHuman === messageId && claim.currentClaimed.has(messageId) }
  },
  update: context => context.state,
  buildViewNode: context => {
    const state = context.state
    if (!state) return null
    return { key: context.key, id: context.id, kind: 'modern-steering-marker', target: 'modern-steering', data: state }
  },
}

export const steeringViewDefinition: ConversationViewDefinition<ConversationViewNode, ReadonlySet<string>> = {
  target: 'modern-steering',
  create: () => {
    let accepted: ReadonlySet<string> = new Set()
    const apply = (nodes: readonly ConversationViewNode[], replace: boolean): ReadonlySet<string> => {
      const next = new Set(replace ? [] : accepted)
      for (const node of nodes) {
        const marker = node.data as Marker
        if (marker.batchStart) next.add(marker.messageId)
        else next.delete(marker.messageId)
      }
      if (next.size !== accepted.size || [...next].some(id => !accepted.has(id))) accepted = next
      return accepted
    }
    return { empty: accepted,
      replace: input => apply(input.nodes, true),
      apply: input => apply(input.upserts, false) }
  },
}

export function installSteeringBatches(ctx: Context): void {
  ctx.inject(['uiConversation'], scope => {
    for (const definition of [inboxDefinition, processDefinition, markerDefinition]) {
      scope.effect(() => scope.uiConversation.events.register(definition))
    }
    scope.effect(() => scope.uiConversation.views.register(steeringViewDefinition))
  })
}
