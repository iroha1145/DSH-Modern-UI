import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageCodeOwnerProps } from './vendor/chat/client/contract/slots.ts'
import type * as intelligentLocale from './vendor/intelligent/client/locales.ts'
import type * as modelLocale from './vendor/model/client/locales.ts'
import type * as subagentLocale from './vendor/subagent/client/locales.ts'
import type * as chatLocale from './vendor/chat/client/locale.ts'
import type * as translationLocale from './vendor/translation/client/locales.ts'

export type { MessageCodeOwnerProps }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'modern-intelligent': keyof typeof intelligentLocale.zh
    'modern-model': keyof typeof modelLocale.zh
    'modern-subagent': keyof typeof subagentLocale.zh
    'modern-chat': keyof typeof chatLocale.zh
    'modern-cot-translation': keyof typeof translationLocale.zh
  }
  interface SlotMap {
    /** Code-fence presenters select from authored content; the standard CodeBlock has priority 100. */
    'conversation.chat.message.code': { kind: 'chain'; scope: 'session'; owner: MessageCodeOwnerProps }
  }
}

