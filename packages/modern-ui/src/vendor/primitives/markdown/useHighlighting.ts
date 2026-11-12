import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createHighlightView, grammarForHint, grammarLoadState, HighlightWorkerError, requestGrammar, retryGrammar, subscribeGrammarLoaded } from './highlight.ts'
import type { HighlightView } from './highlight.ts'
import type { HighlightSpan } from './highlight-tokenizer.ts'
import type { StreamProgress, WorkerFrame } from './highlight-protocol.ts'
import { isChunkLoadError } from '../chunk-load-error.ts'

export function useGrammarState(lang: string | undefined) {
  const language = grammarForHint(lang)
  const subscribe = useCallback((listener: () => void) => subscribeGrammarLoaded(language, listener), [language])
  const snapshot = useCallback(() => grammarLoadState(language), [language])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  let error: Error | undefined
  if (typeof state !== 'boolean') {
    if (!isChunkLoadError(state.error) && !(state.error instanceof HighlightWorkerError)) throw state.error
    error = state.error
  }
  return { loaded: state === true, error }
}

interface ResultSource { code: string; language: string; viewId: number; jobId: number }
export type HighlightResult = ResultSource & (
  | { kind: 'frame'; frame: WorkerFrame }
  | { kind: 'html'; html: string }
  | { kind: 'lines'; chunks: HighlightSpan[][][]; complete: boolean }
  | { kind: 'error'; error: HighlightWorkerError }
)

/** One worker view owns cancellation and its streaming session; source remains rendered while results arrive. */
export function useWorkerHighlight(code: string, lang: string | undefined, enabled: boolean, streaming: boolean, format: 'html' | 'lines', progress?: () => StreamProgress | undefined) {
  const language = grammarForHint(lang)
  const { loaded, error } = useGrammarState(lang)
  const view = useRef<HighlightView>()
  const [result, setResult] = useState<HighlightResult>()
  const latest = useRef<HighlightResult>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const owner = createHighlightView()
    view.current = owner
    return () => { owner.dispose(); view.current = undefined }
  }, [enabled])
  useEffect(() => { if (enabled) requestGrammar(language) }, [enabled, language])
  useEffect(() => {
    if (!enabled || !loaded || language === undefined) return
    const owner = view.current!
    const previous = latest.current
    if (!streaming && previous?.viewId === owner.id && previous.kind === 'frame' && previous.code === code && previous.language === language && previous.frame.settled) {
      owner.settle()
      return
    }
    const chunks: HighlightSpan[][][] = []
    return owner.run(code, language, streaming, format, progress?.(), reply => {
      const source = { code, language, viewId: owner.id, jobId: reply.jobId }
      const publish = (value: HighlightResult): void => { latest.current = value; setResult(value) }
      switch (reply.kind) {
        case 'frame': flushSync(() => publish({ ...source, kind: 'frame', frame: reply.frame })); break
        case 'html': publish({ ...source, kind: 'html', html: reply.html }); break
        case 'chunk':
          chunks.push(reply.lines)
          flushSync(() => publish({ ...source, kind: 'lines', chunks: [...chunks], complete: false }))
          break
        case 'done':
          if (chunks.length > 0) publish({ ...source, kind: 'lines', chunks: [...chunks], complete: true })
          break
        case 'job-error': publish({ ...source, kind: 'error', error: new HighlightWorkerError(reply.message) }); break
      }
    })
  }, [code, enabled, format, language, loaded, streaming, attempt, progress])
  const retry = useCallback(() => {
    if (error !== undefined) retryGrammar(lang)
    else { latest.current = undefined; setResult(undefined); setAttempt(value => value + 1) }
  }, [error, lang])
  const localError = result?.kind === 'error' && result.code === code && result.language === language ? result.error : undefined
  return { result: enabled ? result : undefined, error: error ?? localError, retry }
}
