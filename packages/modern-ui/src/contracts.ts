import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarkdownCodeLabels } from '@iroha1145/dsh-modern-ui/primitives'
import type * as intelligentLocale from './vendor/intelligent/client/locales.ts'
import type * as modelLocale from './vendor/model/client/locales.ts'
import type * as subagentLocale from './vendor/subagent/client/locales.ts'
import type * as chatLocale from './vendor/chat/client/locale.ts'
import type * as translationLocale from './vendor/translation/client/locales.ts'

export interface MessageCodeOwnerProps {
  readonly code: string
  readonly lang: string | undefined
  readonly streaming: boolean
  readonly closed: boolean
  readonly settled: boolean
  readonly labels: MarkdownCodeLabels
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'modern-intelligent': keyof typeof intelligentLocale.zh
    'modern-model': keyof typeof modelLocale.zh
    'modern-subagent': keyof typeof subagentLocale.zh
    'modern-chat': keyof typeof chatLocale.zh
    'modern-cot-translation': keyof typeof translationLocale.zh
  }
  interface SlotMap {
    'modern.conversation.chat.reasoning.body': SlotMap['conversation.chat.reasoning.body']
    'modern.conversation.chat.message.images': SlotMap['conversation.chat.message.images']
    'modern.conversation.chat.message.code': { kind: 'chain'; scope: 'session'; owner: MessageCodeOwnerProps }
  }
}

