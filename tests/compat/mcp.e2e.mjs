import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { runtimeEnvironment, launchEnvironment } from '../../scripts/distribution/manager.mjs'
import { isMainModule } from '../../scripts/distribution/entrypoint.mjs'

const execute = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
export const mcpFixtureName = 'modern-compat-mcp-probe'

/** Add this returned tarball to the isolated profile through the official plugin CLI. */
export async function prepareMcpFixture(output) {
  output = resolve(output)
  const directory = join(output, 'package')
  await mkdir(directory, { recursive: true })
  const events = join(output, 'mcp-events.jsonl')
  await writeFile(events, '')
  await Promise.all(['mcp-probe.mjs', 'mcp-server.mjs'].map(name => copyFile(join(here, name), join(directory, name))))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: mcpFixtureName, version: '1.0.0', type: 'module',
    main: './mcp-probe.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
  await writeFile(join(directory, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: mcpFixtureName, name: mcpFixtureName, config: { events } }] }]))
  const tarball = join(output, 'mcp-probe.tgz')
  await execute('tar', ['-czf', tarball, '-C', output, 'package'], { windowsHide: true })
  return { tarball, events, name: mcpFixtureName }
}

/** Runs against the real CLI's authenticated Web origin after the fixture is active. */
export async function runMcpChecks({ baseUrl, cookie, profile, events, output }) {
  const response = await fetch(new URL('/api/compat-mcp/check', baseUrl), { headers: { cookie }, signal: AbortSignal.timeout(60_000) })
  const result = await response.json()
  if (output) await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n')
  assert.equal(response.status, 200, JSON.stringify(result))
  const transcript = (await readFile(events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  return verifyMcpEvidence(result, transcript, profile)
}

/** Also permits checking a completed Host run without reinstalling its fixture. */
export function verifyMcpEvidence(result, transcript, profile) {
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.equal(result.profile, profile)
  assert.deepEqual(result.results.map(row => row.name), ['discovery', 'call', 'error', 'cancellation', 'unload', 'reload-without-duplicate-registration'])
  assert.ok(result.results.every(row => row.passed === true))
  assert.equal(transcript.filter(row => row.event === 'initialize').length, 2)
  // The real SDK may open a separate modern-protocol probe before negotiating
  // this fixture's initialize-based protocol. Every child must still be gone.
  for (const { pid } of transcript.filter(row => row.event === 'start')) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `MCP child ${pid} must exit`)
  }
  assert.ok(transcript.some(row => row.event === 'cancelled' && row.pending))
  return { ...result, upstreamEvents: transcript }
}

export async function runMcpProfile({ stateFile, output }) {
  const state = JSON.parse(await readFile(resolve(stateFile), 'utf8'))
  output = resolve(output)
  await mkdir(output, { recursive: true })
  const fixture = await prepareMcpFixture(join(output, 'fixture'))
  const installed = await execute(state.node, [state.cli, 'plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', fixture.tarball],
    { cwd: state.generation, env: runtimeEnvironment(state), windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  await writeFile(join(output, 'install.log'), installed.stdout + installed.stderr)
  const child = spawn(state.node, [state.cli, '--profile', state.profile, '--no-open', '--host', '127.0.0.1', '--port', '0'],
    { cwd: state.generation, env: { ...launchEnvironment(state), DSH_TELEMETRY_DISABLED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const closed = new Promise(resolve => child.once('close', resolve))
  child.stdout.on('data', bytes => { log += bytes })
  child.stderr.on('data', bytes => { log += bytes })
  try {
    let url
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw new Error(`Official CLI exited (${child.exitCode}) before MCP readiness`)
      url = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(log)?.[1]
      if (url) break
      await delay(100)
    }
    assert.ok(url, 'Official CLI must publish its loopback URL')
    await delay(1500)
    const authenticated = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    const cookie = authenticated.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ')
    assert.ok(cookie, 'Official CLI must exchange the token for a session cookie')
    const result = await runMcpChecks({ baseUrl: url, cookie, profile: state.profile, events: fixture.events, output: join(output, 'result.json') })
    assert.equal(result.officialVersion, state.officialSource.version)
    await writeFile(join(output, 'result.json'), JSON.stringify({ ...result, cli: state.cli, node: state.node, backend: state.backend }, null, 2) + '\n')
    return result
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await Promise.race([closed, delay(5000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed }
    await writeFile(join(output, 'host.log'), log.replaceAll(/(http:\/\/127\.0\.0\.1:\d+\/)[^\s]*/g, '$1[redacted]'))
  }
}

if (isMainModule(import.meta.url)) {
  const [stateFile, output] = process.argv.slice(2)
  assert.ok(stateFile && output, 'Usage: node tests/compat/mcp.e2e.mjs STATE_JSON OUTPUT_DIRECTORY')
  const result = await runMcpProfile({ stateFile, output })
  console.log(JSON.stringify({ version: result.officialVersion, passed: result.results.length, profile: result.profile }))
}
