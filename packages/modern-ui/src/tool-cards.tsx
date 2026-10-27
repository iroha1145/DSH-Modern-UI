import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { readImageToolview } from './vendor/tool/client/tool/toolviews/read-image-row.tsx'
import { readToolview } from './vendor/tool/client/tool/toolviews/read-row.tsx'
import { fileMutationToolview } from './vendor/tool/client/tool/toolviews/file-mutation-row.tsx'
import { searchToolview } from './vendor/tool/client/tool/toolviews/search-row.tsx'
import { webToolview } from './vendor/tool/client/tool/toolviews/web-row.tsx'
import { todoToolview } from './vendor/tool/client/tool/toolviews/todo-row.tsx'
import { detailsToolview } from './vendor/tool/client/tool/toolviews/details-row.tsx'
import { askQuestionToolview } from './vendor/tool/client/tool/toolviews/ask-question-row.tsx'
import { GenericToolCard } from './vendor/tool/client/tool/toolviews/GenericToolCard.tsx'
import './schedule-styles.css'
import * as chatLocale from './vendor/chat/client/locale.ts'
import * as locale from './vendor/tool/client/dictionaries.ts'

/** Shade public atomic presentation seats; the official tool tree and providers retain ownership. */
export function installToolCards(ctx: Context): void {
  const dictionary = (language: 'zh' | 'en' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt') => ({
    ...locale[language],
    'codeBlock.collapse': chatLocale[language]['codeBlock.collapse'],
    'codeBlock.expand': chatLocale[language]['codeBlock.expand'],
  })
  const dictionaries = {
    zh: dictionary('zh'), en: dictionary('en'), ja: dictionary('ja'), es: dictionary('es'),
    fr: dictionary('fr'), de: dictionary('de'), ru: dictionary('ru'), pt: dictionary('pt'),
  }
  ctx.effect(() => ctx.locale.register('modern-tool', dictionaries))
  ctx.inject(['uiConversation'], scope => {
    scope.plugin(todoToolview)
  })
  for (const view of [readToolview, readImageToolview, fileMutationToolview, searchToolview, webToolview, detailsToolview, askQuestionToolview]) {
    ctx.plugin(view)
  }
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of ['run_code', 'cordis_package_inspect', 'cordis_runtime_inspect', 'cordis_run', 'cordis_stop', 'cordis_undefine']) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, priority: -100, locale: 'modern-tool' }, GenericToolCard)
    }
  })
}

