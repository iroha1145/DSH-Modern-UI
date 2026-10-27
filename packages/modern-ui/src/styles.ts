import type { Context } from '@deepseek-ai/cordis'

const sheets = new Map<string, string>()
export function registerStyle(name: string, css: string): void { sheets.set(name, css) }

/** Factory evaluation only records text; Cordis owns every installed DOM node. */
export function installPluginStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of sheets) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@iroha1145/dsh-modern-ui'
      tag.dataset.pluginCss = name
      tag.textContent = css
      document.head.appendChild(tag)
      return () => tag.remove()
    })
  }
}
