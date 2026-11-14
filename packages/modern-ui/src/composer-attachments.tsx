import type { Context } from '@deepseek-ai/cordis'
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileTypeIcon, fileExtension } from './vendor/primitives/FileTypeIcon.tsx'
import { fileSizeText } from './vendor/primitives/file-size.ts'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconCloseFillRegular } from './vendor/primitives/icons/index.tsx'
import { ImageLightbox } from './vendor/primitives/ImageLightbox.tsx'
import { AttachmentFilename } from './attachment-filename.tsx'
import css from './composer-attachments.module.css'

/** Presentation of the public Composer attachment contract; upload ownership stays with the Host. */
export function ComposerAttachments({
  attachments,
  uploads,
  canAcceptDrop,
  onAddFiles,
  onRemoveAttachment,
  onRetryFile,
  dropLimits,
  t,
  imageZoomT,
}: ComposerAttachmentsProps & { imageZoomT: TranslateNS<'modern-chat'> }) {
  const rail = useRef<HTMLDivElement>(null)
  const count = useRef(attachments.length)
  const dragDepth = useRef(0)
  const [edges, setEdges] = useState({ left: false, right: false })
  const [dragging, setDragging] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const preview = attachments.find(item => item.id === previewId)
  const hasAttachments = attachments.length > 0
  useEffect(() => {
    if (previewId !== null && !preview) setPreviewId(null)
  }, [previewId, preview])
  const refresh = useCallback(() => {
    const element = rail.current
    if (!element) return
    const next = { left: element.scrollLeft > 1, right: element.scrollWidth - element.clientWidth - element.scrollLeft > 1 }
    setEdges(previous => (previous.left === next.left && previous.right === next.right ? previous : next))
  }, [])

  useLayoutEffect(() => {
    if (rail.current && attachments.length > count.current) rail.current.scrollLeft = rail.current.scrollWidth
    count.current = attachments.length
    refresh()
  }, [attachments.length, refresh])
  useEffect(() => {
    if (!hasAttachments) return
    const element = rail.current
    if (!element) return
    const observer = new ResizeObserver(refresh)
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1
      element.scrollBy({ left: event.deltaX * unit || Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * unit, 60) })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      element.removeEventListener('wheel', wheel)
    }
  }, [hasAttachments, refresh])

  useEffect(() => {
    const handle = (event: DragEvent) => {
      const transfer = event.dataTransfer
      if (!transfer?.types.includes('Files')) return
      event.preventDefault()
      transfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
      if (event.type === 'dragenter') setDragging(++dragDepth.current > 0)
      if (event.type === 'dragleave') {
        const outside =
          (event.target === document.body || event.target === document.documentElement) &&
          (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= innerWidth || event.clientY >= innerHeight)
        dragDepth.current = outside ? 0 : Math.max(0, dragDepth.current - 1)
        setDragging(dragDepth.current > 0)
      }
      if (event.type !== 'drop') return
      dragDepth.current = 0
      setDragging(false)
      if (!canAcceptDrop) return
      const files = Array.from(transfer.files)
      const directories = new Set<File>()
      let index = 0
      for (const item of transfer.items) {
        if (item.kind !== 'file') continue
        const file = files[index++]
        if (file && item.webkitGetAsEntry?.()?.isDirectory) directories.add(file)
      }
      onAddFiles(files, directories)
    }
    const reset = () => {
      dragDepth.current = 0
      setDragging(false)
    }
    const events = ['dragenter', 'dragleave', 'dragover', 'drop'] as const
    for (const event of events) document.addEventListener(event, handle)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => {
      for (const event of events) document.removeEventListener(event, handle)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('blur', reset)
    }
  }, [canAcceptDrop, onAddFiles])

  function page(direction: number) {
    const element = rail.current
    element?.scrollBy({
      left: direction * Math.max(element.clientWidth - 64, 200),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }
  return (
    <>
      {dragging &&
        createPortal(
          <div className={css.drop} role="status">
            <div>{t(canAcceptDrop ? 'attachment.dropTitle' : 'attachment.dropBlocked')}</div>
            {canAcceptDrop && dropLimits && <div className={css.dropDescription}>{t('attachment.dropDesc', dropLimits)}</div>}
          </div>,
          document.body,
        )}
      {attachments.length > 0 && (
        <div className={css.root} data-composer-attachments>
          {edges.left && (
            <button type="button" className={`${css.arrow} ${css.left}`} aria-label={t('attachment.scrollLeft')} onClick={() => page(-1)}>
              <IconChevronLeftOutlineRegular />
            </button>
          )}
          {/* biome-ignore lint/a11y/useSemanticElements: This attachment group includes images and action buttons, not form fields. */}
          <div ref={rail} className={css.rail} role="group" aria-label={t('attachment.pending')} onScroll={refresh}>
            {attachments.map(attachment => {
              const name = attachment.file.name
              const remove = (
                <button
                  type="button"
                  className={css.remove}
                  aria-label={t(attachment.kind === 'file' ? 'file.remove' : 'image.remove', { name })}
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <IconCloseFillRegular size={12} />
                </button>
              )
              if (attachment.kind === 'image')
                return (
                  <div key={attachment.id} className={css.image}>
                    <button type="button" className={css.thumbnail} title={t('image.openOriginal')} onClick={() => setPreviewId(attachment.id)}>
                      <img src={attachment.previewUrl} alt={name || t('image.pending')} />
                    </button>
                    {remove}
                  </div>
                )
              const upload = uploads[attachment.id]
              const status = upload?.status ?? 'uploading'
              const meta =
                status === 'ready'
                  ? [fileExtension(name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.size)].filter(Boolean).join(' ')
                  : t(status === 'error' ? 'file.uploadFailed' : 'file.uploading')
              const content = (
                <>
                  <AttachmentFilename className={css.name} name={name || t('file.label')} />
                  <span className={css.meta}>{meta}</span>
                </>
              )
              return (
                <div key={attachment.id} className={css.file} data-state={status} title={name}>
                  <span className={css.icon} aria-hidden>
                    {status === 'uploading' ? <span className={css.spinner} /> : <FileTypeIcon path={name} />}
                  </span>
                  {status === 'error' ? (
                    <button
                      type="button"
                      className={`${css.body} ${css.retry}`}
                      aria-label={t('file.retry', { name })}
                      onClick={() => onRetryFile(attachment.id)}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className={css.body}>{content}</span>
                  )}
                  {remove}
                  {status === 'uploading' && (
                    <span className={css.track} aria-hidden>
                      <span
                        className={css.progress}
                        style={
                          upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0
                            ? { width: `${Math.max(0, Math.min(1, upload.loaded / upload.total)) * 100}%` }
                            : undefined
                        }
                      />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {edges.right && (
            <button type="button" className={`${css.arrow} ${css.right}`} aria-label={t('attachment.scrollRight')} onClick={() => page(1)}>
              <IconChevronRightOutlineRegular />
            </button>
          )}
        </div>
      )}
      {preview?.kind === 'image' && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          onClose={() => setPreviewId(null)}
          labels={{
            dialog: t('image.preview'),
            close: t('image.closePreview'),
            zoomIn: imageZoomT('image.zoomIn'),
            zoomOut: imageZoomT('image.zoomOut'),
            resetZoom: imageZoomT('image.resetZoom'),
            zoomHelp: imageZoomT('image.zoomHelp'),
          }}
        />
      )}
    </>
  )
}

export function installComposerAttachments(ctx: Context): void {
  ctx.inject(['slots', 'locale'], scope => {
    scope.slots.inject('conversation.input.attachments', () =>
      scope.slots.register(
        { name: 'conversation.input.attachments', priority: -200, locale: 'conversation', inject: () => ({ imageZoomT: scope.locale.bind('modern-chat') }) },
        ComposerAttachments,
      ),
    )
  })
}
