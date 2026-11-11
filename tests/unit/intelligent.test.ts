import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseFollowups } from '../../packages/modern-ui/src/vendor/intelligent/client/parse-followups.ts'
import {
  assistantMessage,
  CONTENT_LIMIT,
  EXPANSION_LIMIT,
  expansionEstimate,
  looksLikeOpenUI,
} from '../../packages/modern-ui/src/vendor/intelligent/client/openui-source.ts'
import { PRESENTATION_PROMPT, PROGRESSIVE_PROMPT } from '../../packages/modern-ui/src/vendor/intelligent/presentation-prompt.ts'
import { hasMarkdownSection } from '../../packages/modern-ui/src/vendor/chat/client/contract/turn-process.ts'
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
  test('proposes the message followed by the shown value of every field, skipping empty ones', () => {
    const message = assistantMessage({
      message: ' Help me choose a database ',
      fields: [
        ['Workload', 'analytics'],
        ['Notes', ''],
        ['Team', 5],
        ['Region', null],
      ],
    })
    expect(message).toBe('Help me choose a database\n\n- Workload: analytics\n- Team: 5')
  })

  test("appends the step's context and shortens long values", () => {
    const message = assistantMessage({ message: 'More', fields: [['Notes', 'y'.repeat(400)]], context: { id: 7 } })
    expect(message).toBe(`More\n\n- Notes: ${'y'.repeat(299)}…\n- context: {"id":7}`)
  })

  test('falls back to the message alone and caps the whole proposal', () => {
    expect(assistantMessage({ message: 'Plan another day' })).toBe('Plan another day')
    const fields = Array.from({ length: 40 }, (_, index) => [`f${index}`, 'z'.repeat(200)] as const)
    const long = assistantMessage({ message: 'x', fields })
    expect(long.length).toBe(4000)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('expansionEstimate', () => {
  const num = (v: number) => ({ k: 'Num', v })
  const range = (start: number, end: number) => ({ k: 'Comp', name: 'Range', args: [num(start), num(end)] })
  const each = (list: unknown, template: unknown) => ({ k: 'Comp', name: 'Each', args: [list, { k: 'Str', v: 'i' }, template] })
  const text = { type: 'element', typeName: 'Text', props: { text: 'x' } }

  test('multiplies nested loops and counts literal and unknown lists', () => {
    expect(expansionEstimate({ type: 'element', props: { children: each(range(0, 500), each(range(0, 500), text)) } })).toBe(500 * 501)
    expect(expansionEstimate(each({ k: 'Arr', els: [num(1), num(2), num(3)] }, text))).toBe(3)
    expect(expansionEstimate(each({ k: 'StateRef', n: '$items' }, text))).toBe(100)
    expect(EXPANSION_LIMIT).toBe(20_000)
  })

  test('counts every use of a shared statement and terminates on cycles', () => {
    const shared = each(range(0, 100), text)
    expect(expansionEstimate([shared, shared, shared])).toBe(300)
    const cyclic: Record<string, unknown> = { k: 'Obj' }
    cyclic.self = cyclic
    expect(expansionEstimate(cyclic)).toBe(0)
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

  test('teaches progressive result delivery as its own section, not inside the component guidance', () => {
    expect(PRESENTATION_PROMPT).not.toContain('Staged answers')
    expect(PRESENTATION_PROMPT).not.toContain(PROGRESSIVE_PROMPT)
    // The protocol fact models miss: reply text in a message that makes tool calls is part of the answer, not its end.
    expect(PROGRESSIVE_PROMPT).toContain('Reply text in a message that also makes tool calls reaches the reader at once')
    expect(PROGRESSIVE_PROMPT).toContain('that text is part of the answer, not its end')
    expect(PROGRESSIVE_PROMPT).toContain('Plans, intentions and progress notes')
    expect(PROGRESSIVE_PROMPT).toContain('Write a part only from evidence you already have')
    expect(PROGRESSIVE_PROMPT).toContain('correct it plainly in one sentence of the later part')
    // Independent calls may run together across parts; only dependent calls wait, and a settled part is not held back.
    expect(PROGRESSIVE_PROMPT).toContain('only a call that needs an earlier result waits for it')
    expect(PROGRESSIVE_PROMPT).toContain('Do not hold a settled part for unrelated calls still to come')
    // The official "primary results within your final response" is met by the parts already delivered.
    expect(PROGRESSIVE_PROMPT).toContain('never just a note that the work is done')
    // Only a part that rests on a child's work waits for it; stricter delegation rules elsewhere still win.
    expect(PROGRESSIVE_PROMPT).toContain("A part that rests on work delegated to a child agent waits for that child's final report")
    expect(PROGRESSIVE_PROMPT).toContain('where other instructions require waiting for every child before answering, follow them')
    expect(PROGRESSIVE_PROMPT).toContain('In coding and editing work, report when the work is done')
    // Each part renders as its own Markdown, so a definition written in a later part would not reach it.
    expect(PROGRESSIVE_PROMPT).toContain('the reference definitions [n]: url "title" for the citations it uses at its end')
    expect(PRESENTATION_PROMPT).toContain('or at the end of each part when the answer is delivered in parts')
    expect(PRESENTATION_PROMPT).toContain('in its last message when the answer is delivered in parts')
    // The heading form the prompt asks for is the one the fold keeps in view.
    expect(PROGRESSIVE_PROMPT).toContain('Each part starts with a Markdown heading line (## Name)')
    for (const heading of PROGRESSIVE_PROMPT.match(/"## [A-Z][a-z]+"/g) ?? []) expect(hasMarkdownSection(heading.slice(1, -1))).toBe(true)
    const order = ['1. Message 1: no text; tool calls for the forecast.', '2. Message 2: "## Weather"', '3. Message 3: "## Sights"', '4. Message 4: "## Food"']
    expect(order.every(step => PROGRESSIVE_PROMPT.includes(step))).toBe(true)
    expect(order.map(step => PROGRESSIVE_PROMPT.indexOf(step))).toEqual([...order.map(step => PROGRESSIVE_PROMPT.indexOf(step))].sort((a, b) => a - b))
    expect(PROGRESSIVE_PROMPT).not.toMatch(/jev|presentation_advice/i)
  })

  test('asks for a tool-given address only where one is needed, and keeps each rule on its own line', () => {
    const pictures = PRESENTATION_PROMPT.split('\n').find(line => line.startsWith('- Pictures:')) ?? ''
    expect(pictures).toContain('SearchImage finds such a photo by name without a tool')
    expect(pictures).toContain('A Markdown picture or an Image component needs an address a tool returned or the user gave')
    expect(pictures).toContain('SearchImage needs no address')
    expect(pictures).not.toContain('whenever no tool returned a usable image')
    // A rule glued to the end of the previous one reads as part of it.
    expect(OPENUI_SYSTEM_PROMPT).not.toMatch(/[.:)]- [A-Z]/)
    expect(OPENUI_SYSTEM_PROMPT).toContain('respect requests for text only.\n- This description is complete')
  })

  test('prefers components and streams each block section by section', () => {
    expect(OPENUI_SYSTEM_PROMPT).toContain('Prefer showing to telling.')
    expect(OPENUI_SYSTEM_PROMPT).toContain('write a block section by section')
    expect(OPENUI_SYSTEM_PROMPT).toContain('pick variant "glass" selectively for a hero KPI or highlight card')
    expect(OPENUI_SYSTEM_PROMPT).not.toContain('Data values — leaf content last')
  })
})
