/**
 * The Models settings card for the composer's model picker: one row per
 * catalog model with its effective ratings, price, and where the price came
 * from, an editor that opens under the chosen row, and the price refresh
 * from the public price source. It renders nothing while the picker's
 * settings section is loading or not served.
 */

import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, Tag,
} from '@iroha1145/dsh-modern-ui/primitives'
import type { TagTone } from '@iroha1145/dsh-modern-ui/primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the Models page's SlotMap merge (the 'settings.models.footer' list).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { PriceSource } from '../profiles.ts'
import { VendorMarkIcon } from '../VendorMarkIcon.tsx'
import { formatPrice } from '../format-price.ts'
import type { ModelRowState, ModelSettingsFace, PriceFailure, PricesState } from './controller.ts'
import { ModelEditor } from './ModelEditor.tsx'
import styles from './ModelPickerSettingsCard.module.css'

/** Props the renderer binds for the card. */
export type ModelPickerSettingsCardProps =
  PropsRuntime<'settings.models.footer'>
  & PropsLocale<'modelSettings'>
  & InjectFace<ModelSettingsFace>

/** The card's translate seat. */
type Translate = PropsLocale<'modelSettings'>['t']

/** Rating steps a meter draws. */
const METER_STEPS = [1, 2, 3, 4, 5] as const

/** Tag tone per price source: built-in quiet, fetched neutral, the user's own highlighted. */
const SOURCE_TONES: Record<PriceSource, TagTone> = { preset: 'outline', fetched: 'neutral', user: 'info' }

/** Stands in for a price the model has no figure for. */
const MISSING = '—'

/**
 * A dollar amount per million tokens, to four significant digits.
 * @param value - US dollars per million tokens.
 * @returns the amount with its currency sign, or a dash when unknown.
 */
function dollars(value: number | undefined): string {
  return value === undefined ? MISSING : `$${formatPrice(value)}`
}

/**
 * A moment in the active language.
 * @param iso - ISO time from the settings section.
 * @param locale - BCP 47 tag from the dictionary.
 * @returns the formatted date and time, or the stored text when it is not a date.
 */
