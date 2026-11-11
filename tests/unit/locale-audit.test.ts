// biome-ignore-all lint/performance/noDynamicNamespaceImportAccess: Check exported dictionaries in every locale.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import * as shared from '../../packages/modern-ui/src/vendor/shared/conversation-dictionaries.ts'
import * as chat from '../../packages/modern-ui/src/vendor/chat/client/locale.ts'
import * as workspace from '../../packages/modern-ui/src/vendor/workspace/client/locales.ts'
import * as translation from '../../packages/modern-ui/src/vendor/translation/client/locales.ts'
import * as model from '../../packages/modern-ui/src/vendor/model/client/locales.ts'
import * as intelligent from '../../packages/modern-ui/src/vendor/intelligent/client/locales.ts'
import * as conversation from '../../packages/modern-ui/src/vendor/conversation/client/locales.ts'
import { installLanguages } from '../../packages/modern-ui/src/languages.ts'
import languagePacks from '../../packages/modern-ui/src/languages.json'
import corrections from '../fixtures/locale-audit-corrections.json'

const languages = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const
const modules = { shared, chat, workspace, translation, model, intelligent }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const entries = (dictionary: Record<string, string>) => Object.entries(dictionary).sort(([a], [b]) => a.localeCompare(b, 'en'))
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort()

test('every changed dictionary restores its pinned original when only the reviewed changes are reversed', () => {
  for (const [name, module] of Object.entries(modules)) {
    const group = corrections.groups[name as keyof typeof corrections.groups]
    const changes = group.changes as Record<string, Record<string, { before: string | null; after: string }>>
    for (const language of languages) {
      const restored: Record<string, string> = { ...module[language] }
      for (const [key, change] of Object.entries(changes[language] ?? {})) {
        expect(restored[key], `${name}/${language}/${key}`).toBe(change.after)
        if (change.before === null) delete restored[key]
        else restored[key] = change.before
      }
      expect(Object.keys(restored)).toHaveLength(group.baseline[language].count)
      expect(hash(entries(restored)), `${name}/${language}`).toBe(group.baseline[language].hash)
    }
  }
})

test('all eight languages have complete keys and matching placeholders, including failed-send and chart fallback text', () => {
  for (const [name, module] of Object.entries({ ...modules, conversation })) {
    const keys = Object.keys(module.en).sort()
    for (const language of languages) {
      expect(Object.keys(module[language]).sort(), `${name}/${language}`).toEqual(keys)
      for (const key of keys)
        expect(placeholders((module[language] as Record<string, string>)[key] as string), `${name}/${language}/${key}`).toEqual(
          placeholders((module.en as Record<string, string>)[key] as string),
        )
    }
  }
  for (const language of languages) {
    expect(intelligent[language].chartRangeExceeded.length).toBeGreaterThan(20)
    expect(shared[language]['input.failedSend.attachments']).toContain('{count}')
  }
  expect(intelligent.en.chartRangeExceeded).toBe('The stacked total is outside the chart’s numeric range. The complete data is shown below.')
})

test('time units, weekdays, model terms and action labels retain their intended meanings', () => {
  const render = (text: string, key: string, value: number) => text.replaceAll('{' + key + '}', String(value))
  for (const n of [1, 2, 12]) {
    expect(render(workspace.pt['time.years'], 'n', n)).toBe(`${n} a`)
    expect(render(shared.es['detail.seconds'], 'count', n)).toBe(`${n} s`)
  }
  expect(chat.fr['message.retry.status']).toBe('{label} ({retry}/{maximum}) · {seconds} s')
  expect([workspace.ru['time.hours'], workspace.ru['time.days'], workspace.ru['time.months'], workspace.ru['time.years']]).toEqual([
    '{n} ч',
    '{n} дн.',
    '{n} мес.',
    '{n} г.',
  ])
  for (const [language, sunday] of Object.entries({ es: 'dom.', fr: 'dim.', de: 'So.', ru: 'вс', pt: 'dom.' })) {
    const dictionary = shared[language as keyof typeof shared] as Record<string, string>
    expect(dictionary['detail.weekday.7']).toBe(sunday)
    expect(dictionary['hint.plan']).toBe(dictionary['placeholder.plan'])
    expect(dictionary['hint.plan']).not.toBe(shared.en['hint.plan'])
    expect(dictionary['tool.title.bash']).toBe('Bash')
  }
  expect(chat.es['stats.dialog.llmTime']).toContain('LLM')
  expect(chat.ru['stats.dialog.llmTime']).toContain('LLM')
  expect(translation.pt.google).toBe('Google')
  expect(translation.pt.bing).toBe('Bing')
  expect(model.zh['effort.providerDefault']).toBe('默认')
  expect(chat.es['settings.transcript.verbose']).not.toBe(chat.es['settings.transcript.detailed'])
  expect(chat.de['settings.transcript.verbose']).not.toBe(chat.de['settings.transcript.detailed'])
})

