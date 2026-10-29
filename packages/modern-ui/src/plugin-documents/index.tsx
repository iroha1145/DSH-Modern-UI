import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { DiscoverFace as OfficialDiscoverFace } from '@deepseek-ai/dsh-client-ui-plugin-market/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { DiscoverSection } from '../vendor/plugin-market/DiscoverSection.tsx'
import { PluginDocument } from './PluginDocument.tsx'
import { dictionaries } from './locales.ts'
import { watchPresentation } from '../presentation-shadow.ts'
import { installDiscoverTabNavigation } from './discover-navigation.ts'

type DocumentLocaleFace = { hooks: { documentLocale: ObservableSnapshot<LocaleSnapshot> } }
function BundleDocument({ subject, useDocumentLocale, t }: PropsRuntime<'plugins.detail.section'>
  & PropsLocale<'modern-plugin-documents'> & InjectFace<DocumentLocaleFace>) {
  const language = useDocumentLocale(snapshot => snapshot.active)
  return subject.kind === 'bundle'
    ? <PluginDocument target={{ kind: 'bundle', name: subject.pkg.name, version: subject.pkg.version }} language={language} t={t} />
    : null
}

/** Keep the official discovery controller and installer, replacing only its document-capable view. */
export function installPluginDocuments(ctx: Context): void {
  ctx.effect(() => installDiscoverTabNavigation(document))
  ctx.effect(() => ctx.locale.register('modern-plugin-documents', dictionaries))
  const translateDocument = ctx.locale.bind('modern-plugin-documents')
  ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
    name: 'plugins.detail.section', id: 'modern-ui-readme', locale: 'modern-plugin-documents',
    inject: (): DocumentLocaleFace => ({ hooks: { documentLocale: {
      getSnapshot: () => ctx.locale.getLocale(), subscribe: listener => ctx.locale.subscribe(listener),
    } } }),
  }, BundleDocument))
  watchPresentation(ctx, 'plugins.tab', {
    source: entry => entry.options.id === 'discover' && entry.locale === 'pluginMarket' && (entry.options.priority ?? 0) === 0,
    register(entry) {
      // `plugins.tab` publishes this exact face from ui-plugin-market's public client contract.
      const inject = entry.inject as (() => OfficialDiscoverFace) | undefined
      if (inject === undefined) throw new Error('Official Discover tab has no controller face')
      return ctx.slots.register({ name: 'plugins.tab', id: 'discover', priority: -100,
        order: entry.options.order, label: entry.options.label, locale: 'pluginMarket',
        inject: () => ({ ...inject(), translateDocument }),
      }, DiscoverSection)
    },
  })
}
