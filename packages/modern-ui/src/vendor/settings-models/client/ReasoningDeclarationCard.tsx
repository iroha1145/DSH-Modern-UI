/**
 * The reasoning-declaration block inside a pi-ai provider card on the Models
 * settings page: one row per stored model the installed catalog does not
 * describe (or that already declares levels), with a switch that turns
 * reasoning on or off and, while on, one checkbox per level the schema
 * offers. A hand-declared route renders nothing here: the official editor
 * already carries the control on every one of its rows.
 */

import { useEffect, useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Checkbox, Switch } from '@iroha1145/dsh-modern-ui/primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the Models page's SlotMap merge (the 'settings.models.provider-card' seat).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ModelTarget, ReasoningDeclarationFace } from './controller.ts'
import { declarableModels, valueAt } from './reasoning-declaration.ts'
import styles from './ReasoningDeclarationCard.module.css'

/** Props the renderer binds for the block. */
export type ReasoningDeclarationCardProps =
  PropsRuntime<'settings.models.provider-card'>
  & PropsLocale<'modern-reasoning'>
  & InjectFace<ReasoningDeclarationFace>

/**
 * Render the block for one provider card.
 * @param props - the card's directory row, the shared settings sources and the actions.
 * @returns the block, or nothing for a hand-declared route or a route with nothing to declare.
 */
export function ReasoningDeclarationCard({
  provider, useForm, useMirror, useDeclaration, levels, loadCatalog, setReasoning, toggleLevel, t,
}: ReasoningDeclarationCardProps): ReactNode {
  const route = provider.provider
  const ns = provider.settingsNs
  const settingsPath = provider.settingsPath
  const handDeclared = provider.declared === true
  const user = useForm(snapshot => snapshot.user)
  const writable = useForm(snapshot => snapshot.writable)
  const serialized = useMirror(mirror => mirror.view?.namespaces.find(candidate => candidate.ns === ns)?.schema)
  const catalog = useDeclaration(state => state.catalogs[route])
  const saving = useDeclaration(state => state.saving === route)
  const refused = useDeclaration(state => state.refused === route)
  const headingId = useId()
  useEffect(() => {
    if (!handDeclared && catalog === undefined) loadCatalog(route)
  }, [handDeclared, catalog, route, loadCatalog])
  const offered = useMemo(() => levels(serialized), [levels, serialized])
  const models = useMemo(() => handDeclared ? [] : declarableModels(
    valueAt(user, [...settingsPath, 'models']),
    catalog === undefined || catalog === null ? undefined : new Set(catalog),
  ), [handDeclared, user, settingsPath, catalog])
  if (handDeclared || offered.length === 0 || models.length === 0) return null
  const choices = offered.filter(level => level !== 'off')
  return (
    <section className={styles['block']} data-modern-reasoning-declaration={route} aria-labelledby={headingId}>
      <div className={styles['head']}>
        <h4 id={headingId} className={styles['title']}>{t('title')}</h4>
        <p className={styles['hint']}>{t('hint')}</p>
      </div>
      <ul className={styles['rows']}>
        {models.map((model) => {
          const target: ModelTarget = { provider: route, settingsPath, index: model.index }
          const on = model.efforts !== undefined
          const checked = new Set(model.efforts?.map(([level]) => level))
          const chosen = choices.filter(level => checked.has(level))
          return (
            <li key={model.index} className={styles['row']} data-model-id={model.id} data-reasoning={on ? 'on' : 'off'}>
              <div className={styles['identity']}>
                <span className={styles['id']}>{model.id}</span>
                {model.name === undefined ? null : <span className={styles['name']}>{model.name}</span>}
              </div>
              <Switch
                checked={on} label={t('switch', { model: model.id })} disabled={!writable} busy={saving}
                onChange={(next) => { setReasoning(target, next) }}
              />
              {on
                ? (
                  <div className={styles['levels']} role="group" aria-label={t('levels', { model: model.id })}>
                    {choices.map(level => (
                      <Checkbox
                        key={level} label={level} checked={checked.has(level)}
                        disabled={!writable || saving || (checked.has(level) && chosen.length <= 1)}
                        onChange={(next) => { toggleLevel(target, level, next) }}
                      />
                    ))}
                  </div>
                )
                : null}
            </li>
          )
        })}
      </ul>
      {refused ? <p className={styles['error']} role="alert">{t('writeRefused')}</p> : null}
    </section>
  )
}
