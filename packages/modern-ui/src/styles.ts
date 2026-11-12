import type { Context } from '@deepseek-ai/cordis'

const sheets = new Map<string, string>()
const owners = new Set<(name: string, css: string) => void>()
export function registerStyle(name: string, css: string): void {
  sheets.set(name, css)
  for (const install of owners) install(name, css)
}

/** Cordis owns every sheet, including styles arriving with optional chunks. */
export function installPluginStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tags = new Map<string, HTMLStyleElement>()
    const install = (name: string, css: string): void => {
      const existing = tags.get(name)
      if (existing !== undefined) {
        existing.textContent = css
        return
      }
      const tag = document.createElement('style')
      tag.dataset.plugin = '@iroha1145/dsh-modern-ui'
      tag.dataset.pluginCss = name
      tag.textContent = css
      document.head.appendChild(tag)
      tags.set(name, tag)
    }
    for (const [name, css] of sheets) install(name, css)
    owners.add(install)
    return () => {
      owners.delete(install)
      for (const tag of tags.values()) tag.remove()
    }
  })
}
