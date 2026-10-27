/** Assistant visualization rendered inline with the answer, with a streaming placeholder and source access. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeBlock, TextShimmer } from '@iroha1145/dsh-modern-ui/primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { iconsFor, readHostStyle } from './design-system.ts'
import { parseContent, partialTitle, sourceFormat, type ContentFormat, type IntelligentContent } from './schema.ts'
import { mountVisualization } from './sandbox.ts'
import './locales.ts'
import css from './IntelligentUI.module.css'

/** Framework-bound resolved application palette. */
export interface ThemeInjected { hooks: { theme: HostObservable<ThemeSnapshot> } }
type IntelligentProps = PropsRuntime<'modern.conversation.chat.message.code'> & PropsLocale<'modern-intelligent'> & InjectFace<ThemeInjected> & { matched: object }

interface FrameEvents {
  readonly failed: () => void
  readonly scriptError: () => void
  readonly openLink: (href: string) => void
}

const HEIGHT_CACHE_LIMIT = 64
// A frame can resend requests faster than anyone clicks. The open button arms only after a request
// has been on screen for a moment, and requests are ignored for a moment after the reader answers,
// so a double click never lands on a destination the reader did not see.
const LINK_ARM_MS = 500
const LINK_QUIET_MS = 1000
// Remounts (answer completion, theme changes, retries) reuse the last measured height instead of jumping.
const measuredHeights = new Map<string, number>()

function rememberHeight(key: string, height: number): void {
  measuredHeights.delete(key)
  measuredHeights.set(key, height)
  if (measuredHeights.size > HEIGHT_CACHE_LIMIT) measuredHeights.delete(measuredHeights.keys().next().value ?? key)
}

function VisualizationFrame({ code, content, events, scheme }: { code: string; content: IntelligentContent; events: FrameEvents; scheme: 'light' | 'dark' }) {
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(() => measuredHeights.get(code) ?? content.initialHeight ?? 96)
  const [ready, setReady] = useState(false)
  const icons = useMemo(() => iconsFor(code), [code])
  useEffect(() => {
    if (container.current === null) return
    const resized = (next: number): void => {
      rememberHeight(code, next)
      setHeight(next)
    }
    const callbacks = {
      ready: () => { setReady(true) }, failed: events.failed, scriptError: events.scriptError, resized, openLink: events.openLink,
    }
    const host = readHostStyle(container.current, scheme)
    return mountVisualization(container.current, content, callbacks, { scheme, host, icons })
  }, [code, content, events, icons, scheme])
  return <div className={css.frame} ref={container} style={{ height }} data-intelligent-frame data-ready={ready} />
}

function LinkRequest({ href, onOpen, onCancel, t }: {
  href: string
  onOpen: () => void
  onCancel: () => void
  t: IntelligentProps['t']
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => { setArmed(true) }, LINK_ARM_MS)
    return () => { clearTimeout(timer) }
  }, [])
  // Below a tall visualization the request would otherwise appear off screen.
  const reveal = useCallback((node: HTMLDivElement | null) => { node?.scrollIntoView({ block: 'nearest' }) }, [])
  return <div ref={reveal} className={css.linkRequest} data-intelligent-link-request role="group"
    aria-label={t('openLinkQuestion')} aria-live="polite">
    <span>{t('openLinkQuestion')}</span>
    <span className={css.linkAddress} dir="ltr">{href}</span>
    <div className={css.linkActions}>
      <button type="button" disabled={!armed} onClick={onOpen}>{t('openLink')}</button>
      <button type="button" onClick={onCancel}>{t('cancelLink')}</button>
    </div>
  </div>
}

