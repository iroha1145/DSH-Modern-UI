import { useCallback, useMemo, type ReactNode } from 'react'
import { MarkdownDelegateProvider } from '@iroha1145/dsh-modern-ui/primitives'
import { useMarkdownDelegate } from './vendor/primitives/markdown/MarkdownDelegate.tsx'
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
  const inherited = useMarkdownDelegate()
  const openWorkspaceFile = useCallback((path: string, options?: { line?: number }) => {
    openFile(resolveWorkspacePath(cwd, path), options)
  }, [cwd, openFile])
  const fileImages = useMemo(() => ({
    fileDrag: inherited.fileImages?.fileDrag,
    resourceAddress: inherited.fileImages?.resourceAddress,
    resolve: (path: string) => fileMediaUrl(document.baseURI, resolveWorkspacePath(cwd, path)),
    labels: { open: t('image.open'), loading: t('image.loading'), failed: t('image.failed'), dialog: t('image.dialog'), close: t('image.close') },
  }), [cwd, t, inherited.fileImages])
  return <MarkdownDelegateProvider openFile={openWorkspaceFile} openExternalLink={openExternalLink} fileImages={fileImages}>{children}</MarkdownDelegateProvider>
}
