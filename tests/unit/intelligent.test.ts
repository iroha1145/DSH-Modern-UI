import { describe, expect, test } from 'vitest'
import { parseFollowups } from '../../packages/modern-ui/src/vendor/intelligent/client/parse-followups.ts'
import {
  CONTENT_LIMIT, MAX_FRAGMENTS, MAX_HEIGHT, MIN_HEIGHT, parseContent, partialTitle, reportedHeight, sourceFormat,
} from '../../packages/modern-ui/src/vendor/intelligent/client/schema.ts'
import { FRAME_CSP, frameDocument, frameProgram } from '../../packages/modern-ui/src/vendor/intelligent/client/frame-content.ts'
import { outerDocument } from '../../packages/modern-ui/src/vendor/intelligent/client/sandbox.ts'

const fallback = 'A plain explanation of the chart.'

describe('parseFollowups', () => {
  test('keeps questions in authored order without list markers or wrapping quotes', () => {
    expect(parseFollowups('- First?\n2) Second?\n(3) “Third?”\n• \'Fourth?\'')).toEqual(['First?', 'Second?', 'Third?', 'Fourth?'])
  })

  test('drops blank, punctuation-only, duplicate and over-long lines', () => {
    expect(parseFollowups(`Same?\r\n\r\n—\n...\nSame?\n${'x'.repeat(201)}\nOther?`)).toEqual(['Same?', 'Other?'])
  })

  test('stops at five questions', () => {
    expect(parseFollowups(Array.from({ length: 8 }, (_, index) => `Q${index}?`).join('\n'))).toHaveLength(5)
  })
})

describe('openui content schema', () => {
  test('recognizes JSON by its first non-space character', () => {
    expect(sourceFormat('  {"title":1}')).toBe('json')
    expect(sourceFormat('\n[1]')).toBe('json')
    expect(sourceFormat('<div>{}</div>')).toBe('html')
  })

  test('parses an HTML fragment, lifting its title and non-empty scripts out of the markup', () => {
    const result = parseContent('<title>Sales <b>2026</b></title><div>$&amp;</div><script>draw("$&")</script><script> </script>', 'Untitled')
    expect(result).toEqual({
      ok: true,
      format: 'html',
      content: { version: 1, title: 'Sales 2026', html: '<div>$&amp;</div>', jsExpressions: ['draw("$&")'] },
    })
  })

  test('uses the localized default title when a fragment has none', () => {
    const result = parseContent('<p>hi</p>', 'Visualization')
    expect(result.ok && result.content.title).toBe('Visualization')
  })

  test('rejects text without markup and markup that is only a title', () => {
    expect(parseContent('just prose', 'T')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseContent('<title>Only</title>', 'T')).toEqual({ ok: false, reason: 'invalid' })
  })

  test('rejects oversized sources and too many scripts as tooLarge', () => {
    expect(parseContent(`<p>${'x'.repeat(CONTENT_LIMIT)}</p>`, 'T')).toEqual({ ok: false, reason: 'tooLarge' })
    expect(parseContent('<p></p>' + '<script>1</script>'.repeat(MAX_FRAGMENTS + 1), 'T')).toEqual({ ok: false, reason: 'tooLarge' })
  })

  test('accepts complete JSON content', () => {
    const result = parseContent(JSON.stringify({ version: 1, title: 'Chart', fallback, html: ['<p>', '</p>'], initialHeight: 300 }), 'T')
    expect(result.ok && result.format).toBe('json')
    expect(result.ok && result.content.initialHeight).toBe(300)
  })

  test.each([
    ['an array', '[]'],
    ['malformed JSON', '{"version":1,'],
    ['an unknown key', JSON.stringify({ version: 1, title: 'C', fallback, html: '<p></p>', onload: 'x' })],
    ['a null value', JSON.stringify({ version: 1, title: 'C', fallback, html: '<p></p>', css: null })],
    ['a missing fallback', JSON.stringify({ version: 1, title: 'C', html: '<p></p>' })],
    ['a blank title', JSON.stringify({ version: 1, title: '   ', fallback, html: '<p></p>' })],
    ['blank html', JSON.stringify({ version: 1, title: 'C', fallback, html: ['  ', ''] })],
    ['a wrong version', JSON.stringify({ version: 2, title: 'C', fallback, html: '<p></p>' })],
    ['an out-of-range height', JSON.stringify({ version: 1, title: 'C', fallback, html: '<p></p>', initialHeight: MAX_HEIGHT + 1 })],
  ])('rejects JSON with %s', (_name, source) => {
    expect(parseContent(source, 'T')).toEqual({ ok: false, reason: 'invalid' })
  })

  test('reads a partial title from streaming HTML and JSON', () => {
    expect(partialTitle('<title>  Weekly\n  report </title><div')).toBe('Weekly report')
    expect(partialTitle('{"version":1,"title":"Say \\"hi\\""')).toBe('Say "hi"')
    expect(partialTitle('<title>Unfinished')).toBeUndefined()
    expect(partialTitle('{"title":"   "}')).toBeUndefined()
  })

  test('bounds reported frame heights and ignores non-numbers', () => {
    expect(reportedHeight(10)).toBe(MIN_HEIGHT)
    expect(reportedHeight(100.2)).toBe(101)
    expect(reportedHeight(1e9)).toBe(MAX_HEIGHT)
    expect(reportedHeight(Number.NaN)).toBeUndefined()
    expect(reportedHeight('100')).toBeUndefined()
  })
})

describe('openui sandbox documents', () => {
  const content = { version: 1 as const, title: 'T</script><script>alert(1)</script>', html: '<p>\u2028</p>', css: '</style></script>', jsExpressions: ['x("$$")'] }

  test('the inner shell carries the deny-by-default policy and no authored markup', () => {
    const shell = frameDocument()
    expect(shell).toContain(`content="${FRAME_CSP}"`)
    for (const directive of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"]) expect(FRAME_CSP).toContain(directive)
    expect(shell).not.toContain('<script')
  })

  test('the frame program serializes authored code as data that cannot close the script element', () => {
    const program = frameProgram(content, 'token')
    expect(program).not.toContain('</script>')
    expect(program).not.toContain('\u2028')
    expect(program).toContain('\\u003c/style>\\u003c/script>')
    expect(program).toContain('\\u003cp>\\u2028\\u003c/p>')
    expect(program).toContain('x(\\"$$\\")')
  })

  test('the outer document nests a scripts-only sandbox and keeps replacement patterns literal', () => {
    const outer = outerDocument(content, 'abc')
    expect(outer.match(/<script>/g)).toHaveLength(1)
    expect(outer).toContain("inner.setAttribute('sandbox','allow-scripts')")
    expect(outer).toContain("inner.referrerPolicy='no-referrer'")
    expect(outer).toContain("camera 'none'")
    expect(outer).toContain('$$')
    expect(outer).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/)
  })
})
