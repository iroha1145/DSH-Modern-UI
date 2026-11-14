import { fileExtension } from './vendor/primitives/FileTypeIcon.tsx'
import { useLayoutEffect, useRef } from 'react'
import css from './attachment-filename.module.css'

/** Keep a filename's final extension visible while retaining its full selectable text. */
export function AttachmentFilename({ name, className }: { name: string; className?: string }) {
  const extension = fileExtension(name)
  const dot = name.length - extension.length - 1
  // A dotfile without another dot is a basename, not an extension-only filename.
  const split = extension !== '' && dot > Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1
  const ref = useRef<HTMLSpanElement>(null)
  const suffixRef = useRef<HTMLSpanElement>(null)
  // Inline spans preserve exact copied text; flex/grid insert a newline between the two parts in Chromium.
  // Measure the real suffix instead of estimating character widths, including when fonts or the card resize.
  useLayoutEffect(() => {
    const element = ref.current
    const suffix = split ? suffixRef.current : null
    if (!element) return
    const measure = () => element.style.setProperty('--filename-extension-width', `${suffix?.getBoundingClientRect().width ?? 0}px`)
    measure()
    if (!suffix || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(suffix)
    return () => observer.disconnect()
  }, [split])
  return (
    <span ref={ref} className={`${css.name}${className ? ` ${className}` : ''}`} title={name}>
      <span className={css.prefix}>{split ? name.slice(0, dot) : name}</span>
      {split && (
        <span ref={suffixRef} className={css.extension}>
          {name.slice(dot)}
        </span>
      )}
    </span>
  )
}
