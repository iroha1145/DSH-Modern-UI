/** Numeric source references, trailing source chips, and document-local pointer/keyboard highlighting. */
import { useEffect, useRef } from 'react'
import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react'
import type * as Md from 'mdast'
import { normalizeUri } from 'micromark-util-sanitize-uri'
import { useMarkdownDelegate } from './MarkdownDelegate.tsx'
import css from './Citations.module.css'

/** Localized source-list heading and individual source name prefix. */
export interface MarkdownCitationLabels {
  sources: string
  source: string
}

/** One explicitly numbered, safe HTTP(S) source authored in Markdown. */
export interface CitationSource {
  id: string
  url: string
  title: string
}

/** Sources discovered during a render pass, in first-reference order. */
export type CitationSources = Map<string, CitationSource>

/** A source destination that passed the HTTP(S) check, before it is bound to a number. */
type SourceTarget = Omit<CitationSource, 'id'>

const NUMBER = /^[1-9]\d*$/

/** Text that may sit between two markers without splitting them: whitespace and commas. */
const RUN_SEPARATOR = /^[\s,，、]+$/u

function describeTarget(target: Pick<Md.Definition, 'url' | 'title'>): SourceTarget | undefined {
  const url = normalizeUri(target.url)
  let parsed: URL
  try { parsed = new URL(url) }
  catch { return undefined } // Relative and malformed destinations remain ordinary Markdown.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  return { url, title: target.title?.trim() || parsed.hostname }
}

function conflicts(id: string, target: SourceTarget, sources: CitationSources): boolean {
  const existing = sources.get(id)
  return existing !== undefined && existing.url !== target.url
}

function claim(id: string, target: SourceTarget, sources: CitationSources): CitationSource {
  const existing = sources.get(id)
  if (existing !== undefined) return existing
  const source = { id, ...target }
  sources.set(id, source)
  return source
}

/**
 * Resolve a numeric link or shortcut reference without guessing missing definitions.
 * @param node - The authored Markdown node.
 * @param definitions - CommonMark definitions visible in this render pass.
 * @param sources - First-reference-ordered source collection.
 * @returns A safe source, or undefined for ordinary/unresolved/conflicting links.
 */
function resolveCitation(
  node: Md.RootContent,
  definitions: ReadonlyMap<string, Md.Definition>,
  sources: CitationSources,
): CitationSource | undefined {
  if (node.type !== 'link' && node.type !== 'linkReference') return undefined
  if (node.children.length !== 1 || node.children[0]?.type !== 'text') return undefined
  const id = node.children[0].value
  if (!NUMBER.test(id)) return undefined
  const origin = node.type === 'link' ? node : definitions.get(node.identifier.toUpperCase())
  if (origin === undefined) return undefined
  // Only [1] shorthand and explicit [1](url) denote citations; named/full
  // references such as [1][documentation] keep their ordinary link meaning.
  if (node.type === 'linkReference' && (node.referenceType !== 'shortcut' || node.identifier !== id)) return undefined
  const target = describeTarget(origin)
  if (target === undefined || conflicts(id, target, sources)) return undefined
  return claim(id, target, sources)
}

/**
 * Read `[1][3]` as the two adjacent citations it was written for. CommonMark parses it as a full
 * reference whose text is `1` and whose label is `3`; both numbers must be defined and safe, and
 * neither may contradict a source already registered under its number.
 */
function resolveNumberedPair(
  node: Md.RootContent,
  definitions: ReadonlyMap<string, Md.Definition>,
  sources: CitationSources,
): readonly CitationSource[] {
  if (node.type !== 'linkReference' || node.referenceType !== 'full') return []
  if (node.children.length !== 1 || node.children[0]?.type !== 'text') return []
  const first = node.children[0].value
  const second = node.identifier
  if (!NUMBER.test(first) || !NUMBER.test(second) || first === second) return []
  const firstOrigin = definitions.get(first)
  const secondOrigin = definitions.get(second)
  if (firstOrigin === undefined || secondOrigin === undefined) return []
  const firstTarget = describeTarget(firstOrigin)
  const secondTarget = describeTarget(secondOrigin)
  if (firstTarget === undefined || secondTarget === undefined) return []
  if (conflicts(first, firstTarget, sources) || conflicts(second, secondTarget, sources)) return []
  return [claim(first, firstTarget, sources), claim(second, secondTarget, sources)]
}

