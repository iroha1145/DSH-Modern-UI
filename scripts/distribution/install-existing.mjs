#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readSelection } from './lifecycle.mjs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { main, versions } from './manager.mjs'

export async function installExisting(argv = process.argv.slice(2)) {
  if (process.version !== `v${versions.node}`) throw new Error(`Use Node ${versions.node}, or the bootstrap entry to prepare it privately.`)
  const options = {}
  const accepted = new Set(['--backend', '--plugin', '--plugin-integrity', '--root', '--home', '--skip-community'])
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    if (!accepted.has(key) || !argv[index + 1]?.trim() || Object.hasOwn(options, key)) throw new Error(`Invalid or duplicate option: ${key}`)
    options[key] = argv[index + 1]
  }
  for (const key of ['--backend', '--plugin', '--plugin-integrity']) if (!options[key]) throw new Error(`${key} is required`)
  if (options['--skip-community'] !== undefined && !['true', 'false'].includes(options['--skip-community'])) throw new Error('--skip-community expects true or false')
  const base = process.platform === 'win32' ? process.env.LOCALAPPDATA
    : process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share')
  if (!base && !options['--root']) throw new Error('Pass --root when the local application data directory is unavailable')
  const root = resolve(options['--root'] ?? join(base, 'DSH-Modern-UI/program'))
  const previous = await readSelection(root)
  const home = resolve(options['--home'] ?? previous?.home ?? join(dirname(root), `data-${randomUUID()}`))
  const cacheConditions = {
    releaseCacheDirectoryExisted: existsSync(join(root, 'release-cache')),
    pnpmStoreDirectoryExisted: existsSync(join(root, 'store')), nodeDownloaded: false,
  }
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const core = await main(['install', '--root', root, '--home', home,
    '--backend', resolve(options['--backend']), '--node', process.execPath,
    '--plugin', resolve(options['--plugin']), '--plugin-integrity', options['--plugin-integrity']])
  const coreElapsedMs = Math.round(performance.now() - started)
  console.log(JSON.stringify({ phase: 'core', result: core }, null, 2))
  let community
  if (options['--skip-community'] === 'true') community = { state: 'skipped' }
  else {
    try { community = await main(['community', '--root', root]) }
    catch (error) { community = { state: 'failed', coreRetained: true, error: error.message,
      retry: 'community --root <program-root>' } }
  }
  console.log(JSON.stringify({ phase: 'community', result: community }, null, 2))
  const timing = { startedAt, completedAt: new Date().toISOString(), coreElapsedMs,
    elapsedMs: Math.round(performance.now() - started), cacheConditions, backend: 'existing',
    platform: process.platform, arch: process.arch }
  console.log(JSON.stringify({ phase: 'timing', result: timing }, null, 2))
  return { core, community, timing }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installExisting().catch(error => { console.error(error.message); process.exitCode = 1 })
}
