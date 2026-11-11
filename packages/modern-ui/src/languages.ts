import type { Context } from '@deepseek-ai/cordis'
import translations from './languages.json'
import { ja, es, fr, de, ru, pt } from './vendor/shared/conversation-dictionaries.ts'

const languages = [
  { id: 'ja', label: '日本語', conversation: ja },
  { id: 'es', label: 'Español', conversation: es },
  { id: 'fr', label: 'Français', conversation: fr },
  { id: 'de', label: 'Deutsch', conversation: de },
  { id: 'ru', label: 'Русский', conversation: ru },
  { id: 'pt', label: 'Português', conversation: pt },
] as const

/** Language packs use the public catalog API and dictionary registrations, preserving the official locale owner. */
export function installLanguages(ctx: Context): void {
  const existing = new Set(ctx.locale.getLocale().locales.map(locale => locale.id))
  for (const { id, label, conversation } of languages) {
    // A previously installed language pack remains the owner of its shared translations.
    if (existing.has(id)) continue
    ctx.effect(() => ctx.locale.addLanguage({ id, label, fallback: 'en' }))
    ctx.effect(() => ctx.locale.register('conversation', id, conversation))
    for (const row of translations) {
      const dictionary: Record<string, string> = {}
      for (const [key, value] of Object.entries(row.dictionaries[id])) {
        if (typeof value !== 'string') throw new TypeError(`Invalid ${id} translation in ${row.namespace}: ${key}`)
        dictionary[key] = value
      }
      ctx.effect(() => ctx.locale.register(row.namespace, id, dictionary))
    }
  }
}
