import katex from 'katex'
import type { KatexOptions } from 'katex'
import { KATEX_SAFE_OPTIONS } from './katex-options'

// Budgets apply to generated geometry, including negative offsets and sizes
// hidden by \smash. They are not a bound on arbitrary browser layout work.
// The horizontal budget counts only shifts that pull content backwards over
// what precedes it; the ordinary positive spacing KaTeX puts around every
// operator and relation adds up in a long derivation and is covered by the
// per-length and total budgets instead.
const MAX_LENGTH_EM = 64
const MAX_OFFSET_PATH_EM = 64
const MAX_HORIZONTAL_OFFSETS_EM = 64
const MAX_TOTAL_LENGTH_EM = 4096
const MAX_FONT_SCALE = 20
const MAX_ELEMENTS = 8192

const GEOMETRY_STYLE = /^(?:(?:min-|max-)?(?:width|height)|top|right|bottom|left|vertical-align|margin(?:-.+)?|padding(?:-.+)?|border(?:-.+)?|text-shadow)$/
const OFFSET_STYLE = /^(?:top|right|bottom|left|vertical-align|margin(?:-.+)?)$/
const HORIZONTAL_STYLE = /^(?:left|right|margin(?:-(?:left|right))?)$/
const GEOMETRY_ATTRIBUTES = new Set(['width', 'height', 'depth', 'voffset', 'lspace', 'rspace', 'minsize', 'maxsize', 'linethickness', 'rowspacing', 'columnspacing'])
const OFFSET_ATTRIBUTES = new Set(['voffset', 'lspace', 'rspace'])
const LENGTH = /([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(em|rem|ex|mu|px|pt|pc|in|cm|mm|bp|dd|cc|nd|nc|sp|%|width|height|depth)(?![a-z])/gi
// Absolute CSS lengths use a nominal 16px em for accounting. TeX's HTML
// builder already emits ems; these conversions also cover MathML attributes.
const ABSOLUTE_EM: Record<string, number> = { px: 1 / 16, pt: 1 / 12, pc: 1, in: 6, cm: 6 / 2.54, mm: 6 / 25.4, bp: 1 / 12, dd: 1238 / 1157 / 12, cc: 1238 / 1157, nd: 685 / 642 / 12, nc: 1370 / 107 / 12, sp: 1 / 65536 / 12 }
// A hex colour such as #0066cc would otherwise read as a length in TeX's cc or dd units.
const HEX_COLOR = /#[0-9a-f]{3,8}\b/gi
const CLIPPED_SVG_PARENTS = new Set(['hide-tail', 'halfarrow-left', 'halfarrow-right', 'brace-left', 'brace-center', 'brace-right'])

/** KaTeX draws stretchy symbols with a fixed long SVG and clips its tail. */
function isClippedSvgWidth(element: Element, value: string): boolean {
  return element.localName === 'svg' && value === '400em'
    && [...(element.parentElement?.classList ?? [])].some(name => CLIPPED_SVG_PARENTS.has(name))
    && /^0 0 400000 /.test(element.getAttribute('viewBox') ?? '')
    && /^x(?:Min|Mid|Max)YMin slice$/.test(element.getAttribute('preserveAspectRatio') ?? '')
}

/** This validates trusted KaTeX output, not arbitrary authored HTML or CSS. */
function withinGeometryBudget(body: HTMLElement): boolean {
  let total = 0
  let elements = 0
  let horizontalOffsets = 0
  const stack = [...body.children].map(element => ({ element, scale: 1, offsets: 0 }))
  let backward = 0
  const charge = (value: string, scale: number): number | undefined => {
    if (/nan|infinity/i.test(value)) return undefined
    let amount = 0
    backward = 0
    for (const match of value.replace(HEX_COLOR, ' ').matchAll(LENGTH)) {
      const signed = Number(match[1])
      const number = Math.abs(signed)
      const unit = match[2]!.toLowerCase()
      // MathML's relative-to-content expressions and SVG percentages are
      // emitted with factors <= 1. They must not magnify a bounded subtree.
      if (unit === '%' || unit === 'width' || unit === 'height' || unit === 'depth') {
        if (number > (unit === '%' ? 100 : 1)) return undefined
        continue
      }
      const ems = number * (unit === 'em' || unit === 'ex' ? scale : unit === 'mu' ? scale / 18 : unit === 'rem' ? 1 : ABSOLUTE_EM[unit]!)
      if (!Number.isFinite(ems) || ems > MAX_LENGTH_EM) return undefined
      amount += ems
      if (signed < 0) backward += ems
    }
    total += amount
    return total <= MAX_TOTAL_LENGTH_EM ? amount : undefined
  }
  while (stack.length > 0) {
    const { element, scale: parentScale, offsets: parentOffsets } = stack.pop()!
    if (++elements > MAX_ELEMENTS) return false
    let scale = parentScale
    let offsets = parentOffsets
    const size = element.getAttribute('mathsize')
    if (size !== null) {
      // The pinned renderer emits em-based MathML sizing. Unlike its HTML
      // size-reset classes, nested MathML mstyle sizes multiply in the browser.
      const match = /^([\d.]+)em$/.exec(size)
      if (!match) return false
      scale *= Number(match[1])
      if (!Number.isFinite(scale) || scale <= 0 || scale > MAX_FONT_SCALE) return false
    }
    const viewBox = element.getAttribute('viewBox')
    if (viewBox !== null) {
      // viewBox numbers are coordinate-space values, not physical lengths.
      const values = viewBox.trim().split(/[\s,]+/).map(Number)
      if (values.length !== 4 || values.some(value => !Number.isFinite(value)) || values[2]! <= 0 || values[3]! <= 0) return false
    }
    for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const name = declaration.slice(0, colon).trim().toLowerCase()
      if (!GEOMETRY_STYLE.test(name)) continue
      const amount = charge(declaration.slice(colon + 1), scale)
      if (amount === undefined) return false
      if (OFFSET_STYLE.test(name)) offsets += amount
      // `right` moves a positioned box backwards when it is positive, so it counts in full.
      if (HORIZONTAL_STYLE.test(name)) horizontalOffsets += name === 'right' ? amount : backward
    }
    for (const attribute of element.attributes) {
      if (!GEOMETRY_ATTRIBUTES.has(attribute.name)) continue
      if (attribute.name === 'width' && isClippedSvgWidth(element, attribute.value)) continue
      const amount = charge(attribute.value, scale)
      if (amount === undefined) return false
      if (OFFSET_ATTRIBUTES.has(attribute.name)) offsets += amount
      if (attribute.name === 'lspace' || attribute.name === 'rspace') horizontalOffsets += backward
    }
    if (offsets > MAX_OFFSET_PATH_EM || horizontalOffsets > MAX_HORIZONTAL_OFFSETS_EM) return false
    for (const child of element.children) stack.push({ element: child, scale, offsets })
  }
  return true
}

/** Render and inspect before either frontend entry inserts any generated nodes. */
export function renderBoundedTex(value: string, options: KatexOptions): { html: string; body: HTMLElement } {
  const html = katex.renderToString(value, { ...options, ...KATEX_SAFE_OPTIONS })
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  if (withinGeometryBudget(parsed.body)) return { html, body: parsed.body }
  const fallback = parsed.createElement('span')
  fallback.className = 'katex-error'
  fallback.style.color = '#cc0000'
  fallback.textContent = value
  parsed.body.replaceChildren(fallback)
  return { html: parsed.body.innerHTML, body: parsed.body }
}
