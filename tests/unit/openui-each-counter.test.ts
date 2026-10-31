import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { countEach, LANG_CORE_VERSION } from '../../scripts/openui-each-counter.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const langCore = readFileSync(path.join(root, 'node_modules/@openuidev/lang-core/dist/index.mjs'), 'utf8')

describe('lang-core @Each counter patch', () => {
  test('counts every @Each of the pinned lang-core and exports the setter', () => {
    expect(JSON.parse(readFileSync(path.join(root, 'node_modules/@openuidev/lang-core/package.json'), 'utf8')).version).toBe(LANG_CORE_VERSION)
    const patched = countEach(langCore)
    expect(patched).toContain(
      'const arr = evaluate(args[0], context);\n\t\tif (!Array.isArray(arr)) return [];\n\t\t__dshEachCounter?.(arr.length, context);\n',
    )
    expect(patched).toMatch(/export function __dshSetEachCounter\(counter\)/)
  })

  test('fails instead of skipping when lang-core changed', () => {
    expect(() => countEach(langCore.replace('const arr = evaluate(args[0], context);', 'const arr = evaluate(args[0], context) ?? [];'))).toThrow(
      /no longer matches/,
    )
    expect(() => countEach(countEach(langCore))).toThrow(/no longer matches/)
  })
})
