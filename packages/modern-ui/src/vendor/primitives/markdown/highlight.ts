import type { Context } from '@deepseek-ai/cordis'
import type { LanguageRegistration } from 'shiki'
import { grammarForHint } from './highlight-language.ts'
import { LAZY_GRAMMARS } from './highlight-grammars.ts'
import type { HighlightRequest, HighlightReply, JobReply, StreamProgress } from './highlight-protocol.ts'

export { grammarForHint, supportsHighlighting, withinHighlightBudget, HIGHLIGHT_CHUNK_LINES } from './highlight-language.ts'
export { patchGoGrammar } from './highlight-grammars.ts'
export type { HighlightSpan, StreamingHighlightFrame } from './highlight-tokenizer.ts'

export class HighlightWorkerError extends Error {}
interface GrammarFailure { error: unknown }
const requested = new Map<string, Promise<void>>()
const listeners = new Map<string, Set<() => void>>()
const loadedGrammars = new Set<string>()
const failures = new Map<string, GrammarFailure>()
const registrations = new Map<number, { resolve: (languages: string[]) => void; reject: (error: unknown) => void }>()
const jobs = new Map<number, (reply: JobReply) => void>()
const views = new Set<ViewState>()
let worker: Worker | undefined
let workerUrl: string | undefined
let starting: Promise<Worker | undefined> | undefined
let startup: { resolve: (worker: Worker | undefined) => void; reject: (error: unknown) => void } | undefined
let failedWorker: unknown
let generation = 0
let owners = 0
let nextRequest = 0
let nextJob = 0
let nextView = 0

interface ViewState { id: number; active: boolean; job?: number | undefined }
export interface HighlightView {
  readonly id: number
  run(code: string, language: string, streaming: boolean, format: 'html' | 'lines', progress: StreamProgress | undefined, receive: (reply: JobReply) => void): () => void
  settle(): void
  dispose(): void
}

function notify(language: string): void {
  for (const listener of listeners.get(language) ?? []) listener()
}

function stopWorker(error?: unknown): void {
  worker?.terminate()
  worker = undefined
  if (workerUrl !== undefined) URL.revokeObjectURL(workerUrl)
  workerUrl = undefined
  if (error === undefined) startup?.resolve(undefined)
  else startup?.reject(error)
  startup = undefined
  for (const registration of registrations.values()) registration.reject(error ?? new DOMException('Highlighter owner disposed', 'AbortError'))
  registrations.clear()
  jobs.clear()
}

function failWorker(error: HighlightWorkerError): void {
  failedWorker = error
  for (const language of requested.keys()) failures.set(language, { error })
  loadedGrammars.clear()
  for (const [jobId, receive] of jobs) receive({ kind: 'job-error', jobId, message: error.message })
  generation += 1
  stopWorker(error)
  for (const language of requested.keys()) notify(language)
}

function disposeWorker(): void {
  generation += 1
  for (const view of views) view.active = false
  views.clear()
  stopWorker()
  starting = undefined
  failedWorker = undefined
  requested.clear()
  loadedGrammars.clear()
  failures.clear()
  for (const language of listeners.keys()) notify(language)
}

/** A plugin owns the reusable engine; standalone code views own it until their last view exits. */
export function installHighlighting(ctx: Context): void {
  ctx.effect(() => {
    owners += 1
    return () => { owners -= 1; if (owners === 0) disposeWorker() }
  })
}

function startWorker(): Promise<Worker | undefined> {
  if (failedWorker !== undefined) return Promise.reject(failedWorker)
  if (starting !== undefined) return starting
  const epoch = generation
  starting = import('./highlight.worker.ts?worker-source').then(module => {
    if (epoch !== generation) return undefined
    return new Promise<Worker | undefined>((resolve, reject) => {
      startup = { resolve, reject }
      workerUrl = URL.createObjectURL(new Blob([module.default], { type: 'text/javascript' }))
      worker = new Worker(workerUrl, { name: 'modern-syntax-highlighting' })
      worker.onmessage = (event: MessageEvent<HighlightReply>) => {
        if (epoch !== generation) return
        const reply = event.data
        switch (reply.kind) {
          case 'worker-ready': startup!.resolve(worker); startup = undefined; break
          case 'registered': {
            const pending = registrations.get(reply.requestId)!
            registrations.delete(reply.requestId)
            pending.resolve(reply.languages)
            break
          }
          case 'register-error': {
            const pending = registrations.get(reply.requestId)!
            registrations.delete(reply.requestId)
            pending.reject(new HighlightWorkerError(reply.message))
            break
          }
          default: {
            const receive = jobs.get(reply.jobId)
            if (receive === undefined) return
            receive(reply)
            if (reply.kind === 'done' || reply.kind === 'job-error') jobs.delete(reply.jobId)
          }
        }
      }
      worker.onerror = event => { event.preventDefault(); failWorker(new HighlightWorkerError(event.message)) }
    })
  }).catch(error => {
    if (epoch !== generation) return undefined
    failedWorker = error
    stopWorker(error)
    throw error
  })
  return starting
}

