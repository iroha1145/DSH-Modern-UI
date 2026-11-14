import { useCallback, useContext, useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { FaceActivityContext, PortalTheme, registerOpenUiPortal } from './openui-portal'
import { useAnchoredPosition } from './vendor/primitives/useAnchoredPosition'
import { useDismissBehindModal } from './vendor/primitives/useDismissBehindModal'

interface PickerPopoverProps extends HTMLAttributes<HTMLDivElement> {
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement>
  returnFocusRef?: RefObject<HTMLElement | null>
  onDismiss: () => void
  matchAnchorWidth?: boolean
}

/** Shared placement and dismissal for OpenUI's listbox and calendar. Mount only while open. */
export function PickerPopover({ anchorRef, panelRef, returnFocusRef, onDismiss, matchAnchorWidth, children, className, style, ...props }: PickerPopoverProps) {
  const active = useContext(FaceActivityContext)
  const latest = useRef(onDismiss)
  latest.current = onDismiss
  const dismiss = useCallback(() => latest.current(), [])

  useLayoutEffect(() => {
    if (!active) {
      dismiss()
      return
    }
    const panel = panelRef.current
    const native = Object.hasOwn(HTMLElement.prototype, 'popover')
    if (panel && native) panel.showPopover()
    const unregister = panel && anchorRef.current ? registerOpenUiPortal(anchorRef.current, panel) : undefined
    return () => {
      unregister?.()
      if (native && panel?.matches(':popover-open')) panel.hidePopover()
    }
  }, [active, dismiss, panelRef, anchorRef])
  const position = useAnchoredPosition({ open: active, anchorRef, panelRef, gap: 6, margin: 12, maxHeight: 420, matchAnchorWidth })
  useDismissBehindModal(anchorRef, active, dismiss)

  useLayoutEffect(() => {
    if (!active) return
    const inside = (target: EventTarget | null) => target instanceof Node && (anchorRef.current?.contains(target) || panelRef.current?.contains(target))
    const outside = (event: Event) => {
      if (!inside(event.target)) dismiss()
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || !inside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
      ;(returnFocusRef?.current ?? anchorRef.current)?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', onEscape, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', onEscape, true)
    }
  }, [active, anchorRef, panelRef, returnFocusRef, dismiss])

  if (!active) return null
  return createPortal(
    <PortalTheme source={anchorRef}>
      <div
        {...props}
        {...{ popover: 'manual' }}
        ref={panelRef}
        className={`iui-popover iui-picker-popup ${className ?? ''}`}
        style={{ ...style, ...position, visibility: position ? 'visible' : 'hidden' }}
      >
        {children}
      </div>
    </PortalTheme>,
    document.body,
  )
}
