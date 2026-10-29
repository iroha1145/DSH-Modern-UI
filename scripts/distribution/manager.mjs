#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { checkIntegrity, snapshot, verifySnapshot } from './integrity.mjs'
import { webSelfTest } from './web-self-test.mjs'
import { dependencyInventory } from './dependency-inventory.mjs'
import { verifyReleaseSources } from './verify-release-source.mjs'
import { bindHostCompatibility, preserveEffectivePreferences, preserveConversationPreferences, validateUiOwnerBindings } from './profile-settings.mjs'
import { acquireOperationLock } from './operation-lock.mjs'
import { backupDataHome } from './data-backup.mjs'
import { createLaunchLifecycle } from './launch-child.mjs'
import { download, unpack } from './artifacts.mjs'
import { preparePowerShell, bindPowerShell } from './shell-runtime.mjs'
import { readSelection, previousState, receiptReference, retainSelection } from './lifecycle.mjs'
import { isMainModule } from './entrypoint.mjs'
import { defaultHostVersion, runtimeVersions, getHostCompatibility } from './compatibility.mjs'

export const versions = { backend: defaultHostVersion, ...runtimeVersions }
export const officialSource = getHostCompatibility(defaultHostVersion).officialSource
const here = dirname(fileURLToPath(import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n')
function summary(state) {
  return { root: state.root, generation: state.generation, home: state.home, profile: state.profile,
    node: state.node, pnpm: state.pnpm, backend: state.backend, cli: state.cli, manager: state.manager,
    plugin: state.plugin, officialSource: state.officialSource, compatibility: state.compatibility, nativeProbe: state.nativeProbe,
    selfTest: state.selfTest, webSelfTest: state.webSelfTest, previousGeneration: state.previous?.generation,
    sourceLedger: state.sourceLedger, sourceProof: state.sourceProof, powershell: state.powershell ? { path: state.powershell.path, version: state.powershell.version, source: state.powershell.source } : undefined,
    dataBackup: state.dataBackup, effectivePreferences: state.effectivePreferences,
    settingsMigration: state.settingsMigration, conversationMigration: state.conversationMigration, chatMigration: state.chatMigration, shellBinding: state.shellBinding, hostCompatibility: state.hostCompatibility, ownerBindings: state.ownerBindings, profileStore: state.profileStore, sourceProfile: state.sourceProfile ? { name: state.sourceProfile.name, path: state.sourceProfile.path } : undefined,
    evidence: join(state.generation, 'installation.json') }
}
const run = (exe, args, options = {}) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw new Error(`${exe} ${args.join(' ')} failed: ${result.error ?? result.stderr ?? result.signal}`)
  return result.stdout.trim()
}
export function parse(argv) {
  const [command, ...args] = argv
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--') { options.args = args.slice(i + 1); break }
    if (!args[i].startsWith('--') || args[i + 1] === undefined) throw new Error(`Expected --key value, got ${args[i]}`)
    options[args[i].slice(2)] = args[i + 1]
  }
  if (!options.root) throw new Error('--root is required')
  options.root = resolve(options.root)
  return { command, options }
}
async function atomicState(root, state) {
  const temporary = join(root, `current-${randomUUID()}.json`)
  await save(temporary, state)
  await rename(temporary, join(root, 'current.json'))
}
async function verifyOfficial(state) {
  if (state.inventoryFormat === 2) {
    const current = await dependencyInventory(state.backend, { snapshotFiles: false })
    if (JSON.stringify(Object.keys(current.packages).sort()) !== JSON.stringify(Object.keys(state.officialBaseline).sort())) throw new Error('Official dependency resolution changed after installation')
  }
  for (const [path, baseline] of Object.entries(state.officialBaseline)) await verifySnapshot(path, baseline, { excludeNodeModules: state.inventoryFormat === 2 })
  return { unchanged: true, packages: Object.keys(state.officialBaseline).length }
}
/** Name the usual cause of a launch-time integrity refusal: the official package was upgraded in place. */
async function hostChangeHint(state, error) {
  const recorded = state.officialSource?.version
  let found
  try { found = (await json(state.backend)).version } catch { return error }
  if (recorded === undefined || found === recorded) return error
  return new Error(`${error.message}. The official DSH at ${state.backend} is now ${found}, but this program root was installed for ${recorded}: reinstall exactly ${recorded} there, or install into a new program root with an isolated copy of the data home`, { cause: error })
}
async function futureRealpath(path) {
  let parent = resolve(path)
  const tail = []
  while (!existsSync(parent)) {
    const next = dirname(parent)
    if (next === parent) throw new Error(`No existing filesystem ancestor for ${path}`)
    tail.unshift(basename(parent))
    parent = next
  }
  return resolve(await realpath(parent), ...tail)
}
export function runtimeEnvironment(state) {
  return { ...process.env, DSH_HOME: state.home,
    PATH: [join(state.generation, 'bin'), dirname(state.node), ...(state.powershell ? [dirname(state.powershell.path)] : []), process.env.PATH].join(process.platform === 'win32' ? ';' : ':'),
    ...(state.powershell ? { POWERSHELL_TELEMETRY_OPTOUT: '1', PSModuleAnalysisCachePath: join(state.root, 'runtime-cache', 'powershell-module-analysis') } : {}),
    npm_config_ignore_scripts: 'true', npm_config_store_dir: join(state.root, 'store'),
    NODE_PATH: '', NODE_OPTIONS: '', PNPM_PACKAGE_MANAGER_STRICT: 'false' }
}
/**
 * Environment for the official process at launch and for the installation self-test.
 * The agent's shells inherit this, so it carries only what the runtime needs: the data home,
 * the exact pnpm the profile was installed with (the official plugin manager looks `pnpm` up
 * on PATH) and, on Windows, the private PowerShell. Installer switches such as
 * npm_config_ignore_scripts or npm_config_store_dir would otherwise change how the user's own
 * projects install under the agent, and clearing NODE_OPTIONS/NODE_PATH would drop the user's
 * settings there too.
 */
