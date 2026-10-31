/** A per-block budget on how far an openui-lang program expands, counted while the Renderer evaluates and draws it. */
import { __dshSetCounters } from '@openuidev/lang-core'
import type { Library } from '@openuidev/react-lang'

type EvaluationContext = { readonly functions?: Readonly<Record<string, { readonly fn?: unknown } | undefined>> }
declare module '@openuidev/lang-core' {
  /** Added to the bundled copy by scripts/openui-each-counter.mjs; a counter answering false refuses the work. */
  export function __dshSetCounters(
    counters: {
      each(items: number, context: EvaluationContext): boolean
      built(items: number, context: EvaluationContext): boolean
      result(value: unknown, context: EvaluationContext): boolean
    } | null,
  ): void
}

/**
 * Steps one evaluation and render of a block may take. Looking up a component (once or twice while evaluating
 * it, once more to draw it), calling a function, each item of the lists it is given and each item of a list or
 * object the evaluator builds count one step; each @Each pass, each value a pass produces, each item of a list a
 * function returns and each component drawn count about five, so about 20,000 of those fit, fewer when they combine.
 */
export const STEP_LIMIT = 100_000
// On top of the lookup that precedes every draw.
const DRAW_STEPS = 4
const ITEM_STEPS = 5

/** Counts a block's steps; once past the limit the block stays over budget until it is reset. */
export class ExpansionBudget {
  #steps = 0
  #counting = false
  #exceeded = false
  readonly #listeners = new Set<() => void>()

  /**
   * Count steps of the evaluation or render in progress.
   * @param count - Steps to add.
   * @returns False once the block is over budget.
   */
  step(count = 1): boolean {
    if (this.#exceeded) return false
    // An evaluation runs synchronously, so the count starts over at the next microtask.
    if (!this.#counting) {
      this.#counting = true
      queueMicrotask(() => {
        this.#steps = 0
        this.#counting = false
      })
    }
    this.#steps += count
    if (this.#steps <= STEP_LIMIT) return true
    this.exceed()
    return false
  }

  /** Put the block over budget, for example when new state would make its loops too long. */
  exceed(): void {
    if (this.#exceeded) return
    this.#exceeded = true
    // Listeners re-render after the render that tripped the budget, never inside it.
    queueMicrotask(() => this.#notify())
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly exceeded = (): boolean => this.#exceeded

  /** Give the block a fresh attempt. */
  reset(): void {
    if (!this.#exceeded) return
    this.#exceeded = false
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

const over = () => new Error('openui-lang block is over its expansion budget')
// A view's functions reach every evaluation context its Renderer builds, so they name the block evaluating.
const owners = new WeakMap<object, ExpansionBudget>()

/**
 * The library as one block's Renderer sees it: the same components and functions, with every component lookup and
 * draw, @function call and returned list item counted; the patched @Each counts its own passes against the same
 * budget. Over budget, a function call or a component's evaluation throws, which the runtime catches and which
 * abandons the expansion in progress, and a component draws nothing: a throw while drawing would make React 18
 * still render, and log, every sibling.
 * @param library - The shared component library.
 * @param budget - The block's budget.
 * @returns A view of `library` to pass to that block's Renderer, created once per block.
 */
export function budgeted<L extends Library>(library: L, budget: ExpansionBudget): L {
  const functions = Object.fromEntries(
    Object.entries(library.functions ?? {}).map(([name, definition]) => [
      name,
      {
        ...definition,
        fn: owned(budget, (args: Record<string, unknown>) => {
          // A function walks the lists it is given, like the built-in ones the patched evaluator charges.
          if (!budget.step(1 + Object.values(args).reduce((items: number, arg) => items + (Array.isArray(arg) ? arg.length : 0), 0))) throw over()
          const result: unknown = definition.fn(args)
          if (Array.isArray(result) && !budget.step(result.length * ITEM_STEPS)) throw over()
          return result
        }),
      },
    ]),
  )
  // Evaluation reads a component's `props` schema, and only the Renderer reads `component`, once per node drawn.
  const components = Object.fromEntries(
    Object.entries(library.components).map(([name, definition]) => [
      name,
      Object.create(definition, {
        props: {
          get() {
            if (budget.exceeded()) throw over()
            return definition.props
          },
        },
        component: {
          get() {
            return budget.step(DRAW_STEPS) ? definition.component : undefined
          },
        },
      }),
    ]),
  )
  return {
    ...library,
    functions,
    get components() {
      budget.step()
      return components
    },
  }
}

function owned<F extends object>(budget: ExpansionBudget, fn: F): F {
  owners.set(fn, budget)
  return fn
}

// Evaluations no block claims, outside any block's Renderer, still stop within one synchronous run.
let unclaimed = 0

/** Charge the block whose Renderer built `context`, or the unclaimed run; false once over budget. */
function charge(context: EvaluationContext, steps: number): boolean {
  let budget: ExpansionBudget | undefined
  for (const name in context.functions) {
    budget = owners.get(context.functions[name]?.fn as object)
    break
  }
  if (budget !== undefined) return steps === 0 ? !budget.exceeded() : budget.step(steps)
  if (steps > 0 && unclaimed === 0) {
    queueMicrotask(() => {
      unclaimed = 0
    })
  }
  unclaimed += steps
  return unclaimed <= STEP_LIMIT
}

const OUTPUT_LIMIT = Math.ceil(STEP_LIMIT / ITEM_STEPS) + 1

/**
 * How much one loop pass produced, up to OUTPUT_LIMIT: every text, number or flag, and every list, reached
 * through lists, plain objects and the props of components, which draw them (raw text, table rows, chart points).
 */
function output(value: unknown): number {
  let count = 0
  const stack = [value]
  while (stack.length > 0 && count < OUTPUT_LIMIT) {
    const next = stack.pop()
    if (typeof next === 'string' || typeof next === 'number' || typeof next === 'boolean') count += 1
    else if (Array.isArray(next)) {
      count += 1
      for (const item of next) stack.push(item)
    } else if (next !== null && typeof next === 'object' && typeof (next as { k?: unknown }).k !== 'string') {
      // A component's own fields name it; only its props are drawn. Unevaluated expressions are never drawn.
      const fields = (next as { type?: unknown; props?: unknown }).type === 'element' ? (next as { props?: object }).props : next
      if (fields) for (const item of Object.values(fields)) stack.push(item)
    }
  }
  return count
}

// The evaluator asks before it expands a loop, builds a list or object, or hands back what a pass produced. The
// block whose Renderer built the evaluation context pays, which holds even when React interleaves the renders of
// several blocks. A refusal makes the evaluator return an empty value, so nothing throws out of a click handler.
__dshSetCounters({
  each: (items, context) => charge(context, items * ITEM_STEPS),
  built: (items, context) => items === 0 || charge(context, items),
  result: (value, context) => charge(context, output(value) * ITEM_STEPS),
})