function formatMoment(iso: string, locale: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * The line explaining why a price refresh did not complete.
 * @param failure - the refresh's failure.
 * @param t - the card's translate seat.
 * @returns the localized line.
 */
function describeFailure(failure: PriceFailure, t: Translate): string {
  switch (failure.kind) {
    case 'read': return t('prices.failed', { message: failure.message })
    case 'timeout': return t('prices.failed', { message: t('prices.timeout') })
    case 'save': return t('prices.saveFailed')
  }
}

/** Props of {@link Meter}. */
interface MeterProps {
  /** Localized rating name. */
  label: string
  /** The rating, 1 to 5. */
  value: number | undefined
  t: Translate
}

/**
 * A five-segment meter with its name; the whole reads as one image to assistive technology.
 * @param props - the rating and its copy.
 * @returns the meter.
 */
function Meter({ label, value, t }: MeterProps): ReactNode {
  return (
    <span
      className={styles['meter']}
      role="img"
      aria-label={value === undefined ? t('rating.unrated', { label }) : t('rating.value', { label, value })}
    >
      <span aria-hidden="true">{label}</span>
      <span className={styles['segments']} aria-hidden="true">
        {METER_STEPS.map(step => (
          <span key={step} className={clsx(styles['segment'], value !== undefined && step <= value && styles['filled'])} />
        ))}
      </span>
    </span>
  )
}

/** Props of {@link PriceStatus}. */
interface PriceStatusProps {
  prices: PricesState
  t: Translate
}

/**
 * The price refresh's outcome: the failure, if any, and when prices were last read.
 * @param props - the refresh state and copy.
 * @returns the status lines.
 */
function PriceStatus({ prices, t }: PriceStatusProps): ReactNode {
  return (
    <>
      {prices.failure === undefined ? null : <p className={styles['error']} role="alert">{describeFailure(prices.failure, t)}</p>}
      {prices.updatedAt === undefined
        ? null
        : <p className={styles['meta']}>{t('prices.updatedAt', { time: formatMoment(prices.updatedAt, t('time.locale')) })}</p>}
    </>
  )
}

/** Props of {@link RowSummary}. */
interface RowSummaryProps {
  row: ModelRowState
  open: boolean
  t: Translate
}

/**
 * The collapsed content of one row: tile, name, ratings, price, and its source.
 * @param props - the row and its copy.
 * @returns the row content.
 */
function RowSummary({ row, open, t }: RowSummaryProps): ReactNode {
  const priced = row.priceInput !== undefined || row.priceOutput !== undefined
  return (
    <>
      <span className={styles['glyph']} aria-hidden="true">{row.mark === undefined ? row.glyph : <VendorMarkIcon mark={row.mark} />}</span>
      <span className={styles['rowName']}>
        <span className={styles['name']}>{row.name}</span>
        {row.customized ? <Tag tone="neutral">{t('row.customized')}</Tag> : null}
      </span>
      <span className={styles['rowMeta']}>
        <Meter label={t('field.speed')} value={row.speed} t={t} />
        <Meter label={t('field.quality')} value={row.quality} t={t} />
        <Meter label={t('field.cost')} value={row.cost} t={t} />
        <span className={styles['price']}>
          {priced ? t('price.pair', { input: dollars(row.priceInput), output: dollars(row.priceOutput) }) : t('price.none')}
          {row.priceSource === undefined ? null : <Tag tone={SOURCE_TONES[row.priceSource]}>{t(`source.${row.priceSource}`)}</Tag>}
        </span>
      </span>
      <span className={styles['chevron']} aria-hidden="true">
        {open ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
      </span>
    </>
  )
}

/**
 * Render the card, or nothing while the section is not editable.
 * @param props - the card's state, copy, and actions.
 * @returns the card.
 */
export function ModelPickerSettingsCard(props: ModelPickerSettingsCardProps): ReactNode {
  const { t, loadCatalog } = props
  const state = props.useModelSettings(snapshot => snapshot)
  const base = useId()
  const openId = state.editor?.id
  const wasOpen = useRef<string | undefined>(undefined)
  useEffect(() => { loadCatalog() }, [loadCatalog])
  // Closing an editor removes the control that held focus, so its row takes focus back.
  useEffect(() => {
    const closed = wasOpen.current
    wasOpen.current = openId
    const active = document.activeElement
    if (closed !== undefined && openId === undefined && (active === null || active === document.body)) {
      document.getElementById(`${base}-${closed}`)?.focus()
    }
  }, [openId, base])
  if (!state.available) return null
  const { catalog, prices, editor } = state
  return (
    <section className={styles['card']} aria-labelledby={`${base}-title`}>
      <header className={styles['head']}>
        <div className={styles['intro']}>
          <h3 id={`${base}-title`} className={styles['title']}>{t('card.title')}</h3>
          <p className={styles['text']}>{t('card.intro')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!state.writable || state.saving || prices.busy || state.rows.length === 0}
          onClick={() => { props.refreshPrices() }}
        >
          {prices.busy ? t('prices.refreshing') : t('prices.refresh')}
        </Button>
      </header>
      <PriceStatus prices={prices} t={t} />
      <p className={styles['text']}>{t('prices.note')}</p>
      {state.writable ? null : <p className={styles['notice']}>{t('card.readOnly')}</p>}
      {catalog.loading ? <p className={styles['meta']} role="status">{t('catalog.loading')}</p> : null}
      {catalog.error === undefined
        ? null
        : (
          <p className={styles['error']} role="alert">
            {t('catalog.error', { message: catalog.error })}
            <button type="button" className={styles['retry']} onClick={() => { loadCatalog() }}>{t('catalog.retry')}</button>
          </p>
        )}
      {state.rows.length === 0 && !catalog.loading && catalog.error === undefined
        ? <p className={styles['meta']}>{t('catalog.empty')}</p>
        : null}
      <ul className={styles['rows']}>
        {state.rows.map((row) => {
          const rowEditor = editor?.id === row.id ? editor : undefined
          return (
            <li key={row.id} className={styles['row']}>
              <button
                type="button"
                id={`${base}-${row.id}`}
                className={styles['rowButton']}
                aria-expanded={rowEditor !== undefined}
                disabled={state.saving}
                onClick={() => { props.toggleModel(row.id) }}
              >
                <RowSummary row={row} open={rowEditor !== undefined} t={t} />
              </button>
              {rowEditor === undefined
                ? null
                : (
                  <ModelEditor
                    editor={rowEditor}
                    writable={state.writable}
                    saving={state.saving}
                    t={t}
                    blurb={props.blurb}
                    editField={props.editField}
                    toggleEffort={props.toggleEffort}
                    saveModel={props.saveModel}
                    restoreModel={props.restoreModel}
                    cancelEdit={props.cancelEdit}
                  />
                )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
