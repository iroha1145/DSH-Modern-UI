import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseFollowups } from '../../packages/modern-ui/src/vendor/intelligent/client/parse-followups.ts'
import { assistantMessage, CONTENT_LIMIT, looksLikeOpenUI } from '../../packages/modern-ui/src/vendor/intelligent/client/openui-source.ts'
import { PRESENTATION_PROMPT } from '../../packages/modern-ui/src/vendor/intelligent/presentation-prompt.ts'
import { OPENUI_SYSTEM_PROMPT } from '../../packages/modern-ui/src/vendor/openui/system-prompt.generated.ts'

const root = path.resolve(import.meta.dirname, '../..')

describe('parseFollowups', () => {
  test('keeps questions in authored order without list markers or wrapping quotes', () => {
    expect(parseFollowups("- First?\n2) Second?\n(3) “Third?”\n• 'Fourth?'")).toEqual(['First?', 'Second?', 'Third?', 'Fourth?'])
  })

  test('drops blank, punctuation-only, duplicate and over-long lines', () => {
    expect(parseFollowups(`Same?\r\n\r\n—\n...\nSame?\n${'x'.repeat(201)}\nOther?`)).toEqual(['Same?', 'Other?'])
  })

  test('stops at five questions', () => {
    expect(parseFollowups(Array.from({ length: 8 }, (_, index) => `Q${index}?`).join('\n'))).toHaveLength(5)
  })
})

describe('openui-lang fences', () => {
  test('recognizes a program by its first assignment, after leading comments and blank lines', () => {
    expect(looksLikeOpenUI('root = Col([title])')).toBe(true)
    expect(looksLikeOpenUI('\n  $count = 0\nroot = Col([])')).toBe(true)
    expect(looksLikeOpenUI('// sizing tool\nroot = Card([])')).toBe(true)
  })

  test('leaves HTML and JSON visualizations from older answers to the plain code block', () => {
    expect(looksLikeOpenUI('<section class="ui-card"><h3>Title</h3></section>')).toBe(false)
    expect(looksLikeOpenUI('{"version": 1, "title": "Chart"}')).toBe(false)
    expect(looksLikeOpenUI('')).toBe(false)
  })

  test('bounds parsed source at the documented limit', () => {
    expect(CONTENT_LIMIT).toBe(128_000)
  })
})

describe('assistantMessage', () => {
  test('sends the authored message followed by entered form values and bound variables', () => {
    const message = assistantMessage({
      humanFriendlyMessage: ' Help me choose a database ',
      formState: { form1: { Workload: { value: 'analytics', componentType: 'Select' }, Notes: { value: '' } }, $users: 5000, $empty: null },
    })
    expect(message).toBe('Help me choose a database\n\n- Workload: analytics\n- users: 5000')
  })

  test('falls back to the message alone and caps long payloads', () => {
    expect(assistantMessage({ humanFriendlyMessage: 'Plan another day', formState: undefined })).toBe('Plan another day')
    const long = assistantMessage({ humanFriendlyMessage: 'x', formState: { $notes: 'y'.repeat(5000) } })
    expect(long.length).toBe(4000)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('presentation prompt', () => {
  test('the generated openui-lang prompt is current and its worked examples parse against the library', () => {
    // Exits non-zero when an example fails to parse or the committed prompt is stale.
    expect(() => execFileSync(process.execPath, [path.join(root, 'scripts/generate-openui-prompt.mjs'), '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow()
  })

  test('teaches openui-lang fences inside Markdown answers rather than whole-response programs', () => {
    expect(OPENUI_SYSTEM_PROMPT).toContain('fenced code block whose language is openui-lang')
    expect(OPENUI_SYSTEM_PROMPT).not.toContain('Your ENTIRE response must be valid openui-lang')
    expect(OPENUI_SYSTEM_PROMPT).toContain('FlowNode(title: string')
    for (const removed of ['MapMarker', 'YouTube(', 'Celebration(', '@GroupBy', '@MixColor', 'cdn.jsdelivr'])
      expect(OPENUI_SYSTEM_PROMPT).not.toContain(removed)
  })

  test('keeps the citation, picture and follow-up rules after the component guidance', () => {
    expect(PRESENTATION_PROMPT.startsWith(OPENUI_SYSTEM_PROMPT)).toBe(true)
    for (const rule of ['- Cite externally sourced factual claims', '- Pictures:', '- Follow-up questions:', '```followups'])
      expect(PRESENTATION_PROMPT).toContain(rule)
    expect(PRESENTATION_PROMPT).not.toContain('ui-card')
  })
})
