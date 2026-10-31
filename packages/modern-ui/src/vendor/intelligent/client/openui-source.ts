/** Pure helpers for openui-lang fences: which bodies to render, size bounds, and the text a @ToAssistant click proposes. */

const MESSAGE_LIMIT = 4000
const VALUE_LIMIT = 300
/** Model-authored source beyond this length is shown as code, never parsed. */
export const CONTENT_LIMIT = 128_000
/** Upper bound on the items one block's @Each loops may expand to, nested loops multiplied. */
export const EXPANSION_LIMIT = 20_000
// A loop over a list whose length the source does not fix (function results, values set at runtime) counts as
// this many; the block's runtime budget counts what such loops really expand to.
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

/**
 * Whether Markdown text holds a closed fence the presenter renders as components: `openui-lang`, or `openui` whose
 * body reads as openui-lang. A fence still streaming, or a fence name mentioned inside prose, does not count.
 * @param text - Assistant reply text.
 * @returns True when a complete openui-lang fence is present.
 */
export function hasOpenUIFence(text: string): boolean {
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const open = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(lines[index])
    if (open === null) continue
    const [, marker, info] = open
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`)
    const end = lines.findIndex((line, at) => at > index && close.test(line))
    if (end < 0) return false
    const lang = info.toLowerCase()
    if (lang === 'openui-lang' || (lang === 'openui' && looksLikeOpenUI(lines.slice(index + 1, end).join('\n')))) return true
    index = end
  }
  return false
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

type Node = { readonly [key in 'k' | 'name' | 'args' | 'mappedProps' | 'els' | 'v' | 'n' | 'obj' | 'field' | 'entries']?: unknown }
type States = Readonly<Record<string, unknown>>

// lang-core's own node kinds: data such as {k: "Q1", a: 10} is a value, as lang-core reads it.
const KINDS = new Set(['Comp', 'Ref', 'StateRef', 'RuntimeRef', 'BinOp', 'UnaryOp', 'Ternary', 'Member', 'Index', 'Assign', 'Str', 'Num', 'Bool', 'Null', 'Arr', 'Obj', 'Ph'])
const isAst = (value: unknown): value is Node =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && KINDS.has((value as Node).k as string)

/** Follow a $variable to its declared value and a field of a literal object or declared value to the field. */
function resolve(node: unknown, states: States): unknown {
  if (!isAst(node)) return node
  if (node.k === 'StateRef' && typeof node.n === 'string') return states[node.n]
  if (node.k !== 'Member' || typeof node.field !== 'string') return node
  const field = node.field
  const owner = resolve(node.obj, states)
  if (isAst(owner)) {
    if (owner.k !== 'Obj' || !Array.isArray(owner.entries)) return node
    return resolve((owner.entries as [unknown, unknown][]).find(([key]) => key === field)?.[1], states)
  }
  return owner !== null && typeof owner === 'object' && !Array.isArray(owner) ? (owner as Record<string, unknown>)[field] : node
}

/**
 * The length of a list expression when the source fixes it: a literal array, a $variable's declared array, a
 * field of either, @Range with literal bounds, or @Sort, @Filter or @Each over one of those.
 */
function listLength(expression: unknown, states: States): number {
  const node = resolve(expression, states)
  if (!isAst(node)) return Array.isArray(node) ? node.length : UNKNOWN_LENGTH
  if (node.k === 'Arr' && Array.isArray(node.els)) return node.els.length
  // Built-ins the runtime cannot count; none returns more items than its list has.
  if (node.k === 'Comp' && (node.name === 'Sort' || node.name === 'Filter' || node.name === 'Each') && Array.isArray(node.args)) {
    return listLength(node.args[0], states)
  }
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
 * @param states - The parse result's $variable declarations.
 * @returns Estimated expanded items; compare with EXPANSION_LIMIT.
 */
export function expansionEstimate(root: unknown, states: States = {}): number {
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
      total = walk(list) + listLength(list, states) * (1 + walk(template))
      // A call's mappedProps hold the same expressions as its args, so a loop inside one counts once.
    } else if (isAst(value) && value.k === 'Comp' && value.mappedProps !== undefined) total = walk(value.mappedProps)
    else total = Object.values(value).reduce((sum: number, item) => sum + walk(item), 0)
    open.delete(value)
    // Saturate so an absurd program cannot overflow into a small number.
    total = Math.min(total, Number.MAX_SAFE_INTEGER)
    known.set(value, total)
    return total
  }
  return walk(root)
}
