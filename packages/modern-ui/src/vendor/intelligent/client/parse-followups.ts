/** Parsing of the `followups` fence the assistant ends a substantive answer with. */

/** Most questions shown; the guidance asks for two or three, and extra lines are dropped. */
const MAX_QUESTIONS = 5

/** Longest line, in UTF-16 units, accepted as a question; a longer line is prose, not a suggestion. */
const MAX_QUESTION_LENGTH = 200

/** A bullet or ordinal the model may add despite being told not to: `-`, `*`, `•`, `1.`, `1)`, `1、`, `(1)`. */
const LIST_MARKER = /^(?:[-*•·]|\d{1,2}[.)、]|[(（]\d{1,2}[)）])(?:\s+|$)/u

/** A line with no letter or digit, such as a lone dash or an ellipsis, is not a question. */
const HAS_TEXT = /[\p{L}\p{N}]/u

/** One pair of quotation marks wrapping the whole line. */
const QUOTED_LINE = /^["'“‘「『](.+)["'”’」』]$/u

/**
 * Read the follow-up questions out of a `followups` fence body.
 * @param code - The fence body: one question per line.
 * @returns Distinct questions in authored order, without list markers or wrapping quotation marks;
 * lines without a letter or digit, lines longer than 200 characters, and everything beyond the fifth question are dropped.
 */
export function parseFollowups(code: string): readonly string[] {
  const questions = new Set<string>()
  for (const line of code.split(/\r?\n/u)) {
    const text = line.trim().replace(LIST_MARKER, '')
    const [, inner = text] = QUOTED_LINE.exec(text) ?? []
    const question = inner.trim()
    if (HAS_TEXT.test(question) && question.length <= MAX_QUESTION_LENGTH) questions.add(question)
    if (questions.size === MAX_QUESTIONS) break
  }
  return [...questions]
}
