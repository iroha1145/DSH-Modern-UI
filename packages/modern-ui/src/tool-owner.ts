// Adapted from deepseek-ai/deepseek-harness ui-tool/src/client/apply.ts (MIT), checked against rc.4 lib/client.js.
/** Own the Tool UI subtree; tool execution and all Host services remain official. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from './file-drag.ts'
import { ToolCallTree } from './vendor/tool/client/tool/ToolCallTree.tsx'
import { CONVERSATION_NS as NS } from './vendor/tool/client/locale.ts'
import * as locale from './vendor/tool/client/dictionaries.ts'
import * as chatLocale from './vendor/chat/client/locale.ts'
import { bashToolviewSample } from './vendor/tool/client/tool/toolviews/bash-sample.tsx'
import { readToolview } from './vendor/tool/client/tool/toolviews/read-row.tsx'
import { readImageToolview } from './vendor/tool/client/tool/toolviews/read-image-row.tsx'
import { fileMutationToolview } from './vendor/tool/client/tool/toolviews/file-mutation-row.tsx'
import { searchToolview } from './vendor/tool/client/tool/toolviews/search-row.tsx'
import { webToolview } from './vendor/tool/client/tool/toolviews/web-row.tsx'
import { todoToolview } from './vendor/tool/client/tool/toolviews/todo-row.tsx'
import { detailsToolview } from './vendor/tool/client/tool/toolviews/details-row.tsx'
import { askQuestionToolview } from './vendor/tool/client/tool/toolviews/ask-question-row.tsx'
import './schedule-styles.css'

export const inject = ['slots', 'remote', 'locale']

export function apply(ctx: Context): void {
  const dictionary = (language: 'zh' | 'en' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt') => ({
    ...locale[language],
    'codeBlock.collapse': chatLocale[language]['codeBlock.collapse'],
    'codeBlock.expand': chatLocale[language]['codeBlock.expand'],
  })
  const dictionaries = { zh: dictionary('zh'), en: dictionary('en'), ja: dictionary('ja'), es: dictionary('es'),
    fr: dictionary('fr'), de: dictionary('de'), ru: dictionary('ru'), pt: dictionary('pt') }
  ctx.effect(() => ctx.locale.register(NS, dictionaries))
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'tool-call', locale: NS,
    children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } },
    inject: () => ({ hooks: { hostInfo } }),
  }, ToolCallTree))
  for (const view of [bashToolviewSample, readToolview, readImageToolview, fileMutationToolview,
    searchToolview, webToolview, todoToolview, detailsToolview, askQuestionToolview]) ctx.plugin(view)
}
