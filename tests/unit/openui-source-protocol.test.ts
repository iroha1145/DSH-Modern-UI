import assert from 'node:assert/strict'
import { describe, expect, test } from 'vitest'
import { createLibrary, createParser, defineComponent, parseMessage } from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { prepareOpenUISource } from '../../packages/modern-ui/src/vendor/intelligent/client/openui-source.ts'

const library = createLibrary({
  components: [defineComponent({ name: 'Text', props: z.object({ text: z.string() }), component: () => null })],
  root: 'Text',
})
const parser = createParser(library.toJSONSchema(), library.root)

describe('fence DSL and Cloud transport markers', () => {
  test('preserves literal marker text with the actual lexer semantics for both quote styles', () => {
    for (const literal of [
      JSON.stringify('before\n]]>openui:content\nroot = Text("other")\n]]>openui:context\n{"x":1}'),
      '\'before\n]]>openui:content\nroot = Text("other")\n]]>openui:scripts\n[]\'',
      String.raw`'quote\' slash\\ and ]]>openui:end'`,
      String.raw`"quote\" slash\\ and ]]>openui:state"`,
      '"raw newline\n]]>openui:content\ntext"',
    ]) {
      const code = `root = Text(${literal})`
      const prepared = prepareOpenUISource(code)
      assert.ok(prepared !== null)
      expect(parser.parse(prepared).root?.props).toEqual(parser.parse(code).root?.props)
      expect(parseMessage(prepared, { streaming: true }).content).toBe(prepared)
      expect(parseMessage(prepared).content).toBe(prepared)
      expect(prepared).not.toContain(']]>')
    }
  })

  test('partial marker text cannot turn into a transport section while the string streams', () => {
    for (const quote of ['"', "'"]) {
      const prefix = `root = Text(${quote}before\n`
      const marker = ']]>openui:content'
      for (let n = 1; n <= marker.length; n++) {
        const prepared = prepareOpenUISource(prefix + marker.slice(0, n))
        assert.ok(prepared !== null)
        expect(parseMessage(prepared, { streaming: true }).content).toBe(prepared)
        expect(parser.parse(prepared).root?.props).toEqual(parser.parse(prefix + marker.slice(0, n)).root?.props)
        expect(parser.parse(prepared).meta.incomplete).toBe(parser.parse(prefix + marker.slice(0, n)).meta.incomplete)
      }
    }
  })

  test('preserves partial literals ending in escapes or whitespace', () => {
    for (const quote of ['"', "'"]) {
      for (const suffix of ['\\', '\\n', '\\"', ' ', '\n', '\r\n']) {
        const code = `root = Text(${quote}a]${suffix}`
        const prepared = prepareOpenUISource(code)
        assert.ok(prepared !== null)
        expect(parser.parse(prepared).root?.props).toEqual(parser.parse(code).root?.props)
        expect(parser.parse(prepared).meta.incomplete).toBe(true)
        expect(parseMessage(prepared, { streaming: true }).content).toBe(prepared)
      }
    }
  })

  test('comments can mention markers without changing DSL, and closing brackets remain source while streaming', () => {
    for (const comment of ['#', '//']) {
      const code = `root = Text("shown") ${comment} quote ' ]]>openui:content\n${comment} ]]>openui:scripts`
      const prepared = prepareOpenUISource(code)
      assert.ok(prepared !== null)
      expect(parser.parse(prepared).root?.props).toEqual(parser.parse(code).root?.props)
      expect(parseMessage(prepared, { streaming: true }).content).toBe(prepared)
    }
    const prepared = prepareOpenUISource('$a = [[1\n]]')
    assert.ok(prepared !== null)
    expect(parseMessage(prepared, { streaming: true }).content).toBe(prepared)
  })

  test('rejects transport sections outside DSL strings and comments', () => {
    for (const section of ['content', 'context', 'state', 'scripts', 'end']) {
      expect(prepareOpenUISource(`root = Text("shown")\n]]>openui:${section}\nroot = Text("other")`)).toBeNull()
    }
  })
})
