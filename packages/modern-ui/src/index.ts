import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { Config as ConversationConfig, apply as configureConversation } from '@deepseek-ai/dsh-client-ui-conversation'
import { Config as ChatConfig } from '@deepseek-ai/dsh-client-ui-chat'
import { Config as PickerConfig } from './vendor/model/index.ts'
import { PRESENTATION_PROMPT } from './vendor/intelligent/presentation-prompt.ts'
import { apply as installBootStyle } from './host-compat/official-style/index.ts'

export const Config = z.object({
  ...PickerConfig.dict,
  ...ConversationConfig.dict,
  // The official chat preferences (transcriptView, collapseTiming, performanceUsage, linkOpening):
  // Modern's chat target reads them from this namespace since the ui-chat entry is disabled.
  ...ChatConfig.dict,
  enabled: z.boolean().default(true),
  collapsedViews: z.array(z.string()).default([]).volatile(),
  // Patch-only chat preference; the official chat schema has no field for it.
  foldedReplies: z.union(['all', 'final']).default('all').volatile(),
  // Model-visible behavior is opt-in; the two renderers only draw what a model already wrote.
  // Volatile so the Settings row can write it and every assembly reads the current value.
  presentation: z.object({
    prompt: z.boolean().default(false),
    openui: z.boolean().default(true),
    followups: z.boolean().default(true),
  }).default({}).volatile(),
})

type Presentation = { prompt?: boolean }

/** Read the live switch; a Loader-mounted config holds a volatile reference, a plain object is accepted too. */
function promptEnabled(section: Volatile<Presentation> | Presentation | undefined): boolean {
  const value = section !== undefined && 'get' in section && typeof section.get === 'function' ? section.get() : section as Presentation | undefined
  return value?.prompt === true
}

/** Register only plugin-owned settings and additive guidance through public services. */
export function apply(ctx: Context, config: { enabled: boolean; presentation?: Volatile<Presentation> | Presentation }): void {
  configureConversation(ctx)
  if (!config.enabled) return
  installBootStyle(ctx)
  // Empty section text is dropped at assembly, so a switched-off prompt adds nothing.
  ctx.inject(['systemPrompt'], scope => scope.effect(() => scope.systemPrompt.section({
    name: 'modern-ui:response-presentation',
    order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1,
    interpolate: false,
    text: () => promptEnabled(config.presentation) ? PRESENTATION_PROMPT : '',
  })))
}