function resolveCitations(
  node: Md.RootContent,
  definitions: ReadonlyMap<string, Md.Definition>,
  sources: CitationSources,
): readonly CitationSource[] {
  const single = resolveCitation(node, definitions, sources)
  return single === undefined ? resolveNumberedPair(node, definitions, sources) : [single]
}

/** Adjacent citation markers that render as one chip. */
export interface CitationRun {
  /** Distinct sources in authored order; the first one owns the chip's link. */
  readonly sources: readonly [CitationSource, ...CitationSource[]]
  /** How many nodes after the first one the run absorbed, separators included. */
  readonly consumed: number
}

/**
 * Gather the citation markers that start at one inline node and follow it without text between them.
 * Whitespace and commas between two markers do not break a run; they disappear with the merged chip.
 * @param node - The inline node that may start a run.
 * @param siblings - Every node of the same container, in order.
 * @param next - Index in `siblings` of the node after `node`.
 * @param definitions - CommonMark definitions visible in this render pass.
 * @param sources - First-reference-ordered source collection; each resolved marker registers its source.
 * @returns The merged sources and the number of following nodes absorbed, or undefined when the node is not a citation.
 */
export function citationRun(
  node: Md.RootContent,
  siblings: readonly Md.RootContent[],
  next: number,
  definitions: ReadonlyMap<string, Md.Definition>,
  sources: CitationSources,
): CitationRun | undefined {
  const [head, ...rest] = resolveCitations(node, definitions, sources)
  if (head === undefined) return undefined
  const merged: [CitationSource, ...CitationSource[]] = [head, ...rest]
  let consumed = 0
  let separators = 0
  for (const candidate of siblings.slice(next)) {
    if (separators === 0 && candidate.type === 'text' && RUN_SEPARATOR.test(candidate.value)) {
      separators = 1
      continue
    }
    const found = resolveCitations(candidate, definitions, sources)
    if (found.length === 0) break
    for (const source of found) {
      if (!merged.some(existing => existing.id === source.id)) merged.push(source)
    }
    consumed += separators + 1
    separators = 0
  }
  return { sources: merged, consumed }
}

/**
 * Collect the explicit citation ids contained in a paragraph or list item.
 * @param node - The containing Markdown block.
 * @param definitions - Definitions visible to this render pass.
 * @param sources - Render-pass source collection.
 * @returns Space-separated source numbers for document-local highlighting.
 */
export function citationBlockIds(
  node: Md.RootContent,
  definitions: ReadonlyMap<string, Md.Definition>,
  sources: CitationSources | undefined,
): string | undefined {
  if (sources === undefined) return undefined
  const ids = new Set<string>()
  const visit = (child: Md.RootContent): void => {
    const found = resolveCitations(child, definitions, sources)
    if (found.length > 0) {
      for (const source of found) ids.add(source.id)
    } else if ('children' in child && child.type !== 'link' && child.type !== 'linkReference' && child.type !== 'footnoteDefinition') {
      child.children.forEach(visit)
    }
  }
  visit(node)
  return ids.size === 0 ? undefined : [...ids].join(' ')
}

/**
 * Open a source through the owner's external-link delegate for plain clicks.
 * @param url - The source address.
 * @returns A click handler, or undefined when no delegate exists so the native anchor navigates.
 * Modified and non-primary clicks always keep native browser behavior.
 */
export function useSourceClick(url: string): MouseEventHandler<HTMLAnchorElement> | undefined {
  const { openExternalLink } = useMarkdownDelegate()
  return openExternalLink === undefined ? undefined : (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openExternalLink(url)
  }
}

/**
 * Describe one source for assistive technology and the hover preview.
 * @param source - The cited source.
 * @param label - Localized "source" prefix, absent when the owner supplies no copy.
 * @returns The number, with the localized prefix when available, followed by the title.
 */
export function describeCitation(source: CitationSource, label: string | undefined): string {
  return `${label === undefined ? '' : `${label} `}${source.id}: ${source.title}`
}

