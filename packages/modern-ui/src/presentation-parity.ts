/** Replace selected presentation leaves while official controllers and carriers remain live. */
import type { Context } from '@deepseek-ai/cordis'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingQuestion } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { AgentPresetSectionInjected } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { watchPresentation } from './presentation-shadow.ts'
import { QuestionPresentation } from './vendor/questions/QuestionFlow.tsx'
import type { QuestionDraftStore } from './vendor/questions/draft-types.ts'
import { AgentPresetSection } from './vendor/agent-preset/AgentPresetSection.tsx'

export type FoldLabels = () => { collapseLabel: string; expandLabel: string }
export type TextDisclosureLabels = () => { collapse: string; expand: string }

const dictionaries = {
  zh: { collapse: '折叠代码', expand: '展开代码', textCollapse: '收起', textExpand: '展开' },
  en: { collapse: 'Collapse code', expand: 'Expand code', textCollapse: 'Collapse', textExpand: 'Expand' },
  ja: { collapse: 'コードを折りたたむ', expand: 'コードを展開', textCollapse: '折りたたむ', textExpand: '展開' },
  es: { collapse: 'Contraer código', expand: 'Expandir código', textCollapse: 'Contraer', textExpand: 'Expandir' },
  fr: { collapse: 'Replier le code', expand: 'Déplier le code', textCollapse: 'Réduire', textExpand: 'Développer' },
  de: { collapse: 'Code einklappen', expand: 'Code ausklappen', textCollapse: 'Einklappen', textExpand: 'Ausklappen' },
  ru: { collapse: 'Свернуть код', expand: 'Развернуть код', textCollapse: 'Свернуть', textExpand: 'Развернуть' },
  pt: { collapse: 'Recolher código', expand: 'Expandir código', textCollapse: 'Recolher', textExpand: 'Expandir' },
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'modern-presentation': keyof typeof dictionaries.en }
}

type QuestionFace = {
  keyedHooks: { questionCard: (key: string) => PendingQuestion | undefined }
}

/** Add code disclosure to ordinary questions and the shipped preset guide. */
export function installPresentationParity(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('modern-presentation', dictionaries))
  const t = ctx.locale.bind('modern-presentation')
  const foldLabels: FoldLabels = () => ({ collapseLabel: t('collapse'), expandLabel: t('expand') })
  const textLabels: TextDisclosureLabels = () => ({ collapse: t('textCollapse'), expand: t('textExpand') })

  watchPresentation(ctx, 'conversation.composer', {
    source: entry => entry.locale === 'question'
      && (entry.options.priority ?? 0) === 0
      && entry.children?.['conversation.plan-review.actions'] !== undefined,
    register: source => {
      if (source.select === undefined || source.inject === undefined || source.store === undefined) {
        throw new Error('The official question presentation no longer supplies its declared selector, store and card face')
      }
      // StoredEntry erases the types; the official public QuestionComposerProps contract supplies them.
      const select = source.select as (owner: OwnerOf<'conversation.composer'>) => PendingQuestion | null
      const inject = source.inject as () => QuestionFace
      return ctx.slots.register({
        name: 'conversation.composer', priority: -100, locale: 'question',
        store: source.store as QuestionDraftStore,
        select: owner => {
          const matched = select(owner)
          return matched?.kind === 'question' ? matched : null
        },
        inject: () => ({ ...inject(), foldLabels, textLabels }),
      }, QuestionPresentation)
    },
  })

  watchPresentation(ctx, 'settings.section', {
    source: entry => entry.options.id === 'agent-presets'
      && entry.locale === 'settings.agentPreset'
      && (entry.options.priority ?? 0) === 0,
    register: source => {
      if (source.inject === undefined) throw new Error('The official preset section no longer supplies its declared settings face')
      const inject = source.inject as unknown as () => AgentPresetSectionInjected
      return ctx.slots.register({
        name: 'settings.section', id: 'agent-presets', priority: -100,
        order: source.options.order, label: source.options.label, locale: 'settings.agentPreset',
        inject: () => ({ ...inject(), foldLabels }),
      }, AgentPresetSection)
    },
  })
}
