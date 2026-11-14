/** Keep menu edge hints accurate across engines and after filtering changes the content. */
export function observeScrollHints(viewport: HTMLElement): () => void {
  const update = () => {
    viewport.toggleAttribute('data-scroll-before', viewport.scrollTop > 1)
    viewport.toggleAttribute('data-scroll-after', viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1)
  }
  // Menu groups can exceed the viewport; their intersection ratio cannot identify its exact ends.
  const resize = new ResizeObserver(update)
  const observeContent = () => {
    resize.disconnect()
    resize.observe(viewport)
    for (const child of viewport.children) resize.observe(child)
    update()
  }
  const children = new MutationObserver(observeContent)
  children.observe(viewport, { childList: true })
  viewport.addEventListener('scroll', update, { passive: true })
  observeContent()
  return () => {
    resize.disconnect()
    children.disconnect()
    viewport.removeEventListener('scroll', update)
    viewport.removeAttribute('data-scroll-before')
    viewport.removeAttribute('data-scroll-after')
  }
}
