/** A per-block budget on how far an openui-lang program expands, counted while the Renderer evaluates and draws it. */
import type { Library } from '@openuidev/react-lang'

/**
 * Steps one evaluation and render of a block may take. Looking up a component (once or twice while evaluating
 * it, once more to draw it) and calling an @function count one step; drawing a component and each item of a
 * list a function returns, which can drive one more loop pass, count about five, so about 20,000 fit.
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

/**
 * The library as one block's Renderer sees it: the same components and functions, with every component lookup and
 * draw, @function call and returned list item counted. These are the runtime's only calls into plugin code while it
 * expands @Each, so a loop whose bounds come from variables, state or function results is still counted. Over
 * budget, a function call or a component's evaluation throws, which the runtime catches and which abandons the
 * expansion in progress, and a component draws nothing: a throw while drawing would make React 18 still render,
 * and log, every sibling.
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
        fn: (args: Record<string, unknown>) => {
          if (!budget.step()) throw over()
          const result: unknown = definition.fn(args)
          if (Array.isArray(result) && !budget.step(result.length * ITEM_STEPS)) throw over()
          return result
        },
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
