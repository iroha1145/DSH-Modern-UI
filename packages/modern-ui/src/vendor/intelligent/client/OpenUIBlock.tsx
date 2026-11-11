/** An assistant openui-lang block rendered as live components inside the answer, progressively while it streams. */
import { Component, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { BuiltinActionType, createParser, Renderer, type ActionEvent } from '@openuidev/react-lang'
import { CodeBlock, TextShimmer } from '@iroha1145/dsh-modern-ui/primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { library } from '../../openui/library.ts'
import { runLibraryAction } from '../../openui/actions.ts'
import { FieldRegistry, FieldRegistryContext } from '../../openui/components/fields.ts'
import { webUrl } from '../../openui/components/style.ts'
import { UI_TEXT, UiLocaleContext, UiTextContext, type UiText } from '../../openui/components/ui-text.ts'
import { assistantMessage, CONTENT_LIMIT, EXPANSION_LIMIT, expansionEstimate, NESTING_LIMIT, nestingDepth, prepareOpenUISource } from './openui-source.ts'
import { budgeted, ExpansionBudget, ParseLimitError } from './openui-budget.ts'
import './locales.ts'
import css from './OpenUIBlock.module.css'

/** Framework-bound resolved application palette. */
export interface ThemeInjected { hooks: { theme: HostObservable<ThemeSnapshot>; uiLocale: HostObservable<{ active: string }> } }
type BlockProps = PropsRuntime<'conversation.chat.message.code'> & PropsLocale<'modern-intelligent'> & InjectFace<ThemeInjected> & { matched: object }
type Notice = { key: 'proposed' | 'insertRejected' | 'copiedText' | 'copyFailed'; detail?: string }

// The block judges the source it is showing now with the same library the Renderer uses; the Renderer's own
// parse result arrives a commit later and would describe the previous source.
let parser: ReturnType<typeof createParser> | undefined

/**
 * The parse result, or why the block keeps its source: 'tooLarge' for source too long, nested too deep or inlining
 * more nodes than one parse may build, 'invalid' when the parser throws for any other reason. Nothing it throws
 * reaches the host, which would lose the whole answer.
 */
function parseWithin(code: string, program: string | null): ReturnType<ReturnType<typeof createParser>['parse']> | 'tooLarge' | 'invalid' {
  if (code.length > CONTENT_LIMIT || nestingDepth(code) > NESTING_LIMIT) return 'tooLarge'
  if (program === null) return 'invalid'
  try {
    parser ??= createParser(library.toJSONSchema(), library.root)
    return parser.parse(program)
  } catch (error) {
    return error instanceof ParseLimitError ? 'tooLarge' : 'invalid'
  }
}

/** The loop estimate, or past every limit when a program nested without brackets (a long chain of !) overflows it. */
function estimate(root: unknown, states: Readonly<Record<string, unknown>>): number {
  try {
    return expansionEstimate(root, states)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** A render-time failure inside the components keeps the answer readable: the block shows its source instead. */
class Boundary extends Component<{ fallback: ReactNode; retryKey: unknown; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  // Only a block that failed gets a fresh attempt (once its fence closes); a working one keeps its state.
  override componentDidUpdate(previous: { retryKey: unknown }): void {
    if (this.state.failed && previous.retryKey !== this.props.retryKey) this.setState({ failed: false })
  }
  override render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

/**
 * Render an openui-lang fence as components. While the fence streams the program renders as far as it has
 * arrived; once it closes, inputs and buttons work while the rest of the answer may still stream. A block
 * that never produces a root keeps its source readable, one whose loops would expand past the budget is
 * never evaluated, and one that runs past its step budget while evaluating or drawing stops and shows its source.
 * Buttons never send on their own: a @ToAssistant click puts its message, with what the reader sees in the
 * inputs, in the composer for the reader to read and send, because a button's label need not match what it
 * sends. A copy shows what was copied.
 * @param props - Fence source and stream state, the Session's input actions, the palette, and localized copy.
 * @returns The rendered block, a placeholder, or the preserved source.
 */
export function OpenUIBlock(props: BlockProps) {
  const { code, streaming, closed, labels, t, useTheme, inputActions, useInput, useSession, useAccess } = props
  const language = props.useUiLocale?.(snapshot => snapshot.active) ?? "en-US"
  const scheme = useTheme(snapshot => snapshot.active.colorScheme)
  const busy = useInput(input => input.phase === 'adjudicating' || input.phase === 'submitting')
  const composerFree = useInput(input => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  const writable = useSession(session => !session.removed && (session.subagent === null
    || (session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true)))
  const allowed = useAccess('session/prompt')
  const [renderErrors, setRenderErrors] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const fields = useMemo(() => new FieldRegistry(), [])
  const text = useMemo(() => Object.fromEntries(Object.keys(UI_TEXT).map(key => [key, t(key as keyof UiText)])) as UiText, [t])
  const program = useMemo(() => code.length > CONTENT_LIMIT ? null : prepareOpenUISource(code), [code])
  const parsed = useMemo(() => parseWithin(code, program), [code, program])
  const oversized = useMemo(() => typeof parsed !== 'string' && estimate(parsed.root, parsed.stateDeclarations) > EXPANSION_LIMIT, [parsed])
  // The estimate cannot know lengths computed at runtime; the Renderer counts real steps against this budget.
  const [budget] = useState(() => new ExpansionBudget())
  const counted = useMemo(() => budgeted(library, budget), [budget])
  const overBudget = useSyncExternalStore(budget.subscribe, budget.exceeded, budget.exceeded)
  // Like a render failure, a block over budget gets one fresh attempt once its fence closes.
  const attempt = useRef(closed)
  useLayoutEffect(() => {
    if (attempt.current === closed) return
    attempt.current = closed
    budget.reset()
  }, [budget, closed])
  // A click or an input can put a longer list in a $variable: judge the loops again with the values the
  // Renderer will read, unwrapped from input fields like its own reads, before it evaluates them.
  const onStateUpdate = useCallback((state: Record<string, unknown>): void => {
    const values = Object.fromEntries(Object.entries(state).map(([name, value]) =>
      [name, value !== null && typeof value === 'object' && !Array.isArray(value) && 'value' in value ? value.value : value]))
    if (typeof parsed !== 'string' && estimate(parsed.root, values) > EXPANSION_LIMIT) budget.exceed()
  }, [parsed, budget])
  // Inputs stay disabled only while this fence itself is still arriving.
  const arriving = streaming && !closed
  // The answer ended (normally or stopped) without closing this fence.
  const unfinished = !streaming && !closed

  const propose = useCallback((message: string): void => {
    if (message === '' || busy || !writable || !allowed) return
    if (composerFree) {
      inputActions.setDraft(message)
      setNotice({ key: 'proposed' })
      return
    }
    // The editor may reject an insertion if its state changed since this render.
    setNotice({ key: inputActions.insertText(message, inputActions.captureInsertion()) ? 'proposed' : 'insertRejected' })
  }, [busy, writable, allowed, composerFree, inputActions])

  const onAction = useCallback((event: ActionEvent): void => {
    if (event.type === BuiltinActionType.ContinueConversation) {
      propose(assistantMessage({ message: event.humanFriendlyMessage, fields: fields.read(event.formName), context: event.params.context }))
    } else if (event.type === BuiltinActionType.OpenUrl) {
      const href = webUrl(event.params.url)
      if (href !== null) window.open(href, '_blank', 'noopener,noreferrer')
    } else {
      const copied = typeof event.params.text === 'string' ? event.params.text : ''
      void runLibraryAction(event)?.then(ok => {
        setNotice(ok ? { key: 'copiedText', detail: copied.length > 200 ? `${copied.slice(0, 199)}…` : copied } : { key: 'copyFailed' })
      })
    }
  }, [propose, fields])

  const preserved = (status: 'invalid' | 'incomplete' | 'tooLarge') => <section className={css.card} data-openui-block data-state={status}>
    <div className={css.toolbar}><strong className={css.title}>{t('title')}</strong></div>
    <p className={css.status} role="status">{t(status)}</p>
    <CodeBlock code={code} lang="openui-lang" {...labels} />
  </section>

  if (typeof parsed === 'string') return preserved(parsed)
  if (oversized || overBudget) return preserved('tooLarge')
  const rendered = parsed.root !== null
  if (!rendered && (closed || unfinished)) return preserved(closed ? 'invalid' : 'incomplete')
  const { errors, unresolved, incomplete } = parsed.meta
  const issues = !arriving && rendered && (unfinished || incomplete || errors.length > 0 || unresolved.length > 0 || renderErrors > 0)

  return <section className={css.block} data-openui-block data-state={arriving ? 'streaming' : issues ? 'partial' : 'complete'}>
    {!rendered && <div className={css.placeholder} role="status"><TextShimmer active>{t('preparing')}</TextShimmer></div>}
    <div className={css.stage}>
      <Boundary retryKey={closed} fallback={preserved('invalid')}>
        <UiLocaleContext.Provider value={language}><UiTextContext.Provider value={text}>
          <FieldRegistryContext.Provider value={fields}>
            <div className="iui-root" data-theme={scheme}>
              <Renderer library={counted} response={program!} isStreaming={arriving} onAction={onAction}
                onStateUpdate={onStateUpdate} onError={(found) => { setRenderErrors(found.length) }} />
            </div>
          </FieldRegistryContext.Provider>
        </UiTextContext.Provider></UiLocaleContext.Provider>
      </Boundary>
    </div>
    {issues && <p className={css.status} role="status"><span>{t(unfinished || incomplete ? 'incomplete' : 'partial')}</span></p>}
    {notice !== null && <p className={css.status} role="status">
      <span>{t(notice.key)}</span>
      {notice.detail !== undefined && <code className={css.copied}>{notice.detail}</code>}
    </p>}
  </section>
}
