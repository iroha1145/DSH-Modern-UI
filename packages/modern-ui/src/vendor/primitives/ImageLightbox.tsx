import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import css from './ImageLightbox.module.css'
import { useModalLayer } from './useModalLayer.ts'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  dialog: string
  close: string
  zoomIn: string
  zoomOut: string
  resetZoom: string
  zoomHelp: string
}

/** Original-image portal; shared modal ownership handles Escape and focus return. */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  const viewport = useRef<HTMLDivElement | null>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const pointerType = useRef('mouse')
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null)
  const [scale, setScale] = useState(1)
  const [fit, setFit] = useState({ width: 0, height: 0 })
  useModalLayer(dialog, true, onClose)

  function measure() {
    const node = image.current
    const view = viewport.current
    if (!node?.naturalWidth || !view) return
    const ratio = Math.min(1, Math.min(view.clientWidth, 1600) / node.naturalWidth, view.clientHeight / node.naturalHeight)
    setFit({ width: node.naturalWidth * ratio, height: node.naturalHeight * ratio })
  }

  function zoom(next: number, clientX?: number, clientY?: number) {
    const node = image.current
    const view = viewport.current
    if (!node || !view || !fit.width || Math.max(1, Math.min(4, next)) === scale) return
    const rect = node.getBoundingClientRect()
    const bounds = view.getBoundingClientRect()
    const x = clientX ?? bounds.left + view.clientWidth / 2
    const y = clientY ?? bounds.top + view.clientHeight / 2
    anchor.current = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height, clientX: x - bounds.left, clientY: y - bounds.top }
    setScale(Math.max(1, Math.min(4, next)))
  }

  useLayoutEffect(() => {
    setScale(1)
    measure()
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [src])

  useLayoutEffect(() => {
    const view = viewport.current
    const node = image.current
    const point = anchor.current
    if (!view || !node || !point) return
    const bounds = view.getBoundingClientRect()
    const rect = node.getBoundingClientRect()
    view.scrollLeft += rect.left - bounds.left + point.x * rect.width - point.clientX
    view.scrollTop += rect.top - bounds.top + point.y * rect.height - point.clientY
    anchor.current = null
  }, [scale, fit])

  // React delegates wheel passively. Keep ordinary wheel zoom local to the image,
  // allowing Ctrl/Meta + wheel to continue to the browser's zoom handling.
  useLayoutEffect(() => {
    const node = image.current
    if (!node) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.deltaY === 0) return
      event.preventDefault()
      zoom(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY)
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [scale, fit])

  return createPortal(
    <div ref={dialog} className={css.backdrop} role="dialog" aria-modal="true" aria-label={labels.dialog}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(scale * 1.25) }
        if (event.key === '-') { event.preventDefault(); zoom(scale / 1.25) }
        if (event.key === '0') { event.preventDefault(); zoom(1) }
      }}>
      <div className={css.stage}>
        <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
        <div ref={viewport} className={css.viewport} tabIndex={0} role="group" aria-label={labels.zoomHelp}>
          <div className={css.canvas} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
            <img ref={image} className={css.image} src={src} alt={alt} draggable={false} onLoad={measure}
              style={fit.width ? { width: fit.width * scale, height: fit.height * scale } : undefined}
              data-zoomed={scale > 1 || undefined}
              onDoubleClick={event => { if (pointerType.current !== 'touch') zoom(scale > 1 ? 1 : 2, event.clientX, event.clientY) }}
              onPointerDown={event => {
                pointerType.current = event.pointerType
                if (scale === 1 || event.pointerType === 'touch' || event.button !== 0) return
                const view = viewport.current
                if (!view) return
                event.preventDefault()
                view.focus({ preventScroll: true })
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop }
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={event => {
                const start = drag.current
                const view = viewport.current
                if (!start || start.id !== event.pointerId || !view) return
                view.scrollLeft = start.left + start.x - event.clientX
                view.scrollTop = start.top + start.y - event.clientY
              }}
              onPointerUp={event => {
                drag.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onLostPointerCapture={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
          </div>
        </div>
        <div className={css.controls}>
          <button type="button" aria-label={labels.zoomOut} title={labels.zoomOut} disabled={scale === 1} onClick={() => zoom(scale / 1.25)}>−</button>
          <button type="button" aria-label={labels.resetZoom} title={labels.resetZoom} onClick={() => zoom(1)}><span aria-live="polite">{Math.round(scale * 100)}%</span></button>
          <button type="button" aria-label={labels.zoomIn} title={labels.zoomIn} disabled={scale === 4} onClick={() => zoom(scale * 1.25)}>+</button>
        </div>
        <button type="button" className={css.close} aria-label={labels.close} onClick={onClose} data-modal-autofocus>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
    </div>, document.body,
  )
}
