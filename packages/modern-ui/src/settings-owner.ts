/** Style the official settings owner; retain its Host config, services and children. */
import type { Context } from '@deepseek-ai/cordis'
import css from './vendor/settings-shell/settings-shell.css?inline'
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@iroha1145/dsh-modern-ui'
    style.dataset.pluginCss = 'settings-shell'
    style.textContent = css
    document.head.append(style)
    return () => style.remove()
  })
}
export const settingsOwner = { name: 'modern-settings-style', apply }
