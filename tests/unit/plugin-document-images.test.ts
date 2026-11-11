import { expect, test } from 'vitest'
import { documentImageSource } from '../../packages/modern-ui/src/plugin-documents/image-source.ts'

test('package documents preserve supported web images and reject non-image protocols', () => {
  for (const destination of [
    'https://example.test/image.png',
    'http://example.test/image.png',
    'blob:https://example.test/image-id',
    'data:image/svg+xml,%3Csvg%2F%3E',
    'data:image/png;base64,aGVsbG8=',
  ])
    expect(documentImageSource(destination, 'bundle:id', 'https://host.test/app/')).toBe(destination)
  for (const destination of ['javascript:alert(1)', 'file:///C:/private.png', 'data:text/html,hello', 'mailto:x@example.test']) {
    expect(documentImageSource(destination, 'bundle:id', 'https://host.test/app/')).toBeUndefined()
  }
  expect(documentImageSource('//cdn.test/image.png', 'bundle:id', 'https://host.test/app/')).toBe('https://cdn.test/image.png')
  expect(documentImageSource('//cdn.test/image.png', 'bundle:id', 'http://host.test/app/')).toBe('http://cdn.test/image.png')
  expect(documentImageSource('//cdn.test/image.png', 'bundle:id', 'dsh-app://app/')).toBe('https://cdn.test/image.png')
})

test('relative package paths retain their exact encoding and document ownership', () => {
  for (const base of ['https://host.test/app/', 'dsh-app://app/']) {
    const resolved = documentImageSource('../images/a b.png?width=2#one', 'bundle:a&b', base)
    if (resolved === undefined) throw new Error('Expected a package image URL')
    const url = new URL(resolved)
    expect(url.pathname).toBe(base.startsWith('https:') ? '/app/api/modern-ui/plugin-document-image' : '/api/modern-ui/plugin-document-image')
    expect(url.searchParams.get('document')).toBe('bundle:a&b')
    expect(url.searchParams.get('path')).toBe('../images/a b.png?width=2#one')
  }
})
