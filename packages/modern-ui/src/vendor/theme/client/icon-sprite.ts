import type { Context } from '@deepseek-ai/cordis'
import { ICON_SYMBOLS } from '../../primitives/icons/artwork.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Id of the hidden document sprite every `dsw-icon-*` `<use>` resolves against. */
export const ICON_SPRITE_ID = 'modern-ui-icon-sprite'
const OWNERS = 'data-owners'

/**
 * Build the sprite element: one `<symbol id="dsw-icon-<glyph>-<weight>">` per product icon,
 * carrying the artwork's root attributes (viewBox, fill, stroke-width) so a `<use>` scales
 * and inherits `currentColor` exactly like the inline artwork would.
 */
export function createIconSprite(document: Document): SVGSVGElement {
  const parser = new document.defaultView!.DOMParser()
  const sprite = document.createElementNS(SVG_NS, 'svg')
  sprite.id = ICON_SPRITE_ID
  sprite.setAttribute('aria-hidden', 'true')
  sprite.setAttribute('focusable', 'false')
  // Zero-size rather than display:none: referenced symbols must stay renderable.
  sprite.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
  const icons = Object.entries(ICON_SYMBOLS)
  const artwork = parser.parseFromString(`<svg xmlns="${SVG_NS}">${icons.map(([, source]) => source).join('')}</svg>`, 'image/svg+xml')
  if (artwork.getElementsByTagName('parsererror').length > 0) throw new Error('Icon artwork is not valid SVG')
  const roots = Array.from(artwork.documentElement.children)
  for (const [index, [id]] of icons.entries()) {
    const root = roots[index]!
    if (root.localName !== 'svg') throw new Error(`Icon artwork ${id} is not an SVG document`)
    const symbol = document.createElementNS(SVG_NS, 'symbol')
    symbol.id = id
    for (const attribute of Array.from(root.attributes)) {
      if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) continue
      symbol.setAttribute(attribute.name, attribute.value)
    }
    while (root.firstChild) symbol.appendChild(document.adoptNode(root.firstChild))
    sprite.appendChild(symbol)
  }
  return sprite
}

/**
 * Mount the product icon sprite for this document. The patched ui-theme used to publish it
 * with the shell; the official host does not know these symbols, so the plugin owns the sprite.
 * Several plugin instances in one document (reload, a second bundle generation) share one
 * element and the last owner removes it.
 * @param ctx - Owning plugin context.
 */
export function installIconSprite(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const existing = document.getElementById(ICON_SPRITE_ID)
    const sprite: Element = existing ?? createIconSprite(document)
    if (existing === null) (document.body ?? document.documentElement).appendChild(sprite)
    const owners = Number(sprite.getAttribute(OWNERS) ?? '0') + 1
    sprite.setAttribute(OWNERS, String(owners))
    return () => {
      const remaining = Number(sprite.getAttribute(OWNERS) ?? '1') - 1
      if (remaining <= 0) sprite.remove()
      else sprite.setAttribute(OWNERS, String(remaining))
    }
  })
}
