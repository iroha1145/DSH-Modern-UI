import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { Config as ConversationConfig, apply as configureConversation } from '@deepseek-ai/dsh-client-ui-conversation'
import { Config as PickerConfig } from './vendor/model/index.ts'
import { PRESENTATION_PROMPT } from './vendor/intelligent/presentation-prompt.ts'

export const Config = z.object({
  ...PickerConfig.dict,
  ...ConversationConfig.dict,
  enabled: z.boolean().default(true),
  collapsedViews: z.array(z.string()).default([]).volatile(),
})

/** Register only plugin-owned settings and additive guidance through public services. */
export function apply(ctx: Context, config: { enabled: boolean }): void {
  configureConversation(ctx)
  if (!config.enabled) return
  ctx.inject(['systemPrompt'], scope => scope.effect(() => scope.systemPrompt.section({
    name: 'modern-ui:response-presentation',
    order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1,
    interpolate: false,
    text: PRESENTATION_PROMPT,
  })))
}
