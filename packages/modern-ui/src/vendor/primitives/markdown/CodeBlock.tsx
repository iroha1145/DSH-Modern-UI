import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, Ref } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { CodeToolbar, HighlightLoadNotice, type CodeToolbarLabels } from '../CodeToolbar.tsx'
import {
  HIGHLIGHT_CHUNK_LINES, grammarForHint, withinHighlightBudget,
} from './highlight.ts'
import type { HighlightSpan } from './highlight.ts'
import type { StreamProgress, WorkerFrame } from './highlight-protocol.ts'
import { useViewportHighlighting } from './useViewportHighlighting.ts'
import { useWorkerHighlight } from './useHighlighting.ts'
import css from './CodeBlock.module.css'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /**
   * The code is still growing (a streaming markdown fence): highlight through
   * a per-instance {@link StreamingHighlightSession}, which re-tokenizes only
   * appended text and keeps completed line groups (and DOM) untouched. The
   * caller must keep the component instance stable across growth (a
   * stream-stable React key); an unchanged streamed fence also retains that
   * tree when it settles. Cold settled callers get shiki's HTML.
   */
  streaming?: boolean | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Ref for the stable source-content wrapper, for owners that use it as a scrollport. */
  contentRef?: Ref<HTMLDivElement> | undefined
  /** Show a numbered gutter without adding numbers to copied source. Defaults to false. */
  lineNumbers?: boolean | undefined
  /** Show the language and copy header; false when the caller supplies a toolbar. Defaults to true. */
  showHeader?: boolean | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
  /** Enable the shared card toolbar and spacing; omit for custom toolbar layouts. */
  toolbarLabels?: CodeToolbarLabels | undefined
  /** With toolbarLabels, use the owner's wrapping preference and omit the toolbar's local wrap action. */
  wrap?: boolean | undefined
}

/**
 * The `pre` attributes shiki's HTML arm emits for the css-variables theme,
 * mirrored so the streaming arm's tree is interchangeable with the settled
 * swap (`tests/streaming-code-block.client.spec.tsx` pins the two arms'
 * parity).
 */
const SHIKI_PRE_PROPS = {
  className: 'shiki css-variables',
  style: { backgroundColor: 'var(--shiki-background)', color: 'var(--shiki-foreground)' },
  tabIndex: 0,
} as const

/** Completed-line group size; React reconciles groups while the DOM remains line-for-line identical. */
const STREAMING_LINE_GROUP_SIZE = 32

function renderLine(line: readonly HighlightSpan[], index: number): ReactNode {
  return (
    <Fragment key={index}>
      {index > 0 && '\n'}
      <span className="line">
        {line.map((span, spanIndex) => <span key={spanIndex} style={span.style}>{span.text}</span>)}
      </span>
    </Fragment>
  )
}

// Completed groups retain their token DOM while only the next group upgrades.
const DeferredLineGroup = memo(function DeferredLineGroup({ text, lines, numbered, last }: {
  text: string; lines: HighlightSpan[][] | undefined; numbered: boolean; last: boolean
}) {
  return <span className={css.lineGroup}>{lines !== undefined ? lines.map(renderLine)
    : numbered ? text.split('\n').map((line, index) => <Fragment key={index}>{index > 0 && '\n'}<span className="line">{line}</span></Fragment>)
      : text}{!last && '\n'}</span>
})

function DeferredCode({ code, chunks, numbered }: { code: string; chunks: HighlightSpan[][][] | undefined; numbered: boolean }) {
  const groups = useMemo(() => {
    const lines = code.split(/\r?\n/)
    const result: string[] = []
    for (let index = 0; index < lines.length; index += HIGHLIGHT_CHUNK_LINES) result.push(lines.slice(index, index + HIGHLIGHT_CHUNK_LINES).join('\n'))
    return result
  }, [code])
  const complete = chunks?.length === groups.length
  return <pre {...SHIKI_PRE_PROPS} className={complete ? SHIKI_PRE_PROPS.className : css.plain}><code>
    {groups.map((text, index) => <DeferredLineGroup key={index} text={text} lines={chunks?.[index]} numbered={numbered} last={index === groups.length - 1} />)}
  </code></pre>
}

