/** An assistant openui-lang block rendered as live components inside the answer, progressively while it streams. */
import { Component, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { BuiltinActionType, Renderer, type ActionEvent } from '@openuidev/react-lang'
import type { ParseResult } from '@openuidev/lang-core'
import { CodeBlock, TextShimmer } from '@iroha1145/dsh-modern-ui/primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { library } from '../../openui/library.ts'
import { runLibraryAction } from '../../openui/actions.ts'
import { webUrl } from '../../openui/components/style.ts'
import { UI_TEXT, UiTextContext, type UiText } from '../../openui/components/ui-text.ts'
import { assistantMessage, CONTENT_LIMIT } from './openui-source.ts'
import './locales.ts'
import css from './OpenUIBlock.module.css'

/** Framework-bound resolved application palette. */
export interface ThemeInjected { hooks: { theme: HostObservable<ThemeSnapshot> } }
type BlockProps = PropsRuntime<'conversation.chat.message.code'> & PropsLocale<'modern-intelligent'> & InjectFace<ThemeInjected> & { matched: object }

/** A render-time failure inside the components keeps the answer readable: the block shows its source instead. */
class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  override render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children }
}

/**
 * Render an openui-lang fence as components. While the fence streams the program renders as far as it has
 * arrived; once it closes, inputs and buttons work while the rest of the answer may still stream. A block
 * that never produces a root keeps its source readable.
 * Buttons never send on their own: a @ToAssistant click puts its message in the composer for the reader to
 * read and send, because a button's label need not match what it sends. A copy shows what was copied.
 * @param props - Fence source and stream state, the Session's input actions, the palette, and localized copy.
 * @returns The rendered block, a placeholder, or the preserved source.
 */
export function OpenUIBlock(props: BlockProps) {
  const { code, streaming, closed, labels, t, useTheme, inputActions, useInput, useSession, useAccess } = props
  const scheme = useTheme(snapshot => snapshot.active.colorScheme)
  const busy = useInput(input => input.phase === 'adjudicating' || input.phase === 'submitting')
  const composerFree = useInput(input => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  const writable = useSession(session => !session.removed && (session.subagent === null
    || (session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true)))
  const allowed = useAccess('session/prompt')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [renderErrors, setRenderErrors] = useState(0)
  const [source, setSource] = useState(false)
  const [notice, setNotice] = useState<{ key: 'proposed' | 'insertRejected' | 'copiedText' | 'copyFailed'; detail?: string } | null>(null)
  // The renderer reports its whole state on every change; a click reads the latest copy.
  const state = useRef<Record<string, unknown> | undefined>(undefined)
  const text = useMemo(() => Object.fromEntries(Object.keys(UI_TEXT).map(key => [key, t(key as keyof UiText)])) as UiText, [t])
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
      propose(assistantMessage({ message: event.humanFriendlyMessage, formName: event.formName, state: state.current ?? event.formState, context: event.params.context }))
    } else if (event.type === BuiltinActionType.OpenUrl) {
      const href = webUrl(event.params.url)
      if (href !== null) window.open(href, '_blank', 'noopener,noreferrer')
    } else {
      const copied = typeof event.params.text === 'string' ? event.params.text : ''
      void runLibraryAction(event)?.then(ok => {
        setNotice(ok ? { key: 'copiedText', detail: copied.length > 200 ? `${copied.slice(0, 199)}…` : copied } : { key: 'copyFailed' })
      })
    }
  }, [propose])

  const preserved = (status: 'invalid' | 'incomplete') => <section className={css.card} data-openui-block data-state={status}>
    <div className={css.toolbar}><strong className={css.title}>{t('title')}</strong></div>
    <p className={css.status} role="status">{t(status)}</p>
    <CodeBlock code={code} lang="openui-lang" {...labels} />
  </section>

  if (code.length > CONTENT_LIMIT) return preserved('invalid')
  const rendered = result?.root !== null && result?.root !== undefined
  if (!rendered && (closed || unfinished) && (result !== null || code.trim() === '')) return preserved(closed ? 'invalid' : 'incomplete')
  const issues = !arriving && rendered && (unfinished || result.meta.errors.length > 0 || result.meta.unresolved.length > 0 || renderErrors > 0)
  const toggle = <button type="button" onClick={() => { setSource(value => !value) }} aria-expanded={source}>
    {t(source ? 'hideSource' : 'source')}
  </button>

  return <section className={css.block} data-openui-block data-state={arriving ? 'streaming' : issues ? 'partial' : 'complete'}>
    {!rendered && <div className={css.placeholder} role="status"><TextShimmer active>{t('preparing')}</TextShimmer></div>}
    <div className={css.stage}>
      {/* A failure while the fence streams gets one fresh attempt once it closes. */}
      <Boundary key={closed ? 'closed' : 'open'} fallback={preserved('invalid')}>
        <UiTextContext.Provider value={text}>
          <div className="iui-root" data-theme={scheme}>
            <Renderer library={library} response={code} isStreaming={arriving} onAction={onAction} onParseResult={setResult}
              onStateUpdate={(next) => { state.current = next }} onError={(errors) => { setRenderErrors(errors.length) }} />
          </div>
        </UiTextContext.Provider>
      </Boundary>
      {rendered && !arriving && <div className={css.actions}>{toggle}</div>}
    </div>
    {issues && <p className={css.status} role="status"><span>{t(unfinished ? 'incomplete' : 'partial')}</span></p>}
    {notice !== null && <p className={css.status} role="status">
      <span>{t(notice.key)}</span>
      {notice.detail !== undefined && <code className={css.copied}>{notice.detail}</code>}
    </p>}
    {source && <CodeBlock code={code} lang="openui-lang" {...labels} />}
  </section>
}
