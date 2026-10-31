/** An assistant openui-lang block rendered as live components inside the answer, progressively while it streams. */
import { Component, useCallback, useMemo, useState, type ReactNode } from 'react'
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
 * @param props - Fence source and stream state, the Session's input actions, the palette, and localized copy.
 * @returns The rendered block, a placeholder, or the preserved source.
 */
export function OpenUIBlock(props: BlockProps) {
  const { code, streaming, closed, settled, labels, t, useTheme, inputActions, useInput, useSession, useAccess } = props
  const scheme = useTheme(snapshot => snapshot.active.colorScheme)
  const busy = useInput(input => input.phase === 'adjudicating' || input.phase === 'submitting')
  const composerFree = useInput(input => input.phase === 'plain' && input.draft.trim() === '' && input.attachmentIds.length === 0)
  const writable = useSession(session => !session.removed && (session.subagent === null
    || (session.subagent.address.mode === 'continuable' && session.subagent.parentAvailable === true)))
  const allowed = useAccess('session/prompt')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [source, setSource] = useState(false)
  const [insertionRejected, setInsertionRejected] = useState(false)
  const text = useMemo(() => Object.fromEntries(Object.keys(UI_TEXT).map(key => [key, t(key as keyof UiText)])) as UiText, [t])
  // Inputs stay disabled only while this fence itself is still arriving.
  const arriving = streaming && !closed
  const stopped = !streaming && !settled && !closed

  const ask = useCallback((message: string): void => {
    if (message === '' || busy || !writable || !allowed) return
    setInsertionRejected(false)
    if (!composerFree) {
      // The editor may reject an insertion if its state changed since this render.
      setInsertionRejected(!inputActions.insertText(message, inputActions.captureInsertion()))
      return
    }
    inputActions.setDraft(message)
    inputActions.submit()
  }, [busy, writable, allowed, composerFree, inputActions])

  const onAction = useCallback((event: ActionEvent): void => {
    if (event.type === BuiltinActionType.ContinueConversation) ask(assistantMessage(event))
    else if (event.type === BuiltinActionType.OpenUrl) {
      const href = webUrl(event.params.url)
      if (href !== null) window.open(href, '_blank', 'noopener,noreferrer')
    } else void runLibraryAction(event)
  }, [ask])

  const preserved = (status: 'invalid' | 'incomplete') => <section className={css.card} data-openui-block data-state={status}>
    <div className={css.toolbar}><strong className={css.title}>{t('title')}</strong></div>
    <p className={css.status} role="status">{t(status)}</p>
    <CodeBlock code={code} lang="openui-lang" {...labels} />
  </section>

  if (code.length > CONTENT_LIMIT) return preserved('invalid')
  const rendered = result?.root !== null && result?.root !== undefined
  if (!rendered && (closed || stopped) && (result !== null || code.trim() === '')) return preserved(stopped ? 'incomplete' : 'invalid')
  const issues = !arriving && rendered && (result.meta.errors.length > 0 || stopped)
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
            <Renderer library={library} response={code} isStreaming={arriving} onAction={onAction} onParseResult={setResult} />
          </div>
        </UiTextContext.Provider>
      </Boundary>
      {rendered && !arriving && <div className={css.actions}>{toggle}</div>}
    </div>
    {issues && <p className={css.status} role="status"><span>{t(stopped ? 'incomplete' : 'partial')}</span></p>}
    {insertionRejected && <p className={css.status} role="status">{t('insertRejected')}</p>}
    {source && <CodeBlock code={code} lang="openui-lang" {...labels} />}
  </section>
}
