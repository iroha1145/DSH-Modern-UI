/**
 * Presentational agent family tree: a totals bar, one card per agent, connectors
 * drawn from each parent card, and branches that fold. Every figure arrives as
 * plain data; this module reads no Session runtime.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AnimatedRows, IconCheckOutlineRegular, IconChevronDownOutlineRegular,
  IconClockOutlineRegular, IconQueueOutlineRegular, IconSparkleRegular, IconStopFillRegular,
  IconWarningTriangleOutlineRegular, StateDot, Tag, TextShimmer, type TagTone,
} from '@iroha1145/dsh-modern-ui/primitives'
import { activeDuration, formatDuration, formatExactDuration, formatTokens } from '../format.ts'
import type { NS } from '../locales.ts'
import css from './AgentTree.module.css'
import scroll from './AgentScroll.module.css'

/** Agent status vocabulary; `idle` covers an agent known not to run with no recorded outcome. */
export type AgentStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'idle'

/** One agent and its subagents, as the tree presents them. */
export interface AgentNode {
  /** Session identity; external tasks carry their catalog id. */
  readonly id: SessionId
  /** Card heading. */
  readonly name: string
  /** Task text under the heading, clamped to two lines. */
  readonly task?: string | undefined
  /** Model id shown under the name. */
  readonly model?: string | undefined
  /** Execution status; absent for an external task, which reports none. */
  readonly status?: AgentStatus | undefined
  /** Whether the agent currently runs, including while it waits for the user. */
  readonly running: boolean
  /** Whether this is an external task without a Session of its own. */
  readonly external: boolean
  /** This agent's own token total; parents present their whole branch. */
  readonly tokens?: number | undefined
  /** Active-turn timing of a descriptor-backed child. */
  readonly timing?: SessionProjectionMap['subagentTiming'] | undefined
  /** Whether this is the Session shown in the main view. */
  readonly current: boolean
  /** Whether a card click opens this agent's Session. */
  readonly openable: boolean
  readonly children: readonly AgentNode[]
}

/** Props of the presentational tree. */
export interface AgentTreeProps {
  root: AgentNode
  /** Clock for running durations, in milliseconds. */
  now: number
  t: TranslateNS<typeof NS>
  /** Open one agent's Session. */
  onOpen: (id: SessionId) => void
  /** Branches folded on first render. */
  defaultFolded?: readonly SessionId[] | undefined
}

/** Whole-tree figures for the bar and each card's branch total. */
interface TreeFigures {
  agents: number
  running: number
  waiting: number
  failed: number
  /** Own plus descendant tokens per agent; absent while no agent in the branch reports usage. */
  branchTokens: ReadonlyMap<SessionId, number>
  /** Agents whose branch contains a running agent. */
  live: ReadonlySet<SessionId>
}

/** Rows in document order and the deepest unfolded level, root = 0. */
interface VisibleTree {
  keys: readonly SessionId[]
  depth: number
}

const MUTED: ReadonlySet<AgentStatus> = new Set(['queued', 'stopped'])

const STATUS_TONE = {
  queued: 'neutral',
  running: 'info',
  waiting: 'warning',
  done: 'success',
  failed: 'danger',
  stopped: 'neutral',
  idle: 'quiet',
} as const satisfies Record<AgentStatus, TagTone>

const STATUS_KEY = {
  queued: 'agents.status.queued',
  running: 'agents.status.running',
  waiting: 'agents.status.waiting',
  done: 'agents.status.done',
  failed: 'agents.status.failed',
  stopped: 'agents.status.stopped',
  idle: 'agents.status.idle',
} as const satisfies Record<AgentStatus, string>

/** First character of a name, upper-cased, for the card's identity tile. */
function monogram(name: string): string {
  const [first = ''] = Array.from(name.trim())
  return first.toLocaleUpperCase()
}

function figuresOf(root: AgentNode): TreeFigures {
  const figures = { agents: 0, running: 0, waiting: 0, failed: 0 }
  const branchTokens = new Map<SessionId, number>()
  const live = new Set<SessionId>()
  const visit = (node: AgentNode): { tokens: number | undefined; live: boolean } => {
    figures.agents += 1
    if (node.status === 'running') figures.running += 1
    if (node.status === 'waiting') figures.waiting += 1
    if (node.status === 'failed') figures.failed += 1
    let tokens = node.tokens
    let running = node.running
    for (const child of node.children) {
      const branch = visit(child)
      if (branch.tokens !== undefined) tokens = (tokens ?? 0) + branch.tokens
      running ||= branch.live
    }
    if (tokens !== undefined) branchTokens.set(node.id, tokens)
    if (running) live.add(node.id)
    return { tokens, live: running }
  }
  visit(root)
  return { ...figures, branchTokens, live }
}

