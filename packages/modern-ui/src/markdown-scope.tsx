import { useMemo, type ReactNode } from 'react'
import { MarkdownDelegateProvider } from '@iroha1145/dsh-modern-ui/primitives'
import { fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

export interface MarkdownNavigationInjected {
  openExternalLink: (url: string) => void
}

/** Bridge public owner capabilities into Modern's own Markdown Context. */
export function MarkdownScope({ children, cwd, openFile, openExternalLink, t }: MarkdownNavigationInjected & PropsLocale<'modern-chat'> & {
  children: ReactNode
  cwd?: string
  openFile: (path: string, options?: { line?: number }) => void
}) {
  const fileImages = useMemo(() => ({
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    labels: { open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'), dialog: t('image.dialog'), close: t('image.close') },
  }), [cwd, t])
  return <MarkdownDelegateProvider openFile={openFile} openExternalLink={openExternalLink} fileImages={fileImages}>{children}</MarkdownDelegateProvider>
}
