// Derived from deepseek-ai/deepseek-harness (MIT), 22ddee37 + dsh-ui.patch; see provenance.json.
/** Markdown blockquotes produce atomic quote nodes and inline separator replacements. */
import { messageQuoteRanges, quoteTextOf } from './quote-text.ts'
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    quote: { readonly text: string }
  }
}

/** Recognize blockquote lines and display adjacent paragraph separators as inline spaces. */
export const quoteRule: UserTextRule<'quote'> = {
  id: 'quote',
  order: -10,
  match(text, from) {
    for (const range of messageQuoteRanges(text)) {
      const preceding = /(?:\r?\n){2}$/.exec(text.slice(Math.max(0, range.start - 4), range.start))?.[0]
      for (const start of [range.start - (preceding?.length ?? 0), range.start, range.end]) {
        if (start < from) continue
        if (start === range.start) {
          return { id: 'quote', start, end: range.end, data: { text: quoteTextOf(text.slice(start, range.end)) } }
        }
        const separator = /^(?:\r?\n){2}/.exec(text.slice(start, start + 4))?.[0]
        if (separator !== undefined) {
          return { id: 'text', start, end: start + separator.length, data: { text: separator, display: ' ' } }
        }
      }
    }
    return undefined
  },
}
