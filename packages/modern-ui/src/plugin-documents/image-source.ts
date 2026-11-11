/** Resolve package-relative images without turning web image addresses into package paths. */
export function documentImageSource(destination: string, documentId: string, baseURI: string): string | undefined {
  const value = destination.trim()
  if (value.startsWith('//')) {
    const protocol = new URL(baseURI).protocol === 'http:' ? 'http:' : 'https:'
    try {
      return new URL(protocol + value).href
    } catch {
      return undefined
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const protocol = new URL(value).protocol
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:') return value
      if (protocol === 'data:' && /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(value)) return value
    } catch {
      /* A malformed address names no image. */
    }
    return undefined
  }
  const url = new URL('api/modern-ui/plugin-document-image', baseURI)
  url.searchParams.set('document', documentId)
  url.searchParams.set('path', destination)
  return url.href
}
