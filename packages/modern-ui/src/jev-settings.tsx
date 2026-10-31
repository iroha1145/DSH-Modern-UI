/** Settings row for the optional Jev presentation routing, under the answer visual components switch. */
import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import { SettingsSecretField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@iroha1145/dsh-modern-ui/primitives'
import { CHAT_SETTINGS_NAMESPACE } from './vendor/chat/chat-settings.ts'
import { JEV_LOCALE, jevLocale, trackJev, type JevForm, type JevRowState, type JevState } from './jev-settings-state.ts'
import type { PresentationSettings } from './presentation-switches.ts'
import css from './jev-settings.module.css'

/** Registration-side state and actions. */
export interface JevRowInjected {
  hooks: {
    /** Switch, key state and the latest outcome, bound as useJev. */
    jev: ObservableSnapshot<JevRowState>
    /** Whether the presentation prompt is on, bound as usePrompt. */
    prompt: ObservableSnapshot<boolean>
  }
  actions: Pick<JevState, 'setEnabled' | 'saveKey' | 'removeKey'>
}

/** Full Settings-row props. */
export type JevRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<typeof JEV_LOCALE> & InjectFace<JevRowInjected>

/**
 * Render the Jev row: what it does, the key field, and the switch once a key is available. The typed key
 * stays in this component until it is saved and is cleared after an accepted save.
 * @param props - Composed Settings slot props.
 * @returns The settings row.
 */
export function JevRow({ useJev, usePrompt, actions, t }: JevRowProps) {
  const jev = useJev(value => value)
  const prompt = usePrompt(value => value)
  const [draft, setDraft] = useState('')
  const keyState = !jev.configured ? 'settings.jev.keyUnset' : jev.source === 'file' ? 'settings.jev.keyFile' : 'settings.jev.keyEnv'
  const locked = jev.ref === null || !jev.writable || jev.busy
  return (
    <div className={css.row} data-modern-jev>
      <div className={css.head}>
        <div className={css.text}>
          <div className={css.title}>{t('settings.jev.title')}</div>
          <div className={css.desc}>
            {t('settings.jev.description')}{' '}
            <a className={css.link} href="https://typesafe.ai" target="_blank" rel="noopener noreferrer">{t('settings.jev.site')}</a>
          </div>
          {!prompt && <div className={css.desc}>{t('settings.jev.needsPrompt')}</div>}
        </div>
        {jev.configured && <Switch checked={jev.enabled} label={t('settings.jev.enable')} onChange={actions.setEnabled} />}
      </div>
      <SettingsSecretField
        id="modern-jev-key"
        label={t('settings.jev.key')}
        hint={t('settings.jev.keyHint')}
        text={draft}
        configured={jev.configured}
        stateLabel={t(keyState)}
        disabled={locked}
        onEdit={setDraft}
      />
      <div className={css.actions}>
        <Button size="sm" variant="primary" disabled={locked || draft.trim() === ''}
          onClick={() => { void actions.saveKey(draft).then((saved) => { if (saved) setDraft('') }) }}>
          {t('settings.jev.save')}
        </Button>
        {jev.configured && jev.source === 'file' && <Button size="sm" variant="ghost" disabled={locked} onClick={() => { void actions.removeKey() }}>
          {t('settings.jev.remove')}
        </Button>}
        {jev.notice !== null && <span className={css.notice} role="status">{t(`settings.jev.${jev.notice}`)}</span>}
      </div>
    </div>
  )
}

/**
 * Register the Jev row under the presentation prompt row. Callers inject `remote.credentials`, so a Host
 * without the credentials Remote simply shows no row.
 * @param ctx - client context with configForms, locale, slots and remote.credentials.
 * @param presentation - the accepted presentation switches.
 */
export function installJevSettings(ctx: Context, presentation: ObservableSnapshot<PresentationSettings>): void {
  const state = trackJev(ctx.configForms.get<{ jev?: Record<string, unknown> }>(CHAT_SETTINGS_NAMESPACE) as JevForm, ctx.remote.credentials)
  ctx.effect(() => state.dispose)
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => { state.refresh(String(ref)) }))
  const prompt: ObservableSnapshot<boolean> = {
    getSnapshot: () => presentation.getSnapshot().prompt,
    subscribe: listener => presentation.subscribe(listener),
  }
  ctx.effect(() => ctx.locale.register(JEV_LOCALE, jevLocale))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'jev-routing',
    order: 19,
    locale: JEV_LOCALE,
    inject: (): JevRowInjected => ({
      hooks: { jev: state.state, prompt },
      actions: { setEnabled: state.setEnabled, saveKey: state.saveKey, removeKey: state.removeKey },
    }),
  }, JevRow))
}
