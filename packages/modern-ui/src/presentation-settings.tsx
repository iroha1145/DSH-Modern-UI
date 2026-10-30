/** Settings row for the model-visible presentation prompt, and the live switches for the code-fence presenters. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CHAT_SETTINGS_NAMESPACE } from './vendor/chat/chat-settings.ts'
import { PreferenceRow } from './vendor/chat/client/settings/PreferenceRow.tsx'
import { PRESENTATION_LOCALE, presentationLocale, readPresentation, type PresentationSettings } from './presentation-switches.ts'

/** Registration-side prompt switch. */
export interface PresentationRowInjected {
  hooks: {
    /** Whether the presentation prompt is on, bound as usePrompt. */
    prompt: ObservableSnapshot<boolean>
  }
  /** Persist the prompt switch to the Modern UI entry config. */
  setPrompt: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type PresentationRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<typeof PRESENTATION_LOCALE>
  & InjectFace<PresentationRowInjected>

/**
 * Render the presentation prompt switch.
 * @param props - Composed Settings slot props.
 * @returns The preference row.
 */
export function PresentationRow({ usePrompt, setPrompt, t }: PresentationRowProps) {
  const enabled = usePrompt(value => value)
  return (
    <PreferenceRow
      title={t('settings.presentation.title')}
      description={t('settings.presentation.description')}
      value={enabled ? 'on' : 'off'}
      selectedLabel={t(enabled ? 'settings.presentation.on' : 'settings.presentation.off')}
      options={[
        { id: 'off', label: t('settings.presentation.off') },
        { id: 'on', label: t('settings.presentation.on') },
      ]}
      onSelect={(value) => { setPrompt(value === 'on') }}
    />
  )
}

/**
 * Track the Host-backed switches and register the Settings row.
 * @param ctx - client context with configForms, locale and slots.
 * @returns the live switches for the code-fence presenters.
 */
export function installPresentationSettings(ctx: Context): ObservableSnapshot<PresentationSettings> {
  const form = ctx.configForms.get<{ presentation?: Partial<PresentationSettings> }>(CHAT_SETTINGS_NAMESPACE)
  const settings = createSnapshotStore(readPresentation(form.getSnapshot().value?.presentation))
  ctx.effect(() => form.subscribe(() => {
    const next = readPresentation(form.getSnapshot().value?.presentation)
    const current = settings.getSnapshot()
    if (next.prompt !== current.prompt || next.openui !== current.openui || next.followups !== current.followups) settings.set(next)
  }))
  const prompt: ObservableSnapshot<boolean> = {
    getSnapshot: () => settings.getSnapshot().prompt,
    subscribe: listener => settings.subscribe(listener),
  }
  ctx.effect(() => ctx.locale.register(PRESENTATION_LOCALE, presentationLocale))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'presentation-prompt',
    order: 18,
    locale: PRESENTATION_LOCALE,
    inject: (): PresentationRowInjected => ({
      hooks: { prompt },
      setPrompt: (enabled) => {
        settings.set({ ...settings.getSnapshot(), prompt: enabled })
        void form.mutate([{ op: 'set', path: ['presentation', 'prompt'], value: enabled }]).catch((_error: unknown) => {
          // The Host reload on the next snapshot restores the accepted value.
        })
      },
    }),
  }, PresentationRow))
  return settings
}
