/** Characterize the unmodified Store release and the official current-profile alternative. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, argv) => {
  if (index % 2 === 0) all.push([value.replace(/^--/, ''), argv[index + 1]])
  return all
}, []))
assert.ok(options.consumer && options.pnpm && options.store, 'Pass --consumer, --pnpm and the pinned --store tarball')
const consumer = await realpath(path.resolve(options.consumer))
const require = createRequire(path.join(consumer, 'package.json'))
const backend = require.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(backend, 'utf8'))
const cli = path.resolve(path.dirname(backend), manifest.bin.dsh)
const pnpm = await realpath(path.resolve(options.pnpm))
const storeTarball = await realpath(path.resolve(options.store))
const output = path.resolve(options.output ?? path.join(root, '.artifacts/compat-store', `${manifest.version}-${randomUUID()}`))
const home = path.join(output, 'data')
const fixtures = path.join(output, 'fixtures')
const bin = path.join(output, 'bin')
const currentProfile = 'modern-ui-store-fixture'
const webProfile = 'web'
const names = { web: 'compat-store-web-only', current: 'compat-store-current-only', target: 'compat-store-local-target', probe: 'compat-store-profile-probe' }
await Promise.all([mkdir(fixtures, { recursive: true }), mkdir(bin, { recursive: true })])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const json = async filename => JSON.parse(await readFile(filename, 'utf8'))
const profileDir = name => path.join(home, 'profiles', name)
const profileBytes = name => readFile(path.join(profileDir(name), 'package.json'), 'utf8')
const profileDeps = async name => (await json(path.join(profileDir(name), 'package.json'))).dependencies ?? {}
const profileState = async name => Object.fromEntries(await Promise.all(['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'pnpm-workspace.yaml', '.npmrc'].map(async file => {
  try { return [file, sha256(await readFile(path.join(profileDir(name), file)))] }
  catch (error) { if (error.code !== 'ENOENT') throw error; return [file, null] }
})))
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', PATH: [bin, path.dirname(process.execPath), process.env.PATH ?? ''].join(path.delimiter), npm_config_update_notifier: 'false' }
delete env.NODE_PATH
delete env.NODE_OPTIONS
if (process.platform === 'win32') {
  await writeFile(path.join(bin, 'pnpm.cmd'), `@echo off\r\n"${process.execPath}" "${pnpm}" %*\r\n`)
} else {
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  await writeFile(path.join(bin, 'pnpm'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(pnpm)} "$@"\n`, { mode: 0o755 })
}

async function dsh(args, label) {
  let result
  try { result = await run(process.execPath, [cli, ...args], { cwd: consumer, env, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }) }
  catch (error) { await writeFile(path.join(output, `${label}.log`), `${error.stdout ?? ''}${error.stderr ?? ''}`); throw error }
  await writeFile(path.join(output, `${label}.log`), result.stdout + result.stderr)
  return result.stdout
}

const probeSource = `
import { createRequire } from 'node:module'
import { readProfilePlugins } from '@deepseek-ai/dsh-app-boot'
export const inject = ['profileContext', 'pluginManager', 'webServer']
export function apply(ctx, config) {
  const profile = ctx.profileContext
  const local = createRequire(import.meta.url)
  const host = createRequire(profile.installAnchor)
  const inventory = () => readProfilePlugins({ binName: 'dsh', profileDir: profile.dir, installAnchor: profile.installAnchor })
  const route = (name, action) => ctx.webServer.register({ kind: 'exact', path: '/api/compat-store-profile/' + name, handler: async (request, response) => {
    try {
      const result = await action(request)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(result))
    } catch (error) {
      response.statusCode = 500
      response.end(JSON.stringify({ error: error.message }))
    }
  } })
  route('evidence', async () => ({ profile: { name: profile.name, dir: profile.dir, home: profile.home, installAnchor: profile.installAnchor },
    storeExports: Object.keys(await import('dsh-plugins-store')).sort(),
    plugins: await ctx.pluginManager.listPlugins(), dependencies: inventory().dependencies,
    shared: Object.fromEntries(['@deepseek-ai/cordis'].map(name => [name, {
      path: local.resolve(name), hostPath: host.resolve(name), same: local(name) === host(name)
    }])) }))
  route('install', () => ctx.pluginManager.installBundle(config.fixtureTarball, { saveExact: true }))
  route('remove', () => ctx.pluginManager.removeBundle(config.fixtureName))
}
`

async function pack(name, code = 'export function apply() {}\n', config) {
  const directory = path.join(fixtures, name, 'package')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
  await writeFile(path.join(directory, 'index.js'), code)
  await writeFile(path.join(directory, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: name, name, ...(config ? { config } : {}) }] }]))
  const tarball = path.join(fixtures, `${name}-1.0.0.tgz`)
  await run('tar', ['-czf', tarball, '-C', path.dirname(directory), 'package'], { windowsHide: true })
  return tarball
}

const tarballs = {}
for (const name of [names.web, names.current, names.target]) tarballs[name] = await pack(name)
tarballs[names.probe] = await pack(names.probe, probeSource, { fixtureTarball: tarballs[names.target], fixtureName: names.target })
const registryRequests = []
const registry = createServer(async (request, response) => {
  registryRequests.push(request.url)
  const location = new URL(request.url, 'http://localhost')
  if (location.pathname === `/${names.target}/-/${names.target}-1.0.0.tgz`) {
    response.setHeader('Content-Type', 'application/octet-stream')
    response.end(await readFile(tarballs[names.target])); return
  }
  if (location.pathname === `/${names.target}` || location.pathname === `/${names.target}/1.0.0`) {
    const bytes = await readFile(tarballs[names.target])
    const version = { name: names.target, version: '1.0.0', dist: { tarball: `${registryUrl}/${names.target}/-/${names.target}-1.0.0.tgz`, shasum: createHash('sha1').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` } }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(location.pathname.endsWith('/1.0.0') ? version : { name: names.target, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': version }, time: { '1.0.0': '2026-01-01T00:00:00.000Z' } })); return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'Only the local fixture package is available' }))
})
await new Promise(resolve => registry.listen(0, '127.0.0.1', resolve))
const registryUrl = `http://127.0.0.1:${registry.address().port}`
env.npm_config_registry = registryUrl
let child
let childOutput = ''
let result
const observations = {}
try {
  const officialPaths = {}
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-web-frontend']) {
    const filename = require.resolve(`${name}/package.json`)
    const physical = await realpath(filename)
    assert.ok(physical.startsWith(consumer + path.sep), `${name} escaped the isolated consumer`)
    officialPaths[name] = { path: physical, version: (await json(filename)).version, manifestSha256: sha256(await readFile(filename)) }
  }
  for (const profile of [webProfile, currentProfile]) {
    await dsh([profile, ...(profile === webProfile ? [] : ['--from-default-profile', 'web']), '--dump-config'], `init-${profile}`)
    await writeFile(path.join(profileDir(profile), '.npmrc'), `registry=${registryUrl}\nminimum-release-age=0\n`)
    await dsh(['plugin', '--profile', profile, 'add', '--ignore-scripts', '--save-exact', tarballs[profile === webProfile ? names.web : names.current]], `marker-${profile}`)
  }
  const webManifest = await json(path.join(profileDir(webProfile), 'package.json'))
  webManifest.compatPreserve = { nullable: null, enabled: false, unknown: { kept: true } }
  await writeFile(path.join(profileDir(webProfile), 'package.json'), JSON.stringify(webManifest, null, 2) + '\n')
  await writeFile(path.join(profileDir(webProfile), 'cordis.patch.yml'), `# Original web profile configuration stays independent.\n- id: ${names.web}\n  name: ${names.web}\n  disabled: null\n  config:\n    unknown-user-setting: retained\n`)
  await dsh(['plugin', '--profile', currentProfile, 'add', '--ignore-scripts', '--save-exact', storeTarball, tarballs[names.probe]], 'install-store-and-probe')
  assert.equal((await json(path.join(profileDir(currentProfile), 'node_modules/dsh-plugins-store/package.json'))).version, '0.1.4')
  if (options.modern) await dsh(['plugin', '--profile', currentProfile, 'add', '--ignore-scripts', '--save-exact', path.resolve(options.modern)], 'install-modern')
  const currentBefore = await profileBytes(currentProfile)
  const webBefore = await profileBytes(webProfile)
  const currentStateBefore = await profileState(currentProfile)
  const webStateBefore = await profileState(webProfile)
  child = spawn(process.execPath, [cli, '--profile', currentProfile, '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: consumer, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let url
  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Store test Host did not become ready')), 60_000)
    child.on('error', reject)
    child.on('exit', code => reject(new Error(`Store test Host exited ${code}: ${childOutput.slice(-4000)}`)))
    const collect = bytes => {
      childOutput += bytes
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(childOutput)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
  })
  url = await startup
  const initial = await fetch(url, { redirect: 'manual' })
  const cookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const origin = new URL(url).origin
  const api = async (pathname, body, expectedStatus = 200) => {
    const response = await fetch(new URL(pathname, origin), { method: body ? 'POST' : 'GET', headers: { cookie, origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150_000) })
    const text = await response.text()
    assert.equal(response.status, expectedStatus, `${pathname}: ${response.status} ${text}`)
    return JSON.parse(text)
  }
  let evidence
  for (let attempt = 0; attempt < 40; attempt++) {
    try { evidence = await api('/api/compat-store-profile/evidence'); break } catch (error) { if (attempt === 39) throw error; await delay(250) }
  }
  assert.equal(evidence.profile.name, currentProfile)
  assert.equal(evidence.profile.dir, profileDir(currentProfile))
  const store = evidence.plugins.find(row => row.moduleName === 'dsh-plugins-store')
  assert.equal(store?.fiberPhase, 'active', 'Store must actually activate, not be skipped')
  assert.deepEqual(evidence.storeExports, ['apply', 'inject', 'name'], 'The released package offers no public profile adapter or Config')
  assert.ok(Object.values(evidence.shared).every(item => item.same), 'Store probe uses the Host shared instances')
  observations.hostEvidence = evidence
  const inventory = await api('/api/dsh-plugins-store/plugins')
  assert.equal(inventory.ok, true)
  assert.ok(inventory.plugins.some(item => item.name === names.web), 'The old Store incorrectly lists the web-only marker')
  assert.ok(!inventory.plugins.some(item => item.name === names.current), 'The old Store misses the running profile marker')
  observations.storeInventory = inventory
  assert.equal(await profileBytes(webProfile), webBefore, 'Inventory alone must not mutate web')
  assert.equal(await profileBytes(currentProfile), currentBefore)
  assert.deepEqual(await profileState(webProfile), webStateBefore)
  assert.deepEqual(await profileState(currentProfile), currentStateBefore)
  const install = await api('/api/dsh-plugins-store/install', { repositoryId: 'compat-local-fixture', install: { source: 'npm', target: `${names.target}@1.0.0`, executable: true, args: ['plugin', '--profile', 'web', 'add', `${names.target}@1.0.0`] } }, 502)
  assert.equal(install.ok, false)
  assert.match(install.message, /安装计划不可执行/)
  assert.ok(!Object.hasOwn(await profileDeps(webProfile), names.target), 'The original HTTP installer rejects its normalized plan before mutation')
  assert.ok(!Object.hasOwn(await profileDeps(currentProfile), names.target))
  assert.equal(await profileBytes(webProfile), webBefore)
  assert.equal(await profileBytes(currentProfile), currentBefore)
  assert.deepEqual(await profileState(webProfile), webStateBefore)
  assert.deepEqual(await profileState(currentProfile), currentStateBefore)
  assert.equal(registryRequests.length, 0, 'The refused HTTP installer did not fetch or install a package')
  observations.storeHttpInstall = { status: 502, result: install, targetProfile: 'blocked-before-mutation', acceptedPlanProfile: 'web' }
  // Seed the removal target through the official CLI because the original
  // Store HTTP installer itself refuses a valid plan before spawning a command.
  await dsh(['plugin', '--profile', webProfile, 'add', '--ignore-scripts', '--save-exact', tarballs[names.target]], 'seed-web-removal-fixture')
  const remove = await api('/api/dsh-plugins-store/remove', { name: names.target })
  assert.equal(remove.ok, true)
  assert.ok(!Object.hasOwn(await profileDeps(webProfile), names.target), 'The old Store removes from web')
  assert.equal(await profileBytes(currentProfile), currentBefore)
  assert.deepEqual(await profileState(currentProfile), currentStateBefore)
  observations.storeHttpRemove = remove
  const webControl = await profileBytes(webProfile)
  const webStateControl = await profileState(webProfile)
  const publicInstall = await api('/api/compat-store-profile/install', {})
  assert.ok(publicInstall.changed && publicInstall.application !== 'failed', JSON.stringify(publicInstall))
  assert.ok(Object.hasOwn(await profileDeps(currentProfile), names.target))
  assert.equal(await profileBytes(webProfile), webControl, 'The official manager must preserve the non-target web profile')
  assert.deepEqual(await profileState(webProfile), webStateControl)
  const publicRemove = await api('/api/compat-store-profile/remove', {})
  assert.ok(publicRemove.changed && publicRemove.application !== 'failed', JSON.stringify(publicRemove))
  assert.ok(!Object.hasOwn(await profileDeps(currentProfile), names.target))
  assert.equal(await profileBytes(webProfile), webControl)
  assert.deepEqual(await profileState(webProfile), webStateControl)
  assert.deepEqual((await json(path.join(profileDir(webProfile), 'package.json'))).compatPreserve, webManifest.compatPreserve)
  result = { host: manifest.version, platform: `${process.platform}-${process.arch}`, node: process.versions.node, cli, officialPaths,
    store: { name: 'dsh-plugins-store', version: '0.1.4', tarballSha256: sha256(await readFile(storeTarball)), fiberPhase: store.fiberPhase,
      compatibility: 'unsupported-current-profile', inventoryProfile: webProfile, installProfile: 'blocked-before-mutation', installPlanProfile: webProfile, removeProfile: webProfile, actualProfile: currentProfile },
    publicAlternative: { profileContext: evidence.profile, sameSharedInstances: evidence.shared, inventory: 'current-profile', install: publicInstall.application, remove: publicRemove.application, nonTargetWebUnchanged: true },
    fixtures: 'Only local dependency-free bundles, including a loopback npm registry for the original Store install', registryRequests,
    modernArtifact: options.modern ?? null, browser: 'not-run; Host/HTTP/actual package operations only', observations, output }
  console.log(JSON.stringify({ host: result.host, store: result.store.compatibility, publicAlternative: 'passed', output }))
} catch (error) {
  result = { status: 'failed', host: manifest.version, message: error.stack, observations, output }
  throw error
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await new Promise(resolve => registry.close(resolve))
  await writeFile(path.join(output, 'host.log'), childOutput.replace(/\?token=[^\s]+/g, '?token=[redacted]'))
  if (result) await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
}
