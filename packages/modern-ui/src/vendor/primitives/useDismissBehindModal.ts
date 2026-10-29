import { useLayoutEffect, type RefObject } from 'react'
import { isBehindModal } from './useModalLayer.ts'

const dialogSelector = '[role="dialog"][aria-modal="true"]'

/** Yield an open floating surface when a modern or official modal takes its anchor's foreground. */
export function useDismissBehindModal(
  anchor: RefObject<HTMLElement | null>, open: boolean, dismiss: () => void,
): void {
  useLayoutEffect(() => {
    if (!open) return
    const document = anchor.current?.ownerDocument
    const view = document?.defaultView
    if (document === undefined || view === null || view === undefined) return
    let active = true
    const check = (): void => { if (active && isBehindModal(anchor.current)) dismiss() }
    // Descendant layout effects run before their new dialog registers itself.
    // Wait for the complete commit before consulting the shared foreground.
    view.queueMicrotask(check)
    // Modal registration happens in layout effects. Mutation delivery also sees
    // async dialogs which deliberately keep focus where it was.
    const observer = new view.MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node instanceof view.Element
        && (node.matches(dialogSelector) || node.querySelector(dialogSelector) !== null)))) check()
    })
    // Both official and modern dialogs portal their root directly to body;
    // reasoning text mutations inside the chat must not wake this observer.
    observer.observe(document.body, { childList: true })
    document.addEventListener('focusin', check)
    return () => { active = false; observer.disconnect(); document.removeEventListener('focusin', check) }
  }, [anchor, open, dismiss])
}
