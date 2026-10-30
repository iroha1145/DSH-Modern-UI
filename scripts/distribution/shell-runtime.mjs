import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { download, unpack } from './artifacts.mjs'
import { checkIntegrity, snapshot, verifySnapshot } from './integrity.mjs'
import { schemaFor } from './profile-settings.mjs'

export async function preparePowerShell(state) {
  if (process.platform !== 'win32') return undefined
  const lock = JSON.parse(await readFile(new URL('./runtime-lock.json', import.meta.url), 'utf8'))
  const source = lock.powershell?.['win32-x64']
  if (!source) throw new Error('No pinned official PowerShell distribution for Windows x64')
  const prior = state.previous?.powershell
  let root
  if (prior?.source?.integrity === source.integrity && prior.version === source.version) {
    await verifySnapshot(prior.root, prior.baseline)
    root = prior.root
  } else {
    const cache = join(state.root, 'runtime-cache')
    await mkdir(cache, { recursive: true })
    const archive = join(cache, `PowerShell-${source.version}-win-x64.zip`)
    if (!existsSync(archive)) await download(source.url, source.integrity, archive)
    checkIntegrity(await readFile(archive), source.integrity)
    root = join(state.generation, 'powershell')
    await unpack(archive, root)
  }
  for (const name of [source.executable, source.licenseFile, source.thirdPartyNotices]) {
    if (!existsSync(join(root, name))) throw new Error(`Official PowerShell distribution is incomplete: ${name}`)
  }
  const executable = join(root, source.executable)
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1', PSModuleAnalysisCachePath: join(state.root, 'runtime-cache', 'powershell-module-analysis') },
  })
  if (result.error || result.status !== 0 || result.stdout.trim() !== source.version) throw new Error('Private PowerShell version/self-test failed')
  return { path: executable, root, version: source.version, source, baseline: prior?.root === root ? prior.baseline : await snapshot(root) }
}

/** Bind the actual official shell executor through its supported Config, preserving confinement. */
export async function bindPowerShell(profile, effectiveYaml, powershell, yaml) {
  if (!powershell) return { changed: false, executors: [] }
  const schema = schemaFor(yaml)
  const effective = yaml.load(effectiveYaml, { schema })
  if (!Array.isArray(effective)) throw new Error('Effective profile is not an entry list')
  const names = new Set(['@deepseek-ai/dsh-pwsh-local', '@deepseek-ai/dsh-pwsh-sandbox'])
  const rows = effective.filter(entry => names.has(entry.name) && entry.disabled !== true)
  if (!rows.length) throw new Error('Windows profile has no supported top-level PowerShell executor')
  const additions = []
  for (const row of rows) {
    if (!row.id || typeof row.id !== 'string') throw new Error('PowerShell executor requires a stable profile id')
    if (row.config !== undefined && (!row.config || Array.isArray(row.config) || Object.getPrototypeOf(row.config) !== Object.prototype))
      throw new Error(`Computed executor configuration for ${row.id} requires manual review`)
    const configured = row.config?.pwshPath
    if (configured !== undefined && configured !== '' && configured !== powershell.path)
      throw new Error(`Executor ${row.id} pins another PowerShell path; source configuration was not overwritten`)
    // Official entry patches replace config as a whole, so retain the effective executor settings.
    if (configured !== powershell.path) additions.push({ id: row.id, name: row.name, config: { ...row.config, pwshPath: powershell.path } })
  }
  if (additions.length) {
    const path = join(profile, 'cordis.patch.yml')
    const original = await readFile(path, 'utf8')
    const patch = yaml.load(original, { schema }) ?? []
    if (!Array.isArray(patch)) throw new Error('Profile patch is not an entry list')
    await writeFile(path, yaml.dump([...patch, ...additions], { schema, lineWidth: -1, noCompatMode: true }))
  }
  return { changed: additions.length > 0, executors: rows.map(row => ({ id: row.id, module: row.name })), path: powershell.path }
}
