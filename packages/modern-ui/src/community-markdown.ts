import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'

// dsh-better-sidebar 0.28.0: TextEditor.editorMd, in both floating and native hosts.
const PREVIEW = ':is([data-dsh-better-sidebar], [data-dsh-native-tab-host]) .nArs4W_editorMd'
const BLOCKS = `${PREVIEW} .md-code-block`
const BUTTON = 'data-modern-community-fold'
const COLLAPSED = 'data-modern-community-collapsed'
const owners = new WeakMap<Document, { count: number; dispose(): void }>()
let sequence = 0

interface Fold {
  block: HTMLElement
  banner: HTMLElement
  content: HTMLElement
  button: HTMLButtonElement
  collapsed: boolean
  hidden: string | null
  id: string | null
  assignedId: string
  marker: string | null
}

function restoreAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

/** Add only code visibility controls; community parsing, editing and navigation remain untouched. */
export function installCommunityMarkdown(ctx: Context): void {
  const document = globalThis.document
  const view = document?.defaultView
  if (!document?.body || !view) return
  ctx.effect(() => {
    let owner = owners.get(document)
    if (!owner) {
      const folds = new Map<HTMLElement, Fold>()
      const translate = ctx.locale.bind('modern-chat')
      const style = document.createElement('style')
      style.dataset.plugin = '@iroha1145/dsh-modern-ui'
      style.dataset.pluginCss = '@iroha1145/dsh-modern-ui/community-markdown'
      style.textContent = `
        [${BUTTON}] { display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer; }
        [${BUTTON}]:hover { color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover); }
        [${BUTTON}]:focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px; }
        [${BUTTON}] svg { width:14px;height:14px; }
        [${BUTTON}][aria-expanded=false] svg { transform:rotate(-90deg); }
        ${BLOCKS}[${COLLAPSED}] > [data-code-block-content] { display:none; }
      `
      document.head.appendChild(style)
      const label = (fold: Fold) => {
        const text = translate(fold.collapsed ? 'codeBlock.expand' : 'codeBlock.collapse')
        fold.button.setAttribute('aria-label', text)
        fold.button.title = text
      }
      const paint = (fold: Fold) => {
        fold.content.hidden = fold.collapsed
        fold.block.toggleAttribute(COLLAPSED, fold.collapsed)
        fold.button.setAttribute('aria-expanded', String(!fold.collapsed))
        label(fold)
      }
      const withdraw = (fold: Fold) => {
        fold.button.remove()
        restoreAttribute(fold.content, 'hidden', fold.hidden)
        if (fold.content.id === fold.assignedId) restoreAttribute(fold.content, 'id', fold.id)
        restoreAttribute(fold.block, COLLAPSED, fold.marker)
        folds.delete(fold.block)
      }
      const attach = (block: HTMLElement) => {
        const previous = folds.get(block)
        const banner = block.querySelector<HTMLElement>('[data-code-block-banner]')
        const content = block.querySelector<HTMLElement>(':scope > [data-code-block-content]')
        const existingToggle = banner?.querySelector(`button[aria-expanded][aria-controls]:not([${BUTTON}])`)
        if (!block.matches(BLOCKS) || block.hasAttribute('data-mermaid-processed') || block.closest('[data-dsh-html-segment]')
          || !banner || banner.closest('.md-code-block') !== block || !content || existingToggle) {
          if (previous) withdraw(previous)
          return
        }
        if (previous?.content === content) {
          previous.banner = banner
          if (previous.button.parentElement !== banner) banner.prepend(previous.button)
          return
        }
        const collapsed = previous?.collapsed ?? content.hasAttribute('hidden')
        if (previous) withdraw(previous)
        const id = content.getAttribute('id')
        let assignedId = id
        if (!assignedId) {
          do { assignedId = `modern-community-code-${++sequence}` } while (document.getElementById(assignedId))
          content.id = assignedId
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute(BUTTON, '')
        button.setAttribute('aria-controls', assignedId)
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        icon.setAttribute('viewBox', '0 0 24 24')
        icon.setAttribute('aria-hidden', 'true')
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        arrow.setAttribute('d', 'm6 9 6 6 6-6')
        arrow.setAttribute('fill', 'none')
        arrow.setAttribute('stroke', 'currentColor')
        arrow.setAttribute('stroke-width', '1.5')
        icon.appendChild(arrow)
        button.appendChild(icon)
        const fold: Fold = { block, banner, content, button, collapsed, hidden: content.getAttribute('hidden'), id, assignedId, marker: block.getAttribute(COLLAPSED) }
        button.addEventListener('click', () => { fold.collapsed = !fold.collapsed; paint(fold) })
        folds.set(block, fold)
        paint(fold)
        banner.prepend(button)
      }
      const scan = (node: Node) => {
        if (!(node instanceof view.Element)) return
        const block = node.closest<HTMLElement>('.md-code-block')
        if (block) attach(block)
        node.querySelectorAll<HTMLElement>(BLOCKS).forEach(attach)
        if (node.matches(BLOCKS)) attach(node as HTMLElement)
      }
      scan(document.body)
      const observer = new view.MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') attach(record.target as HTMLElement)
          else {
            scan(record.target)
            record.addedNodes.forEach(scan)
          }
        }
        for (const fold of folds.values()) if (!fold.block.isConnected || !fold.block.matches(BLOCKS)) withdraw(fold)
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mermaid-processed'] })
      const unsubscribe = ctx.locale.subscribe(() => folds.forEach(label))
      owner = { count: 0, dispose() {
        observer.disconnect()
        unsubscribe()
        for (const fold of folds.values()) withdraw(fold)
        style.remove()
        owners.delete(document)
      } }
      owners.set(document, owner)
    }
    owner.count++
    return () => { if (--owner.count === 0) owner.dispose() }
  }, 'modern-ui: community Markdown code visibility')
}
