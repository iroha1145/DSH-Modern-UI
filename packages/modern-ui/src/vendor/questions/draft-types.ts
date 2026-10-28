// Derived from ui-user-questions draft-store (MIT); types only, the official store owns state.
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** One in-progress answer, including an explicit skip. */
export interface QuestionDraftAnswer {
  /** Offered labels currently selected. */
  selected: string[]
  /** Human-authored alternative or additional answer. */
  custom: string
  /** Whether the user explicitly skipped this question. */
  skipped: boolean
}

/** Navigation and answer drafts for one pending request. */
export interface QuestionDraftProgress {
  /** Current question index. */
  index: number
  /** One draft per question, in request order. */
  drafts: QuestionDraftAnswer[]
  /** Local indefinite-wait choice restored with the draft. */
  wait?: 'editing' | 'waiting'
}

interface QuestionDraftState {
  progressByRequest: Record<string, QuestionDraftProgress>
}

type QuestionDraftActions = {
  replace: (draft: QuestionDraftState, requestKey: string, progress: QuestionDraftProgress) => void
  clear: (draft: QuestionDraftState, requestKey: string) => void
  prune: (draft: QuestionDraftState, keep: readonly string[]) => void
}


export type QuestionDraftStore = EngineStoreHandle<QuestionDraftState, QuestionDraftActions>
