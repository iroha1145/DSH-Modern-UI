// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Read-only Markdown viewer for logged plans and temporary review documents. */
import { useMemo } from 'react'
import { MarkdownText } from '@iroha1145/dsh-modern-ui/primitives'
import type { MarkdownLabels } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the right sidebar's `sidebar.right.pane.tab` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './plan.ts'
import { isReviewPreviewAddress } from './review-preview.ts'
import { planFailureLine } from './failure-line.ts'
import css from './PlanPreview.module.css'

type PlanPreviewProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'modern-plan'>

/**
 * Render the submitted plan with its complete Markdown through the Modern
 * primitive, so long code fences fold like they do in the chat.
 * @param props - Framework-bound tab identity, resource, and copy.
 * @returns the plan document or a localized loading/failure state.
 */
export function PlanPreview({ useTabInfo, useResource, t }: PlanPreviewProps) {
  const tab = useTabInfo()
  const resource = useResource<'plan'>(tab.tab.navigation.address)
  const temporary = isReviewPreviewAddress(tab.tab.navigation.address)
  const params = tab.tab.navigation.params
  const plan = temporary ? (params !== undefined && 'planReview' in params ? params.planReview : undefined) : resource.value
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap'), collapseLabel: t('codeBlock.collapse'), expandLabel: t('codeBlock.expand') } },
    footnotes: t('markdown.footnotes'),
  }), [t])
  if (plan === undefined) return (
    <div className={css.message} role="status">
      {temporary ? t('preview.expired') : resource.status === 'none' ? t('preview.unavailable')
        : resource.status === 'failed' ? t('preview.failed') : t('preview.loading')}
      {!temporary && resource.failure !== undefined && <p>{planFailureLine(t, resource.failure)}</p>}
    </div>
  )
  return (
    <section className={css.preview} data-plan-preview={'callId' in plan ? plan.callId : tab.tab.navigation.address} aria-label={plan.title}>
      <div className={css.document}><MarkdownText text={plan.markdown} labels={labels} /></div>
    </section>
  )
}
