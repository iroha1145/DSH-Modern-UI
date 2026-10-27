// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
/** Locale namespace supplied by the conversation owner to Tool renderers. */
export const CONVERSATION_NS = 'modern-tool'

import type * as dictionaries from './dictionaries.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'modern-tool': keyof typeof dictionaries.zh | 'codeBlock.collapse' | 'codeBlock.expand' }
}
