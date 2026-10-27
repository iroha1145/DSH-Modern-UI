/** Localized copy adapters for Cordis-free Markdown primitives. */

import type { MarkdownLabels } from '@iroha1145/dsh-modern-ui/primitives'
import type { ChatViewSlotProps } from './contract/slots.ts'

/**
 * Build the complete Markdown chrome copy for one locale revision.
 * @param t - Chat locale seat.
 * @returns Labels for code fences, footnotes, and source citations.
 */
export function markdownLabels(t: ChatViewSlotProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap'), collapseLabel: t('codeBlock.collapse'), expandLabel: t('codeBlock.expand') } },
    footnotes: t('markdown.footnotes'),
    citations: { sources: t('markdown.sources'), source: t('markdown.source') },
  }
}
