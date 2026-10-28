// Derived from deepseek-ai/deepseek-harness (MIT), packages/client/ui-file-drag/src/client/transfers.ts.
// Browser transport only: rc.4 exposes no desktop file preparation bridge.
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { FileDragSource, PreparedFileDrag } from '../primitives/file-drag-actions.ts'

export const FILE_DRAG_TOKEN_TYPE = 'application/x-dsh-file'

const IMAGE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg', 'jpe'], 'image/gif': ['gif'],
  'image/webp': ['webp'], 'image/avif': ['avif'], 'image/svg+xml': ['svg'],
  'image/bmp': ['bmp'], 'image/tiff': ['tif', 'tiff'], 'image/x-icon': ['ico'],
}

/** Image-only adaptation of the legacy file-drag naming helper, with no runtime MIME dependency. */
export function imageFileName(name: string | undefined, mediaType: string, outputExtension?: string): string {
  let clean = (name ?? 'image').replace(/[<>:"/\\|?*\x00-\x1f]/gu, '_').replace(/^[. ]+|[. ]+$/gu, '') || 'image'
  const dot = clean.lastIndexOf('.')
  const suffix = dot < 0 ? '' : clean.slice(dot + 1)
  const compatible = IMAGE_EXTENSIONS[mediaType.replace(/;.*$/su, '').trim().toLowerCase()]
  const explicit = outputExtension?.replace(/^\./u, '').replace(/[^a-z\d_-]/giu, '')
  const extension = explicit || (compatible !== undefined && !compatible.includes(suffix.toLowerCase()) ? compatible[0] : suffix)
  if (extension) clean = `${dot < 0 ? clean : clean.slice(0, dot)}.${extension}`
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(clean)) clean = `_${clean}`
  const finalDot = clean.lastIndexOf('.')
  const encoder = new TextEncoder()
  const truncate = (value: string, bytes: number): string => {
    let result = ''
    for (const character of value) {
      const length = encoder.encode(character).length
      if (length > bytes) break
      result += character
      bytes -= length
    }
    return result
  }
  const tail = truncate(finalDot < 0 ? '' : clean.slice(finalDot), 32)
  return `${truncate(finalDot < 0 ? clean : clean.slice(0, finalDot), 255 - encoder.encode(tail).length)}${tail}`
}

/** One activation owns original bytes, browser download URLs, and its unforgeable active token. */
export class FileTransfers {
  private active: { token: string; file: File; end: () => void } | undefined
  private readonly prepared = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private disposed = false

  read(transfer: DataTransfer): File | undefined {
    return this.active?.token === transfer.getData(FILE_DRAG_TOKEN_TYPE) ? this.active.file : undefined
  }

  async prepare(source: FileDragSource, signal: AbortSignal): Promise<PreparedFileDrag> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    signal.throwIfAborted()
    let content: Blob
    if (source.kind === 'url') {
      const response = await fetch(source.url, { signal, referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error('Image read failed')
      content = await response.blob()
    } else content = source.blob
    signal.throwIfAborted()
    const mediaType = source.mediaType || content.type
    const file = new File([content], imageFileName(source.name, mediaType, source.outputExtension), { type: mediaType })
    return this.browser(file)
  }

  private browser(file: File): PreparedFileDrag {
    const url = URL.createObjectURL(file)
    let released = false
    let started = false
    const releaseUrl = (): void => { this.prepared.delete(release); URL.revokeObjectURL(url) }
    const release = (): void => { released = true; if (!started) releaseUrl() }
    this.prepared.add(release)
    return {
      start: (transfer, source) => {
        if (released || this.disposed) return false
        this.active?.end()
        started = true
        const token = randomUUID()
        let ended = false
        const end = (): void => {
          if (ended) return
          ended = true
          source.removeEventListener('dragend', end)
          window.removeEventListener('drop', dropped)
          this.active = undefined
          started = false
          if (released) releaseUrl()
        }
        const dropped = (): void => { queueMicrotask(end) }
        this.active = { token, file, end }
        source.addEventListener('dragend', end, { once: true })
        window.addEventListener('drop', dropped, { once: true })
        transfer.items.clear()
        transfer.effectAllowed = 'copy'
        transfer.setData(FILE_DRAG_TOKEN_TYPE, token)
        transfer.setData('DownloadURL', `${file.type || 'application/octet-stream'}:${file.name}:${url}`)
        return true
      },
      release,
    }
  }

  dispose(): void {
    this.disposed = true
    this.lifetime.abort(new Error('File transfers disposed'))
    this.active?.end()
    for (const release of this.prepared) release()
  }
}
