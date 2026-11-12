import { test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
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
      if (deps.every(dep => dep === 'systemPrompt')) callback(scope)
    },
    on: () => () => {},
  }
  host.apply(ctx, host.Config(config))
  return sections.filter(section => (typeof section.text === 'function' ? section.text({}) : section.text).length > 0).map(section => section.name)
}

const states = [
  ['absent', {}, []],
  ['off', { presentation: { prompt: false, progressive: false } }, []],
  ['components on', { presentation: { prompt: true } }, ['modern-ui:response-presentation']],
  ['progressive on', { presentation: { progressive: true } }, ['modern-ui:progressive-results']],
  ['both on', { presentation: { prompt: true, progressive: true } }, ['modern-ui:response-presentation', 'modern-ui:progressive-results']],
]

for (const [label, config, expected] of states) {
  test(`presentation switches ${label}: system prompt sections ${expected.join(', ') || 'absent'}`, () => {
    const accepted = read(host.Config(config).presentation)
    assert.equal(accepted.prompt, expected.includes('modern-ui:response-presentation'))
    assert.equal(accepted.progressive, expected.includes('modern-ui:progressive-results'))
    assert.equal(accepted.openui, true)
    assert.equal(accepted.followups, true)
    assert.deepEqual(sectionsFor(config), expected)
  })
}

test('a live switch change takes effect at the next assembly without remounting', () => {
  const live = { prompt: false, progressive: false }
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
        if (deps.every(dep => dep === 'systemPrompt')) callback(scope)
      },
      on: () => () => {},
    },
    { enabled: true, presentation: { get: () => live } },
  )
  assert.equal(sections.length, 2)
  const [components, progressive] = sections
  for (const section of sections) assert.equal(section.text({}), '')
  live.prompt = true
  assert.ok(components.text({}).length > 1000)
  assert.equal(progressive.text({}), '')
  live.progressive = true
  assert.ok(progressive.text({}).length > 1000)
  live.prompt = false
  assert.equal(components.text({}), '')
})

test('progressive delivery follows the component guidance and precedes the persona suffix', () => {
  const sections = []
  const orders = { DEPLOYMENT_PERSONA_SUFFIX: 10200 }
  const scope = {
    effect: fn => fn(),
    systemPrompt: {
      section: section => {
        sections.push(section)
      },
      getSectionOrder: name => orders[name],
    },
  }
  host.apply(
    {
      inject: (deps, callback) => {
        if (deps.every(dep => dep === 'systemPrompt')) callback(scope)
      },
      on: () => () => {},
    },
    host.Config({ presentation: { prompt: true, progressive: true } }),
  )
  const order = Object.fromEntries(sections.map(section => [section.name, section.order]))
  assert.ok(order['modern-ui:response-presentation'] < order['modern-ui:progressive-results'])
  assert.ok(order['modern-ui:progressive-results'] < orders.DEPLOYMENT_PERSONA_SUFFIX)
})

test('a disabled Modern UI entry adds no prompt even when the switch is on', () => {
  assert.deepEqual(sectionsFor({ enabled: false, presentation: { prompt: true, progressive: true } }), [])
})

test('the bundle patch declares the prompt off explicitly', async () => {
  const patch = await readFile(path.join(root, 'packages/modern-ui/cordis.patch.yml'), 'utf8')
  assert.match(patch, /presentation:\r?\n\s+prompt: false/)
  assert.match(patch, /\n\s+progressive: false/)
})

test('client switches read the accepted section and keep defaults for missing fields', async () => {
  const { readPresentation, DEFAULT_PRESENTATION, presentationLocale } = await load('presentation-switches.ts')
  assert.deepEqual(readPresentation(undefined), DEFAULT_PRESENTATION)
  assert.deepEqual(readPresentation({ prompt: true }), { prompt: true, progressive: false, openui: true, followups: true })
  assert.deepEqual(readPresentation({ progressive: true }), { prompt: false, progressive: true, openui: true, followups: true })
  assert.deepEqual(readPresentation({ openui: false, followups: 'no' }), { prompt: false, progressive: false, openui: false, followups: true })
  const keys = Object.keys(presentationLocale.zh).sort()
  for (const language of ['en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) assert.deepEqual(Object.keys(presentationLocale[language]).sort(), keys)
})
