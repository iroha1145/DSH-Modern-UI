/**
 * Frame design system: chat-matched theme tokens, base element styles, OpenIntelligentUI's SVG color classes,
 * and layout components, so authored fragments read as part of the answer.
 */
import { ICON_ALIASES, ICONS } from './icons.ts'

/** Chat typography and colors captured from the page; every value passes an allowlist before reaching frame CSS. */
export interface HostStyle {
  readonly fontFamily: string
  readonly monoFamily: string
  readonly fontSize: string
  readonly bg: string
  readonly fg: string
  readonly muted: string
  readonly subtle: string
  readonly line: string
  readonly link: string
  readonly success: string
  readonly warning: string
  readonly danger: string
}

type Scheme = 'light' | 'dark'

const FALLBACK: Readonly<Record<Scheme, HostStyle>> = {
  light: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', monoFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '15px',
    bg: '#ffffff', fg: '#171717', muted: '#5b5b5b', subtle: '#6a6a6a', line: '#e8e8e8', link: '#185fa5', success: '#3b6d11', warning: '#854f0b', danger: '#a32d2d',
  },
  dark: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', monoFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '15px',
    bg: '#171717', fg: '#ededed', muted: '#b0b0b0', subtle: '#969696', line: '#2e2e2e', link: '#85b7eb', success: '#97c459', warning: '#ef9f27', danger: '#f09595',
  },
}

const SAFE_FONT = /^[\w\s,"'.-]{1,300}$/
const SAFE_SIZE = /^\d{1,2}(\.\d{1,3})?px$/
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([\w\s.,%/+-]{1,80}\))$/i

