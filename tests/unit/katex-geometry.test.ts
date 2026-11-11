import { afterAll, expect, test } from 'vitest'
import { JSDOM } from 'jsdom'
import katex from 'katex'
import { KATEX_SAFE_OPTIONS } from '../../packages/modern-ui/src/vendor/primitives/markdown/katex-options.ts'
import { renderBoundedTex } from '../../packages/modern-ui/src/vendor/primitives/markdown/katex-render.ts'

const dom = new JSDOM('')
const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: dom.window.DOMParser })
afterAll(() => {
  dom.window.close()
  if (previous) Object.defineProperty(globalThis, 'DOMParser', previous)
  else Reflect.deleteProperty(globalThis, 'DOMParser')
})
const options = { ...KATEX_SAFE_OPTIONS, throwOnError: false, strict: 'ignore' as const }
const attacks = [
  String.raw`\rule[-999999em]{1em}{1em}`,
  String.raw`\raisebox{-999999em}{x}`,
  String.raw`\def\drop#1{\raisebox{-999999em}{#1}}\drop{x}`,
  String.raw`\kern-999999px x`,
  String.raw`\hspace{-999999em}x`,
  String.raw`\smash{\raisebox{-999999em}{x}}`,
  String.raw`\rule[-999999pt]{1em}{1em}`,
  String.raw`\raisebox{-999999cm}{x}`,
]

test.each(attacks)('rejects every oversized descendant for %s', tex => {
  for (const displayMode of [false, true]) {
    const { body, html } = renderBoundedTex(tex, { ...options, displayMode })
    expect(body.textContent).toBe(tex)
    expect(body.children).toHaveLength(1)
    expect(body.firstElementChild?.className).toBe('katex-error')
    expect(html).not.toContain('999999em;')
  }
})

test('bounds cumulative offsets, deep offset chains and inherited MathML scaling', () => {
  let nested = 'x'
  for (let index = 0; index < 8; index++) nested = `\\smash{\\raisebox{-20em}{${nested}}}`
  for (const tex of [
    String.raw`\kern-20em`.repeat(90) + 'x',
    String.raw`\hspace{-20em}`.repeat(90) + 'x',
    nested,
    '{\\Huge '.repeat(8) + 'x' + '}'.repeat(8),
  ]) {
    const { body } = renderBoundedTex(tex, options)
    expect(body.firstElementChild?.className).toBe('katex-error')
    expect(body.textContent).toBe(tex)
  }
})

test('safe generated output stays byte-identical for normal formulae and clipped SVG glyphs', () => {
  const matrix = `\\begin{bmatrix}${Array.from({ length: 10 }, () => Array.from({ length: 10 }, (_, n) => String(n)).join('&')).join('\\\\')}\\end{bmatrix}`
  for (const tex of [
    String.raw`\frac{x^2+1}{\sqrt{y}}`,
    matrix,
    String.raw`E=mc^2,\quad x_{n+1}=\sum_{i=0}^{n}i`,
    String.raw`\overrightarrow{AB}+\underbrace{x+y}_{z}+\xrightarrow{n\to\infty}`,
    String.raw`\widehat{abc}+\overleftrightarrow{xy}+\overbrace{a+b}`,
    String.raw`x\kern-0.2em y+\raisebox{-3pt}{z}`,
    String.raw`\rule{999999em}{999999em}`,
    String.raw`\mathllap{x}+\mathclap{y}+\colorbox{yellow}{z}`,
    String.raw`\cancel{x}+\bcancel{y}+\xcancel{z}+\pmb{x}`,
  ]) {
    for (const displayMode of [false, true]) {
      const config = { ...options, displayMode }
      expect(renderBoundedTex(tex, config).html, tex).toBe(katex.renderToString(tex, config))
    }
  }
})

test('oversize fallback escapes source markup rather than inserting it', () => {
  const tex = String.raw`\smash{\raisebox{-999999em}{x}}\text{<img src=x onerror=alert(1)> &}`
  const { body } = renderBoundedTex(tex, options)
  expect(body.firstElementChild?.className).toBe('katex-error')
  expect(body.querySelector('img')).toBeNull()
  expect(body.textContent).toBe(tex)
})
