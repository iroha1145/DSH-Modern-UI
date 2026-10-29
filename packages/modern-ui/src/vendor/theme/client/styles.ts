import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import beautifulUi from '../styles/beautiful-ui.css?inline'
import cornerShape from '../styles/corner-shape.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import extensions from '../styles/extensions.css?inline'
import feel from '../styles/feel.css?inline'
import focus from '../styles/focus.css?inline'
import iconMotion from '../styles/icon-motion.css?inline'
import matrixLoader from '../styles/matrix-loader.css?inline'
import onboarding from '../styles/onboarding.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'

const PLUGIN_ID = '@iroha1145/dsh-modern-ui'
const HAIRLINE_WIDTH = '--dsh-hairline-width'

const STYLES = [
  ['base.css', base],
  ['feel.css', feel],
  ['corner-shape.css', cornerShape],
  ['design-platform.css', designPlatform],
  ['beautiful-ui.css', beautifulUi],
  ['matrix-loader.css', matrixLoader],
  ['icon-motion.css', iconMotion],
  ['focus.css', focus],
  ['onboarding.css', onboarding],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
  ['extensions.css', extensions],
] as const

/**
 * Tokens that media/platform rules in design-platform.css re-declare (macOS desktop menus, no
 * backdrop-filter, reduced transparency, forced colors). The presenter writes override tokens as
 * body inline styles, which would beat those rules, so these stay with the stylesheet; their base
 * values are identical in the official and Modern themes.
 */
const CONDITIONAL_TOKENS = new Set(['--dsw-menu-surface-fill', '--dsw-specific-menu'])

/** Read both authored palettes, never the device's current computed scheme. */
export function modernThemeTokens(): import('@deepseek-ai/dsh-client-ui-theme/client').ThemeTokenOverrides {
  const light: Record<string, string> = {}, dark: Record<string, string> = {}
  for (const css of [designPlatform, beautifulUi]) {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const rule of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim()
      if (![':root', 'body', 'body[data-ds-dark-theme]'].includes(selector)) continue
      for (const declaration of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+?)(?:;|$)/g)) {
        const [, name, value] = declaration
        if (/^--(?:dsw-static|dsw-font|dsh-)/.test(name) || CONDITIONAL_TOKENS.has(name)) continue
        if (selector !== 'body[data-ds-dark-theme]') light[name] = value.trim()
        else dark[name] = value.trim()
      }
    }
  }
  return Object.fromEntries([...new Set([...Object.keys(light), ...Object.keys(dark)])]
    .map(name => [name, { light: light[name] ?? dark[name], dark: dark[name] ?? light[name] }]))
}

/**
 * Mount global theme sheets; window-backed documents also publish the DPR-aware stroke width.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  const view = document.defaultView
  if (view !== null) ctx.effect(() => {
    const root = document.documentElement
    const previousWidth = root.style.getPropertyValue(HAIRLINE_WIDTH)
    const previousPriority = root.style.getPropertyPriority(HAIRLINE_WIDTH)
    const matchMedia = typeof view.matchMedia === 'function' ? view.matchMedia.bind(view) : undefined
    let resolution: MediaQueryList | undefined
    const updateStroke = (): void => {
      // Positive borders round down to whole device pixels, with a one-pixel minimum.
      const dpr = view.devicePixelRatio
      const width = Math.max(1, Math.floor(0.5 * dpr)) / dpr
      root.style.setProperty(HAIRLINE_WIDTH, `${width}px`)
      resolution?.removeEventListener('change', updateStroke)
      resolution = matchMedia?.(`(resolution: ${dpr}dppx)`)
      resolution?.addEventListener('change', updateStroke)
    }
    updateStroke()
    return () => {
      resolution?.removeEventListener('change', updateStroke)
      if (previousWidth === '') root.style.removeProperty(HAIRLINE_WIDTH)
      else root.style.setProperty(HAIRLINE_WIDTH, previousWidth, previousPriority)
    }
  }, 'ui-theme: DPR-aware hairline width')
  ctx.effect(() => {
    const tags = STYLES.map(([name, css]) => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return tag
    })
    const withdraw = ctx.theme.overrideTokens(PLUGIN_ID, modernThemeTokens())
    return () => {
      for (const tag of tags) tag.remove()
      withdraw()
    }
  }, 'modern-ui: styles and theme overrides')
}
