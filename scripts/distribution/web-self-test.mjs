import { spawn, spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { schemaFor } from './profile-settings.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { request } from 'node:http'

function statusRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const pending = request(url, { headers, timeout: 10000 }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    pending.on('timeout', () => pending.destroy(new Error('Web security self-test timed out')))
    pending.on('error', reject)
    pending.end()
  })
}

const QUOTED = '"(?:[^"\\\\\\n]|\\\\.)*"'
const SKIPPED_BUNDLE = new RegExp(`^dsh: skipping profile bundle (${QUOTED}): ([^\\n]*)$`, 'gm')
const DISABLED_PLUGIN = new RegExp(`^dsh: disabling profile plugin (?:row (${QUOTED})|(.+?)): ((?:Plugin |its )[^\\n]*)$`, 'gm')
const MAX_REASON = 400

function unquote(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function categorize(reason) {
  if (/is incompatible with dsh|reaches an incompatible plugin/.test(reason)) return 'compatibility'
  if (/Bundle supports Host platforms/.test(reason)) return 'platform'
  if (/cannot resolve profile bundle/.test(reason)) return 'missing'
  if (/cannot be validated/.test(reason)) return 'unvalidated'
  return 'load-failure'
}

/**
 * Classify the official startup output. The official loader reports a selected profile entry it
 * does not load with one line and still boots: `skipping profile bundle "<name>": <reason>` for a
 * bundle (rc4 and 0.2.2-rc.1), `disabling profile plugin row "<id>": <reason>` or
 * `disabling profile plugin <module>: <reason>` for a plugin row (rc4 and 0.2.2-rc.1).
 * Only an official `@deepseek-ai/` bundle that no longer resolves (a copied profile selecting a
 * package this release does not ship) is a harmless removal and lands in `skippedBundles`. Every other skip keeps its name,
 * category and reason in `unverified`: those entries the user selected are NOT running, so the
 * install is reported with a warning instead of being claimed as fully verified. Other error lines
 * remain fatal through `problem`.
 * @param {string} text combined stdout and stderr of the startup.
 * @returns {{skippedBundles: string[], unverified: {kind: 'bundle'|'plugin', name: string, category: string, reason: string}[], problem: boolean}}
 */
export function auditStartupOutput(raw) {
  const text = raw.replace(/\r\n/g, '\n')
  const skippedBundles = new Set()
  const unverified = []
  const record = (kind, name, reason) => {
    const category = categorize(reason)
    // Only an official package the pinned release stopped shipping is a harmless removal; an unresolved
    // community bundle the user selected is reported like any other entry that is not running.
    if (kind === 'bundle' && category === 'missing' && name.startsWith('@deepseek-ai/')) return void skippedBundles.add(name)
    const trimmed = reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON)}...` : reason
    if (!unverified.some(item => item.kind === kind && item.name === name && item.reason === trimmed))
      unverified.push({ kind, name, category, reason: trimmed })
  }
  for (const match of text.matchAll(SKIPPED_BUNDLE)) record('bundle', unquote(match[1]), match[2])
  for (const match of text.matchAll(DISABLED_PLUGIN)) record('plugin', match[1] === undefined ? match[2] : unquote(match[1]), match[3])
  const remainder = text.replace(SKIPPED_BUNDLE, '').replace(DISABLED_PLUGIN, '')
  const problem = /entr(?:y|ies) did not activate|ValidationError|(?:Type|Reference|Syntax)?Error:|startup[^\n]*fail/i.test(remainder)
  return { skippedBundles: [...skippedBundles], unverified, problem }
}

const SCHEDULER = '@deepseek-ai/dsh-schedule'
const INCLUDES = new Set(['cordis:include', '@deepseek-ai/cordis-plugin-include'])

/** Every row with `name` anywhere in a composed tree, nested under any key. */
function rowsNamed(value, names, found = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return found
  seen.add(value)
  if (!Array.isArray(value) && names.has(value.name)) found.push(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) rowsNamed(child, names, found, seen)
  return found
}

/**
 * Patch rows that disable every scheduler instance of a composed profile, or a refusal.
 * An overlay row reaches an entry only by id, through top-level rows and `group` children
 * (the include plugin's `applyEntryPatches`); a scheduler anywhere else, without an id, or
 * sharing its id, cannot be disabled, and an active include hides rows the dump does not show.
 */
export function schedulerOverlay(composedYaml, yaml) {
  const composed = yaml.load(composedYaml, { schema: schemaFor(yaml) })
  if (!Array.isArray(composed)) throw new Error('The composed profile is not an entry list')
  // The same rows the patch algorithm indexes by id.
  const indexed = []
  const visit = rows => {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      indexed.push(row)
      if (row.group && Array.isArray(row.config)) visit(row.config)
    }
  }
  visit(composed)
  const all = rowsNamed(composed, new Set([SCHEDULER]))
  for (const row of all) {
    const where = typeof row.id === 'string' && row.id ? `instance ${row.id}` : 'an instance without an id'
    if (!indexed.includes(row)) throw new Error(`${where} is nested where a patch cannot reach it`)
    if (typeof row.id !== 'string' || !row.id) throw new Error(`${where} cannot be patched`)
    if (indexed.filter(other => other.id === row.id).length !== 1) throw new Error(`${where} shares its id with another entry`)
  }
  const include = rowsNamed(composed, INCLUDES).find(row => row.disabled !== true)
  if (include) throw new Error(`include ${include.id ?? '(no id)'} loads entries the composed profile does not show`)
  return all.map(row => ({ id: row.id, name: SCHEDULER, disabled: true }))
}

/** Throw unless every scheduler instance in the composed profile is literally disabled. */
export function assertSchedulersDisabled(composedYaml, yaml) {
  const composed = yaml.load(composedYaml, { schema: schemaFor(yaml) })
  const active = rowsNamed(composed, new Set([SCHEDULER])).filter(row => row.disabled !== true)
  if (active.length) throw new Error(`instance ${active.map(row => row.id ?? '(no id)').join(', ')} is still enabled with the self-test overlay`)
}

function composeProfile(state, env, patches) {
  const args = [state.cli, '--profile', state.profile, ...patches.flatMap(patch => ['--patch', patch]), '--dump-config']
  const result = spawnSync(state.node, args, {
    cwd: state.generation,
    env: { ...env, DSH_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) throw new Error(`dsh --dump-config failed: ${result.error?.message ?? result.stderr.trim()}`)
  return result.stdout
}

/**
 * Write the self-test overlay from the composed profile and prove, by composing again with it,
 * that no scheduler instance is left running against the real data home.
 */
async function writeSchedulerOverlay(state, env, overlay) {
  const yaml = createRequire(state.backend)('js-yaml')
  try {
    const rows = schedulerOverlay(composeProfile(state, env, []), yaml)
    await writeFile(
      overlay,
      `# Written by the Modern UI installer for its startup self-test only.\n${rows.length ? yaml.dump(rows, { lineWidth: -1 }) : '[]\n'}`,
    )
    assertSchedulersDisabled(composeProfile(state, env, [overlay]), yaml)
  } catch (error) {
    throw new Error(
      `The installation self-test was not started because it boots the real data home and could not keep every ${SCHEDULER} scheduler off: ${error.message}. No reminder was delivered; the previous selection is retained`,
      { cause: error },
    )
  }
}