function SourceChip({ source, label }: { source: CitationSource; label: string | undefined }): ReactNode {
  const onClick = useSourceClick(source.url)
  return <a
    href={source.url}
    target="_blank"
    rel="noopener noreferrer"
    className={css.source}
    data-citation-id={source.id}
    data-citation-kind="source"
    aria-label={label === undefined ? undefined : describeCitation(source, label)}
    title={source.title}
    onClick={onClick}
  >
    <span className={css.number}>{source.id}</span>
    <span className={css.title}>{source.title}</span>
  </a>
}

/**
 * Render only sources explicitly referenced by a numbered body marker.
 * @param props - First-reference-ordered safe sources and optional localized chrome.
 * @returns The trailing source chips, or null for a document without citations.
 */
export function CitationSection({ sources, labels }: {
  sources: CitationSources
  labels: MarkdownCitationLabels | undefined
}): ReactNode {
  if (sources.size === 0) return null
  return <section className={css.sources} data-citation-sources aria-label={labels?.sources}>
    {labels !== undefined && <div className={css.heading}>{labels.sources}</div>}
    <div className={css.sourceList}>{[...sources.values()].map(source =>
      <SourceChip key={source.id} source={source} label={labels?.source} />,
    )}</div>
  </section>
}

type CitationIds = readonly (string | undefined)[]

function idsOf(element: HTMLElement): CitationIds {
  return element.dataset['citationIds']?.split(' ') ?? [element.dataset['citationId']]
}

/**
 * Keep citation interaction within one Markdown root without rerendering its children.
 * Pointer hover or keyboard focus on an inline chip or a source highlights every element that shares one of its numbers.
 * @param props - Existing Markdown root attributes, source revision, and cached children.
 * @returns The Markdown root with local pointer and focus event delegation.
 */
export function CitationDocument({ revision, children, ...props }: HTMLAttributes<HTMLDivElement> & {
  revision: string
  children: ReactNode
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const hovered = useRef<CitationIds | undefined>(undefined)
  const focused = useRef<CitationIds | undefined>(undefined)
  const painted = useRef<string | undefined>(undefined)
  const paint = (): void => {
    const ids = hovered.current ?? focused.current
    const key = ids?.join(' ')
    if (painted.current === key) return
    painted.current = key
    /* v8 ignore next -- the root is attached before any pointer or focus event can reach it. */
    for (const element of root.current?.querySelectorAll<HTMLElement>('[data-citation-id], [data-citation-ids]') ?? []) {
      if (element.closest('[data-citation-document]') !== root.current) continue
      if (ids === undefined) delete element.dataset['citationState']
      else {
        const owned = idsOf(element)
        element.dataset['citationState'] = ids.some(id => owned.includes(id)) ? 'active' : 'muted'
      }
    }
  }
  const idsAt = (target: EventTarget | null): CitationIds | undefined => {
    if (!(target instanceof Element)) return undefined
    const anchor = target.closest<HTMLElement>('[data-citation-id]')
    return anchor !== null && anchor.closest('[data-citation-document]') === root.current ? idsOf(anchor) : undefined
  }
  // A revised message may reuse this root for another conversation. Clear
  // transient decoration after its DOM commits, including newly appended chips.
  useEffect(() => {
    if (hovered.current === undefined && focused.current === undefined) return
    hovered.current = undefined
    focused.current = undefined
    painted.current = undefined
    /* v8 ignore next -- effects run after the root is attached. */
    for (const element of root.current?.querySelectorAll<HTMLElement>('[data-citation-state]') ?? []) {
      if (element.closest('[data-citation-document]') === root.current) delete element.dataset['citationState']
    }
  }, [revision])
  return <div {...props} ref={root} data-citation-document
    onPointerOver={(event) => {
      if (event.pointerType === 'touch') return
      hovered.current = idsAt(event.target)
      paint()
    }}
    onPointerOut={(event) => {
      hovered.current = idsAt(event.relatedTarget)
      paint()
    }}
    onFocus={(event) => { focused.current = idsAt(event.target); paint() }}
    onBlur={(event) => { focused.current = idsAt(event.relatedTarget); paint() }}
  >{children}</div>
}