function visibleTree(root: AgentNode, folded: ReadonlySet<SessionId>): VisibleTree {
  const keys: SessionId[] = []
  let depth = 0
  const visit = (node: AgentNode, level: number): void => {
    keys.push(node.id)
    depth = Math.max(depth, level)
    if (folded.has(node.id)) return
    for (const child of node.children) visit(child, level + 1)
  }
  visit(root, 0)
  return { keys, depth }
}

const STATUS_GLYPH = {
  queued: () => <IconQueueOutlineRegular size={12} className={css.badgeIcon} />,
  running: () => <StateDot state="ongoing" size={12} className={css.badgeIcon} />,
  waiting: () => <IconClockOutlineRegular size={12} className={css.badgeIcon} />,
  done: () => <IconCheckOutlineRegular size={12} className={css.badgeIcon} />,
  failed: () => <IconWarningTriangleOutlineRegular size={12} className={css.badgeIcon} />,
  stopped: () => <IconStopFillRegular size={12} className={css.badgeIcon} />,
  idle: () => null,
} as const satisfies Record<AgentStatus, () => ReactNode>

interface BranchProps {
  node: AgentNode
  /** ARIA level, root = 1. */
  level: number
  /** Position among the root's children, measured in columns from the row center. */
  offset: number
  folded: ReadonlySet<SessionId>
  figures: TreeFigures
  now: number
  t: TranslateNS<typeof NS>
  onOpen: (id: SessionId) => void
  onToggle: (id: SessionId) => void
}

