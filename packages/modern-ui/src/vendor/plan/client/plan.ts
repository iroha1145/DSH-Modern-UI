// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/**
 * Plan documents as the preview reads them. The official ui-plan package keeps
 * the resource provider, the tab type, the cards and the chip; the plugin only
 * draws the preview body, so these are the two document shapes and the
 * resource protocol merge the official package's `.d.ts` keeps off its public
 * `./client` path.
 */
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Complete Markdown and the heading displayed by a plan preview. */
export interface PlanDocument {
  readonly markdown: string
  readonly title: string
}

/** One submitted plan, identified by its originating tool invocation. */
export interface SubmittedPlan extends PlanDocument {
  readonly callId: ToolCallId
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The resource URL does not identify a plan invocation. */
    'plan/invalid-address': Record<string, never>
    /** Session history ended before an opening snapshot. */
    'plan/unavailable': Record<string, never>
    /** The Session has no readable plan for this invocation. */
    'plan/not-found': Record<string, never>
    /** The Session history read failed. */
    'plan/read-failed': Record<string, never>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Immutable Markdown from a logged exit_plan_mode invocation (served by the official ui-plan provider). */
    plan: SubmittedPlan
  }
}
