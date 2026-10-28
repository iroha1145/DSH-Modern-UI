// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/**
 * Keyed document-body registration for Markdown files. The official
 * documentpreview package keeps the implementation metadata (extensions,
 * loading mode) and its own body entry; the Modern body shadows that entry
 * under the same key at a lower priority, so the file preview renders through
 * the plugin's MarkdownText with code-fence folding.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `sidebar.right.tab.document` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { MarkdownBody } from './MarkdownBody.tsx'

/** Implementation identity the official metadata registers the Markdown body under. */
export const MARKDOWN_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'

/** Shadows the official entry (priority 0) under the same key; the lowest priority renders. */
export const MARKDOWN_BODY_PRIORITY = -100

/**
 * Register the Modern Markdown document body for the owning plugin lifetime.
 * @param ctx - plugin context carrying the slot registry.
 */
export function registerMarkdownBody(ctx: Context): void {
  ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: MARKDOWN_BODY_ID, priority: MARKDOWN_BODY_PRIORITY, locale: 'modern-document-markdown',
  }, MarkdownBody))
}