// The official URL is announced before the Loader startup audit. A listening port alone
// does not prove that the Modern UI Host plugin activated (schema failures can be nonfatal).
export async function webSelfTest(state, env) {
  const startedAt = new Date().toISOString()
  const started = performance.now()
  let readyAt
  let readyElapsedMs
  // The self-test boots the real data home for a few seconds. Without this overlay an official
  // scheduler instance (under any id) would start any reminder that is already due and the SIGTERM
  // below would cut that turn short, losing it; telemetry stays off for the same throwaway run.
  // Everything else is the profile exactly as it will launch.
  const overlay = join(state.generation, 'self-test-overlay.yml')
  await writeSchedulerOverlay(state, env, overlay)
  const child = spawn(state.node, [state.cli, '--profile', state.profile, '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: state.generation,
    env: { ...env, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  let diagnostics = ''
  let timer
  try {
    const url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Official Web startup did not become ready within 30 seconds')), 30000)
      child.on('error', reject)
      child.on('exit', code => reject(new Error(`Official Web exited before readiness (${code}); selection retained`)))
      child.stderr.on('data', bytes => {
        diagnostics = (diagnostics + bytes).slice(-65536)
      })
      child.stdout.on('data', bytes => {
        output = (output + bytes).slice(-65536)
        const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(output)
        if (match) {
          readyAt = new Date().toISOString()
          readyElapsedMs = performance.now() - started
          resolve(match[1])
        }
      })
    })
    clearTimeout(timer)
    await delay(2500)
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Official Web exited during startup audit')
    const audit = auditStartupOutput(output + diagnostics)
    if (audit.problem) {
      // Do not persist process-token URLs or configuration values in installer output.
      throw new Error('Official Web startup audit reported inactive or invalid entries; selection retained')
    }
    for (const item of audit.unverified)
      console.warn(`Warning: the official Host did not load ${item.kind} ${item.name} (${item.category}); it is unverified and not running: ${item.reason}`)
    let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    const cookie = response.headers
      .getSetCookie()
      .map(value => value.split(';', 1)[0])
      .join('; ')
    if (!cookie) throw new Error('Official Web did not exchange its token for a browser cookie')
    if ([302, 303].includes(response.status)) {
      const location = new URL(response.headers.get('location') ?? '/', url)
      if (!cookie || location.origin !== new URL(url).origin) throw new Error('Official Web authentication redirect was not a same-origin cookie exchange')
      response = await fetch(location, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(10000) })
    }
    const html = await response.text()
    if (response.status !== 200 || !html.includes('<html')) throw new Error(`Official Web did not serve its authenticated HTML entry (HTTP ${response.status})`)
    const serialized = /<script>\s*globalThis\["__DSH_BOOT__"\]\s*=\s*([\s\S]*?)<\/script>/.exec(html)?.[1]
    if (!serialized) throw new Error('Official Web did not publish its boot graph')
    const graph = JSON.parse(serialized.trim().replace(/;$/, ''))
    if (graph.release?.version !== state.officialSource.version) throw new Error('Web graph release does not match the verified official backend')
    const entry = graph.entries?.find(row => row.id === state.plugin.name)
    if (!entry || typeof entry.rev !== 'string' || !entry.rev) throw new Error('Modern UI is absent from the official client boot graph')
    const resourceUrl = new URL(entry.url, url)
    const origin = new URL(url).origin
    if (resourceUrl.origin !== origin || !/^\/plugins(?:\/|$)/.test(resourceUrl.pathname) || !decodeURIComponent(entry.url).includes(entry.rev))
      throw new Error('Modern UI client resource is not a same-origin revisioned plugin resource')
    const resource = await fetch(resourceUrl, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(10000) })
    if (resource.status !== 200 || (await resource.arrayBuffer()).byteLength === 0) throw new Error('Modern UI revisioned client resource could not be fetched')
    const api = new URL('/api/remote.mux', origin)
    const unauthenticated = await statusRequest(api, { origin })
    const untrustedHost = await statusRequest(api, { origin, cookie, host: 'untrusted.invalid' })
    if (unauthenticated !== 401 || untrustedHost !== 403)
      throw new Error(`Official API authentication/trust fence rejected its self-test (unauthenticated ${unauthenticated}, untrusted Host ${untrustedHost})`)
    return {
      authenticatedLoopbackHttp: 'passed',
      release: graph.release,
      clientEntry: { id: entry.id, revision: entry.rev, resource: 'HTTP 200' },
      apiSecurity: { unauthenticated, untrustedHost },
      timing: {
        startedAt,
        readyAt,
        readyElapsedMs,
        completedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started,
        entry: 'official CLI process start through readiness and HTTP checks; excludes manager integrity scan',
        cacheConditions: 'new process, installed package files already present; OS file cache not flushed',
      },
      startupAudit: audit.unverified.length
        ? 'no fatal startup errors observed after readiness; some selected entries were not loaded (see unverified)'
        : 'no inactive/invalid entries observed after readiness',
      skippedBundles: audit.skippedBundles,
      ...(audit.skippedBundles.length
        ? {
            skippedBundlesNote:
              'The copied profile selects bundles this official release does not ship; the official loader skipped them. Remove them from the profile package.json dsh.profile.bundles to silence the warning.',
          }
        : {}),
      unverified: audit.unverified,
      ...(audit.unverified.length
        ? {
            unverifiedNote:
              'The official Host refused or could not load these selected entries, so they are not running and were not verified. Update them to a version that supports this Host, remove them from the profile, or grant an exact-version exemption yourself (dsh plugin allow-version).',
          }
        : {}),
      fullBrowserAcceptance: 'required separately',
    }
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await new Promise(resolve => {
        const stopTimer = setTimeout(resolve, 5000)
        child.once('exit', () => {
          clearTimeout(stopTimer)
          resolve()
        })
      })
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }
}
