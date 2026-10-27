/**
 * Pure derivation of the Agents view tree: the top ancestor of the current
 * Session, its descendants from list lineage and loaded subagent catalogs, and
 * each agent's figures from summary projection values and live UI status.
 */
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent/client'
import { tokenTotal } from '../format.ts'
import type { AgentNode, AgentStatus } from './AgentTree.tsx'
import type {} from '@deepseek-ai/dsh-token-meter/client'

/** The list facts the tree reads. */
export type AgentTreeList = Pick<SessionListState, 'byId' | 'projectionsBySession'>

/** Inputs of one derivation. */
export interface AgentTreeInput {
  /** Session shown in the main view; the tree roots at its top ancestor. */
  readonly currentSessionId: SessionId
  /** Parent named by the current Session's own subagent address, when known. */
  readonly currentParentId: SessionId | undefined
  readonly list: AgentTreeList
  readonly statuses: SessionStatusSnapshot
}

/** One derived family. */
export interface AgentTreeModel {
  readonly root: AgentNode
  /** Whether any agent in the family runs, so durations need a clock. */
  readonly running: boolean
  /** Family Sessions whose projections were never read, so their own catalogs may be missing. */
  readonly unread: readonly SessionId[]
}

/** Parent from list lineage, the current Session's address, or a loaded parent catalog. */
function parentOf(input: AgentTreeInput, id: SessionId): SessionId | undefined {
  const row = input.list.byId[id]
  if (row !== undefined) return row.origin === 'subagent' ? row.parentId : undefined
  if (id === input.currentSessionId && input.currentParentId !== undefined) return input.currentParentId
  for (const [parentId, snapshot] of Object.entries(input.list.projectionsBySession)) {
    if (snapshot.values.subagentCatalog?.some(entry => entry.id === id) === true) return parentId as SessionId
  }
  return undefined
}

/** Walk up while the parent is a listed Session; a lineage cycle stops the walk. */
function rootOf(input: AgentTreeInput): SessionId {
  let id = input.currentSessionId
  const seen = new Set<SessionId>([id])
  for (;;) {
    const parent = parentOf(input, id)
    if (parent === undefined || seen.has(parent) || input.list.byId[parent] === undefined) return id
    seen.add(parent)
    id = parent
  }
}

/** Listed subagent rows by parent, oldest first; a loaded catalog orders its own entries first. */
function childRows(list: AgentTreeList): ReadonlyMap<SessionId, readonly SessionSummary[]> {
  const index = new Map<SessionId, SessionSummary[]>()
  for (const row of Object.values(list.byId)) {
    if (row.origin !== 'subagent' || row.parentId === undefined) continue
    const siblings = index.get(row.parentId) ?? []
    siblings.push(row)
    index.set(row.parentId, siblings)
  }
  for (const siblings of index.values()) {
    siblings.sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
  }
  return index
}

/**
 * Status from the facts the client holds: a pending interaction means the
 * agent waits for the user; the running flag means it runs; otherwise the
 * child's latest closed turn decides. A turn that ended without completing
 * reads as stopped, because the summary keeps no reason that separates a
 * failure from an interruption; an open turn on an agent that no longer runs
 * was cut off. Without timing the agent is known only not to run.
 */
function statusOf(row: SessionSummary, statuses: SessionStatusSnapshot): { status: AgentStatus; running: boolean } {
  const live = statuses.get(row.id)
  const running = live?.running ?? row.running
  if (live?.pendingInteraction !== undefined) return { status: 'waiting', running }
  if (running) return { status: 'running', running }
  const timing = row.projectionValues?.subagentTiming
  if (timing?.lastTurnCompleted === true) return { status: 'done', running }
  if (timing?.lastTurnCompleted === false || timing?.active !== undefined) return { status: 'stopped', running }
  return { status: 'idle', running }
}

/** Model the next step uses, else the one the latest request used. */
function modelOf(row: SessionSummary): string | undefined {
  const selection = row.projectionValues?.modelSelection
  return (selection?.next ?? selection?.lastUsed)?.model
}

function externalNode(entry: SubagentCatalogEntry): AgentNode {
  return {
    id: entry.id,
    name: entry.label ?? entry.id,
    running: false,
    external: true,
    current: false,
    openable: false,
    children: [],
  }
}

/**
 * Derive the agent family of the current Session.
 * @param input - current Session, its addressed parent, list facts, and live status.
 * @returns the family tree, or undefined while the root Session has no list row.
 */
export function deriveAgentTree(input: AgentTreeInput): AgentTreeModel | undefined {
  const rootRow = input.list.byId[rootOf(input)]
  if (rootRow === undefined) return undefined
  const index = childRows(input.list)
  const unread: SessionId[] = []
  const visited = new Set<SessionId>()
  let anyRunning = false
  const build = (row: SessionSummary, entry: SubagentCatalogEntry | undefined): AgentNode => {
    visited.add(row.id)
    const snapshot = input.list.projectionsBySession[row.id]
    const catalog = snapshot?.values.subagentCatalog
    if (catalog === undefined && (snapshot === undefined || snapshot.state === 'idle')) unread.push(row.id)
    const children: AgentNode[] = []
    const catalogued = new Set<SessionId>()
    for (const child of catalog ?? []) {
      catalogued.add(child.id)
      if (visited.has(child.id)) continue
      if (child.mode === 'external') {
        children.push(externalNode(child))
        continue
      }
      // The Session list adds a row for every local catalog child it projects.
      const childRow = input.list.byId[child.id]
      if (childRow !== undefined) children.push(build(childRow, child))
    }
    for (const childRow of index.get(row.id) ?? []) {
      if (!catalogued.has(childRow.id) && !visited.has(childRow.id)) children.push(build(childRow, undefined))
    }
    const { status, running } = statusOf(row, input.statuses)
    anyRunning ||= running
    const values = row.projectionValues
    const label = entry?.label ?? values?.subagent?.label
    return {
      id: row.id,
      name: label ?? row.displayTitle,
      task: label !== undefined && row.title !== undefined && row.title !== label ? row.title : undefined,
      model: modelOf(row),
      status,
      running,
      external: false,
      tokens: tokenTotal(values?.tokenUsage),
      // Only a subagent's timing measures its run; a top-level Session reports an empty one.
      timing: row.origin === 'subagent' ? values?.subagentTiming : undefined,
      current: row.id === input.currentSessionId,
      openable: row.id !== input.currentSessionId,
      children,
    }
  }
  const root = build(rootRow, undefined)
  return { root, running: anyRunning, unread }
}
