import { afterEach, expect, test, vi } from 'vitest'
import { searchImages } from '../../packages/modern-ui/src/vendor/openui/components/image-search.ts'

afterEach(() => vi.unstubAllGlobals())

test('a query ending on a surrogate pair reaches the article lookup intact', async () => {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url)
    return { ok: true, status: 200, json: async () => ({}) }
  })
  await searchImages('A'.repeat(199) + '😀 suffix')
  const summary = urls.find(url => url.includes('/page/summary/'))
  expect(summary).toBeDefined()
  expect(decodeURIComponent(summary?.split('/').at(-1) ?? '')).toBe('A'.repeat(199) + '😀')
})

test('malformed filenames do not discard good article results and search results stay on Wikimedia', async () => {
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.includes('/summary/')
        ? { thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/photo%zz.jpg' } }
        : url.includes('/media-list/')
          ? {
              items: [
                { type: 'image', srcset: [{ src: 'https://upload.wikimedia.org/wikipedia/commons/second.jpg' }] },
                { type: 'image', srcset: [{ src: 'https://upload.wikimedia.org.attacker.invalid/third.jpg' }] },
              ],
            }
          : {},
  }))
  expect(await searchImages('dedupe malformed filename test')).toEqual([
    'https://upload.wikimedia.org/wikipedia/commons/photo%zz.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/second.jpg',
  ])
})
