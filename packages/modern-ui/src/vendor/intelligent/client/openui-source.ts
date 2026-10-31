/** Pure helpers for openui-lang fences: which bodies to render, size bounds, and the text a @ToAssistant click proposes. */

const MESSAGE_LIMIT = 4000
const VALUE_LIMIT = 300
/** Model-authored source beyond this length is shown as code, never parsed. */
export const CONTENT_LIMIT = 128_000
/** Upper bound on the items one block's @Each loops may expand to, nested loops multiplied. */
export const EXPANSION_LIMIT = 20_000
// A loop over a list whose length is unknown before it runs ($variables, function results) counts as this many.
const UNKNOWN_LENGTH = 100

/**
 * Whether a fence body reads as openui-lang: its first statement assigns a name or a $variable.
 * Older answers used the `openui` fence for HTML or JSON visualizations, which this renderer leaves as code.
 * @param code - The fence body, possibly still streaming.
 * @returns True for openui-lang source.
 */
export function looksLikeOpenUI(code: string): boolean {
  return /^\s*(?:\/\/[^\n]*\n\s*)*\$?[A-Za-z_][\w]*\s*=/.test(code)
}

/** What a @ToAssistant click carries. */
export interface AssistantRequest {
  readonly message: string
  /** Label and shown value of every input in the button's Form, or outside any Form. */
  readonly fields?: readonly (readonly [string, unknown])[]
  /** The step's optional `context` argument. */
  readonly context?: unknown
}

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== ''

function show(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT - 1)}…` : text
}

/**
 * The text a @ToAssistant click proposes: the authored message, then what the reader sees in the inputs of the
 * button's Form (or the inputs outside any Form), then the step's context.
 * @param request - The message, shown fields and context of one click.
 * @returns The proposed user message, at most a few thousand characters.
 */
export function assistantMessage(request: AssistantRequest): string {
  const lines: string[] = []
  for (const [label, value] of request.fields ?? []) if (present(value)) lines.push(`- ${label}: ${show(value)}`)
  if (present(request.context)) lines.push(`- context: ${show(request.context)}`)
  const text = [request.message.trim(), lines.join('\n')].filter(part => part !== '').join('\n\n')
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text
}

type Node = { readonly k?: unknown; readonly name?: unknown; readonly args?: unknown; readonly els?: unknown; readonly v?: unknown }

const isAst = (value: unknown): value is Node => value !== null && typeof value === 'object' && typeof (value as Node).k === 'string'

/** The length of a list expression when the source fixes it: a literal array or @Range with literal bounds. */
function listLength(node: unknown): number {
  if (!isAst(node)) return Array.isArray(node) ? node.length : UNKNOWN_LENGTH
  if (node.k === 'Arr' && Array.isArray(node.els)) return node.els.length
  if (node.k === 'Comp' && node.name === 'Range' && Array.isArray(node.args)) {
    const [start, end, step] = (node.args as Node[]).map(arg => (isAst(arg) && arg.k === 'Num' && typeof arg.v === 'number' ? arg.v : undefined))
    if (start !== undefined && end !== undefined) {
      const by = step ?? 1
      return by === 0 ? 0 : Math.max(0, Math.ceil((end - start) / by))
    }
  }
  return UNKNOWN_LENGTH
}

/**
 * Estimate how many items a parsed block's @Each loops expand to before anything evaluates, multiplying nested
 * loops. Parsed props keep unevaluated expressions, so the walk sees every loop with its list and template.
 * @param root - The parse result's root element, or any value inside it.
 * @returns Estimated expanded items; compare with EXPANSION_LIMIT.
 */
export function expansionEstimate(root: unknown): number {
  // A statement used in several places is one shared object: every use counts, each is walked once.
  const known = new Map<object, number>()
  const open = new Set<object>()
  const walk = (value: unknown): number => {
    if (value === null || typeof value !== 'object' || open.has(value)) return 0
    const cached = known.get(value)
    if (cached !== undefined) return cached
    open.add(value)
    let total: number
    if (Array.isArray(value)) total = value.reduce((sum: number, item) => sum + walk(item), 0)
    else if (isAst(value) && value.k === 'Comp' && value.name === 'Each' && Array.isArray(value.args)) {
      const [list, , template] = value.args as unknown[]
      total = walk(list) + listLength(list) * (1 + walk(template))
    } else total = Object.values(value).reduce((sum: number, item) => sum + walk(item), 0)
    open.delete(value)
    // Saturate so an absurd program cannot overflow into a small number.
    total = Math.min(total, Number.MAX_SAFE_INTEGER)
    known.set(value, total)
    return total
  }
  return walk(root)
}
