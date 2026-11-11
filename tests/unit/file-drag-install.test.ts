import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installLanguages } from '../../packages/modern-ui/src/languages.ts'
import { installFileDrag } from '../../packages/modern-ui/src/file-drag.ts'
import { ja } from '../../packages/modern-ui/src/vendor/file-drag/locales.ts'

// The two React views need the browser build; everything that registers is the real source.
vi.mock('../../packages/modern-ui/src/vendor/file-drag/MessageImage.tsx', () => ({ ImageGallery: () => null }))
vi.mock('../../packages/modern-ui/src/vendor/file-drag/feedback.tsx', () => ({ FileDragFeedback: () => null }))

interface OfficialLocaleRuntime {
  getLocale(): { locales: Array<{ id: string }> }
  addLanguage(input: { id: string; label: string; fallback: string }): () => void
  register(namespace: string, language: string | Record<string, Record<string, string>>, dictionary?: Record<string, string>): () => void
  setLocale(id: string): void
  bind(namespace: string): (key: string) => string
  dicts: Map<string, Map<string, Record<string, string>>>
}
const require = createRequire(import.meta.url)
let LocaleRuntime!: new (ctx: { emit: () => void }, host: undefined, bootstrap: { languages: string[] }) => OfficialLocaleRuntime
// The installed, unmodified official runtime: it rejects a second dictionary for one namespace and language.
runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-locale/client'), 'utf8'), {
  window: {
    __ModuleLoader__: {
      load: (module: { factory: (dependency: (name: string) => unknown) => { LocaleRuntime: typeof LocaleRuntime } }) => {
        LocaleRuntime = module.factory(name => (name === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(name))).LocaleRuntime
      },
    },
  },
  console,
})

const IMAGE_SLOTS = [
  'factory:modern.images.content',
  'conversation.chat.message.images',
  'conversation.chat.user.images',
  'conversation.trajectory.images',
  'tool.call.images',
]
const official = '@deepseek-ai/dsh-client-ui-file-drag'
type Actions = { prepare: (source: unknown, signal: AbortSignal) => Promise<unknown>; reportFailure: () => void }

/** A real cordis root with the official locale runtime, a recording slot registry and the Host boot graph. */
function host(plugins: string[]) {
  const ctx = new Context() as unknown as Context & { provide(name: string, value?: unknown): unknown; get(name: string): unknown }
  const locale = new LocaleRuntime({ emit() {} }, undefined, { languages: ['en'] })
  const slots: string[] = []
  const injected: Array<() => { fileDrag: Actions }> = []
  ctx.provide('locale', locale)
  ctx.provide('slots', {
    registerFactory: (entry: { name: string; inject: () => { fileDrag: Actions } }) => {
      slots.push('factory:' + entry.name)
      injected.push(entry.inject)
      return () => {}
    },
    register: (entry: { name: string; id?: string }) => {
      slots.push(entry.id ?? entry.name)
      return () => {}
    },
    inject: (_name: string, callback: () => unknown) => {
      callback()
      return () => {}
    },
  })
  ctx.provide('modules', { manifest: { rev: 'test', modules: [], plugins: plugins.map(id => ({ id, inject: [], immediately: false })) } })
  const fibers: Array<PromiseLike<unknown> & { state: number }> = []
  const inject = ctx.inject.bind(ctx)
  ctx.inject = ((deps: Parameters<typeof inject>[0], callback: Parameters<typeof inject>[1]) => {
    const fiber = inject(deps, callback)
    fibers.push(fiber as unknown as PromiseLike<unknown> & { state: number })
    return fiber
  }) as typeof ctx.inject
  const settle = async () => {
    const failures: string[] = []
    for (const fiber of fibers)
      await Promise.resolve(fiber).then(
        () => {},
        (error: unknown) => failures.push(String(error)),
      )
    return failures
  }
  const actions = (): Actions => {
    const [inject] = injected
    if (inject === undefined) throw new Error('modern.images.content was not registered')
    return inject().fileDrag
  }
  return { ctx, locale, slots, actions, settle }
}

/** What the official plugin of 0.2.2 declares: the public service, dictionaries in every language, the overlay. */
function officialFileDrag(fixture: ReturnType<typeof host>) {
  const calls: string[] = []
  const dictionary = { failed: 'official' }
  fixture.locale.register('fileDrag', {
    zh: dictionary,
    en: dictionary,
    ja: dictionary,
    es: dictionary,
    fr: dictionary,
    de: dictionary,
    ru: dictionary,
    pt: dictionary,
  })
  fixture.ctx.provide('fileDrag', {
    actions: {
      prepare: async () => {
        calls.push('prepare')
        return { start: () => true, release() {} }
      },
      reportFailure: () => {
        calls.push('reportFailure')
      },
    },
    read: () => undefined,
  })
  return calls
}

test('a Host without the official plugin (0.2.1) gets the transfer service, its dictionaries, the image slots and the overlay', async () => {
  const fixture = host([])
  installLanguages(fixture.ctx)
  installFileDrag(fixture.ctx)
  expect(await fixture.settle()).toEqual([])
  expect(fixture.ctx.get('fileDrag')).toBeDefined()
  expect(fixture.slots).toEqual(['file-drag.feedback', ...IMAGE_SLOTS])
  expect([...(fixture.locale.dicts.get('fileDrag')?.keys() ?? [])].sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  fixture.locale.setLocale('ja')
  expect(fixture.locale.bind('fileDrag')('failed')).toBe(ja.failed)
})

test('a Host that composes the official plugin (0.2.2) keeps its service, dictionaries and overlay; Modern adds only the image slots', async () => {
  for (const officialFirst of [true, false]) {
    const fixture = host([official])
    installLanguages(fixture.ctx)
    let calls: string[] = []
    if (officialFirst) calls = officialFileDrag(fixture)
    installFileDrag(fixture.ctx)
    expect(await fixture.settle()).toEqual([])
    // Loading after Modern UI must not find the names taken either.
    if (!officialFirst) calls = officialFileDrag(fixture)
    expect(fixture.slots).toEqual(IMAGE_SLOTS)
    expect(fixture.locale.bind('fileDrag')('failed')).toBe('official')
    const fileDrag = fixture.actions()
    await fileDrag.prepare({ kind: 'url', url: 'blob:image', mediaType: 'image/png' }, new AbortController().signal)
    fileDrag.reportFailure()
    expect(calls).toEqual(['prepare', 'reportFailure'])
  }
})

test('the image slots stay registered when another plugin already owns the service on an older Host', async () => {
  const fixture = host([])
  const calls = officialFileDrag(fixture)
  installFileDrag(fixture.ctx)
  expect(await fixture.settle()).toEqual([])
  expect(fixture.slots).toEqual(IMAGE_SLOTS)
  fixture.actions().reportFailure()
  expect(calls).toEqual(['reportFailure'])
})
