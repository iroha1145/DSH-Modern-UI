import type { LanguageRegistration } from 'shiki'
import type { HighlightSpan, StreamingHighlightFrame } from './highlight-tokenizer.ts'

export interface StreamProgress { viewId: number; sessionId: number; generation: number; lines: number }
export interface WorkerFrame extends StreamingHighlightFrame {
  sessionId: number
  from: number
  prefixLength: number
  completedLines: number
}
export type HighlightRequest =
  | { kind: 'register'; requestId: number; language: string; grammars: LanguageRegistration[] }
  | { kind: 'highlight'; jobId: number; viewId: number; code: string; language: string; streaming: boolean; format: 'html' | 'lines'; progress?: StreamProgress | undefined }
  | { kind: 'cancel'; jobId: number; viewId: number }
  | { kind: 'release'; viewId: number }
  | { kind: 'settled'; viewId: number }

export type HighlightReply =
  | { kind: 'worker-ready' }
  | { kind: 'registered'; requestId: number; languages: string[] }
  | { kind: 'register-error'; requestId: number; message: string }
  | { kind: 'frame'; jobId: number; frame: WorkerFrame }
  | { kind: 'html'; jobId: number; html: string }
  | { kind: 'chunk'; jobId: number; lines: HighlightSpan[][] }
  | { kind: 'done'; jobId: number }
  | { kind: 'job-error'; jobId: number; message: string }

export type JobReply = Extract<HighlightReply, { jobId: number }>
