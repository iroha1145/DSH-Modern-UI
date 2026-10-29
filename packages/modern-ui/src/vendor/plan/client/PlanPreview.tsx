// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Read-only Markdown viewer for logged plans and temporary review documents. */
import { useMemo } from 'react'
import { MarkdownText, MarkdownDelegateProvider } from '@iroha1145/dsh-modern-ui/primitives'
import type { MarkdownLabels } from '@iroha1145/dsh-modern-ui/primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MarkdownDelegate } from '../../primitives/markdown/MarkdownDelegate.tsx'
// Type-only: the right sidebar's `sidebar.right.pane.tab` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './plan.ts'
import { isReviewPreviewAddress } from './review-preview.ts'
import { planFailureLine } from './failure-line.ts'
import { planSessionId } from './navigation.ts'
import css from './PlanPreview.module.css'

type PlanPreviewProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'modern-plan'> & InjectFace<{
  hooks: { sessions: ObservableSnapshot<SessionListState> }
  navigation: (address: string) => MarkdownDelegate
}>

/**
 * Render the submitted plan with its complete Markdown through the Modern
 * primitive, so long code fences fold like they do in the chat.
 * @param props - Framework-bound tab identity, resource, and copy.
 * @returns the plan document or a localized loading/failure state.
 */
export function PlanPreview({ useTabInfo, useResource, useSessions, navigation, t }: PlanPreviewProps) {
  const tab = useTabInfo()
  const sessionId = planSessionId(tab.tab.navigation.address)
  const session = useSessions(value => sessionId === undefined ? undefined : value.byId[sessionId])
  const delegate = useMemo(() => navigation(tab.tab.navigation.address), [navigation, tab.tab.navigation.address, session, t])
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
      <MarkdownDelegateProvider {...delegate}>
        <div className={css.document}><MarkdownText text={plan.markdown} labels={labels} /></div>
      </MarkdownDelegateProvider>
    </section>
  )
}
