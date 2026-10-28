/**
 * Right-sidebar document previews the plugin draws through its own
 * MarkdownText (code fences fold): the Markdown file preview body and the plan
 * preview body. Both shadow the official keyed entries under the same key at
 * priority -100; the official packages keep their metadata, tab types,
 * resource providers and titles.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from './contracts.ts'
import * as markdownLocale from './vendor/documentpreview/client/markdown/locales.ts'
import * as planLocale from './vendor/plan/client/locales.ts'
import { registerMarkdownBody } from './vendor/documentpreview/client/markdown/index.ts'
import { registerPlanPreview } from './vendor/plan/client/index.ts'

export { MARKDOWN_BODY_ID } from './vendor/documentpreview/client/markdown/index.ts'
export { PLAN_PREVIEW_ID } from './vendor/plan/client/index.ts'

const LANGUAGES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] as const
const dictionaries = <D extends Record<string, string>>(source: Record<typeof LANGUAGES[number], D>) => ({
  zh: source.zh, en: source.en, ja: source.ja, es: source.es, fr: source.fr, de: source.de, ru: source.ru, pt: source.pt,
})

/**
 * Register the two preview namespaces and their shadowing entries.
 * @param ctx - a client context with `slots` and `locale`.
 */
export function installPreviews(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('modern-document-markdown', dictionaries(markdownLocale)), 'modern-ui: markdown preview dictionaries')
  ctx.effect(() => ctx.locale.register('modern-plan', dictionaries(planLocale)), 'modern-ui: plan preview dictionaries')
  registerMarkdownBody(ctx)
  registerPlanPreview(ctx)
}
