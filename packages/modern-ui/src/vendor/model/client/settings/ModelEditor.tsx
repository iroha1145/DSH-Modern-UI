/**
 * The editor of one model's picker details: the tile's mark, description,
 * the three ratings, first-token wait, prices, and which reasoning levels the
 * picker offers. A blank field inherits the built-in, fetched, or catalog
 * value, shown as the field's placeholder. Everything is staged in the
 * controller; saving, cancelling, and restoring the built-in details are the
 * card's actions.
 */

import { useId } from 'react'
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import { Button, Checkbox, Input } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { LETTER_ICON } from '../../model-settings.ts'
import { isVendorMark, MARK_IDS, type VendorMark } from '../vendor-marks.ts'
import { VendorMarkIcon } from '../VendorMarkIcon.tsx'
import type { DraftField, ModelEditorState, ModelSettingsFace } from './controller.ts'
import styles from './ModelPickerSettingsCard.module.css'

/** The card's translate seat. */
type Translate = PropsLocale<'modelSettings'>['t']

/** Rating values the select offers besides "default". */
const RATING_STEPS = [1, 2, 3, 4, 5] as const

/** Props of {@link ModelEditor}. */
export interface ModelEditorProps extends Pick<
  ModelSettingsFace,
  'blurb' | 'editField' | 'toggleEffort' | 'saveModel' | 'restoreModel' | 'cancelEdit'
> {
  /** The open editor's state. */
  editor: ModelEditorState
  /** Whether the settings document accepts writes. */
  writable: boolean
  /** Whether a model write is in flight. */
  saving: boolean
  /** Card copy. */
  t: Translate
}

/** Props of {@link TextField}. */
interface TextFieldProps {
  id: string
  label: string
  value: string
  placeholder: string
  /** One line shown under the field while its text is usable. */
  hint?: string | undefined
  /** The line shown instead while its text is not usable. */
  invalidNote?: string | undefined
  invalid: boolean
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  disabled: boolean
  onChange: (text: string) => void
}

/**
 * A labelled single-line field with its hint or validation note.
 * @param props - the field's text, copy, and change callback.
 * @returns the field.
 */
function TextField(props: TextFieldProps): ReactNode {
  const note = props.invalid ? props.invalidNote : props.hint
  const noteId = `${props.id}-note`
  return (
    <div className={styles['field']}>
      <label className={styles['fieldLabel']} htmlFor={props.id}>{props.label}</label>
      <div className={styles['control']}>
        <Input
          id={props.id}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          inputMode={props.inputMode}
          aria-invalid={props.invalid ? true : undefined}
          aria-describedby={note === undefined ? undefined : noteId}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { props.onChange(event.target.value) }}
        />
      </div>
      {note === undefined ? null : <p id={noteId} className={props.invalid ? styles['error'] : styles['hint']}>{note}</p>}
    </div>
  )
}

/** Props of {@link RatingSelect}. */
interface RatingSelectProps {
  id: string
  label: string
  value: string
  /** The rating a blank choice falls back to. */
  inherited: number | undefined
  disabled: boolean
  t: Translate
  onChange: (text: string) => void
}

/**
 * A 1 to 5 rating choice with a "default" option that clears the override.
 * @param props - the rating's current text and fallback.
 * @returns the select.
 */
function RatingSelect(props: RatingSelectProps): ReactNode {
  return (
    <div className={styles['field']}>
      <label className={styles['fieldLabel']} htmlFor={props.id}>{props.label}</label>
      <div className={styles['selectFrame']}>
        <select
          id={props.id}
          className={styles['select']}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => { props.onChange(event.target.value) }}
        >
          <option value="">
            {props.inherited === undefined ? props.t('choice.default') : props.t('choice.defaultValue', { value: props.inherited })}
          </option>
          {RATING_STEPS.map(step => <option key={step} value={String(step)}>{step}</option>)}
        </select>
      </div>
    </div>
  )
}

/** Props of {@link IconSelect}. */
interface IconSelectProps {
  id: string
  /** The staged choice: empty for automatic, the letter choice, or a mark id. */
  value: string
  /** The mark the automatic choice draws; undefined when it keeps the letter. */
  automatic: VendorMark | undefined
  /** The monogram the letter choice draws. */
  glyph: string
  disabled: boolean
  t: Translate
  onChange: (text: string) => void
}

/**
 * The tile's mark: automatic, the name's first letter, or any vendor mark, with
 * the tile the choice would draw beside the menu.
 * @param props - the staged choice, the automatic mark, and the monogram.
 * @returns the field.
 */
