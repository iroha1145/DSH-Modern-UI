import { describe, expect, test } from 'vitest'
import { JEV_TOOL, PRESENTATIONS } from '../../packages/modern-ui/src/jev-tool.ts'
import { toolRowModel } from '../../packages/modern-ui/src/vendor/tool/client/tool/models/tool-call-model.ts'

const args = { text: () => undefined, complete: () => false }
const summary = 'Three sources compared on method, findings and limits.'

/** A settled call as the conversation snapshot hands it to the Tool row. */
function settled(meta: unknown, isError = false) {
  return {
    kind: 'tool-result',
    seq: 9,
    time: 2,
    callId: 'call-1',
    name: JEV_TOOL,
    args,
    call: { name: JEV_TOOL, argsRaw: JSON.stringify({ content_summary: summary }) },
    callTime: 1,
    content: [{ type: 'text', text: 'You could consider a table (Table) for the parts that compare items.' }],
    isError,
    ...(meta === undefined ? {} : { meta }),
    subCalls: [],
  } as never
}

describe('jev_presentation_advice tool row', () => {
  test('has its own title instead of the generic row with the raw tool name', () => {
    const running = toolRowModel(JEV_TOOL, {
      phase: 'start',
      callId: 'call-1',
      name: JEV_TOOL,
      args,
      argsRaw: JSON.stringify({ content_summary: summary }),
    } as never)
    expect(running.titleKey).toBe('tool.title.jevAdvice')
    expect(running.summary).toBe(summary)
    expect(running.summary).not.toContain(JEV_TOOL)
    expect(running.outcomeKey).toBeNull()
  })

  test('a settled call shows the outcome from the result metadata, never the confidence', () => {
    expect(toolRowModel(JEV_TOOL, settled({ status: 'suggestion', presentation: 'table', confidence: 0.8 })).outcomeKey).toBe('jev.outcome.table')
    expect(toolRowModel(JEV_TOOL, settled({ status: 'repeated', presentation: 'flowchart', confidence: 0.6 })).outcomeKey).toBe('jev.outcome.flowchart')
    expect(toolRowModel(JEV_TOOL, settled({ status: 'no_suggestion', presentation: 'text', confidence: 0.9 })).outcomeKey).toBe('jev.outcome.text')
    expect(toolRowModel(JEV_TOOL, settled({ status: 'unavailable' })).outcomeKey).toBe('jev.outcome.unavailable')
    expect(toolRowModel(JEV_TOOL, settled({ status: 'already_consulted' })).outcomeKey).toBe('jev.outcome.alreadyConsulted')
    expect(toolRowModel(JEV_TOOL, settled({ status: 'not_sent' })).outcomeKey).toBe('jev.outcome.notSent')
    // A cancelled call, an older record without metadata, or metadata of another shape shows no outcome.
    expect(toolRowModel(JEV_TOOL, settled(undefined)).outcomeKey).toBeNull()
    expect(toolRowModel(JEV_TOOL, settled({ status: 'suggestion', presentation: 'map' })).outcomeKey).toBeNull()
    expect(toolRowModel(JEV_TOOL, settled({ status: 'suggestion', presentation: 'table' }, true)).outcomeKey).toBeNull()
    // Other tools are untouched.
    expect(toolRowModel('some_mcp_tool', settled({ status: 'suggestion', presentation: 'table' })).outcomeKey).toBeNull()
  })

  test('the title and every outcome exist in all eight interface languages, for every Jev choice', async () => {
    const { jevToolLocale, JEV_TOOL_NAME } = await import('../../packages/modern-ui/src/jev-tool-card.ts')
    expect(JEV_TOOL_NAME).toBe(JEV_TOOL)
    const keys = Object.keys(jevToolLocale.zh)
    expect(keys).toContain('tool.title.jevAdvice')
    for (const presentation of Object.keys(PRESENTATIONS)) expect(keys).toContain(`jev.outcome.${presentation}`)
    expect(Object.keys(jevToolLocale).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
    for (const dictionary of Object.values(jevToolLocale)) {
      expect(Object.keys(dictionary).sort()).toEqual([...keys].sort())
      for (const text of Object.values(dictionary)) expect(text.trim()).not.toBe('')
    }
  })
})
