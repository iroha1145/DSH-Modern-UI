import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DetailDocument, useDetailDocumentLabels, type DetailDocumentState } from '../vendor/primitives/DetailDocument.tsx'
import type { PluginDetail } from '../host-compat/plugin-documents/types.ts'
import type {} from './locales.ts'

export type DocumentTarget = { readonly kind: 'bundle'; readonly name: string; readonly version?: string }
  | { readonly kind: 'market'; readonly name: string; readonly url: string; readonly version: string }
export type DocumentTranslate = PropsLocale<'modern-plugin-documents'>['t']
type ReadState = { readonly key: string; readonly value: PluginDetail } | { readonly key: string; readonly failure: string }
const FAILURE_KEYS = { 'too-large': 'detailTooLarge', network: 'detailNetwork', denied: 'detailDenied',
  'git-unavailable': 'detailGitUnavailable', invalid: 'detailInvalid' } as const

/** Read a listed package's document; each mounted language/target owns its request. */
export function PluginDocument({ target, language, t }: { target: DocumentTarget; language: string; t: DocumentTranslate }) {
  const key = JSON.stringify([target.kind, target.name, target.version, target.kind === 'market' ? target.url : '', language])
  const [read, setRead] = useState<ReadState>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const url = new URL('api/modern-ui/plugin-document', document.baseURI)
    for (const [name, value] of Object.entries(target)) if (value !== undefined) url.searchParams.set(name, value)
    url.searchParams.set('language', language)
    if (retry > 0) url.searchParams.set('refresh', 'true')
    void fetch(url, { signal: controller.signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) {
          const failure: unknown = await response.json()
          const reason = typeof failure === 'object' && failure !== null && 'reason' in failure ? failure.reason : undefined
          throw new Error(typeof reason === 'string' ? reason : 'network')
        }
        const value: PluginDetail = await response.json()
        if (value.status !== 'none' && (value.status !== 'found' || typeof value.markdown !== 'string' || typeof value.document !== 'string')) {
          throw new Error('invalid')
        }
        if (!controller.signal.aborted) setRead({ key, value })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setRead({ key, failure: error instanceof Error ? error.message : 'network' })
      })
    return () => controller.abort()
  }, [key, retry])
  const accepted = read?.key === key ? read : undefined
  const found = accepted !== undefined && 'value' in accepted && accepted.value.status === 'found' ? accepted.value : undefined
  const state: DetailDocumentState = accepted === undefined ? { status: 'loading' }
    : 'failure' in accepted ? { status: 'error', message: t(FAILURE_KEYS[accepted.failure as keyof typeof FAILURE_KEYS] ?? 'detailFailed') }
      : accepted.value.status === 'none' ? { status: 'none' } : { status: 'found', markdown: accepted.value.markdown }
  const labels = useDetailDocumentLabels({ title: t('detailTitle'), loading: t('detailLoading'), retry: t('retry'),
    copy: t('copy'), copied: t('copied'), codeBlock: t('codeBlock.title'), wrap: t('codeBlock.wrap'), unwrap: t('codeBlock.unwrap'),
    collapseCode: t('codeBlock.collapse'), expandCode: t('codeBlock.expand'), footnotes: t('footnotes') })
  const images = useMemo(() => found === undefined ? undefined : { resolve: (destination: string) => {
    const url = new URL('api/modern-ui/plugin-document-image', document.baseURI)
    url.searchParams.set('document', found.document)
    url.searchParams.set('path', destination)
    return url.href
  } }, [found?.document])
  return <DetailDocument state={state} labels={labels} images={images} onRetry={() => { setRead(undefined); setRetry(value => value + 1) }} />
}
