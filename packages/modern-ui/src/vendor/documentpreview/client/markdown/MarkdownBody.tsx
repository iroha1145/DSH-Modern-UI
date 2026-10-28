// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** One retained Markdown renderer over the document owner's accumulated text. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@iroha1145/dsh-modern-ui/primitives'
import type { MarkdownLabels, MarkdownPathImages } from '@iroha1145/dsh-modern-ui/primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the official document owner's slot contract (`sidebar.right.tab.document`) and the `file` resource.
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { splitFrontmatter } from './frontmatter.ts'
import { FrontmatterFields } from './frontmatter-fields.tsx'
import { markdownImageUrl } from './path-images.ts'
import css from './MarkdownBody.module.css'

/** Standard document inputs and this implementation's locale. */
export type MarkdownBodyProps = DocumentPreviewProps & PropsLocale<'modern-document-markdown'>

/**
 * Render one accumulated document; EOF completes the primitive's full parse.
 * A leading YAML frontmatter block renders as a field list instead of Markdown.
 * The Modern primitive adds the code-fence collapse control the official rc.4
 * CodeBlock lacks; the labels name it in the plugin's own namespace.
 * @param props - owner-loaded contents and localized primitive labels.
 * @returns Markdown content, or nothing for a non-text delivery.
 */
export function MarkdownBody({ content, resourceAddress, useResource, t }: MarkdownBodyProps): ReactNode {
  const absolutePath = useResource<'file'>(resourceAddress).value?.absolutePath
  const pathImages = useMemo<MarkdownPathImages>(() => ({
    resolve: value => markdownImageUrl(document.baseURI, absolutePath, value),
  }), [absolutePath])
  const copyLabel = t('code.copy')
  const copiedLabel = t('code.copied')
  const footnotes = t('footnotes')
  const codeLabel = t('codeBlock.title')
  const wrapLabel = t('codeBlock.wrap')
  const unwrapLabel = t('codeBlock.unwrap')
  const collapseLabel = t('codeBlock.collapse')
  const expandLabel = t('codeBlock.expand')
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel, copiedLabel, toolbarLabels: { codeLabel, wrapLabel, unwrapLabel, collapseLabel, expandLabel } }, footnotes,
  }), [copyLabel, copiedLabel, footnotes, codeLabel, wrapLabel, unwrapLabel, collapseLabel, expandLabel])
  const text = content.kind === 'text' ? content.text : ''
  const split = useMemo(() => splitFrontmatter(text), [text])
  if (content.kind !== 'text') return null
  return (
    <div className={css.document} data-document-markdown>
      {split === undefined ? null : <FrontmatterBox source={split.source} />}
      <MarkdownText text={split?.body ?? text} streaming={!content.eof} labels={labels} pathImages={pathImages} />
    </div>
  )
}

/**
 * Frame one frontmatter block and choose its field list or verbatim source.
 * The field list ships in the plugin bundle (no lazy chunk), so it needs no Suspense.
 * @param props - YAML between the frontmatter delimiters.
 * @returns the metadata box; it collapses when the document has no content.
 */
function FrontmatterBox({ source }: { source: string }): ReactNode {
  const verbatim = <pre className={css.frontmatterSource}>{source}</pre>
  return (
    <div className={css.frontmatter} data-document-frontmatter>
      <FrontmatterFields source={source} fallback={verbatim} />
    </div>
  )
}
