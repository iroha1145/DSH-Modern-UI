import { onTestFinished, test } from 'vitest'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { webSelfTest } from '../../scripts/distribution/web-self-test.mjs'
import { schemaFor } from '../../scripts/distribution/profile-settings.mjs'

// The self-test boots the real data home, so every scheduler instance of the composed profile must
// be disabled, whatever its id. These cases compose with the official 0.2.1-rc.4 configuration
// composer (`dsh --dump-config`, boot-free). The CLI handed to the self-test is a stub: it forwards
// --dump-config to the official CLI and, for the Web start, only records its arguments and overlay.
const require = createRequire(import.meta.url)
const backend = require.resolve('@deepseek-ai/dsh/package.json')
const officialBin = join(backend, '..', 'lib', 'bin.js')
const yaml = createRequire(backend)('js-yaml')
const SCHEDULER = '@deepseek-ai/dsh-schedule'

async function fixture({ profilePatch, homePatch } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'compat-self-test-scheduler-'))
  onTestFinished(() => rm(base, { recursive: true, force: true }))
  const home = join(base, 'home')
  const generation = join(base, 'generation')
  await mkdir(generation, { recursive: true })
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  const created = spawnSync(process.execPath, [officialBin, 'probe', '--from-default-profile', 'web', '--dump-config'], { cwd: base, env, encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  if (profilePatch) await writeFile(join(home, 'profiles', 'probe', 'cordis.patch.yml'), profilePatch)
  if (homePatch) await writeFile(join(home, 'cordis.patch.yml'), homePatch)
  const log = join(base, 'web-start.jsonl')
  const cli = join(base, 'stub-cli.mjs')
  await writeFile(
    cli,
    `import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args.includes('--dump-config')) process.exit(spawnSync(process.execPath, [${JSON.stringify(officialBin)}, ...args], { stdio: 'inherit' }).status ?? 1)
const patch = args.indexOf('--patch')
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, overlay: patch < 0 ? null : readFileSync(args[patch + 1], 'utf8') }) + '\\n')
process.exit(3)
`,
  )
  const state = {
    node: process.execPath,
    cli,
    backend,
    profile: 'probe',
    generation,
    officialSource: { version: '0.2.1-rc.4' },
    plugin: { name: '@dsh-modern/modern-ui' },
  }
  const starts = async () =>
    existsSync(log)
      ? (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
  return { base, env, state, starts }
}

/** Every scheduler instance in a composed tree, wherever it is nested. */
function schedulers(value, found = []) {
  if (Array.isArray(value)) for (const item of value) schedulers(item, found)
  else if (value && typeof value === 'object') {
    if (value.name === SCHEDULER) found.push(value)
    for (const child of Object.values(value)) schedulers(child, found)
  }
  return found
}

/** Compose the profile exactly as the recorded Web start would, with the overlay it was given. */
async function composeWith({ base, env, state }, overlay) {
  const file = join(base, 'recorded-overlay.yml')
  await writeFile(file, overlay)
  const result = spawnSync(process.execPath, [officialBin, '--profile', state.profile, '--patch', file, '--dump-config'], { cwd: base, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return yaml.load(result.stdout, { schema: schemaFor(yaml) })
}

const customId = `- insert:
    - id: my-reminders
      name: '${SCHEDULER}'
`
const groupNested = `- insert:
    - id: reminder-bucket
      name: cordis:group
      group: true
      config:
        - id: inner
          name: cordis:group
          group: true
          config:
            - id: nested-reminders
              name: '${SCHEDULER}'
              disabled: !!js process.platform === 'none'
`

for (const [label, layers, expectedIds] of [
  ['the default instance', {}, ['schedule']],
  ['a custom-id instance', { profilePatch: customId }, ['schedule', 'my-reminders']],
  ['an instance nested in groups', { profilePatch: groupNested }, ['schedule', 'nested-reminders']],
  ['an instance from the home-level patch layer', { homePatch: customId }, ['schedule', 'my-reminders']],
]) {
  test(`the self-test starts the Web host with ${label} disabled in the composed profile`, async () => {
    const context = await fixture(layers)
    await assert.rejects(webSelfTest(context.state, context.env), /exited before readiness/)
    const starts = await context.starts()
    assert.equal(starts.length, 1)
    assert.ok(starts[0].args.includes('--patch'))
    const composed = schedulers(await composeWith(context, starts[0].overlay))
    assert.deepEqual(composed.map(row => row.id).sort(), [...expectedIds].sort())
    for (const row of composed) assert.equal(row.disabled, true, `scheduler ${row.id} would run during the self-test`)
  })
}

for (const [label, profilePatch, reason] of [
  [
    'a scheduler nested where id patches cannot reach it',
    `- id: preset-standard
  config:
    id: standard
    order: 1
    plugins:
      - id: preset-reminders
        name: '${SCHEDULER}'
`,
    /instance preset-reminders is nested where a patch cannot reach it/,
  ],
  [
    'a scheduler without an id',
    `- insert:
    - name: '${SCHEDULER}'
`,
    /an instance without an id cannot be patched/,
  ],
  [
    'two schedulers sharing one id',
    `- insert:
    - id: twin
      name: '${SCHEDULER}'
    - id: bucket
      name: cordis:group
      group: true
      config:
        - id: twin
          name: '${SCHEDULER}'
`,
    /instance twin shares its id/,
  ],
  [
    'an included file the composed dump does not expand',
    `- insert:
    - id: extra
      name: cordis:include
      config:
        path: ./more.yml
`,
    /include extra loads entries the composed profile does not show/,
  ],
  [
    // The official single-pass id index never sees a group child introduced by a later config
    // replacement, so the overlay row misses it; only composing again with the overlay shows that.
    'a group child the id index never sees',
    `- insert:
    - id: late
      name: cordis:group
      group: true
      config: []
- id: late
  config:
    - id: late-reminders
      name: '${SCHEDULER}'
`,
    /instance late-reminders is still enabled with the self-test overlay/,
  ],
]) {
  test(`the self-test refuses to start the Web host with ${label}`, async () => {
    const context = await fixture({ profilePatch })
    await assert.rejects(webSelfTest(context.state, context.env), error => {
      assert.match(error.message, /^The installation self-test was not started/)
      assert.match(error.message, reason)
      return true
    })
    assert.deepEqual(await context.starts(), [], 'the Web host must not start')
  })
}
