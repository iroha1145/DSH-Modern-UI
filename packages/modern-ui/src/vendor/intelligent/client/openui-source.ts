/** Pure helpers for openui-lang fences: which bodies to render, size bounds, and the text a @ToAssistant click proposes. */

const MESSAGE_LIMIT = 4000
const VALUE_LIMIT = 300
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

/** What a @ToAssistant click carries, read from the renderer's action event and its latest state. */
export interface AssistantRequest {
  readonly message: string
  /** The Form the button sits in, if any. */
  readonly formName?: string
  /** The renderer's state: `{ formName: { field: { value, componentType } }, field: {...}, $name: value }`. */
  readonly state?: Record<string, unknown>
  /** The step's optional `context` argument. */
  readonly context?: unknown
}

const isField = (value: unknown): value is { value: unknown } =>
  value !== null && typeof value === 'object' && 'value' in value && 'componentType' in value

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== ''

function show(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT - 1)}…` : text
}

/**
 * The text a @ToAssistant click proposes: the authored message, then the fields of the button's own Form
 * (or the loose fields when it has none), the block's non-empty $variables, and the step's context.
 * @param request - The message, form, renderer state and context of one click.
 * @returns The proposed user message, at most a few thousand characters.
 */
export function assistantMessage(request: AssistantRequest): string {
  const lines: string[] = []
  const state = request.state ?? {}
  const form = request.formName === undefined ? undefined : state[request.formName]
  const fields = form !== null && typeof form === 'object' && !isField(form)
    ? Object.entries(form as Record<string, unknown>)
    : Object.entries(state).filter(([key, entry]) => !key.startsWith('$') && isField(entry))
  for (const [name, field] of fields) if (isField(field) && present(field.value)) lines.push(`- ${name}: ${show(field.value)}`)
  for (const [key, value] of Object.entries(state)) if (key.startsWith('$') && present(value)) lines.push(`- ${key.slice(1)}: ${show(value)}`)
  if (present(request.context)) lines.push(`- context: ${show(request.context)}`)
  const text = [request.message.trim(), lines.join('\n')].filter(part => part !== '').join('\n\n')
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text
}
