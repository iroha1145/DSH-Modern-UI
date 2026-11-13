import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

import type { MessageCodeOwnerProps } from './vendor/chat/client/contract/slots.ts'
import type * as intelligentLocale from './vendor/intelligent/client/locales.ts'
import type * as modelLocale from './vendor/model/client/locales.ts'
import type * as subagentLocale from './vendor/subagent/client/locales.ts'
import type * as chatLocale from './vendor/chat/client/locale.ts'
import type * as translationLocale from './vendor/translation/client/locales.ts'
import type * as markdownPreviewLocale from './vendor/documentpreview/client/markdown/locales.ts'
import type * as planPreviewLocale from './vendor/plan/client/locales.ts'
import type * as reasoningLocale from './vendor/settings-models/client/locales.ts'
import type { ModelOptionsOwner, ModelParametersOwner } from './model-extras.tsx'

export type { MessageCodeOwnerProps }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'modern-intelligent': keyof typeof intelligentLocale.zh
    'modern-model': keyof typeof modelLocale.zh
    'modern-subagent': keyof typeof subagentLocale.zh
    'modern-chat': keyof typeof chatLocale.zh
    'modern-cot-translation': keyof typeof translationLocale.zh
    'modern-document-markdown': keyof typeof markdownPreviewLocale.zh
    'modern-plan': keyof typeof planPreviewLocale.zh
    'modern-reasoning': keyof typeof reasoningLocale.zh
  }
  interface SlotMap {
    /** Code-fence presenters select from authored content; the standard CodeBlock has priority 100. */
    'conversation.chat.message.code': { kind: 'chain'; scope: 'session'; owner: MessageCodeOwnerProps }
    /**
     * Rows a provider's plugin adds for the selected model, shown in the menu beside the composer's model button.
     * An entry renders nothing while the selected model is not its own; the button shows only while a row rendered.
     */
    'conversation.input.model.parameters': { kind: 'list'; scope: 'session'; owner: ModelParametersOwner }
    /**
     * Session options that are not about one provider's model. Official 0.2.2-rc.2 declares this list in its own
     * model menu and puts the Team mode switch there; Modern UI owns the seat, so it declares the list itself and
     * shows the rows in the same menu as the provider's. Earlier releases register nothing here. The installed
     * typings predate the official declaration, which has the same shape.
     */
    'conversation.input.model.options': { kind: 'list'; scope: 'session'; owner: ModelOptionsOwner }
  }
}
