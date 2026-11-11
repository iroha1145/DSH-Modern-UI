const LANGUAGES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const

/** Select the supported dictionaries without registering other module exports. */
export const dictionaries = <D extends Record<string, string>>(source: Record<(typeof LANGUAGES)[number], D>) => ({
  zh: source.zh,
  en: source.en,
  ja: source.ja,
  es: source.es,
  fr: source.fr,
  de: source.de,
  ru: source.ru,
  pt: source.pt,
})
