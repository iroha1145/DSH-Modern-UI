import type { Nodes } from 'mdast'
import { parseGfm } from './parse.ts'

/** Remove unambiguous strong delimiters from a bounded status preview. */
export function stripStrong(text: string): string {
  // A grapheme can contain arbitrarily many combining marks. Keep that literal
  // instead of feeding an unbounded cluster to the Markdown parser.
  if (text.length > 512) return text
  if (!text.includes('**') && !text.includes('__')) return text
  const delimiters: number[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'strong') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) {
        // CommonMark also recognizes strong across separate glob paths or
        // inside ASCII expressions. Those are ambiguous in a status line.
        if (/[A-Za-z0-9_\\/]/.test(text[start - 1] ?? '') || /[\\/]/.test(text[end] ?? '')) return
        delimiters.push(start, end - 2)
      }
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(parseGfm(text))
  let result = text
  for (const offset of delimiters.sort((a, b) => b - a)) {
    result = result.slice(0, offset) + result.slice(offset + 2)
  }
  return result
}
