import type { Context } from '@deepseek-ai/cordis'
import translations from './languages.json'

const languages = [
  { id: 'ja', label: '日本語' }, { id: 'es', label: 'Español' }, { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' }, { id: 'ru', label: 'Русский' }, { id: 'pt', label: 'Português' },
] as const

/** Language packs use the public catalog API and dictionary registrations, preserving the official locale owner. */
export function installLanguages(ctx: Context): void {
  const existing = new Set(ctx.locale.getLocale().locales.map(locale => locale.id))
  for (const { id, label } of languages) {
    // A previously installed language pack remains the owner of its shared translations.
    if (existing.has(id)) continue
    ctx.effect(() => ctx.locale.addLanguage({ id, label, fallback: 'en' }))
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
