import type { Context } from '@deepseek-ai/cordis'
import css from './official-controls.css?inline'
import { createFeelSwitchMotion } from './vendor/primitives/feel-switch.ts'

const SCOPE = 'data-modern-official-controls'
const SWITCH = 'button._switch_1ik0f_5[role="switch"][aria-checked]'
const owners = new WeakMap<Document, { count: number; dispose(): void }>()

/** Observe the official controlled state; input events and persistence remain official. */
export function installOfficialControls(ctx: Context): void {
  const document = globalThis.document
  const view = document?.defaultView
  if (!document?.body || !view) return
  ctx.effect(() => {
    let owner = owners.get(document)
    if (!owner) {
      const body = document.body
      const previous = body.getAttribute(SCOPE)
      body.setAttribute(SCOPE, '')
      const style = document.createElement('style')
      style.dataset.plugin = '@iroha1145/dsh-modern-ui'
      style.dataset.pluginCss = '@iroha1145/dsh-modern-ui/official-controls.css'
      style.textContent = css
      document.head.appendChild(style)
      const motions = new Map<HTMLButtonElement, ReturnType<typeof createFeelSwitchMotion>>()
      const attach = (element: HTMLButtonElement) => {
        if (!motions.has(element)) motions.set(element, createFeelSwitchMotion(element, element.getAttribute('aria-checked') === 'true'))
      }
      const scan = (node: Node) => {
        if (!(node instanceof view.Element)) return
        if (node.matches(SWITCH)) attach(node as HTMLButtonElement)
        node.querySelectorAll<HTMLButtonElement>(SWITCH).forEach(attach)
      }
      scan(body)
      const observer = new view.MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') {
            const element = record.target as HTMLButtonElement
            if (element.matches(SWITCH)) {
              attach(element)
              motions.get(element)?.to(element.getAttribute('aria-checked') === 'true')
            }
          } else record.addedNodes.forEach(scan)
        }
        for (const [element, motion] of motions) {
          if (element.isConnected && element.matches(SWITCH)) continue
          motion.dispose()
          element.style.removeProperty('--dsh-switch-x')
          element.style.removeProperty('--dsh-switch-fill')
          motions.delete(element)
        }
      })
      observer.observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-checked'] })
      owner = { count: 0, dispose() {
        observer.disconnect()
        for (const [element, motion] of motions) {
          motion.dispose()
          element.style.removeProperty('--dsh-switch-x')
          element.style.removeProperty('--dsh-switch-fill')
        }
        style.remove()
        if (previous === null) body.removeAttribute(SCOPE)
        else body.setAttribute(SCOPE, previous)
        owners.delete(document)
      } }
      owners.set(document, owner)
    }
    owner.count++
    return () => { if (--owner.count === 0) owner.dispose() }
  }, 'modern-ui: official control styles and switch motion')
}
