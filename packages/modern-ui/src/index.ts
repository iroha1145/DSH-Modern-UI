import type { Context } from '@deepseek-ai/cordis'
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
})

/** Register only plugin-owned settings and additive guidance through public services. */
export function apply(ctx: Context, config: { enabled: boolean }): void {
  configureConversation(ctx)
  if (!config.enabled) return
  installBootStyle(ctx)
  ctx.inject(['systemPrompt'], scope => scope.effect(() => scope.systemPrompt.section({
    name: 'modern-ui:response-presentation',
    order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1,
    interpolate: false,
    text: PRESENTATION_PROMPT,
  })))
}
