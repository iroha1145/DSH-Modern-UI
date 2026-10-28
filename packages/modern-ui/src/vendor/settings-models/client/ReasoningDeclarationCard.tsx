/** Complete per-model declarations beside the official catalog-route editor. */
import { useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@iroha1145/dsh-modern-ui/primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ModelTarget, ReasoningDeclarationFace } from './controller.ts'
import { declarableModels, inheritedModelDrafts, validateReasoningEfforts, type ModelRowDraft } from './reasoning-declaration.ts'
import { ModelReasoningEfforts } from './ModelReasoningEfforts.tsx'
import type { ReasoningDeclarationKey } from './locales.ts'
import styles from './ReasoningDeclarationCard.module.css'

export type ReasoningDeclarationCardProps =
  PropsRuntime<'settings.models.provider-card'>
  & PropsLocale<'modern-reasoning'>
  & InjectFace<ReasoningDeclarationFace>

function ModelDeclaration({ model, target, revision, offered, disabled, saveModel, t }: {
  model: ModelRowDraft
  target: ModelTarget
  revision: number | undefined
  offered: readonly string[]
  disabled: boolean
  saveModel: ReasoningDeclarationFace['saveModel']
  t: (key: ReasoningDeclarationKey) => string
}): ReactNode {
  const [draft, setDraft] = useState<{ model: ModelRowDraft; revision: number | undefined }>()
  const edited = draft?.model ?? model
  const failure = validateReasoningEfforts([edited])
  return (
    <>
      <ModelReasoningEfforts
        model={edited} levels={offered} position={target.index + 1} disabled={disabled} t={t}
        onChange={next => { setDraft(current => ({ model: next, revision: current === undefined ? revision : current.revision })) }}
      />
      {draft === undefined ? null : (
        <div className={styles['actions']}>
          <Button disabled={disabled} onClick={() => { setDraft(undefined) }}>{t('cancel')}</Button>
          <Button disabled={disabled || failure !== undefined} onClick={() => {
            void saveModel(target, draft.model, draft.revision).then(saved => { if (saved) setDraft(undefined) })
          }}>{t('apply')}</Button>
        </div>
      )}
    </>
  )
}

export function ReasoningDeclarationCard({
  provider, useForm, useMirror, useDeclaration, levels, loadCatalog, saveModel, t,
}: ReasoningDeclarationCardProps): ReactNode {
  const route = provider.provider
  const ns = provider.settingsNs
  const settingsPath = provider.settingsPath
  const handDeclared = provider.declared === true
  const form = useForm(snapshot => snapshot)
  const serialized = useMirror(mirror => mirror.view?.namespaces.find(candidate => candidate.ns === ns)?.schema)
  const catalog = useDeclaration(state => state.catalogs[route])
  const saving = useDeclaration(state => state.saving !== undefined)
  const refused = useDeclaration(state => state.refused === route)
  const headingId = useId()
  useEffect(() => {
    if (!handDeclared && catalog === undefined) loadCatalog(route)
  }, [handDeclared, catalog, route, loadCatalog])
  const offered = useMemo(() => levels(serialized), [levels, serialized])
  const models = useMemo(() => handDeclared ? [] : declarableModels(
    inheritedModelDrafts(form.user, form.base, [...settingsPath, 'models']),
    catalog === undefined || catalog === null ? undefined : new Set(catalog),
  ), [handDeclared, form.user, form.base, settingsPath, catalog])
  if (handDeclared || offered.length === 0 || models.length === 0) return null
  return (
    <section className={styles['block']} data-modern-reasoning-declaration={route} aria-labelledby={headingId}>
      <div className={styles['head']}>
        <h4 id={headingId} className={styles['title']}>{t('title')}</h4>
        <p className={styles['hint']}>{t('hint')}</p>
      </div>
      <ul className={styles['rows']}>
        {models.map(model => (
          <li key={model.index + ':' + model.id} className={styles['row']} data-model-id={model.id} data-reasoning={model.efforts === undefined ? 'off' : 'on'}>
            <div className={styles['identity']}>
              <span className={styles['id']}>{model.id}</span>
              {model.name === undefined ? null : <span className={styles['name']}>{model.name}</span>}
            </div>
            <ModelDeclaration
              model={model.model} target={{ provider: route, settingsPath, index: model.index }}
              revision={form.revision} offered={offered} disabled={!form.writable || saving}
              saveModel={saveModel} t={t}
            />
          </li>
        ))}
      </ul>
      {refused ? <p className={styles['error']} role="alert">{t('writeRefused')}</p> : null}
    </section>
  )
}
