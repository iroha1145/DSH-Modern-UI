import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { countEach, EDITS, LANG_CORE_VERSION } from '../../scripts/openui-each-counter.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const langCore = readFileSync(path.join(root, 'node_modules/@openuidev/lang-core/dist/index.mjs'), 'utf8')

describe('lang-core expansion counter patch', () => {
  test('counts loops, built lists and objects, and pass results of the pinned lang-core, and exports the setter', () => {
    expect(JSON.parse(readFileSync(path.join(root, 'node_modules/@openuidev/lang-core/package.json'), 'utf8')).version).toBe(LANG_CORE_VERSION)
    const patched = countEach(langCore)
    for (const { replace } of EDITS) expect(patched).toContain(replace)
    for (const counter of [
      'each(arr.length',
      'each(0',
      'result(result',
      'built(node.els.length',
      'built(node.entries.length',
      'built(obj.length',
      'built(__dshListItems',
    ])
      expect(patched).toContain(`__dshCounters?.${counter}`)
    expect(patched).toMatch(/export function __dshSetCounters\(counters\)/)
  })

  test('fails instead of skipping when any counted source changed', () => {
    for (const { find } of EDITS) expect(() => countEach(langCore.replace(find, find.replace('(', '( ')))).toThrow(/no longer matches/)
    expect(() => countEach(langCore + EDITS[2].find)).toThrow(/no longer matches/)
    expect(() => countEach(countEach(langCore))).toThrow(/no longer matches/)
  })
})
