import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readSelectorContract, runOfficialControlsChecks } from './official-controls.mjs'

assert.ok(process.env.COMPAT_BACKEND_PACKAGE, 'Set COMPAT_BACKEND_PACKAGE to the installed official DSH package.json')
const stylesheet = readFileSync(path.resolve(import.meta.dirname, '../../packages/modern-ui/src/official-controls.css'), 'utf8')
const scratch = mkdtempSync(path.join(tmpdir(), 'modern-official-controls-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
let report
const check = () => (report ??= runOfficialControlsChecks(process.env.COMPAT_BACKEND_PACKAGE))
/** Run the release check against an edited copy of the stylesheet and return its failure. */
async function failure(css) {
  const cssPath = path.join(scratch, 'official-controls.css')
  writeFileSync(cssPath, css)
  return runOfficialControlsChecks(process.env.COMPAT_BACKEND_PACKAGE, { cssPath }).then(
    () => assert.fail('The edited stylesheet must not pass'),
    error => error.message,
  )
}

test('all 49 official control targets exist in published CSS and runtime mappings', async () => {
  assert.equal((await check()).classes.length, 49)
})

test('every renamed module resolves to the one build this release publishes', async () => {
  const { classes, modules } = await check()
  assert.equal(modules.length, 7)
  for (const module of modules) {
    assert.ok(module.builds.includes(module.published), JSON.stringify(module))
    const other = module.builds.filter(build => build !== module.published)
    assert.ok(
      classes.every(name => other.every(build => !name.includes(`_${build}_`))),
      'Only the published build is reported',
    )
  }
})

test('a release that publishes neither build of a module fails and names every class it lacks', async () => {
  const css = stylesheet.replaceAll('_1rv3m_', '_zzzz1_').replaceAll('_1ulci_', '_zzzz2_').replaceAll('yHnPSG_avatar', 'yHnPSG_portrait')
  const lacking = [...new Set(css.match(/_\w+_zzzz[12]_\d+|yHnPSG_portrait/g))]
  assert.equal(lacking.length, 15)
  const message = await failure(css)
  for (const name of lacking) assert.ok(message.includes(name), `${name} is named in: ${message}`)
  assert.ok(!message.includes('yHnPSG_signedOutMenu') && !message.includes('_card_'), 'Published classes are not reported')
})

test('the stylesheet must give every rule of a renamed module a name for each build', () => {
  assert.equal(readSelectorContract(stylesheet).targets.length, 49)
  const bare = 'body[data-modern-official-controls] ._button_1rv3m_2 { color: red; }'
  assert.throws(() => readSelectorContract(stylesheet + bare), /_button_1rv3m_2 is written with different alternatives/)
  // The first rule of a module and a later one: neither may fall back to a single build's name.
  for (const [old, next] of [
    ['_button_1rv3m_2', '_button_1ulci_2'],
    ['_sm_1rv3m_28', '_sm_1ulci_28'],
  ]) {
    const single = stylesheet.replaceAll(`:is(.${old}, .${next})`, `.${old}`)
    assert.notEqual(single, stylesheet)
    assert.throws(() => readSelectorContract(single), new RegExp(`${old} has no name for module build 1ulci`))
  }
  const renamed = stylesheet.replaceAll('._ghost_1ulci_46', '._plain_1ulci_46')
  assert.throws(() => readSelectorContract(renamed), /Alternatives must name the same official class: _ghost_1rv3m_45, _plain_1ulci_46/)
  const nested = stylesheet.replaceAll(':is(._field_bjqpo_3, ._field_181ew_3)', ':is(._field_bjqpo_3, ._field_181ew_3:not(a))')
  assert.throws(() => readSelectorContract(nested), /:is\(\) may only list alternative class names/)
})

test('published switch and menu retain the structures used by exact selectors', async () => {
  const { structures } = await check()
  assert.ok(structures.switches > 0 && structures.accountMenus > 0)
})
