import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const settingsShortcut = (platform = process.platform) => platform === 'darwin'
  ? 'Meta+Alt+Comma' : platform === 'win32' ? 'Control+Alt+Comma' : undefined
export async function openSettings(page, platform = process.platform) {
  const shortcut = settingsShortcut(platform)
  if (shortcut) await page.keyboard.press(shortcut)
  else {
    // rc.4 ships no web:linux default for settings.open. Use its official launcher.
    await page.locator('[data-modern-settings-seat]').getByRole('button').press('Enter')
    await page.getByRole('menuitem', { name: '设置', exact: true }).press('Enter')
  }
  await page.getByRole('dialog').waitFor()
}
export const browserExecutable = (platform = process.platform, override = process.env.MODERN_UI_BROWSER) => override
  ?? (platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)

export function fixtureEnvironment(home, base = process.env) {
  const environment = { ...base, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: '', NODE_OPTIONS: '' }
  for (const key of Object.keys(environment)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY)$/i.test(key)) delete environment[key]
  return environment
}

/** Hash user data without following dependency links or reading installed package trees. */
export async function dataSnapshot(home) {
  const files = {}
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(filename)
      else if (entry.isFile()) files[path.relative(home, filename)] = createHash('sha256').update(await readFile(filename)).digest('hex')
    }
  }
  await visit(home)
  return files
}

/** Reinstall the consumer's package into a fresh official profile; never clone a live home. */
export async function isolatedInstalledFixture(source, run) {
  const before = await dataSnapshot(source.home)
  const home = path.join(run, 'home')
  const profile = 'modern-ui-e2e'
  await mkdir(home, { recursive: true })
  const { runtimeEnvironment } = await import(pathToFileURL(source.manager).href)
  const environment = fixtureEnvironment(home, { ...runtimeEnvironment(source),
    npm_config_store_dir: path.join(run, 'store'), npm_config_cache: path.join(run, 'npm-cache'),
    PSModuleAnalysisCachePath: path.join(run, 'powershell-module-analysis') })
  function command(executable, args) {
    const result = spawnSync(executable, args, { cwd: run, env: environment, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
    assert.equal(result.status, 0, `Fixture setup failed: ${result.error ?? result.stderr}\n${result.stdout.slice(-5000)}`)
    return result.stdout
  }
  const dsh = args => command(source.node, [source.cli, ...args])
  dsh([profile, '--from-default-profile', 'web', '--dump-config'])
  const artifact = path.join(source.generation, 'modern-ui.tgz')
  const verifyArchive = async (filename, integrity) => {
    assert.equal('sha512-' + createHash('sha512').update(await readFile(filename)).digest('base64'), integrity, `Consumer archive integrity: ${filename}`)
  }
  await verifyArchive(artifact, source.plugin.integrity)
  dsh(['plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts', artifact])
  const sourceProfile = JSON.parse(await readFile(path.join(source.home, 'profiles', source.profile, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(path.dirname(source.manager), 'community-lock.json'), 'utf8'))
  const communities = []
  for (const name of sourceProfile.dsh.profile.bundles) {
    const pinned = lock.plugins.find(plugin => plugin.name === name)
    if (!pinned) continue
    const reference = sourceProfile.dependencies[name]
    assert.ok(reference?.startsWith('file:'), `Consumer community package must use its verified release archive: ${name}`)
    const archive = path.resolve(path.join(source.home, 'profiles', source.profile), reference.slice(5))
    await verifyArchive(archive, pinned.integrity)
    dsh(['plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts', archive])
    communities.push({ name, version: pinned.version, integrity: pinned.integrity })
  }
  assert.equal(communities.length, lock.plugins.length, 'Installed acceptance retains every fixed community bundle')
  const directory = path.join(home, 'profiles', profile)
  const hostRequire = createRequire(source.cli)
  const yaml = createRequire(hostRequire.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
  const { bindHostCompatibility } = await import(pathToFileURL(path.join(path.dirname(source.manager), 'profile-settings.mjs')).href)
  await bindHostCompatibility(directory, dsh([profile, '--dump-config']), yaml)
  if (source.powershell) {
    const { bindPowerShell } = await import(pathToFileURL(path.join(path.dirname(source.manager), 'shell-runtime.mjs')).href)
    await bindPowerShell(directory, dsh([profile, '--dump-config']), source.powershell, yaml)
  }
  const pluginPath = path.join(directory, 'node_modules', source.plugin.name)
  const sourceHome = await realpath(source.home)
  for (const name of [source.plugin.name, ...communities.map(plugin => plugin.name)]) {
    const relative = path.relative(sourceHome, await realpath(path.join(directory, 'node_modules', name)))
    assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'Fixture packages cannot resolve into the source home')
  }
  const installedPluginPath = await realpath(pluginPath)
  const state = { ...source, home, profile, plugin: { ...source.plugin, path: pluginPath } }
  const verifySource = async () => {
    const after = await dataSnapshot(source.home)
    assert.deepEqual(after, before, 'Installed consumer data and profile must remain byte-for-byte unchanged')
    await writeFile(path.join(run, 'isolation.json'), JSON.stringify({ sourceHome: source.home, home, profile,
      sourceFiles: before, unchanged: true, official: source.cli, plugin: installedPluginPath,
      artifact: { path: artifact, integrity: source.plugin.integrity },
      communities, boundary: 'fresh official web profile; original SRI-verified release archives installed by official plugin manager; official CLI unchanged' }, null, 2))
  }
  await verifySource()
  return { state, environment, verifySource }
}
