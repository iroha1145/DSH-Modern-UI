/** Pure helpers for openui-lang fences: which bodies to render, size bounds, and the text a @ToAssistant click sends. */
import type { ActionEvent } from '@openuidev/lang-core'

const MESSAGE_LIMIT = 4000
/** Model-authored source beyond this length is shown as code, never parsed. */
export const CONTENT_LIMIT = 128_000

/**
 * Whether a fence body reads as openui-lang: its first statement assigns a name or a $variable.
 * Older answers used the `openui` fence for HTML or JSON visualizations, which this renderer leaves as code.
 * @param code - The fence body, possibly still streaming.
 * @returns True for openui-lang source.
 */
export function looksLikeOpenUI(code: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*)*\$?[A-Za-z_][\w]*\s*=/.test(code)
}

/**
 * The text a @ToAssistant click sends: the authored message, then the values the reader entered.
 * @param event - The action event from the renderer.
 * @returns The next user message, at most a few thousand characters.
 */
export function assistantMessage(event: Pick<ActionEvent, 'humanFriendlyMessage' | 'formState'>): string {
  const lines: string[] = []
  const show = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value)
  for (const [key, entry] of Object.entries(event.formState ?? {})) {
    if (key.startsWith('$')) {
      if (entry !== null && entry !== undefined && entry !== '') lines.push(`- ${key.slice(1)}: ${show(entry)}`)
      continue
    }
    if (entry === null || typeof entry !== 'object') continue
    for (const [field, state] of Object.entries(entry as Record<string, unknown>)) {
      const value = state !== null && typeof state === 'object' && 'value' in state ? (state as { value: unknown }).value : state
      if (value !== null && value !== undefined && value !== '') lines.push(`- ${field}: ${show(value)}`)
    }
  }
  const text = [event.humanFriendlyMessage.trim(), lines.join('\n')].filter(part => part !== '').join('\n\n')
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text
}
