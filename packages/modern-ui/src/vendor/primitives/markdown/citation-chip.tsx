/** Inline source chip that names the cited site and previews its sources on hover or keyboard focus. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { pointerModality } from '../input-modality.ts'
import { overlayTopMargin } from '../overlay-top-margin.ts'
import { describeCitation, useSourceClick } from './citations.tsx'
import type { CitationSource } from './citations.tsx'
import { citationPreviewMaxWidth, placeCitationPreview } from './preview-placement.ts'
import { citationChipName, citationGlyph, citationLocation, citationSiteName } from './site-name.ts'
import css from './Citations.module.css'

/** Distance between the chip and its preview card. */
const PREVIEW_GAP = 6

/** Viewport margin kept around the preview card. */
const PREVIEW_MARGIN = 8

/** Width the preview card takes when the message column is wide enough. */
const PREVIEW_WIDTH = 320

interface PreviewProps {
  id: string
  anchor: RefObject<HTMLAnchorElement | null>
  sources: readonly CitationSource[]
  dismiss: () => void
}

/**
 * The preview card for the sources one chip cites. It is a tooltip: it takes no pointer input,
 * lists each source (glyph, site, number, title, address), and leaves with Escape.
 */
function CitationPreview({ id, anchor, sources, dismiss }: PreviewProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const card = panel.current
    const chip = anchor.current
    /* v8 ignore next -- both refs are attached before layout effects run. */
    if (card === null || chip === null) return
    const place = (): void => {
      const rect = chip.getBoundingClientRect()
      const column = chip.closest('[data-citation-document]')?.getBoundingClientRect() ?? { left: 0, right: window.innerWidth }
      // Bounding the width first lets the measured height include the wrapped lines.
      card.style.maxWidth = `${citationPreviewMaxWidth(column, window.innerWidth, PREVIEW_WIDTH)}px`
      const size = card.getBoundingClientRect()
      const placement = placeCitationPreview({
        anchor: rect, column, size, gap: PREVIEW_GAP,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        topInset: overlayTopMargin(PREVIEW_MARGIN, rect, PREVIEW_GAP),
      })
      card.style.left = `${placement.left}px`
      card.style.top = `${placement.top}px`
      card.style.visibility = 'visible'
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [anchor])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      dismiss()
    }
    // Capture phase: Escape closes the card before any other Escape binding sees the key.
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [dismiss])
  return <div ref={panel} id={id} role="tooltip" className={css.preview} style={{ visibility: 'hidden' }}>
    {sources.map((source) => {
      const site = citationSiteName(source.url)
      return <div key={source.id} className={css.previewItem} data-citation-preview={source.id}>
        <div className={css.previewHead}>
          <span className={css.glyph} aria-hidden="true">{citationGlyph(site)}</span>
          <span className={css.previewSite}>{site}</span>
          <span className={css.cardNumber}>{source.id}</span>
        </div>
        <div className={css.previewTitle}>{source.title}</div>
        <div className={css.previewAddress}>{citationLocation(source.url)}</div>
      </div>
    })}
  </div>
}

/**
 * One inline citation marker rendered as a pill named after the cited site, such as `GitHub` or `Notion +1`.
 * Adjacent markers arrive as one chip: the first source owns the link, and the preview lists every source.
 * @param props - The cited sources (the first is non-empty by construction) and the localized "source" prefix.
 * @returns The chip anchor, plus a portaled tooltip preview while the pointer rests on it or keyboard focus is on it.
 * Touch input never opens the preview; Escape closes it. The accessible name carries the site, the source numbers, and the titles.
 */
export function CitationChip({ sources, label }: {
  sources: readonly [CitationSource, ...CitationSource[]]
  label: string | undefined
}): ReactNode {
  const [primary] = sources
  const onClick = useSourceClick(primary.url)
  const anchor = useRef<HTMLAnchorElement>(null)
  const previewId = useId()
  const [open, setOpen] = useState(false)
  const triggers = useRef({ hover: false, focus: false })
  const sync = (): void => { setOpen(triggers.current.hover || triggers.current.focus) }
  const dismiss = useCallback(() => {
    triggers.current = { hover: false, focus: false }
    setOpen(false)
  }, [])
  const site = citationSiteName(primary.url)
  const extra = sources.length - 1
  return <>
    <a
      ref={anchor}
      href={primary.url}
      target="_blank"
      rel="noopener noreferrer"
      className={css.chip}
      data-citation-id={primary.id}
      data-citation-ids={extra === 0 ? undefined : sources.map(source => source.id).join(' ')}
      data-citation-kind="reference"
      aria-label={`${extra === 0 ? site : `${site} +${extra}`}, ${sources.map(source => describeCitation(source, label)).join('; ')}`}
      aria-describedby={open ? previewId : undefined}
      onClick={(event) => {
        onClick?.(event)
        dismiss()
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return
        triggers.current.hover = true
        sync()
      }}
      onPointerLeave={() => { triggers.current.hover = false; sync() }}
      onFocus={() => {
        if (pointerModality()) return
        triggers.current.focus = true
        sync()
      }}
      onBlur={() => { triggers.current.focus = false; sync() }}
    >
      <span>{citationChipName(site)}</span>
      {extra > 0 && <>{' '}<span className={css.chipMore}>{`+${extra}`}</span></>}
    </a>
    {open && createPortal(<CitationPreview id={previewId} anchor={anchor} sources={sources} dismiss={dismiss} />, document.body)}
  </>
}
