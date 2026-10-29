/** Keep keyboard navigation on the visible rows of the official raw tab ledger. */
export function installDiscoverTabNavigation(document: Document): () => void {
  const view = document.defaultView
  if (!view) return () => {}
  const navigate = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const target = event.target
    if (!(target instanceof view.Element)) return
    const current = target.closest<HTMLElement>('[role="tab"]')
    const list = current?.parentElement
    if (!current || list?.getAttribute('role') !== 'tablist') return
    // The official list slot includes both the original Discover entry and our
    // presentation shadow. CSS hides its duplicate; the Host still indexes it.
    if (!list.querySelector(':scope > [role="tab"][id$="-discover"] ~ [role="tab"][id$="-discover"]')) return
    const tabs = Array.from(list.children).filter((tab): tab is HTMLElement =>
      tab instanceof view.HTMLElement && tab.getAttribute('role') === 'tab'
      && !tab.hidden && !tab.hasAttribute('disabled')
      && view.getComputedStyle(tab).display !== 'none'
      && view.getComputedStyle(tab).visibility !== 'hidden')
    const index = tabs.indexOf(current)
    if (index < 0) return
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    event.preventDefault()
    event.stopPropagation()
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  document.addEventListener('keydown', navigate, true)
  return () => document.removeEventListener('keydown', navigate, true)
}