test('the remaining language-pack data changes only explicitly reviewed legacy copies', () => {
  const restored = structuredClone(languagePacks)
  for (const change of corrections.languagePackChanges) {
    const row = restored.find(row => row.namespace === change.namespace)
    const dictionary = row?.dictionaries[change.language as keyof NonNullable<typeof row>['dictionaries']] as Record<string, string>
    expect(dictionary[change.key]).toBe(change.after)
    dictionary[change.key] = change.before
  }
  expect(hash(restored)).toBe(corrections.languagePacksBaselineHash)
  // Both namespaces are registered in every language by their owning module; a second copy here would collide.
  for (const namespace of ['conversation', 'fileDrag']) expect(languagePacks.some(row => row.namespace === namespace)).toBe(false)
  for (const namespace of ['chat', 'model', 'workspace']) expect(languagePacks.some(row => row.namespace === namespace)).toBe(true)
  for (const row of languagePacks)
    for (const language of ['ja', 'es', 'fr', 'de', 'ru', 'pt'] as const)
      expect(Object.values(row.dictionaries[language]).every(value => typeof value === 'string')).toBe(true)
})

interface OfficialLocaleRuntime {
  getLocale(): { locales: Array<{ id: string }> }
  addLanguage(input: { id: string; label: string; fallback: string }): () => void
  register(namespace: string, language: string | Record<string, Record<string, string>>, dictionary?: Record<string, string>): () => void
  setLocale(id: string): void
  bind(namespace: string): (key: string, parameters?: Record<string, string | number>) => string
  dicts: Map<string, Map<string, Record<string, string>>>
}
const require = createRequire(import.meta.url)
let LocaleRuntime!: new (ctx: { emit: () => void }, host: undefined, bootstrap: { languages: string[] }) => OfficialLocaleRuntime
// Load the installed, unmodified runtime. Primitive components are not rendered by these registry tests.
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
function localeContext(existing: string[] = ['zh', 'en']) {
  const locale = new LocaleRuntime({ emit() {} }, undefined, { languages: ['en'] }),
    cleanup: Array<() => void> = []
  for (const id of existing) if (id !== 'zh' && id !== 'en') locale.addLanguage({ id, label: id, fallback: 'en' })
  const ctx = {
    locale,
    effect: (callback: () => () => void) => {
      cleanup.push(callback())
    },
  }
  return {
    ctx,
    get ids() {
      return new Set(locale.getLocale().locales.map(row => row.id))
    },
    get dictionaries() {
      return new Map(
        [...locale.dicts].flatMap(([namespace, rows]) => [...rows].map(([language, dictionary]) => [namespace + '/' + language, dictionary] as const)),
      )
    },
    dispose: () => {
      for (const run of cleanup.splice(0).reverse()) run()
    },
  }
}
function registerConversation(fixture: ReturnType<typeof localeContext>) {
  // Execute the actual locale-registration segment, preserving its public zh/en adapter keys.
  const source = readFileSync(new URL('../../packages/modern-ui/src/vendor/conversation/client/apply.ts', import.meta.url), 'utf8')
  const start = source.indexOf("  ctx.effect(() => ctx.locale.register('conversation',")
  const end = source.indexOf('  const t = ctx.locale.bind(NS)', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  new Function('ctx', 'zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'NS', source.slice(start, end))(
    fixture.ctx,
    conversation.zh,
    conversation.en,
    conversation.ja,
    conversation.es,
    conversation.fr,
    conversation.de,
    conversation.ru,
    conversation.pt,
    conversation.NS,
  )
}
test('actual language installation and conversation registration retain public keys and fully revoke their own resources', () => {
  const fixture = localeContext()
  for (let attempt = 0; attempt < 2; attempt++) {
    installLanguages(fixture.ctx as unknown as Parameters<typeof installLanguages>[0])
    registerConversation(fixture)
    expect([...fixture.ids].sort()).toEqual([...languages].sort())
    for (const language of languages) {
      fixture.ctx.locale.setLocale(language)
      const dictionary = fixture.dictionaries.get('conversation/' + language) as Record<string, string>
      expect(fixture.ctx.locale.bind('conversation')('hint.plan')).toBe(shared[language]['hint.plan'])
      for (const [key, value] of Object.entries(shared[language])) expect(dictionary[key]).toBe(value)
      expect(fixture.dictionaries.get('modern-conversation/' + language)).toEqual(conversation[language])
    }
    for (const language of ['zh', 'en'])
      for (const key of ['session.tabVisibility', 'session.hideTab', 'session.showTab', 'settings.saveFailed'])
        expect(fixture.dictionaries.get('conversation/' + language)).toHaveProperty(key)
    fixture.dispose()
    expect([...fixture.ids]).toEqual(['zh', 'en'])
    expect(fixture.dictionaries.size).toBe(0)
    expect(fixture.ctx.locale.bind('conversation')('hint.plan')).toBe('hint.plan')
  }
})
test('an existing third-party language keeps its public dictionaries while Modern private translations remain owned and disposable', () => {
  const fixture = localeContext(['zh', 'en', 'fr']),
    foreign = { example: 'external language pack' }
  fixture.ctx.locale.register('conversation', 'fr', foreign)
  fixture.ctx.locale.register('chat', 'fr', foreign)
  installLanguages(fixture.ctx as unknown as Parameters<typeof installLanguages>[0])
  registerConversation(fixture)
  expect(fixture.dictionaries.get('conversation/fr')).toBe(foreign)
  expect(fixture.dictionaries.get('chat/fr')).toBe(foreign)
  expect(fixture.dictionaries.get('modern-conversation/fr')).toEqual(conversation.fr)
  fixture.dispose()
  expect([...fixture.ids]).toEqual(['zh', 'en', 'fr'])
  expect([...fixture.dictionaries.values()]).toEqual([foreign, foreign])
})
