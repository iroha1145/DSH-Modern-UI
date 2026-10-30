import { test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '../..')
const host = await import(pathToFileURL(path.join(root, 'packages/modern-ui/lib/index.js')).href)

/** Bundle one client source module for direct inspection (React is not rendered). */
async function load(name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-presentation-'))
  try {
    const outfile = path.join(directory, 'module.mjs')
    await build({ entryPoints: [path.join(root, 'packages/modern-ui/src', name)], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    return await import(pathToFileURL(outfile).href)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** A Loader-resolved volatile section is a reference; read through it either way. */
const read = value => (typeof value?.get === 'function' ? value.get() : value)

/** Run the Host entry against a recording context and return the non-empty system prompt sections of one assembly. */
function sectionsFor(config) {
  const sections = []
  const scope = {
    effect: fn => fn(),
    systemPrompt: {
      section: section => {
        sections.push(section)
      },
      getSectionOrder: () => 100,
    },
  }
  const ctx = {
    inject: (deps, callback) => {
      if (deps.includes('systemPrompt')) callback(scope)
    },
    on: () => () => {},
  }
  host.apply(ctx, host.Config(config))
  return sections.filter(section => (typeof section.text === 'function' ? section.text({}) : section.text).length > 0).map(section => section.name)
}

const states = [
  ['absent', {}, false],
  ['off', { presentation: { prompt: false } }, false],
  ['on', { presentation: { prompt: true } }, true],
]

for (const [label, config, expected] of states) {
  test(`presentation prompt ${label}: system prompt section ${expected ? 'added' : 'absent'}`, () => {
    const accepted = read(host.Config(config).presentation)
    assert.equal(accepted.prompt, expected)
    assert.equal(accepted.openui, true)
    assert.equal(accepted.followups, true)
    assert.deepEqual(sectionsFor(config), expected ? ['modern-ui:response-presentation'] : [])
  })
}

test('a live switch change takes effect at the next assembly without remounting', () => {
  const live = { prompt: false }
  const sections = []
  const scope = {
    effect: fn => fn(),
    systemPrompt: {
      section: section => {
        sections.push(section)
      },
      getSectionOrder: () => 100,
    },
  }
  host.apply(
    {
      inject: (deps, callback) => {
        if (deps.includes('systemPrompt')) callback(scope)
      },
      on: () => () => {},
    },
    { enabled: true, presentation: { get: () => live } },
  )
  assert.equal(sections.length, 1)
  assert.equal(sections[0].text({}), '')
  live.prompt = true
  assert.ok(sections[0].text({}).length > 1000)
})

test('a disabled Modern UI entry adds no prompt even when the switch is on', () => {
  assert.deepEqual(sectionsFor({ enabled: false, presentation: { prompt: true } }), [])
})

test('the bundle patch declares the prompt off explicitly', async () => {
  const patch = await readFile(path.join(root, 'packages/modern-ui/cordis.patch.yml'), 'utf8')
  assert.match(patch, /presentation:\r?\n\s+prompt: false/)
})

test('client switches read the accepted section and keep defaults for missing fields', async () => {
  const { readPresentation, DEFAULT_PRESENTATION, presentationLocale } = await load('presentation-switches.ts')
  assert.deepEqual(readPresentation(undefined), DEFAULT_PRESENTATION)
  assert.deepEqual(readPresentation({ prompt: true }), { prompt: true, openui: true, followups: true })
  assert.deepEqual(readPresentation({ openui: false, followups: 'no' }), { prompt: false, openui: false, followups: true })
  const keys = Object.keys(presentationLocale.zh).sort()
  for (const language of ['en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) assert.deepEqual(Object.keys(presentationLocale[language]).sort(), keys)
})
