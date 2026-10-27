import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// The domain's client-namespace pure-type outlet: one import edge delivers
// the `todos` projection-key merge (single source, no consumer-side restated
// declare) and the payload type. Type-only by construction — the outlet is
// free of host value imports, so no host Context merge enters this program.
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { IconChecklistOutlineRegular } from '@iroha1145/dsh-modern-ui/primitives'
import { NS } from '../locales.ts'
import css from './TodoPanel.module.css'

export interface TodoPanelProps {
  /** The session's current plan (empty renders nothing) — selected by the dock adapter. */
  todos: readonly TodoItem[]
  /** The dock entry's locale seat, passed down as a plain prop. */
  t: TodoDockProps['t']
}

/** Local exhaustiveness helper — client packages do not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if status is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable todo status: ${String(value)}`)
}

/** Return the localized status announced beside one decorative marker. */
function statusLabel(status: TodoItem['status'], t: TodoPanelProps['t']): string {
  switch (status) {
    case 'completed': return t('todo.status.completed')
    case 'in_progress': return t('todo.status.inProgress')
    case 'pending': return t('todo.status.pending')
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/** Header summary: "·"-joined per-status counts; zero-count segments are omitted as noise (a non-empty list keeps at least one). */
function progressLabel(todos: readonly TodoItem[], t: TodoPanelProps['t']): string {
  const done = todos.filter(item => item.status === 'completed').length
  const active = todos.filter(item => item.status === 'in_progress').length
  const pending = todos.length - done - active
  // En spaces (U+2002): HTML collapses runs of ASCII spaces, so widening the
  // separator breathing room needs a literal wide space.
  return [
    ...done > 0 ? [t('todo.progress.done', { done })] : [],
    ...active > 0 ? [t('todo.progress.active', { active })] : [],
    ...pending > 0 ? [t('todo.progress.pending', { pending })] : [],
  ].join('\u2002·\u2002')
}

/** Beautiful UI TaskRows.tsx SpinnerRing (MIT), driven only by the real todo status. */
function TaskRing({ active, step }: { active: boolean; step: number }) {
  const circumference = 2 * Math.PI * 11
  return (
    <span className={css.ring}>
      <svg width="24" height="24" className={active ? css.ringActive : undefined} aria-hidden>
        <circle cx="12" cy="12" r="11" fill="none" stroke="var(--bui-line, var(--line))" strokeWidth="2" />
        {active && <circle cx="12" cy="12" r="11" fill="none" stroke="var(--bui-ink-3, var(--ink-3))" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${circumference * 0.28} ${circumference * 0.72}`} />}
      </svg>
      <span className={css.step}>{step}</span>
    </span>
  )
}

export function TodoPanel({ todos, t }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  if (todos.length === 0) return null

  const doneCount = todos.filter(item => item.status === 'completed').length
  const anyActive = todos.some(item => item.status === 'in_progress')

  return (
    <section className={css.root} data-testid="todo-panel" aria-label={t('todo.title')}>
      <div className={css.body}>
        <button
          type="button"
          className={css.header}
          aria-expanded={!collapsed}
          onClick={() => { setCollapsed(v => !v) }}
        >
          <span className={css.lead} aria-hidden>
            {anyActive ? (
              <svg width="14" height="14" viewBox="0 0 16 16" className={css.ringActive} style={{ color: 'var(--accent)' }}>
                <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.75" />
                <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            ) : doneCount === todos.length ? (
              <span className={css.checkBadge}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-6.5" />
                </svg>
              </span>
            ) : <IconChecklistOutlineRegular size={14} />}
          </span>
          <span className={css.title}>{t('todo.title')}</span>
          <span className={css.progress}>{progressLabel(todos, t)}</span>
          <span className={css.chevron} aria-hidden style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
        {!collapsed && (
          <ul className={css.list}>
            {todos.map((item, index) => (
              <li key={item.content} className={css.item} data-status={item.status}>
                <span className={css.glyph} role="img" aria-label={statusLabel(item.status, t)}>
                  {item.status === 'completed' ? (
                    <span className={css.checkBadge}>
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-6.5" />
                      </svg>
                    </span>
                  ) : (
                    <TaskRing active={item.status === 'in_progress'} step={index + 1} />
                  )}
                </span>
                <span className={css.content}>{item.content}</span>
                {item.status === 'completed' && (
                  <span className={css.statusCompleted}>{t('todo.status.completed')}</span>
                )}
                {item.status === 'in_progress' && (
                  <span className="shimmer-text" style={{ fontSize: '11.5px', fontWeight: 500 }}>
                    {t('todo.status.inProgress')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Props for the projected todo dock. */
export type TodoDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'modern-conversation'>

/** Renders the current todo projection, or nothing when it is absent. */
export function TodoDock({ useProjection, t }: TodoDockProps) {
  const todos = useProjection('todos')
  return <TodoPanel todos={todos ?? []} t={t} />
}

/** Registers the projected todo dock. */
export const todoDockEntry = {
  name: 'conversation-todo-dock',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: NS }, TodoDock))
  },
}