export function launchEnvironment(state) {
  const path = [join(state.generation, 'bin'), ...(state.powershell ? [dirname(state.powershell.path)] : []), process.env.PATH, dirname(state.node)]
  return { ...process.env, DSH_HOME: state.home, PATH: path.filter(Boolean).join(delimiter),
    ...(state.powershell ? { POWERSHELL_TELEMETRY_OPTOUT: '1', PSModuleAnalysisCachePath: join(state.root, 'runtime-cache', 'powershell-module-analysis') } : {}) }
}
/**
 * Pin the profile's pnpm store to the program root when the profile does not choose one.
 * The installer installs with this store; the official plugin manager later runs pnpm from
 * the launch environment, which carries no npm_config_store_dir, so the workspace file is the
 * one place both agree on. A profile that already names a store keeps it.
 */
export async function ensureProfileStore(profile, root) {
  const file = join(profile, 'pnpm-workspace.yaml')
  let text = ''
  try { text = await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (/^storeDir\s*:/m.test(text)) return { pinned: false, file }
  const store = join(root, 'store')
  if (/[\r\n#]/.test(store)) throw new Error('Program root path cannot be written into pnpm-workspace.yaml')
  await writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}storeDir: ${store}\n`)
  return { pinned: true, file, store }
}
function dsh(state, args, cwd = state.generation) {
  return run(state.node, [state.cli, ...args], { cwd, env: runtimeEnvironment(state), timeout: 180000 })
}
function windowsNodeBridge(metadataFile, firstArgument) {
  return `# DSH Modern UI managed dispatcher\r\n$ErrorActionPreference = 'Stop'\r\nif (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '${metadataFile}'))) { [Console]::Error.WriteLine('Modern UI is not installed. Reinstall to recover retained data and profiles.'); exit 1 }\r\n$state = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '${metadataFile}'), [Text.Encoding]::UTF8))\r\nfunction ConvertTo-NativeArgument([string]$value) {\r\n  if ($value.Length -gt 0 -and $value -notmatch '[\\s"]') { return $value }\r\n  $escaped = [regex]::Replace($value, '(\\\\*)"', '$1$1\\"')\r\n  $escaped = [regex]::Replace($escaped, '(\\\\+)$', '$1$1')\r\n  return '"' + $escaped + '"'\r\n}\r\n$nativeArguments = @(${firstArgument}) + $args\r\n$start = New-Object Diagnostics.ProcessStartInfo\r\n$start.FileName = $state.node\r\n$start.UseShellExecute = $false\r\n$start.Arguments = [string]::Join(' ', @($nativeArguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }))\r\n$child = [Diagnostics.Process]::Start($start)\r\n$child.WaitForExit()\r\n$code = $child.ExitCode\r\n$child.Dispose()\r\nexit $code\r\n`
}
function windowsCommandBridge(script) {
  return `@echo off\r\nrem DSH Modern UI managed dispatcher\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0${script}" %*\r\n`
}
export async function privatePnpm(state) {
  await mkdir(join(state.generation, 'bin'), { recursive: true })
  const paths = [state.node, state.pnpm]
  const forbidden = process.platform === 'win32' ? /[\r\n%"`$]/ : /[\r\n]/
  if (paths.some(path => forbidden.test(path))) throw new Error('Runtime paths contain unsupported shell metacharacters')
  if (process.platform === 'win32') {
    await save(join(state.generation, 'bin', 'runtime.json'), { node: state.node, pnpm: state.pnpm })
    await writeFile(join(state.generation, 'bin', 'pnpm.ps1'), windowsNodeBridge('runtime.json', '$state.pnpm'))
    await writeFile(join(state.generation, 'bin', 'pnpm.cmd'), windowsCommandBridge('pnpm.ps1'))
  }
  else await writeFile(join(state.generation, 'bin', 'pnpm'), `#!/bin/sh\nexec '${state.node.replaceAll("'", "'\\''")}' '${state.pnpm.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 })
}
export async function installEntrypoint(state) {
  const marker = 'DSH Modern UI managed dispatcher'
  await cp(here, join(state.generation, 'manager'), { recursive: true })
  state.manager = join(state.generation, 'manager', 'manager.mjs')
  const dispatcher = `// ${marker}\nimport { readFile } from 'node:fs/promises'\nimport { dirname, join } from 'node:path'\nimport { fileURLToPath, pathToFileURL } from 'node:url'\nconst root = dirname(fileURLToPath(import.meta.url))\nlet state\ntry { state = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; console.error('Modern UI is not installed. Reinstall to recover retained data and profiles.'); process.exit(1) }\nconst { main } = await import(pathToFileURL(state.manager).href)\nawait main(['launch', '--root', root, '--', ...process.argv.slice(2)])\n`
  const files = [[join(state.root, 'launch.mjs'), dispatcher]]
  if (process.platform === 'win32') {
    // ASCII wrappers let Windows use Unicode paths without a console code-page dependency.
    const powershell = windowsNodeBridge('current.json', "(Join-Path $PSScriptRoot 'launch.mjs')")
    files.push([join(state.root, 'launch.ps1'), powershell],
      [join(state.root, 'dsh-ui.cmd'), windowsCommandBridge('launch.ps1')])
  }
  else files.push([join(state.root, 'dsh-ui'), `#!/bin/sh\n# ${marker}\nexec '${state.node.replaceAll("'", "'\\''")}' '${join(state.root, 'launch.mjs').replaceAll("'", "'\\''")}' "$@"\n`])
  for (const [path, content] of files) {
    if (existsSync(path)) {
      if (!(await readFile(path, 'utf8')).includes(marker)) throw new Error(`Refusing to replace an unrelated entrypoint ${path}`)
    }
    const temporary = path + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, content, { mode: 0o755, flag: 'wx' })
    await rename(temporary, path)
  }
}
async function provision(state, lockPath, nodeArchive) {
  const lock = await json(lockPath)
  const target = `${process.platform}-${process.arch}`
  const node = lock.node?.[target]
  if (!node || lock.nodeVersion !== versions.node || lock.pnpmVersion !== versions.pnpm) throw new Error(`Missing exact runtime artifacts for ${target}`)
  const archive = join(state.generation, 'node.archive')
  if (nodeArchive) {
    const bytes = await readFile(resolve(nodeArchive))
    checkIntegrity(bytes, node.integrity)
    await writeFile(archive, bytes)
  } else await download(node.url, node.integrity, archive)
  await unpack(archive, join(state.generation, 'runtime'))
  state.node = join(state.generation, 'runtime', node.executable)
  await provisionPnpm(state, lock)
  state.runtimeSources = lock
}
async function provisionPnpm(state, lock = undefined) {
  lock ??= await json(join(here, 'runtime-lock.json'))
  if (lock.pnpmVersion !== versions.pnpm) throw new Error('Exact pnpm release pin mismatch')
  const pnpm = join(state.generation, 'pnpm.tgz')
  await download(lock.pnpm.url, lock.pnpm.integrity, pnpm)
  await unpack(pnpm, join(state.generation, 'pnpm'))
  state.pnpm = join(state.generation, 'pnpm', 'package', 'bin', 'pnpm.cjs')
  state.runtimeSources ??= { pnpmVersion: lock.pnpmVersion, pnpm: lock.pnpm }
}
/** Existing installations keep their actual backend; an explicit version never replaces it. */
export async function selectInstallHost(options, previous) {
  const path = options.backend ?? previous?.backend
  const backend = path ? await realpath(resolve(path)) : undefined
  let version = options['backend-version'] ?? defaultHostVersion
  if (backend) {
    const metadata = await json(backend)
    if (metadata.name !== '@deepseek-ai/dsh') throw new Error('Official backend name mismatch')
    if (options['backend-version'] !== undefined && metadata.version !== options['backend-version']) {
      throw new Error('Requested backend version differs from the existing backend; no backend replacement was performed')
    }
    version = metadata.version
  }
  if (previous) {
    const prior = await json(previous.backend)
    if (prior.name !== '@deepseek-ai/dsh' || (previous.officialSource && prior.version !== previous.officialSource.version)) {
      throw new Error(`Previously selected backend identity changed (recorded ${previous.officialSource?.version ?? 'unknown'}, found ${prior.name}@${prior.version} at ${previous.backend}); existing selection and data were retained. Reinstall exactly the recorded version there, or use a new program root with an isolated copy of the data home`)
    }
    if (version !== prior.version) {
      throw new Error('Changing the host version of a managed data home is not supported; use a new program root and isolated data copy, verified by the target official reader')
    }
  }
  return { backend, compatibility: getHostCompatibility(version) }
}

export function verifyPluginCompatibility(plugin, compatibility) {
  const expected = compatibility.plugin
  if (plugin.name !== expected.name || plugin.version !== expected.version) throw new Error('Unexpected Modern UI artifact identity')
  if (Object.keys(plugin.scripts ?? {}).some(key => ['preinstall', 'install', 'postinstall', 'prepare'].includes(key))) throw new Error('Consumer plugin may not have build lifecycle scripts')
  const declaration = expected.compatibleHosts.join(' || ')
  if (plugin.dsh?.compatibleHost !== declaration || plugin.engines?.dsh !== declaration) {
    throw new Error('Plugin must declare the exact verified host set from the compatibility manifest')
  }
}

async function install(options) {
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) throw new Error('Linux musl is not an accepted distribution target')
  if (process.platform === 'win32' && /arm64/i.test(process.env.PROCESSOR_ARCHITEW6432 ?? process.env.PROCESSOR_ARCHITECTURE ?? '')) throw new Error('Windows arm64 has not been accepted')
  const root = options.root
  if (!options.home || !options.plugin || !options['plugin-integrity']) throw new Error('install requires --home, --plugin tgz and --plugin-integrity')
  const bytes = await readFile(resolve(options.plugin))
  checkIntegrity(bytes, options['plugin-integrity'])
  const previous = await readSelection(root)
  // A source profile is chosen once, at first adoption. An upgrade that inherited a leftover
  // DSH_MODERN_FROM_PROFILE / -FromProfile would otherwise re-copy that profile and silently leave
  // the managed Modern profile (its settings, plugins and migration receipts) behind.
  if (previous && options['from-profile'] !== undefined && options['from-profile'] !== previous.profile) {
    throw new Error(`--from-profile is only for first adoption; this program root already manages profile ${previous.profile}. Unset DSH_MODERN_FROM_PROFILE / -FromProfile to upgrade, or use a new program root`)
  }
  const selectedHost = await selectInstallHost(options, previous)
  if (!selectedHost.compatibility.platforms.includes(`${process.platform}-${process.arch}`)) throw new Error(`Official DSH ${selectedHost.compatibility.officialSource.version} has not been verified on ${process.platform}-${process.arch}; no source-build fallback`)
  const previousReference = previous ? await receiptReference(previous) : undefined
  const home = await futureRealpath(options.home)
  const contains = (parent, child) => {
    const path = relative(parent, child)
    return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
  }
  if (contains(root, home) || contains(home, root)) throw new Error('Program and data directories must be separate after resolving symlinks/junctions')
  if (previous && relative(await realpath(previous.home), home) !== '') throw new Error('An upgrade must retain the same data home')
  await mkdir(home, { recursive: true })
  if (relative(home, await realpath(home)) !== '') throw new Error('Data directory resolution changed during creation')
  const id = randomUUID()
  const generation = join(root, 'versions', id)
  const state = { root, generation, home, profile: `modern-ui-${id}`, previous, created: new Date().toISOString(),
    backend: selectedHost.backend, officialSource: selectedHost.compatibility.officialSource, compatibility: selectedHost.compatibility }
  const homeLease = await acquireOperationLock(home)
  try {
    state.dataBackup = await backupDataHome(home, root)
    await mkdir(generation, { recursive: true })
    try { return await stage(state, options, bytes, previousReference) }
    catch (error) {
      // Only this run's freshly named directories go; caches, earlier generations, the source
      // profile and the old selection stay, so a retry neither re-verifies nor recovers stale state.
      await rm(generation, { recursive: true, force: true })
      await rm(join(home, 'profiles', state.profile), { recursive: true, force: true })
      throw error
    }
  } finally { await homeLease.release() }
}
async function stage(state, options, bytes, previousReference) {
  const { root, generation, home, previous } = state
  if (options['runtime-lock']) await provision(state, resolve(options['runtime-lock']), options['node-archive'])
  else {
    if (!options.node) throw new Error('Provide --runtime-lock, or an exact installed --node runtime')
    state.node = await realpath(resolve(options.node))
    if (options.pnpm) state.pnpm = await realpath(resolve(options.pnpm))
    else await provisionPnpm(state)
  }
  if (run(state.node, ['--version']) !== `v${versions.node}` || run(state.node, [state.pnpm, '--version']) !== versions.pnpm) throw new Error('Exact Node/pnpm version mismatch')
  state.powershell = await preparePowerShell(state)
  await privatePnpm(state)
  if (!state.backend) {
    const archive = join(generation, 'official-dsh.tgz')
    await download(state.officialSource.url, state.officialSource.integrity, archive)
    await save(join(generation, 'package.json'), { private: true, dependencies: { '@deepseek-ai/dsh': `file:${archive.replaceAll('\\', '/')}` } })
    await writeFile(join(generation, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\n')
    run(state.node, [state.pnpm, 'install', '--ignore-scripts', '--reporter=append-only', '--store-dir', join(root, 'store')], { cwd: generation, env: runtimeEnvironment(state), timeout: 300000 })
    state.backend = join(generation, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  }
  const backend = await json(state.backend)
  if (backend.name !== state.officialSource.name || backend.version !== state.officialSource.version) throw new Error('Official backend version/name mismatch')
  state.cli = join(dirname(state.backend), backend.bin.dsh)
  state.sourceLedger = join(generation, 'source-ledger.json')
  if (previous?.sourceProof?.verified && previous.inventoryFormat === 2 && relative(previous.backend, state.backend) === '') {
    await verifyOfficial(previous)
    const ledgerBytes = await readFile(previous.sourceLedger)
    if (createHash('sha256').update(ledgerBytes).digest('hex') !== previous.sourceProof.ledgerSha256) throw new Error('Previous release provenance receipt changed')
    state.officialBaseline = previous.officialBaseline
    state.officialOptionalMissing = previous.officialOptionalMissing
    state.inventoryFormat = 2
    await writeFile(state.sourceLedger, ledgerBytes)
    state.sourceProof = { ...previous.sourceProof, reusedFrom: previous.generation }
  } else {
    const inventory = await dependencyInventory(state.backend)
    state.officialBaseline = inventory.packages
    state.officialOptionalMissing = inventory.optionalMissing
    state.inventoryFormat = 2
    const ledger = await verifyReleaseSources(inventory.packages, join(root, 'release-cache'), join(generation, 'release-verification'), { [`${state.officialSource.name}@${state.officialSource.version}`]: state.officialSource })
    await save(state.sourceLedger, ledger)
    state.sourceProof = { verified: true, packages: ledger.length, ledgerSha256: createHash('sha256').update(await readFile(state.sourceLedger)).digest('hex') }
  }
  // Fail rather than invoke node-pty's install script (which can fall back to node-gyp).
  state.nativeProbe = run(state.node, [join(here, 'native-probe.mjs'), state.backend], { cwd: generation, env: runtimeEnvironment(state), timeout: 20000 })
  const artifact = join(generation, 'modern-ui.tgz')
  await writeFile(artifact, bytes)
  await unpack(artifact, join(generation, 'inspect-plugin'))
  const plugin = await json(join(generation, 'inspect-plugin', 'package', 'package.json'))
  verifyPluginCompatibility(plugin, state.compatibility)
  const profile = join(home, 'profiles', state.profile)
  const sourceName = options['from-profile'] ?? previous?.profile ?? (existsSync(join(home, 'profiles', 'web', 'package.json')) ? 'web' : undefined)
  if (sourceName !== undefined) {
    if (!/^[a-zA-Z0-9_-]+$/.test(sourceName)) throw new Error('Invalid source profile name')
    const source = await realpath(join(home, 'profiles', sourceName))
    const before = await snapshot(source, { excludeNodeModules: true })
    await cp(source, profile, { recursive: true, filter: path => relative(join(source, 'node_modules'), path) !== '' })
    state.sourceProfile = { name: sourceName, path: source, baseline: before }
    // Rehydrate dependencies into the new generation via the official profile manager.
    state.profileStore = await ensureProfileStore(profile, root)
    dsh(state, ['plugin', '--profile', state.profile, 'install', '--ignore-scripts'])
  } else {
    dsh(state, [state.profile, '--from-default-profile', 'web', '--dump-config'])
    state.profileStore = await ensureProfileStore(profile, root)
  }
  const originalEffective = dsh(state, [state.profile, '--dump-config'])
  const backendRequire = createRequire(state.backend)
  state.ownerBindings = validateUiOwnerBindings(await readFile(join(generation, 'inspect-plugin', 'package', 'cordis.patch.yml'), 'utf8'), originalEffective, backendRequire('js-yaml'))
  dsh(state, ['plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', artifact])
  const installed = await json(join(profile, 'node_modules', plugin.name, 'package.json'))
  if (installed.version !== plugin.version) throw new Error('Installed plugin version mismatch')
  state.effectivePreferences = await preserveEffectivePreferences(profile, originalEffective, dsh(state, [state.profile, '--dump-config']), backendRequire('js-yaml'))
  state.conversationMigration = await preserveConversationPreferences(profile, dsh(state, [state.profile, '--dump-config']), backendRequire('js-yaml'))
  state.plugin = { name: plugin.name, version: plugin.version, integrity: options['plugin-integrity'], path: join(profile, 'node_modules', plugin.name) }
  const beforeBindings = dsh(state, [state.profile, '--dump-config'])
  state.hostCompatibility = await bindHostCompatibility(profile, beforeBindings, backendRequire('js-yaml'))
  state.shellBinding = await bindPowerShell(profile, dsh(state, [state.profile, '--dump-config']), state.powershell, backendRequire('js-yaml'))
  const selfTest = dsh(state, [state.profile, '--dump-config'])
  if (!selfTest.includes(plugin.name)) throw new Error('Modern UI bundle is not present in composed configuration')
  const help = dsh(state, [state.profile, '--help'])
  if (!help.includes('--port') || !help.includes('--trusted-host')) throw new Error('Official Web startup self-test did not provide expected supported options')
  state.selfTest = 'configuration composition and official Web --help passed; full Web behavior requires consumer acceptance'
  state.webSelfTest = await webSelfTest(state, launchEnvironment(state))
  await verifyOfficial(state)
  if (state.sourceProfile) await verifySnapshot(state.sourceProfile.path, state.sourceProfile.baseline, { excludeNodeModules: true })
  await installEntrypoint(state)
  state.previous = previousReference
  await save(join(generation, 'installation.json'), state)
  await atomicState(root, state)
  return summary(state)
}
export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parse(argv)
  await mkdir(options.root, { recursive: true })
  options.root = await realpath(options.root)
  if (command === 'status') {
    const state = await readSelection(options.root, { recovery: false })
    return state ? summary(state) : { installed: false, recoverable: Boolean(await readSelection(options.root)) }
  }
  const lease = await acquireOperationLock(options.root)
  try {
    if (command === 'install') return await install(options)
    if (command === 'uninstall') {
      const selected = await readSelection(options.root)
      if (selected) await retainSelection(options.root, selected)
      await rm(join(options.root, 'current.json'), { force: true })
      return { removed: 'Modern UI entry selection', retained: ['official backend', 'all profiles and data', 'program generations for recovery'], recovery: selected ? join(options.root, 'recovery.json') : undefined }
    }
    const state = await readSelection(options.root, { recovery: false })
    if (!state) throw new Error('Modern UI is not installed. Reinstall to recover retained data and profiles.')
    // Program-only operations must remain usable when retained data was moved,
    // is offline, or is currently held by another managed program root.
    if (command === 'verify') return await verifyOfficial(state)
    if (command === 'rollback') {
      if (!state.previous) throw new Error('No previous program/profile generation')
      const previous = await previousState(state.previous, options.root)
      await verifyOfficial(previous)
      await atomicState(options.root, previous)
      return { rolledBackTo: previous.generation, dataRollback: false, note: 'Shared sessions are not rewritten. Check data-version compatibility before resuming.' }
    }
    if (!['community', 'launch'].includes(command)) throw new Error(`Unknown command ${command}`)
    const homeLease = await acquireOperationLock(state.home)
    try {
      if (command === 'community') {
        const manifest = options.manifest ? await json(resolve(options.manifest))
          : { plugins: getHostCompatibility(state.officialSource.version).communityPlugins }
        const profile = join(state.home, 'profiles', state.profile)
        const declared = (await json(join(profile, 'package.json'))).dependencies ?? {}
        const results = []
        for (const plugin of manifest.plugins ?? []) {
          const path = join(profile, 'node_modules', plugin.name, 'package.json')
          const installed = existsSync(path) ? await json(path) : undefined
          if (installed || declared[plugin.name]) {
            const bundles = (await json(join(profile, 'package.json'))).dsh?.profile?.bundles ?? []
            results.push({ ...plugin, state: installed?.version === plugin.version ? 'same-skip' : 'preserved', installed: installed?.version,
              selected: !installed?.dsh?.bundle || bundles.includes(plugin.name) })
            continue
          }
          if (options.check === 'true') { results.push({ ...plugin, state: 'missing' }); continue }
          try {
            const artifacts = join(state.generation, 'community-artifacts')
            await mkdir(artifacts, { recursive: true })
            const artifact = join(artifacts, `${plugin.name}-${plugin.version}.tgz`)
            await download(plugin.url, plugin.integrity, artifact)
            dsh(state, ['plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', artifact])
            const added = await json(path)
            if (added.version !== plugin.version) throw new Error('Installed community version mismatch')
            const bundles = (await json(join(profile, 'package.json'))).dsh?.profile?.bundles ?? []
            if (added.dsh?.bundle && !bundles.includes(plugin.name)) throw new Error('Installed community bundle was not selected by the official profile manager')
            results.push({ ...plugin, state: 'installed' })
          }
          catch (error) { results.push({ ...plugin, state: 'failed', error: error.message }) }
        }
        await verifyOfficial(state)
        return results
      }
      if (command === 'launch') {
        const lifecycle = createLaunchLifecycle()
        try {
          try { await verifyOfficial(state) }
          catch (error) { throw await hostChangeHint(state, error) }
          // Both phases use their own POSIX process group, so terminal signals are forwarded once.
          const preflight = await lifecycle.run(state.node, [state.cli, state.profile, '--dump-config'],
            { cwd: state.generation, env: runtimeEnvironment(state), detached: process.platform !== 'win32' },
            { captureOutput: true, timeout: 180000 })
          if (lifecycle.interrupted) {
            const result = { exitCode: preflight.exitCode, ...(preflight.signal ? { signal: preflight.signal } : {}) }
            process.exitCode = result.exitCode
            return result
          }
          if (preflight.exitCode !== 0) throw new Error(`DSH launch preflight failed (${preflight.exitCode}): ${preflight.stderr.trim()}`)
          // Newly added Host instances follow the same reviewed profile binding path as installation.
          const profile = join(state.home, 'profiles', state.profile)
          const hostCompatibilityRefresh = await bindHostCompatibility(profile, preflight.stdout.trim(), createRequire(state.backend)('js-yaml'))
          if (hostCompatibilityRefresh.changed) console.log(JSON.stringify({ hostCompatibilityRefresh }))
          console.log(JSON.stringify({ node: state.node, pnpm: state.pnpm, backend: state.backend, version: state.officialSource.version, plugin: state.plugin, profile: state.profile, home: state.home, cwd: process.cwd() }))
          const result = await lifecycle.run(state.node, [state.cli, '--profile', state.profile, ...(options.args ?? [])],
            { cwd: process.cwd(), env: launchEnvironment(state), stdio: 'inherit', detached: process.platform !== 'win32' })
          process.exitCode = result.exitCode
          return result
        } finally { lifecycle.dispose() }
      }
      throw new Error(`Unknown command ${command}`)
    } finally { await homeLease.release() }
  } finally { await lease.release() }
}
if (isMainModule(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
