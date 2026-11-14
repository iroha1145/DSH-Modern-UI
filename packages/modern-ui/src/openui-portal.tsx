import { createContext, type ReactNode, type RefObject } from 'react'
import { useColorScheme } from './vendor/openui/components/scheme'

// React ownership crosses portals, unlike the inert DOM boundary of a card face.
export const FaceActivityContext = createContext(true)

const panels = new Map<HTMLElement, HTMLElement>()

/** Let an enclosing OpenUI popover recognize a picker portaled out of its DOM. */
export function registerOpenUiPortal(anchor: HTMLElement, panel: HTMLElement) {
  panels.set(panel, anchor)
  return () => {
    panels.delete(panel)
  }
}

export function containsOpenUiPortal(root: HTMLElement | null, target: Node | null): boolean {
  if (!root || !target) return false
  if (root.contains(target)) return true
  for (const [panel, anchor] of panels) {
    if (panel.contains(target) && containsOpenUiPortal(root, anchor)) return true
  }
  return false
}

export function hasOpenUiPortal(root: HTMLElement | null): boolean {
  return [...panels.values()].some(anchor => root?.contains(anchor))
}

/** Keep portaled controls in their source block's theme. */
export function PortalTheme({ source, children }: { source: RefObject<HTMLElement | null>; children: ReactNode }) {
  const scheme = useColorScheme(source)
  return (
    <div className="iui-root iui-portal" data-theme={scheme}>
      {children}
    </div>
  )
}