function opaqueBackground(element: Element | null): string {
  for (let node = element; node !== null; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor
    if (color !== '' && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color
  }
  return ''
}

/**
 * Capture the chat's own font and colors around a visualization mount point.
 * @param element - Mounted container inside the assistant answer.
 * @param scheme - Resolved application palette, which selects the fallbacks.
 * @returns Allowlisted values, each falling back to the palette default.
 */
export function readHostStyle(element: Element, scheme: Scheme): HostStyle {
  const style = getComputedStyle(element)
  const variable = (name: string): string => style.getPropertyValue(name).trim()
  const fallback = FALLBACK[scheme]
  const pick = (value: string, pattern: RegExp, otherwise: string): string => pattern.test(value) ? value : otherwise
  return {
    fontFamily: pick(style.fontFamily, SAFE_FONT, fallback.fontFamily),
    monoFamily: pick(variable('--ds-font-family-code'), SAFE_FONT, fallback.monoFamily),
    fontSize: pick(style.fontSize, SAFE_SIZE, fallback.fontSize),
    bg: pick(opaqueBackground(element), SAFE_COLOR, fallback.bg),
    fg: pick(style.color, SAFE_COLOR, fallback.fg),
    muted: pick(variable('--ink-2'), SAFE_COLOR, fallback.muted),
    subtle: pick(variable('--ink-3'), SAFE_COLOR, fallback.subtle),
    line: pick(variable('--line'), SAFE_COLOR, fallback.line),
    link: pick(variable('--dsw-alias-link'), SAFE_COLOR, fallback.link),
    success: pick(variable('--dsw-alias-state-success-primary'), SAFE_COLOR, fallback.success),
    warning: pick(variable('--dsw-alias-state-warn-primary'), SAFE_COLOR, fallback.warning),
    danger: pick(variable('--dsw-alias-state-error-primary'), SAFE_COLOR, fallback.danger),
  }
}

/**
 * Palette defaults for callers without a mounted page element.
 * @param scheme - Resolved application palette.
 * @returns The fixed fallback style.
 */
export function defaultHostStyle(scheme: Scheme): HostStyle {
  return FALLBACK[scheme]
}

/**
 * Select the icon geometry a fence body can reference, including names its scripts assign later.
 * @param source - Complete fence body.
 * @returns Icon markup keyed by every mentioned icon name or alias.
 */
export function iconsFor(source: string): Record<string, string> {
  const used: Record<string, string> = {}
  for (const [word] of source.matchAll(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g)) {
    if (Object.hasOwn(used, word)) continue
    const name = Object.hasOwn(ICONS, word) ? word : Object.hasOwn(ICON_ALIASES, word) ? ICON_ALIASES[word] : undefined
    const markup = name === undefined ? undefined : ICONS[name]
    if (markup !== undefined) used[word] = markup
  }
  return used
}

// OpenIntelligentUI color ramps (MIT): fill, stroke, strong text, and small text per palette.
const RAMPS: Readonly<Record<string, Readonly<Record<Scheme, readonly [string, string, string, string]>>>> = {
  purple: { light: ['#EEEDFE', '#534AB7', '#3C3489', '#534AB7'], dark: ['#3C3489', '#AFA9EC', '#CECBF6', '#AFA9EC'] },
  teal: { light: ['#E1F5EE', '#0F6E56', '#085041', '#0F6E56'], dark: ['#085041', '#5DCAA5', '#9FE1CB', '#5DCAA5'] },
  coral: { light: ['#FAECE7', '#993C1D', '#712B13', '#993C1D'], dark: ['#712B13', '#F0997B', '#F5C4B3', '#F0997B'] },
  pink: { light: ['#FBEAF0', '#993556', '#72243E', '#993556'], dark: ['#72243E', '#ED93B1', '#F4C0D1', '#ED93B1'] },
  gray: { light: ['#F1EFE8', '#5F5E5A', '#444441', '#5F5E5A'], dark: ['#444441', '#B4B2A9', '#D3D1C7', '#B4B2A9'] },
  blue: { light: ['#E6F1FB', '#185FA5', '#0C447C', '#185FA5'], dark: ['#0C447C', '#85B7EB', '#B5D4F4', '#85B7EB'] },
  green: { light: ['#EAF3DE', '#3B6D11', '#27500A', '#3B6D11'], dark: ['#27500A', '#97C459', '#C0DD97', '#97C459'] },
  amber: { light: ['#FAEEDA', '#854F0B', '#633806', '#854F0B'], dark: ['#633806', '#EF9F27', '#FAC775', '#EF9F27'] },
  red: { light: ['#FCEBEB', '#A32D2D', '#791F1F', '#A32D2D'], dark: ['#791F1F', '#F09595', '#F7C1C1', '#F09595'] },
}

function svgClasses(scheme: Scheme): string {
  const ramps = Object.entries(RAMPS).map(([name, palettes]) => {
    const [fill, stroke, strong, small] = palettes[scheme]
    const shapes = `svg .c-${name}>rect,svg .c-${name}>circle,svg .c-${name}>ellipse,svg .c-${name}>path,svg rect.c-${name},svg circle.c-${name},svg ellipse.c-${name}`
    return `${shapes}{fill:${fill};stroke:${stroke}}svg .c-${name} text.th,svg .c-${name} text.t{fill:${strong}}svg .c-${name} text.ts{fill:${small}}`
      + `.c-${name}:not(svg *){--ramp-fill:${fill};--ramp-stroke:${stroke};--ramp-text:${strong}}`
  })
  return 'svg text.t{font:400 14px var(--font-sans);fill:var(--fg)}svg text.ts{font:400 12px var(--font-sans);fill:var(--muted)}'
    + 'svg text.th{font:500 14px var(--font-sans);fill:var(--fg)}svg .box>rect,svg .box>circle,svg .box>ellipse{fill:var(--fill);stroke:var(--line)}'
    + 'svg .arr{stroke:var(--muted);stroke-width:1.5;fill:none}svg .leader{stroke:var(--subtle);stroke-width:.5;stroke-dasharray:4 4;fill:none}'
    + 'svg .node{cursor:pointer}svg .node:hover{opacity:.8}' + ramps.join('')
}

const ARROW_MASK = 'url("data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 14 28%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.6%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M7 2v23M2 20l5 5 5-5%27/%3E%3C/svg%3E") center/contain no-repeat'

const COMPONENTS = [
  '.ui-card{border:1px solid var(--line);border-radius:16px;padding:22px 24px}',
  '.ui-card+.ui-card,.ui-card+.ui-list,.ui-list+.ui-card{margin-top:16px}',
  '.ui-card-title,.ui-card>h3:first-child{font-size:1.07em;font-weight:600;margin:0 0 20px}',
  '.ui-caption,.ui-flow>figcaption{align-self:flex-start;font-size:.92em;color:var(--muted);margin:0 0 6px}',
  '.ui-eyebrow{display:block;font-size:.86em;color:var(--muted);margin-bottom:4px}',
  '[data-icon]{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;color:var(--fg);vertical-align:middle}',
  '[data-icon] svg{width:100%;height:100%;display:block}',
  '.ui-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:28px 36px}',
  // Three items share one row and four form a two-by-two grid instead of leaving one item alone.
  '.ui-grid:has(>:nth-child(3):last-child){grid-template-columns:repeat(3,minmax(0,1fr))}',
  '.ui-grid:has(>:nth-child(4):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}',
  '.ui-item{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}',
  '.ui-item>[data-icon]{margin-bottom:10px}',
  '.ui-item h4,.ui-list h4{font-size:1.03em;font-weight:600;line-height:1.45}',
  '.ui-item p,.ui-list p{color:var(--muted)}',
  '.ui-list{list-style:none;margin:0;padding:0}',
  '.ui-list>li{display:grid;grid-template-columns:24px minmax(0,1fr);column-gap:16px;padding:18px 0;border-bottom:1px solid var(--line)}',
  '.ui-list>li:first-child{padding-top:2px}.ui-list>li:last-child{border-bottom:0;padding-bottom:2px}',
  '.ui-list>li>[data-icon]{margin-top:1px}.ui-list>li>div{display:flex;flex-direction:column;gap:6px;min-width:0}',
  '.ui-tags{display:flex;flex-wrap:wrap;gap:8px}',
  '.ui-tag{display:inline-flex;align-items:center;gap:6px;padding:3px 12px;border-radius:999px;background:var(--fill);color:var(--fg);font-size:.88em;line-height:1.6;white-space:nowrap}',
  '.ui-tag [data-icon]{width:14px;height:14px}',
  '.ui-flow{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}',
  '.ui-node{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}',
  '.ui-node>[data-icon]{margin-bottom:6px}.ui-node strong{font-weight:600;font-size:1.03em}.ui-node span{font-size:.88em;color:var(--muted)}',
  '.ui-arrow{display:flex;align-items:center;justify-content:center;gap:8px;min-height:30px;color:var(--muted);font-size:.92em}',
  `.ui-arrow::before{content:"";width:12px;height:28px;flex:none;background:currentColor;-webkit-mask:${ARROW_MASK};mask:${ARROW_MASK}}`,
  '.ui-group{width:100%;border:1px solid var(--line);border-radius:14px;padding:22px 20px;display:flex;flex-direction:column;align-items:center;gap:20px}',
  '.ui-group>strong:first-child,.ui-group>h4:first-child{font-size:1.1em;font-weight:600}',
  '.ui-cols{width:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:16px 20px}',
  '.ui-bar{width:100%;padding:12px 16px;border-radius:10px;background:var(--fill-strong);font-weight:500;text-align:center}',
  '.ui-steps{list-style:none;margin:0;padding:0;counter-reset:ui-step}',
  '.ui-steps>li{position:relative;padding:0 0 22px 42px;counter-increment:ui-step}',
  '.ui-steps>li::before{content:counter(ui-step);position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;background:var(--fill-strong);display:grid;place-items:center;font-size:.85em;font-weight:600}',
  '.ui-steps>li::after{content:"";position:absolute;left:12.5px;top:32px;bottom:6px;width:1px;background:var(--line)}',
  '.ui-steps>li:last-child{padding-bottom:0}.ui-steps>li:last-child::after{display:none}.ui-steps h4{font-size:1.03em;font-weight:600}.ui-steps p{color:var(--muted)}',
  '.ui-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));gap:18px}',
  '.ui-stat>strong,.ui-stat>b{display:block;font-size:1.7em;font-weight:600;line-height:1.2}.ui-stat>span{font-size:.88em;color:var(--muted)}',
  '.ui-profile{display:flex;gap:24px;align-items:flex-start;justify-content:space-between}',
  '.ui-profile h3{font-size:1.45em;font-weight:600;line-height:1.3;margin:2px 0 12px}.ui-profile>div{min-width:0}',
  '.ui-media{flex:none;width:128px;height:128px;border-radius:22px;background:var(--fill);display:grid;place-items:center}.ui-media [data-icon]{width:48px;height:48px}',
  '.ui-callout{display:grid;grid-template-columns:22px minmax(0,1fr);gap:12px;padding:14px 16px;border-radius:12px;background:var(--fill)}',
  '.success{--tone:var(--success)}.warning{--tone:var(--warning)}.danger{--tone:var(--danger)}.info{--tone:var(--accent)}',
  ':is(.ui-node,.ui-tag,.ui-callout,.ui-item,.ui-stat):is(.success,.warning,.danger,.info),:is(.ui-node,.ui-item,.ui-callout):is(.success,.warning,.danger,.info) [data-icon]{color:var(--tone)}',
  ':is(.ui-tag,.ui-callout):is(.success,.warning,.danger,.info){background:color-mix(in srgb,var(--tone) 13%,transparent)}',
  '@media (max-width:560px){.ui-grid:has(>:nth-child(3):last-child){grid-template-columns:minmax(0,1fr)}}',
  '@media (max-width:480px){.ui-card{padding:18px}.ui-grid{gap:22px;grid-template-columns:minmax(0,1fr)!important}.ui-profile{flex-direction:column-reverse;gap:14px}.ui-media{width:72px;height:72px;border-radius:16px}.ui-media [data-icon]{width:30px;height:30px}}',
].join('')

const FORMS = 'button{font:inherit;font-size:.93em;padding:6px 14px;border:1px solid var(--color-border-secondary);border-radius:8px;background:transparent;color:var(--fg);cursor:pointer;transition:background .15s}'
  + 'button:hover{background:var(--fill)}button:active{transform:scale(.98)}'
  + 'input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea,select{font:inherit;font-size:.93em;padding:6px 12px;min-height:36px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);max-width:100%}'
  + 'input:focus,textarea:focus,select:focus{outline:none;border-color:var(--color-border-primary)}'
  + 'input[type=range]{accent-color:var(--fg);max-width:100%}input[type=checkbox],input[type=radio]{accent-color:var(--accent)}'
  + 'button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}'

/**
 * Build the complete stylesheet loaded before authored CSS and markup.
 * @param scheme - Resolved application palette.
 * @param host - Allowlisted chat typography and colors.
 * @returns Static CSS text for the inner frame.
 */
export function frameStyles(scheme: Scheme, host: HostStyle): string {
  const mix = (color: string, amount: number): string => `color-mix(in srgb,${color} ${amount}%,transparent)`
  const tokens = `:root{color-scheme:${scheme};--font-sans:${host.fontFamily};--font-mono:${host.monoFamily};--font-serif:Georgia,"Times New Roman",serif;`
    + `--bg:${host.bg};--fg:${host.fg};--muted:${host.muted};--subtle:${host.subtle};--line:${host.line};--accent:${host.link};`
    + `--success:${host.success};--warning:${host.warning};--danger:${host.danger};--fill:${mix(host.fg, 6)};--fill-strong:${mix(host.fg, 10)};`
    + '--color-text-primary:var(--fg);--color-text-secondary:var(--muted);--color-text-tertiary:var(--subtle);--color-text-info:var(--accent);'
    + '--color-text-success:var(--success);--color-text-warning:var(--warning);--color-text-danger:var(--danger);'
    + '--color-background-primary:var(--bg);--color-background-secondary:var(--fill);--color-background-tertiary:var(--fill-strong);'
    + `--color-background-info:${mix(host.link, 13)};--color-background-success:${mix(host.success, 13)};--color-background-warning:${mix(host.warning, 13)};--color-background-danger:${mix(host.danger, 13)};`
    + `--color-border-primary:${mix(host.fg, 40)};--color-border-secondary:${mix(host.fg, 24)};--color-border-tertiary:var(--line);`
    + '--color-border-info:var(--accent);--color-border-success:var(--success);--color-border-warning:var(--warning);--color-border-danger:var(--danger);'
    + '--border-radius-md:8px;--border-radius-lg:12px;--border-radius-xl:16px;--p:var(--fg);--s:var(--muted);--t:var(--subtle);--bg2:var(--fill);--b:var(--line)}'
  const base = '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:transparent;width:100%;max-width:100%}html{overflow-x:hidden;overflow-y:hidden}body{overflow-x:clip;overflow-y:visible}'
    + `body{padding:2px;font-family:var(--font-sans);font-size:${host.fontSize};line-height:1.65;color:var(--fg);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}`
    + '#dsh-visual{display:flow-root;width:100%;min-width:0}h1,h2,h3,h4,h5,h6,p,ul,ol,dl,figure,blockquote{margin:0}'
    + 'h1,h2,h3{font-weight:600;line-height:1.35}h1{font-size:1.5em}h2{font-size:1.3em}h3{font-size:1.12em}h4,h5,h6{font-size:1em;font-weight:600}'
    + 'a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}'
    + 'code,kbd,pre{font-family:var(--font-mono);font-size:.9em}:not(pre)>code{padding:.1em .4em;border-radius:6px;background:var(--fill)}pre{white-space:pre-wrap}'
    + 'img,svg,canvas,video{max-width:100%}table{width:100%;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}th{font-weight:600}'
    + '#dsh-visual>*{animation:dsh-enter .32s ease-out both}#dsh-visual>:nth-child(2){animation-delay:.05s}#dsh-visual>:nth-child(n+3){animation-delay:.1s}'
    + '@keyframes dsh-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'
  return tokens + base + FORMS + svgClasses(scheme) + COMPONENTS
}
