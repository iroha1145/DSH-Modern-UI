/// <reference lib="webworker" />
import { engine, registerGrammar } from './highlight-engine.ts'
import { highlightToHtml, highlightLinesAsync, StreamingHighlightSession } from './highlight-tokenizer.ts'
import type { HighlightRequest, HighlightReply } from './highlight-protocol.ts'
import { HIGHLIGHT_CHUNK_LINES } from './highlight-language.ts'

const scope = self as unknown as DedicatedWorkerGlobalScope
const sessions = new Map<number, { id: number; tokenizer: StreamingHighlightSession }>()
const jobs = new Map<number, { id: number; controller: AbortController }>()
const send = (reply: HighlightReply): void => scope.postMessage(reply)

async function highlight(request: Extract<HighlightRequest, { kind: 'highlight' }>): Promise<void> {
  jobs.get(request.viewId)?.controller.abort()
  const controller = new AbortController()
  jobs.set(request.viewId, { id: request.jobId, controller })
  try {
    if (request.streaming) {
      let session = sessions.get(request.viewId)
      if (session === undefined) {
        session = { id: request.jobId, tokenizer: new StreamingHighlightSession() }
        sessions.set(request.viewId, session)
      }
      const frame = session.tokenizer.updateFrame(request.code, request.language)!
      const progress = request.progress
      let from = progress?.sessionId === session.id && progress.generation === frame.generation ? progress.lines : 0
      const completed = session.tokenizer.completedLineCount
      do {
        if (controller.signal.aborted) return
        let end = Math.min(from + HIGHLIGHT_CHUNK_LINES, completed)
        // The final growing line upgrades too, so leave one slot for it.
        if (end === completed && frame.settled && end - from === HIGHLIGHT_CHUNK_LINES) end -= 1
        const prefixLength = session.tokenizer.prefixOffset(end)
        const final = end === completed
        send({ kind: 'frame', jobId: request.jobId, frame: {
          ...frame, sessionId: session.id, from, appended: session.tokenizer.completedSince(from, end),
          prefixLength, completedLines: end,
          tail: final ? frame.tail : request.code.slice(prefixLength).split(/\r?\n/).map(text => [{ text, style: {} }]),
          settled: final && frame.settled,
        } })
        from = end
        if (!final) await new Promise<void>(resolve => setTimeout(resolve, 0))
      } while (from < completed)
    } else {
      sessions.delete(request.viewId)
      const html = request.format === 'html' ? highlightToHtml(request.code, request.language) : undefined
      if (html !== undefined) send({ kind: 'html', jobId: request.jobId, html })
      else await highlightLinesAsync(request.code, request.language, controller.signal, lines => send({ kind: 'chunk', jobId: request.jobId, lines }))
    }
    if (!controller.signal.aborted) send({ kind: 'done', jobId: request.jobId })
  } catch (error) {
    send({ kind: 'job-error', jobId: request.jobId, message: (error as Error).message })
  } finally {
    if (jobs.get(request.viewId)?.id === request.jobId) jobs.delete(request.viewId)
  }
}

scope.onmessage = (event: MessageEvent<HighlightRequest>): void => {
  const request = event.data
  switch (request.kind) {
    case 'register':
      try {
        registerGrammar(request.grammars, request.language)
        send({ kind: 'registered', requestId: request.requestId, languages: engine.getLoadedLanguages() })
      } catch (error) {
        send({ kind: 'register-error', requestId: request.requestId, message: (error as Error).message })
      }
      break
    case 'highlight': void highlight(request); break
    case 'cancel':
      if (jobs.get(request.viewId)?.id === request.jobId) jobs.get(request.viewId)!.controller.abort()
      break
    case 'release':
      jobs.get(request.viewId)?.controller.abort()
      jobs.delete(request.viewId)
      sessions.delete(request.viewId)
      break
    case 'settled': sessions.delete(request.viewId); break
  }
}
send({ kind: 'worker-ready' })
