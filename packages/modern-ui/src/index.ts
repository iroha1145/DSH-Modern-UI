import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { Config as ConversationConfig, apply as configureConversation } from '@deepseek-ai/dsh-client-ui-conversation'
import { Config as ChatConfig } from '@deepseek-ai/dsh-client-ui-chat'
import { Config as PickerConfig } from './vendor/model/index.ts'
import { PRESENTATION_PROMPT, PROGRESSIVE_PROMPT } from './vendor/intelligent/presentation-prompt.ts'
import { apply as installBootStyle } from './host-compat/official-style/index.ts'
import { installJevTool, JevConfig, type JevSettings } from './jev-tool.ts'

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
  // Presentation guidance is enabled by default; each switch still accepts an explicit opt-out.
  // Volatile so the Settings row can write it and every assembly reads the current value.
  presentation: z
    .object({
      prompt: z.boolean().default(true),
      // Progressive delivery remains independent of the components prompt.
      progressive: z.boolean().default(true),
      openui: z.boolean().default(true),
      followups: z.boolean().default(true),
    })
    .default({})
    .volatile(),
  // Optional TypeSafe Jev presentation advice the model may consult; inactive until the credential resolves to a key.
  jev: JevConfig.default({}).volatile(),
})

type Presentation = { prompt?: boolean; progressive?: boolean }

/** Read one live switch; a Loader-mounted config holds a volatile reference, a plain object is accepted too. */
function switchOn(section: Volatile<Presentation> | Presentation | undefined, key: keyof Presentation): boolean {
  const value = section !== undefined && 'get' in section && typeof section.get === 'function' ? section.get() : (section as Presentation | undefined)
  return value?.[key] !== false
}

const promptEnabled = (section: Volatile<Presentation> | Presentation | undefined) => switchOn(section, 'prompt')

const JEV_DEFAULTS: JevSettings = JevConfig({})

/**
 * Read the live Jev settings the same way; a missing section or field keeps the defaults (on, but keyless until
 * configured). The Loader's schema already fills them; a plain object may carry `undefined`, which must not win.
 */
function jevSettings(section: Volatile<Partial<JevSettings>> | Partial<JevSettings> | undefined): JevSettings {
  const value = section !== undefined && 'get' in section && typeof section.get === 'function' ? section.get() : (section as Partial<JevSettings> | undefined)
  return { ...JEV_DEFAULTS, ...Object.fromEntries(Object.entries(value ?? {}).filter(([, field]) => field !== undefined)) }
}

/** Register only plugin-owned settings and additive guidance through public services. */
export function apply(
  ctx: Context,
  config: { enabled: boolean; presentation?: Volatile<Presentation> | Presentation; jev?: Volatile<Partial<JevSettings>> | Partial<JevSettings> },
): void {
  configureConversation(ctx)
  if (!config.enabled) return
  installBootStyle(ctx)
  // Empty section text is dropped at assembly, so a switched-off prompt adds nothing.
  ctx.inject(['systemPrompt'], scope =>
    scope.effect(() =>
      scope.systemPrompt.section({
        name: 'modern-ui:response-presentation',
        order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 1,
        interpolate: false,
        text: () => (promptEnabled(config.presentation) ? PRESENTATION_PROMPT : ''),
      }),
    ),
  )
  // Its own section and switch, right after the component guidance and before the persona suffix.
  ctx.inject(['systemPrompt'], scope =>
    scope.effect(() =>
      scope.systemPrompt.section({
        name: 'modern-ui:progressive-results',
        order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 0.5,
        interpolate: false,
        text: () => (switchOn(config.presentation, 'progressive') ? PROGRESSIVE_PROMPT : ''),
      }),
    ),
  )
  // Jev only advises a model taught the components, so its tool follows the presentation prompt switch.
  installJevTool(
    ctx,
    () => jevSettings(config.jev),
    () => promptEnabled(config.presentation),
  )
}
