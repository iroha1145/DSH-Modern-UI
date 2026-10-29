import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { officialCommand, startHost } from './host.mjs'
import { prepareMcpFixture, runMcpChecks, mcpFixtureName } from './mcp.e2e.mjs'
import { prepareLifecycleFixture, runLifecycleChecks } from './lifecycle.e2e.mjs'
import { PROBE as lifecycleFixtureName } from './fixtures/lifecycle/protocol.mjs'
import { runBrowserChecks, browserFixtureName } from './browser.mjs'
import { checkFailedUpgrade } from './install-failure.mjs'
import { runWebConfigChecks } from './web-config.mjs'

const execute = promisify(execFile)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  if (!['--preview', '--host', '--root', '--browser', '--state'].includes(key) || !process.argv[index + 1] || Object.hasOwn(options, key)) throw new Error(`Invalid compatibility option: ${key}`)
  options[key] = process.argv[index + 1]
}
const json = async filename => JSON.parse(await readFile(filename, 'utf8'))
const save = (filename, value) => writeFile(filename, JSON.stringify(value, null, 2) + '\n')
const root = options['--root'] ? path.resolve(options['--root']) : await mkdtemp(path.join(tmpdir(), 'modern-compat-'))
const assertOutsideRepository = (repository, directory) => {
  const relative = path.relative(repository, directory)
  assert.ok(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'Consumer directories must be outside the development repository')
}
assertOutsideRepository(repo, root)
await mkdir(root, { recursive: true })
assertOutsideRepository(await realpath(repo), await realpath(root))
const output = path.join(root, `results-${randomUUID()}`)
await mkdir(output)
let preview = options['--preview'] && path.resolve(options['--preview'])
if (!preview && !options['--state']) {
  preview = path.join(repo, '.artifacts/compat-preview')
  for (const [script, args] of [['scripts/build-plugin.mjs', []], ['scripts/create-preview.mjs', [preview]]]) {
    const run = await execute(process.execPath, [path.join(repo, script), ...args], { cwd: repo, windowsHide: true, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
    await writeFile(path.join(output, path.basename(script) + '.log'), run.stdout + run.stderr)
  }
}
const existing = options['--state'] ? await json(path.resolve(options['--state'])) : undefined
if (existing) {
  const marker = await json(path.join(path.dirname(existing.root), '.compat-consumer.json'))
  assert.deepEqual(marker, { owner: 'modern-ui-compatibility-tests', program: existing.root, home: existing.home }, '--state must name an owned isolated test consumer')
  const repository = await realpath(repo)
  for (const location of [existing.root, existing.home, existing.backend, existing.cli, existing.plugin.path,
    path.join(existing.home, 'profiles', existing.profile)]) {
    assertOutsideRepository(repository, await realpath(location))
  }
}
const catalog = !existing && await json(path.join(preview, 'preview.json'))
if (existing && options['--host']) assert.equal(existing.officialSource.version, options['--host'], 'The supplied state must match the requested host')
assert.equal(process.version, `v${existing?.compatibility.node ?? catalog.node}`, 'Use the exact declared Node runtime')
const versions = existing ? [existing.officialSource.version] : options['--host'] ? [options['--host']] : catalog.compatibleHosts
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
  node: process.version, preview, hosts: [], boundaries: ['No paid provider calls', 'External providers, old Node, old browsers and data-format downgrade are unverified', 'Store 0.1.4 is excluded; its separate regression records an unsupported plugin, not a successful compatibility check'] }
let failed = false
for (const version of versions) {
  const evidence = path.join(output, version)
  await mkdir(evidence)
  const result = { version, layers: {} }
  report.hosts.push(result)
  try {
    let state = existing
    if (!state) {
      assert.ok(catalog.compatibleHosts.includes(version), `Host ${version} is outside the precompiled artifact's exact set`)
      const { main } = await import(pathToFileURL(path.join(preview, 'installer/manager.mjs')).href)
      const consumer = path.join(root, `${version}-${randomUUID()}`)
      const program = path.join(consumer, 'program')
      await mkdir(consumer, { recursive: true })
      await save(path.join(consumer, '.compat-consumer.json'), { owner: 'modern-ui-compatibility-tests', program, home: path.join(consumer, 'home') })
      await main(['install', '--root', program, '--home', path.join(consumer, 'home'), '--backend-version', version,
        '--node', process.execPath, '--plugin', path.join(preview, catalog.plugin.filename), '--plugin-integrity', catalog.plugin.integrity])
      await main(['community', '--root', program])
      state = await json(path.join(program, 'current.json'))
    }
    assert.equal(state.officialSource.version, version)
    const { main } = await import(pathToFileURL(state.manager).href)
    const artifact = await readFile(path.join(state.generation, 'modern-ui.tgz'))
    assert.equal('sha512-' + createHash('sha512').update(artifact).digest('base64'), state.plugin.integrity)
    result.artifact = { integrity: state.plugin.integrity, version: state.plugin.version }
    result.cli = state.cli; result.profile = state.profile
    result.layers.installation = { state: 'passed', reusedInstalledState: Boolean(existing), proof: state.sourceProof, selfTest: state.webSelfTest }
    result.layers.officialBefore = { state: 'passed', result: await main(['verify', '--root', state.root]) }
    const cleanupFixtures = async names => {
      const errors = []
      for (const name of names) {
        try {
          const profile = await json(path.join(state.home, 'profiles', state.profile, 'package.json'))
          if (Object.hasOwn(profile.dependencies ?? {}, name)) {
            await officialCommand(state, ['plugin', '--profile', state.profile, 'remove', name], path.join(evidence, `${name}-cleanup.log`))
          }
        } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Could not remove compatibility test fixtures')
    }
    const sentinel = path.join(state.home, 'compat-unrelated-data.txt')
    const sentinelBytes = `unrelated-${randomUUID()}`
    await writeFile(sentinel, sentinelBytes)
    const mcp = await prepareMcpFixture(path.join(evidence, 'mcp-fixture'))
    const lifecycle = await prepareLifecycleFixture(path.join(evidence, 'lifecycle-fixture'))
    try {
      for (const [label, artifact] of [['mcp', mcp.tarball], ['lifecycle', lifecycle]]) {
        await officialCommand(state, ['plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', artifact], path.join(evidence, `${label}-install.log`))
      }
      const host = await startHost(state, path.join(evidence, 'host.log'))
      try {
        result.layers.mcp = { state: 'passed', result: await runMcpChecks({ ...host, profile: state.profile, events: mcp.events, output: path.join(evidence, 'mcp.json') }) }
        result.layers.lifecycle = { state: 'passed', result: await runLifecycleChecks({ ...host, profile: state.profile, output: path.join(evidence, 'lifecycle'), restart: host.restart }) }
      } finally { await host.stop() }
    } finally { await cleanupFixtures([mcpFixtureName, lifecycleFixtureName]) }
    result.layers.webConfiguration = { state: 'passed', result: await runWebConfigChecks({ state, output: path.join(evidence, 'web-configuration') }) }
    try {
      const browser = await runBrowserChecks({ state, output: path.join(evidence, 'browser'), executablePath: options['--browser'] })
      const browserState = browser.checks.some(check => check.state === 'failed') ? 'failed'
        : browser.checks.some(check => check.state === 'unverified') ? 'unverified' : 'passed'
      result.layers.browser = { state: browserState, evidence: path.join(evidence, 'browser/result.json'), checks: browser.checks }
      assert.equal(browserState, 'passed', 'Real browser acceptance must pass before this run can claim core compatibility')
    } finally { await cleanupFixtures([browserFixtureName]) }
    assert.equal(await readFile(sentinel, 'utf8'), sentinelBytes)
    result.layers.unrelatedData = { state: 'passed' }
    result.layers.failedUpgrade = await checkFailedUpgrade(state, path.join(evidence, 'failed-upgrade'))
    result.layers.officialAfter = { state: 'passed', result: await main(['verify', '--root', state.root]) }
    result.state = 'passed'
  } catch (error) {
    failed = true; result.state = 'failed'; result.error = error.stack ?? String(error)
  }
  await save(path.join(evidence, 'result.json'), result)
  await save(path.join(output, 'report.json'), report)
  console.log(JSON.stringify({ host: version, state: result.state, evidence }))
}
report.completedAt = new Date().toISOString()
report.state = failed ? 'failed' : 'passed'
await save(path.join(output, 'report.json'), report)
console.log(JSON.stringify({ state: report.state, report: path.join(output, 'report.json') }))
process.exitCode = failed ? 1 : 0
