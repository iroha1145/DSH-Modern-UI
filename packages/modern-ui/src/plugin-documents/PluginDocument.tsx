import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DetailDocument, useDetailDocumentLabels, type DetailDocumentState } from '../vendor/primitives/DetailDocument.tsx'
import type { PluginDetail } from '../host-compat/plugin-documents/types.ts'
import type {} from './locales.ts'
import { documentImageSource } from './image-source.ts'

export type DocumentTarget =
  | { readonly kind: 'bundle'; readonly name: string; readonly version?: string }
  | { readonly kind: 'market'; readonly name: string; readonly url: string; readonly version: string }
export type DocumentTranslate = PropsLocale<'modern-plugin-documents'>['t']
type DocumentProps = { target: DocumentTarget; language: string; t: DocumentTranslate }
type ReadState = { readonly value: PluginDetail } | { readonly failure: string }
const FAILURE_KEYS = {
  'too-large': 'detailTooLarge',
  network: 'detailNetwork',
  denied: 'detailDenied',
  'git-unavailable': 'detailGitUnavailable',
  invalid: 'detailInvalid',
} as const

/** Read a listed package's document; each target and language is read by an instance of its own. */
export function PluginDocument(props: DocumentProps) {
  const { target, language } = props
  // A retry belongs to the document it was asked for: another target or language, and coming back to this one later,
  // start without it and read the cache again.
  const key = JSON.stringify([target.kind, target.name, target.version, target.kind === 'market' ? target.url : '', language])
  return <DocumentRead key={key} {...props} />
}

function DocumentRead({ target, language, t }: DocumentProps) {
  const [read, setRead] = useState<ReadState>()
  const [retry, setRetry] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: The parent keys this instance by every target field and language; only retry refetches.
  useEffect(() => {
    const controller = new AbortController()
    const url = new URL('api/modern-ui/plugin-document', document.baseURI)
    for (const [name, value] of Object.entries(target)) if (value !== undefined) url.searchParams.set(name, value)
    url.searchParams.set('language', language)
    if (retry > 0) url.searchParams.set('refresh', 'true')
    void fetch(url, { signal: controller.signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) {
          const failure: unknown = await response.json().catch(() => null)
          const reason = typeof failure === 'object' && failure !== null && 'reason' in failure ? failure.reason : undefined
          throw new Error(typeof reason === 'string' ? reason : 'network')
        }
        const value: PluginDetail = await response.json()
        if (value.status !== 'none' && (value.status !== 'found' || typeof value.markdown !== 'string' || typeof value.document !== 'string')) {
          throw new Error('invalid')
        }
        if (!controller.signal.aborted) setRead({ value })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRead({ failure: error instanceof Error ? error.message : 'network' })
      })
    return () => controller.abort()
    // The instance is keyed by target and language, so only a retry reads again.
  }, [retry])
  const found = read !== undefined && 'value' in read && read.value.status === 'found' ? read.value : undefined
  const documentId = found?.document
  const state: DetailDocumentState =
    read === undefined
      ? { status: 'loading' }
      : 'failure' in read
        ? { status: 'error', message: t(FAILURE_KEYS[read.failure as keyof typeof FAILURE_KEYS] ?? 'detailFailed') }
        : read.value.status === 'none'
          ? { status: 'none' }
          : { status: 'found', markdown: read.value.markdown }
  const labels = useDetailDocumentLabels({
    title: t('detailTitle'),
    loading: t('detailLoading'),
    retry: t('retry'),
    copy: t('copy'),
    copied: t('copied'),
    codeBlock: t('codeBlock.title'),
    wrap: t('codeBlock.wrap'),
    unwrap: t('codeBlock.unwrap'),
    collapseCode: t('codeBlock.collapse'),
    expandCode: t('codeBlock.expand'),
    footnotes: t('footnotes'),
  })
  const images = useMemo(
    () =>
      documentId === undefined
        ? undefined
        : {
            resolve: (destination: string) => documentImageSource(destination, documentId, document.baseURI),
          },
    [documentId],
  )
  return (
    <DetailDocument
      state={state}
      labels={labels}
      images={images}
      onRetry={() => {
        setRead(undefined)
        setRetry(value => value + 1)
      }}
    />
  )
}