function register(target: Worker, language: string, grammars: LanguageRegistration[]): Promise<string[]> {
  const requestId = ++nextRequest
  return new Promise((resolve, reject) => {
    registrations.set(requestId, { resolve, reject })
    target.postMessage({ kind: 'register', requestId, language, grammars } satisfies HighlightRequest)
  })
}

export function requestGrammar(lang: string | undefined): void {
  const language = grammarForHint(lang)
  if (language === undefined || requested.has(language)) return
  const epoch = generation
  const load = LAZY_GRAMMARS.get(language)!
  const request = Promise.all([startWorker(), load()]).then(async ([target, grammar]) => {
    if (epoch !== generation || target === undefined) return
    const languages = await register(target, language, grammar.default)
    if (epoch !== generation) return
    for (const id of languages) {
      if (loadedGrammars.has(id)) continue
      loadedGrammars.add(id)
      failures.delete(id)
      notify(id)
    }
  }).catch(error => {
    if (epoch !== generation) return
    failures.set(language, { error })
    notify(language)
  })
  requested.set(language, request)
}

export function subscribeGrammarLoaded(lang: string | undefined, listener: () => void): () => void {
  const language = grammarForHint(lang)
  if (language === undefined) return () => {}
  let subscribers = listeners.get(language)
  if (subscribers === undefined) listeners.set(language, subscribers = new Set())
  subscribers.add(listener)
  return () => { subscribers.delete(listener); if (subscribers.size === 0) listeners.delete(language) }
}

export function isGrammarLoaded(lang: string | undefined): boolean {
  const language = grammarForHint(lang)
  return language !== undefined && loadedGrammars.has(language)
}

export function grammarLoadState(lang: string | undefined): boolean | GrammarFailure {
  const language = grammarForHint(lang)
  return language === undefined ? false : failures.get(language) ?? loadedGrammars.has(language)
}

export function retryGrammar(lang: string | undefined): void {
  const language = grammarForHint(lang)
  if (language === undefined || !failures.has(language)) return
  if (failedWorker !== undefined) { failedWorker = undefined; starting = undefined }
  failures.delete(language)
  requested.delete(language)
  requestGrammar(language)
  notify(language)
}

export function createHighlightView(): HighlightView {
  const state: ViewState = { id: ++nextView, active: true }
  views.add(state)
  const cancel = (): void => {
    if (state.job === undefined) return
    jobs.delete(state.job)
    worker?.postMessage({ kind: 'cancel', jobId: state.job, viewId: state.id } satisfies HighlightRequest)
    state.job = undefined
  }
  return {
    id: state.id,
    run(code, language, streaming, format, progress, receive) {
      cancel()
      if (!state.active) return () => {}
      const jobId = ++nextJob
      state.job = jobId
      jobs.set(jobId, receive)
      worker!.postMessage({ kind: 'highlight', jobId, viewId: state.id, code, language, streaming, format,
        progress: progress?.viewId === state.id ? progress : undefined } satisfies HighlightRequest)
      return cancel
    },
    settle() { if (state.active) worker?.postMessage({ kind: 'settled', viewId: state.id } satisfies HighlightRequest) },
    dispose() {
      if (!state.active) return
      cancel()
      state.active = false
      views.delete(state)
      worker?.postMessage({ kind: 'release', viewId: state.id } satisfies HighlightRequest)
      if (views.size === 0 && owners === 0) disposeWorker()
    },
  }
}