/** One agent card plus its unfolded subagents. */
function Branch({ node, level, offset, folded, figures, now, t, onOpen, onToggle }: BranchProps) {
  const count = node.children.length
  const isFolded = count > 0 && folded.has(node.id)
  const open = count > 0 && !isFolded
  const statusText = node.status === undefined ? t('mode.external') : t(STATUS_KEY[node.status])
  const muted = node.status !== undefined && MUTED.has(node.status)
  const tokens = figures.branchTokens.get(node.id)
  const elapsed = activeDuration(node.timing, node.running, now)
  const side = offset < 0 ? 'left' : offset > 0 ? 'right' : 'center'
  const style = level === 2 ? { '--agent-reach': String(Math.abs(offset)) } as CSSProperties : undefined
  let meta: ReactNode = null
  if (tokens !== undefined || elapsed !== undefined || count > 0) {
    meta = (
      <div className={css.meta}>
        <span className={css.figures}>
          {tokens !== undefined && (
            <TextShimmer active={figures.live.has(node.id)}>
              {t('tokens.total', { value: formatTokens(tokens, t) })}
            </TextShimmer>
          )}
          {tokens !== undefined && elapsed !== undefined && <span aria-hidden="true">·</span>}
          {elapsed !== undefined && (
            <span title={t('duration.exactTitle', { duration: formatExactDuration(elapsed, t) })}>
              {formatDuration(elapsed, t)}
            </span>
          )}
        </span>
        {count > 0 && (
          <button
            type="button"
            className={css.fold}
            aria-expanded={open}
            aria-label={isFolded
              ? t(count === 1 ? 'agents.fold.show.one' : 'agents.fold.show.other', { count, name: node.name })
              : t('agents.fold.hide', { name: node.name })}
            onClick={() => { onToggle(node.id) }}
          >
            <span>{isFolded ? `+${String(count)}` : String(count)}</span>
            <IconChevronDownOutlineRegular size={12} />
          </button>
        )}
      </div>
    )
  }
  return (
    <div
      role="treeitem"
      aria-label={t('agents.item', { name: node.name, status: statusText })}
      aria-level={level}
      aria-current={node.current || undefined}
      {...count > 0 ? { 'aria-expanded': open } : {}}
      className={level === 1 ? css.root : css.node}
      data-side={level === 2 ? side : undefined}
      data-muted={muted || undefined}
      style={style}
    >
      <div className={css.slot} data-row-key={node.id} data-open={open || undefined}>
        <article
          className={css.card}
          data-current={node.current || undefined}
          data-muted={muted || undefined}
          data-openable={node.openable || undefined}
        >
          {node.openable && (
            <button
              type="button"
              className={css.open}
              aria-label={t('agents.open', { name: node.name })}
              onClick={() => { onOpen(node.id) }}
            />
          )}
          <div className={css.top}>
            <span className={css.avatar} aria-hidden="true">{monogram(node.name)}</span>
            <span className={css.name}>{node.name}</span>
            <span className={css.sub}>
              {node.model !== undefined && <span className={css.model}>{node.model}</span>}
              {node.status !== undefined && (
                <Tag tone={STATUS_TONE[node.status]} className={css.badge}>
                  <span className={css.badgeContent}>
                    {STATUS_GLYPH[node.status]()}
                    {statusText}
                  </span>
                </Tag>
              )}
            </span>
          </div>
          {node.external
            ? <p className={css.task}>{statusText}</p>
            : node.task !== undefined && <p className={css.task}>{node.task}</p>}
          {meta}
        </article>
      </div>
      {open && (
        <div role="group" className={level === 1 ? css.rootGroup : css.group}>
          {node.children.map((child, index) => (
            <Branch
              key={child.id}
              node={child}
              level={level + 1}
              offset={index - (count - 1) / 2}
              folded={folded}
              figures={figures}
              now={now}
              t={t}
              onOpen={onOpen}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Render one agent family: the totals bar, then the root card with its
 * subagents. From 560px of container width the first level sits side by side
 * under the root and deeper levels hang below their parent; narrower, every
 * level hangs under its parent. Connectors are drawn from the cards
 * themselves, so they follow any width or zoom.
 * @param props - the family tree, clock, translate, and open callback.
 * @returns the Agents view body.
 */
export function AgentTree({ root, now, t, onOpen, defaultFolded = [] }: AgentTreeProps) {
  const [folded, setFolded] = useState<ReadonlySet<SessionId>>(() => new Set(defaultFolded))
  const figures = useMemo(() => figuresOf(root), [root])
  const visible = useMemo(() => visibleTree(root, folded), [root, folded])
  const totalTokens = figures.branchTokens.get(root.id)
  const toggle = (id: SessionId): void => {
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <section className={css.view}>
      <header className={css.bar}>
        <IconSparkleRegular size={14} className={css.spark} />
        <span className={css.title}>{t('agents.title')}</span>
        <span className={css.totals}>
          <span className={css.counts} aria-live="polite">
            <span>{t(figures.agents === 1 ? 'agents.count.one' : 'agents.count.other', { count: figures.agents })}</span>
            {figures.running > 0 && (
              <span className={css.runningCount}>{t('agents.running', { count: figures.running })}</span>
            )}
            {figures.waiting > 0 && (
              <span className={css.waitingCount}>
                {t(figures.waiting === 1 ? 'agents.waiting.one' : 'agents.waiting.other', { count: figures.waiting })}
              </span>
            )}
            {figures.failed > 0 && (
              <span className={css.failedCount}>{t('agents.failed', { count: figures.failed })}</span>
            )}
          </span>
          {totalTokens !== undefined && (
            <TextShimmer active={figures.live.has(root.id)} className={css.totalTokens}>
              {t('tokens.total', { value: formatTokens(totalTokens, t) })}
            </TextShimmer>
          )}
        </span>
      </header>
      <div className={css.body}>
        <div
          className={[css.canvas, scroll.scroller].join(' ')}
          style={{
            '--agent-depth': String(visible.depth),
            '--agent-columns': String(Math.max(1, folded.has(root.id) ? 1 : root.children.length)),
          } as CSSProperties}
        >
          <AnimatedRows
            className={css.tree as string}
            role="tree"
            label={t('agents.title')}
            rowKeys={visible.keys}
            ready
            resetKey={root.id}
          >
            <Branch
              node={root}
              level={1}
              offset={0}
              folded={folded}
              figures={figures}
              now={now}
              t={t}
              onOpen={onOpen}
              onToggle={toggle}
            />
          </AnimatedRows>
        </div>
        {root.children.length === 0 && <p className={css.hint}>{t('agents.empty')}</p>}
      </div>
    </section>
  )
}