function CompletedVisualization({
  content, format, code, labels, t, useTheme,
}: IntelligentProps & { content: IntelligentContent; format: ContentFormat }) {
  const scheme = useTheme(snapshot => snapshot.active.colorScheme)
  const [source, setSource] = useState(false)
  const [failed, setFailed] = useState(false)
  const [scriptError, setScriptError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const quietUntil = useRef(0)
  const events = useMemo<FrameEvents>(() => ({
    failed: () => { setFailed(true); setPendingLink(null) },
    scriptError: () => { setScriptError(true) },
    // Frame messages are untrusted requests, even when they claim a reader clicked.
    // Keep the displayed destination fixed until the reader confirms or cancels.
    openLink: (href) => {
      if (Date.now() < quietUntil.current) return
      setPendingLink(current => current ?? href)
    },
  }), [])
  const settleLink = (): void => {
    quietUntil.current = Date.now() + LINK_QUIET_MS
    setPendingLink(null)
  }
  const retry = (): void => {
    setFailed(false)
    setPendingLink(null)
    setScriptError(false)
    setAttempt(value => value + 1)
  }
  const sourceToggle = <button type="button" onClick={() => { setSource(value => !value) }} aria-expanded={source}>
    {t(source ? 'hideSource' : 'source')}
  </button>
  return <section className={css.visual} data-intelligent-ui data-format={format} data-state={failed ? 'failed' : scriptError ? 'script-error' : 'complete'}>
    {!failed && <div className={css.stage}>
      <VisualizationFrame key={attempt} code={code} content={content} events={events} scheme={scheme} />
      <div className={css.actions}>{sourceToggle}</div>
    </div>}
    {pendingLink !== null && <LinkRequest key={pendingLink} href={pendingLink} t={t} onCancel={settleLink} onOpen={() => {
      window.open(pendingLink, '_blank', 'noopener,noreferrer')
      settleLink()
    }} />}
    {(failed || scriptError) && <p className={css.status} role="status">
      <span>{t(failed ? 'failed' : 'scriptError')}</span>
      <button type="button" onClick={retry}>{t('retry')}</button>
      {failed && sourceToggle}
    </p>}
    {content.fallback !== undefined && failed && <p className={css.fallback} data-intelligent-fallback>{content.fallback}</p>}
    {source && <CodeBlock code={code} lang={format} {...labels} />}
  </section>
}

function PendingVisualization({ code, streaming, settled, closed, labels, t, reason }: IntelligentProps & { reason: 'invalid' | 'tooLarge' | undefined }) {
  const title = partialTitle(code)
  if (streaming && reason === undefined) return <section className={css.visual} data-intelligent-ui data-state="streaming">
    <div className={css.placeholder} role="status">
      {title !== undefined && <strong className={css.placeholderTitle}>{title}</strong>}
      <TextShimmer active>{t('preparing')}</TextShimmer>
    </div>
  </section>
  const status = !closed || (!settled && !streaming) || reason === undefined ? 'incomplete' : reason
  return <section className={css.card} data-intelligent-ui data-state={status === 'incomplete' ? 'incomplete' : 'invalid'}>
    <div className={css.toolbar}><strong className={css.title}>{title ?? t('title')}</strong></div>
    <p className={css.status} role="status">{t(status)}</p>
    <CodeBlock code={code} lang={sourceFormat(code)} {...labels} />
  </section>
}

/**
 * Render a closed, valid block inline as soon as its fence closes, while the rest of the answer may still stream;
 * an open fence shows a placeholder, and stopped or rejected input keeps the original source.
 * @param props - Assistant-owned source and localized copy from the registered slot.
 * @returns A visualization or readable local state.
 */
export function IntelligentUI(props: IntelligentProps) {
  const { code, streaming, settled, closed, t } = props
  const defaultTitle = t('title')
  const parsed = useMemo(() => closed ? parseContent(code, defaultTitle) : undefined, [closed, code, defaultTitle])
  if (parsed === undefined || !parsed.ok || (!streaming && !settled)) {
    return <PendingVisualization {...props} reason={parsed !== undefined && !parsed.ok ? parsed.reason : undefined} />
  }
  return <CompletedVisualization key={code} {...props} content={parsed.content} format={parsed.format} />
}
