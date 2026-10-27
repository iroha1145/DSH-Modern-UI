/** Completed DSH visualization source: an HTML fragment, or JSON adapted from OpenIntelligentUI's content fields. */
import z from '@deepseek-ai/schemastery'

/** A single completed visualization; execution never accepts partial streaming source. */
export interface IntelligentContent {
  version: 1
  title: string
  /** Standalone explanation; JSON blocks require it, HTML fragments rely on the surrounding answer. */
  fallback?: string
  initialHeight?: number
  css?: string
  html: string | string[]
  jsFunctions?: string
  jsExpressions?: string | string[]
}

/** Authored notation of one fence body. */
export type ContentFormat = 'html' | 'json'

/** Security limits apply to model-authored content, independently of deployment settings. */
export const CONTENT_LIMIT = 128_000
/** Minimum visible frame height in CSS pixels. */
export const MIN_HEIGHT = 24
/** Maximum frame height; taller content scrolls inside the frame. */
export const MAX_HEIGHT = 2400
/** Maximum JSON fragments, or inline scripts in one HTML fragment. */
export const MAX_FRAGMENTS = 128

const TITLE_LIMIT = 200
const fragments = z.union([z.string(), z.array(z.string()).max(MAX_FRAGMENTS)])
const contentSchema: z<IntelligentContent> = z.object({
  version: z.const(1).required(),
  title: z.string().min(1).max(TITLE_LIMIT).required(),
  fallback: z.string().min(1).max(16_000).required(),
  initialHeight: z.number().min(MIN_HEIGHT).max(MAX_HEIGHT),
  css: z.string().max(32_000),
  html: fragments.required(),
  jsFunctions: z.string().max(32_000),
  jsExpressions: fragments,
})

const TITLE_ELEMENT = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i
const SCRIPT_ELEMENT = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi
const JSON_TITLE = /^\s*\{[\s\S]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/

/** Validated result retains source elsewhere so a rejected visualization remains readable. */
export type ContentResult =
  | { ok: true; format: ContentFormat; content: IntelligentContent }
  | { ok: false; reason: 'invalid' | 'tooLarge' }

/**
 * Parse completed untrusted source; a body starting with `{` or `[` is JSON, anything else an HTML fragment.
 * @param source - Raw openui fence body.
 * @param defaultTitle - Localized title for a fragment without a `<title>` element.
 * @returns Validated content with its notation, or a localized failure category.
 */
export function parseContent(source: string, defaultTitle: string): ContentResult {
  if (source.length > CONTENT_LIMIT) return { ok: false, reason: 'tooLarge' }
  return sourceFormat(source) === 'json' ? parseJson(source) : parseFragment(source, defaultTitle)
}

/**
 * Name the notation of a possibly partial fence body.
 * @param source - Fence body.
 * @returns `json` when the body starts with `{` or `[`, otherwise `html`.
 */
export function sourceFormat(source: string): ContentFormat {
  return /^\s*[[{]/.test(source) ? 'json' : 'html'
}

/**
 * Read the title written so far, for the placeholder shown while the answer streams.
 * @param source - Possibly partial fence body.
 * @returns The plain-text title, or undefined until one is complete.
 */
export function partialTitle(source: string): string | undefined {
  const title = sourceFormat(source) === 'json'
    ? JSON_TITLE.exec(source)?.[1]?.replace(/\\(.)/g, '$1')
    : TITLE_ELEMENT.exec(source)?.[1]
  const text = title?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT) ?? ''
  return text === '' ? undefined : text
}

function parseFragment(source: string, defaultTitle: string): ContentResult {
  if (!/<[a-z]/i.test(source)) return { ok: false, reason: 'invalid' }
  const scripts: string[] = []
  // Replacer functions keep `$` sequences in authored code literal.
  const markup = source.replace(TITLE_ELEMENT, () => '').replace(SCRIPT_ELEMENT, (_element: string, text: string) => {
    if (text.trim() !== '') scripts.push(text)
    return ''
  })
  if (markup.trim() === '' && scripts.length === 0) return { ok: false, reason: 'invalid' }
  if (scripts.length > MAX_FRAGMENTS) return { ok: false, reason: 'tooLarge' }
  return {
    ok: true,
    format: 'html',
    content: { version: 1, title: partialTitle(source) ?? defaultTitle, html: markup, jsExpressions: scripts },
  }
}

function parseJson(source: string): ContentResult {
  try {
    const input: unknown = JSON.parse(source)
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'invalid' }
    const allowed = new Set(['version', 'title', 'fallback', 'initialHeight', 'css', 'html', 'jsFunctions', 'jsExpressions'])
    if (Object.values(input).some(value => value === null)) return { ok: false, reason: 'invalid' }
    if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, reason: 'invalid' }
    const content = z.resolve(input, contentSchema, {})[0] as IntelligentContent
    if (content.title.trim() === '' || content.fallback?.trim() === ''
      || (Array.isArray(content.html) ? content.html.join('') : content.html).trim() === '') return { ok: false, reason: 'invalid' }
    if (content.initialHeight !== undefined && !Number.isFinite(content.initialHeight)) return { ok: false, reason: 'invalid' }
    return { ok: true, format: 'json', content }
  } catch (_error) {
    // JSON and schema failures have one owner-visible state; the source remains available.
    return { ok: false, reason: 'invalid' }
  }
}

/**
 * Accept finite frame measurements only and bound their layout impact.
 * @param value - Untrusted postMessage height.
 * @returns Rounded bounded height, or undefined for invalid measurements.
 */
export function reportedHeight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(value)))
    : undefined
}
