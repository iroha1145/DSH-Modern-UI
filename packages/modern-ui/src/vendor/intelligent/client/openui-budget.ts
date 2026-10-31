/** A per-block budget on how far an openui-lang program expands, counted while the Renderer evaluates and draws it. */
import { __dshSetEachCounter } from '@openuidev/lang-core'
import type { Library } from '@openuidev/react-lang'

declare module '@openuidev/lang-core' {
  /** Added to the bundled copy by scripts/openui-each-counter.mjs: the counter sees each @Each list length. */
  export function __dshSetEachCounter(
    counter: ((items: number, context: { readonly functions?: Readonly<Record<string, { readonly fn?: unknown } | undefined>> }) => void) | null,
  ): void
}

/**
 * Steps one evaluation and render of a block may take. Looking up a component (once or twice while evaluating
 * it, once more to draw it) and calling an @function count one step; each @Each pass, each item of a list a
 * function returns and each component drawn count about five, so about 20,000 fit, fewer when they combine.
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
          if (!budget.step()) throw over()
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

// Every @Each, whatever its list and body, charges the block whose Renderer built the evaluation context, which
// holds even when React interleaves the renders of several blocks. Throwing makes lang-core abandon the loop,
// like an over-budget function call.
__dshSetEachCounter((items, context) => {
  if (items === 0) return
  const steps = items * ITEM_STEPS
  let budget: ExpansionBudget | undefined
  for (const name in context.functions) {
    budget = owners.get(context.functions[name]?.fn as object)
    break
  }
  if (budget !== undefined) {
    if (!budget.step(steps)) throw over()
    return
  }
  if (unclaimed === 0) {
    queueMicrotask(() => {
      unclaimed = 0
    })
  }
  unclaimed += steps
  if (unclaimed > STEP_LIMIT) throw over()
})
