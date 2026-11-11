import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { grammarForHint, highlightLinesAsync, isGrammarLoaded, subscribeGrammarLoaded } from './highlight.ts'
import type { HighlightSpan } from './highlight.ts'

export function useGrammarReady(lang: string | undefined): boolean {
  const resolved = grammarForHint(lang)
  const subscribe = useCallback((listener: () => void) => subscribeGrammarLoaded(resolved, listener), [resolved])
  const snapshot = useCallback(() => isGrammarLoaded(resolved), [resolved])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** An old task can neither publish after cleanup nor paint a result for changed props. */
export function useDeferredHighlightChunks(code: string, lang: string | undefined, enabled: boolean, ready: boolean) {
  const [result, setResult] = useState<{ code: string; lang: string | undefined; chunks: HighlightSpan[][][] }>()
  useEffect(() => {
    if (!enabled) {
      setResult(undefined)
      return
    }
    const controller = new AbortController()
    const chunks: HighlightSpan[][][] = []
    void highlightLinesAsync(code, lang, controller.signal, lines => {
      if (controller.signal.aborted) return
      chunks.push(lines)
      // The tokenizer has already yielded outside React's effect. Commit this
      // small upgrade now so concurrent batching cannot turn all chunks back
      // into one large DOM insertion when the computation finishes.
      flushSync(() => setResult({ code, lang, chunks: [...chunks] }))
    })
    return () => { controller.abort() }
  }, [code, lang, enabled, ready])
  return enabled && result?.code === code && result.lang === lang ? result.chunks : undefined
}
