/** Follow an official presentation entry without replacing its business owner. */
import type { Context } from '@deepseek-ai/cordis'
import type { SlotMap, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export interface PresentationShadow {
  /** Identify the source entry, excluding this plugin's own contribution. */
  source(entry: StoredEntry): boolean
  /** Install one presentation using the source's public face and return its disposer. */
  register(entry: StoredEntry): () => void
}

/** Rebind when a source entry is removed or replaced; cleanup restores ordinary slot election. */
export function watchPresentation(ctx: Context, slot: keyof SlotMap & string, shadow: PresentationShadow): () => void {
  return ctx.effect(() => {
    let source: StoredEntry | undefined
    let release: (() => void) | undefined
    let active = true
    const sync = (): void => {
      if (!active) return
      const next = ctx.slots.entries(slot).find(shadow.source)
      if (next === source) return
      release?.()
      release = undefined
      source = next
      if (next !== undefined) release = shadow.register(next)
    }
    const unsubscribe = ctx.slots.subscribe(slot, sync)
    try {
      sync()
    } catch (error) {
      unsubscribe()
      throw error
    }
    return () => {
      active = false
      unsubscribe()
      release?.()
      release = undefined
      source = undefined
    }
  })
}