function IconSelect(props: IconSelectProps): ReactNode {
  const { t } = props
  const shown = props.value === LETTER_ICON
    ? undefined
    : isVendorMark(props.value) ? props.value : props.automatic
  return (
    <div className={styles['field']}>
      <label className={styles['fieldLabel']} htmlFor={props.id}>{t('field.icon')}</label>
      <div className={styles['iconPick']}>
        <span className={styles['glyph']} aria-hidden="true">
          {shown === undefined ? props.glyph : <VendorMarkIcon mark={shown} />}
        </span>
        <div className={styles['selectFrame']}>
          <select
            id={props.id}
            className={styles['select']}
            value={props.value}
            disabled={props.disabled}
            onChange={(event) => { props.onChange(event.target.value) }}
          >
            <option value="">
              {props.automatic === undefined ? t('icon.autoLetter') : t('icon.autoMark', { name: t(`mark.${props.automatic}`) })}
            </option>
            <option value={LETTER_ICON}>{t('icon.letter')}</option>
            {MARK_IDS.map(mark => <option key={mark} value={mark}>{t(`mark.${mark}`)}</option>)}
          </select>
        </div>
      </div>
      <p className={styles['hint']}>{t('field.iconHint')}</p>
    </div>
  )
}

/**
 * Render the open model's editor.
 * @param props - the editor state, the card's mode flags, and its actions.
 * @returns the editor panel.
 */
export function ModelEditor(props: ModelEditorProps): ReactNode {
  const { editor, t } = props
  const base = useId()
  const locked = !props.writable || props.saving
  const { draft, placeholders } = editor
  const edit = (field: DraftField) => (text: string): void => { props.editField(field, text) }
  const idOf = (field: DraftField): string => `${base}-${field}`
  const invalidPrice = t('field.invalidPrice')
  return (
    <div className={styles['editor']} role="group" aria-label={t('editor.aria', { model: editor.name })}>
      <p className={styles['hint']}>{t('editor.hint')}</p>
      <IconSelect
        id={idOf('icon')}
        value={draft.icon}
        automatic={placeholders.mark}
        glyph={editor.glyph}
        disabled={locked}
        t={t}
        onChange={edit('icon')}
      />
      <TextField
        id={idOf('description')}
        label={t('field.description')}
        value={draft.description}
        placeholder={placeholders.blurb === undefined ? placeholders.description ?? '' : props.blurb(placeholders.blurb)}
        invalid={false}
        disabled={locked}
        onChange={edit('description')}
      />
      <div className={styles['ratings']}>
        <RatingSelect
          id={idOf('speed')} label={t('field.speed')} value={draft.speed} inherited={placeholders.speed}
          disabled={locked} t={t} onChange={edit('speed')}
        />
        <RatingSelect
          id={idOf('quality')} label={t('field.quality')} value={draft.quality} inherited={placeholders.quality}
          disabled={locked} t={t} onChange={edit('quality')}
        />
        <RatingSelect
          id={idOf('cost')} label={t('field.cost')} value={draft.cost} inherited={placeholders.cost}
          disabled={locked} t={t} onChange={edit('cost')}
        />
      </div>
      <p className={styles['hint']}>{t('field.ratingHint')}</p>
      <div className={styles['numbers']}>
        <TextField
          id={idOf('latency')}
          label={t('field.latency')}
          value={draft.latency}
          placeholder={placeholders.latency}
          hint={t('field.latencyHint')}
          invalidNote={t('field.invalidSeconds')}
          invalid={editor.invalid.latency}
          inputMode="decimal"
          disabled={locked}
          onChange={edit('latency')}
        />
        <TextField
          id={idOf('priceInput')}
          label={t('field.priceInput')}
          value={draft.priceInput}
          placeholder={placeholders.priceInput}
          invalidNote={invalidPrice}
          invalid={editor.invalid.priceInput}
          inputMode="decimal"
          disabled={locked}
          onChange={edit('priceInput')}
        />
        <TextField
          id={idOf('priceOutput')}
          label={t('field.priceOutput')}
          value={draft.priceOutput}
          placeholder={placeholders.priceOutput}
          invalidNote={invalidPrice}
          invalid={editor.invalid.priceOutput}
          inputMode="decimal"
          disabled={locked}
          onChange={edit('priceOutput')}
        />
      </div>
      {editor.efforts.length === 0
        ? null
        : (
          <fieldset className={styles['efforts']}>
            <legend className={styles['fieldLabel']}>{t('field.efforts')}</legend>
            <div className={styles['effortChoices']}>
              {editor.efforts.map(effort => (
                <Checkbox
                  key={effort.id}
                  label={effort.name}
                  checked={effort.checked}
                  disabled={locked || effort.locked}
                  onChange={(checked) => { props.toggleEffort(effort.id, checked) }}
                />
              ))}
            </div>
            <p className={styles['hint']}>{t('field.effortsHint')}</p>
          </fieldset>
        )}
      {editor.conflicted ? <p className={styles['error']} role="alert">{t('editor.conflict')}</p> : null}
      {editor.failed ? <p className={styles['error']} role="alert">{t('editor.saveFailed')}</p> : null}
      <div className={styles['actions']}>
        <Button variant="ghost" disabled={locked || !editor.customized} onClick={() => { props.restoreModel() }}>
          {t('action.restore')}
        </Button>
        <span className={styles['spacer']} />
        <Button variant="outline" disabled={props.saving} onClick={() => { props.cancelEdit() }}>
          {t('action.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={locked || !editor.dirty || editor.invalid.latency || editor.invalid.priceInput || editor.invalid.priceOutput}
          onClick={() => { props.saveModel() }}
        >
          {props.saving ? t('action.saving') : t('action.save')}
        </Button>
      </div>
    </div>
  )
}