export function CodeBlock({
  code, lang, streaming, className, contentRef, lineNumbers = false, showHeader = true, copyLabel, copiedLabel, toolbarLabels, wrap,
}: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  const sourceLines = lineNumbers ? trimmed.split('\n') : undefined
  const rootRef = useRef<HTMLDivElement>(null)
  const highlighting = useViewportHighlighting(rootRef, lang)
  const lineCacheRef = useRef<{
    viewId: number; jobId: number; generation: number; sessionId: number; groups: ReactNode[]; pending: ReactNode[];
    nextLine: number; prefix: string; source: string; language: string; frame: WorkerFrame;
  } | null>(null)
  const progress = useCallback((): StreamProgress | undefined => {
    const cache = lineCacheRef.current
    return cache === null ? undefined : { viewId: cache.viewId, sessionId: cache.sessionId, generation: cache.generation, lines: cache.nextLine }
  }, [])
  const { result, error: highlightError, retry: retryHighlight } = useWorkerHighlight(trimmed, lang, highlighting, streaming === true, 'html', progress)
  const streamedBody = useMemo(() => {
    if (!highlighting) { lineCacheRef.current = null; return undefined }
    const language = grammarForHint(lang)
    let cache = lineCacheRef.current
    if (cache !== null && (cache.language !== language || !trimmed.startsWith(cache.prefix))) cache = lineCacheRef.current = null
    if (result?.kind === 'frame' && result.language === language && trimmed.startsWith(result.code) && cache?.frame !== result.frame) {
      const frame = result.frame
      const same = cache?.viewId === result.viewId && cache.sessionId === frame.sessionId && cache.generation === frame.generation
      const groups = same ? [...cache!.groups] : []
      let pending = same ? [...cache!.pending] : []
      let nextLine = same ? cache!.nextLine : 0
      for (const line of frame.appended.slice(nextLine - frame.from)) {
        pending.push(renderLine(line, nextLine))
        nextLine += 1
        if (pending.length !== STREAMING_LINE_GROUP_SIZE) continue
        groups.push(<Fragment key={nextLine - pending.length}>{pending}</Fragment>)
        pending = []
      }
      cache = { viewId: result.viewId, jobId: result.jobId, generation: frame.generation, sessionId: frame.sessionId,
        groups, pending, nextLine, prefix: result.code.slice(0, frame.prefixLength), source: result.code, language: result.language, frame }
      lineCacheRef.current = cache
    }
    // A fence that settles with new text or an untokenized backlog keeps its streamed lines until the settled result replaces them.
    if (cache === null || result?.kind !== 'frame') return undefined
    const tail = cache.source === trimmed ? cache.frame.tail : trimmed.slice(cache.prefix.length).split(/\r?\n/).map(text => [{ text, style: {} }])
    const tailGroup = <Fragment key={cache.nextLine - cache.pending.length}>{[...cache.pending, ...tail.map((line, index) => renderLine(line, cache.nextLine + index))]}</Fragment>
    return <pre {...SHIKI_PRE_PROPS}><code>{[...cache.groups, tailGroup]}</code></pre>
  }, [highlighting, trimmed, lang, result])
  const current = result?.code === trimmed && result.language === grammarForHint(lang) ? result : undefined
  const html = current?.kind === 'html' ? current.html : undefined
  const deferredBody = current?.kind === 'lines' ? <DeferredCode code={trimmed} chunks={current.chunks} numbered={lineNumbers} />
    : streaming !== true && !withinHighlightBudget(trimmed) ? <DeferredCode code={trimmed} chunks={undefined} numbered={lineNumbers} /> : undefined
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      window.clearTimeout(copyTimer.current)
    }
  }, [])
  const [localWrapped, setWrapped] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const collapsible = showHeader && toolbarLabels?.collapseLabel !== undefined && toolbarLabels.expandLabel !== undefined
  const contentHidden = collapsible && collapsed
  const wrapped = wrap ?? localWrapped

  const onCopy = useCallback(() => {
    if (copied) return
    // Copy source, independent of partial token DOM and newline normalization.
    void writeClipboard(trimmed).then((ok) => {
      if (!ok || !mounted.current) return
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  // shiki's HTML output is a static span tree it generated from `code` (no
  // user HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
  const body = streamedBody !== undefined
    ? streamedBody
    : deferredBody !== undefined
      ? deferredBody
    : html === undefined
      ? (
        <pre className={css.plain}><code>{sourceLines === undefined ? trimmed : sourceLines.map((line, index) => (
          <Fragment key={index}>{index > 0 && '\n'}<span className="line">{line}</span></Fragment>
        ))}</code></pre>
      )
      : (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )

  return (
    <div ref={rootRef} className={clsx(css.block, 'md-code-block', lineNumbers && css.numbered, toolbarLabels !== undefined && css.card, className)}
      data-line-numbers={lineNumbers || undefined}
      data-code-collapsed={contentHidden || undefined}
      data-code-wrap={toolbarLabels === undefined ? undefined : wrapped}
      style={sourceLines === undefined ? undefined : {
        '--dsl-code-block-line-number-width': `${Math.max(2, String(sourceLines.length).length)}ch`,
      } as CSSProperties}>
      {/* These paired attributes are stable semantic hooks for owner styling and DOM tests. */}
      {showHeader && <div className={css.bannerWrap}>
        {toolbarLabels !== undefined ? <CodeToolbar
          lang={lang} labels={toolbarLabels} copyLabel={copyLabel} copiedLabel={copiedLabel}
          copied={copied} wrapped={wrapped} onCopy={onCopy}
          collapsed={contentHidden} contentId={contentId}
          onToggleCollapse={collapsible ? () => { setCollapsed(value => !value) } : undefined}
          onWrap={wrap === undefined ? () => { setWrapped(value => !value) } : undefined}
        /> : <div className={css.banner} data-code-block-banner>
          <div className={css.infostring} data-text-interaction-exclude="">{lang ?? ''}</div>
          <div className={css.action}>
            <button type="button" className={css.copyButton} onClick={onCopy}>
              {copied ? copiedLabel : copyLabel}
            </button>
          </div>
        </div>}
      </div>}
      {highlightError !== undefined && <HighlightLoadNotice error={highlightError} labels={toolbarLabels?.highlight} onRetry={retryHighlight} />}
      <div ref={contentRef} id={contentId} className={css.content} data-code-block-content hidden={contentHidden}>{body}</div>
    </div>
  )
}
