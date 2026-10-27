// Usage: exact-node installed-consumer.mjs backend-package.json pnpm.cjs modern-ui.tgz EMPTY_SCRATCH
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { main } from '../../scripts/distribution/manager.mjs'
import { spawnSync } from 'node:child_process'

const [backend, pnpm, plugin, directory, releaseCacheSeed] = process.argv.slice(2).map(path => resolve(path))
const root = join(directory, 'program 空格')
const home = join(directory, 'data 数据')
if (existsSync(directory)) throw new Error('Use an absent scratch directory to avoid real user data')
await mkdir(join(home, 'profiles', 'unrelated'), { recursive: true })
await mkdir(root, { recursive: true })
if (releaseCacheSeed) await cp(releaseCacheSeed, join(root, 'release-cache'), { recursive: true })
await writeFile(join(home, 'profiles', 'unrelated', 'sentinel.json'), '{"keep":true}\n')
const backendMetadata = JSON.parse(await readFile(backend, 'utf8'))
const officialCli = join(dirname(backend), backendMetadata.bin.dsh)
const initializeSource = spawnSync(process.execPath, [officialCli, '--profile', 'web', '--dump-config'], { cwd: home, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' })
assert.equal(initializeSource.status, 0, initializeSource.stderr)
const sourcePatch = '# Existing official profile user configuration\n- id: web-runtime\n  config:\n    openBrowser: false\n- insert:\n    - id: fixture-translator\n      name: "@deepseek-ai/dsh-experimental-translator"\n      config:\n        provider: google\n        timeoutMs: 4321\n'
await writeFile(join(home, 'profiles', 'web', 'cordis.patch.yml'), sourcePatch)
const integrity = 'sha512-' + createHash('sha512').update(await readFile(plugin)).digest('base64')
const args = ['install', '--root', root, '--home', home, '--plugin', plugin, '--plugin-integrity', integrity, '--node', process.execPath, '--pnpm', pnpm, '--backend', backend]
const first = await main(args)
const stagedPatch = await readFile(join(home, 'profiles', first.profile, 'cordis.patch.yml'), 'utf8')
assert.match(stagedPatch, /openBrowser: false/)
assert.match(stagedPatch, /modern-ui-compat-fixture-translator/)
assert.equal(first.hostCompatibility.replacements.some(row => row.fromId === 'fixture-translator' && row.plugin === '@iroha1145/dsh-modern-ui/translator'), true)
assert.equal(await readFile(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'), sourcePatch)
const isolatedEntry = spawnSync(process.execPath, [join(root, 'launch.mjs'), '--help'], { cwd: home, encoding: 'utf8' })
assert.equal(isolatedEntry.status, 0, isolatedEntry.stderr)
assert.match(isolatedEntry.stdout, /--trusted-host/)
const isolatedCommunity = spawnSync(process.execPath, [first.manager, 'community', '--root', root, '--check', 'true'], { cwd: home, encoding: 'utf8' })
assert.equal(isolatedCommunity.status, 0, isolatedCommunity.stderr)
const community = JSON.parse(isolatedCommunity.stdout)
assert.deepEqual(community.map(plugin => [plugin.name, plugin.version, plugin.state]), [
  ['dsh-context', '0.75.1', 'missing'], ['dsh-better-sidebar', '0.28.0', 'missing'], ['dsh-plugins-store', '0.1.4', 'missing'],
])
assert.equal((await main(['verify', '--root', root])).unchanged, true)
const firstCurrent = await readFile(join(root, 'current.json'), 'utf8')
const brokenArgs = [...args]
brokenArgs[brokenArgs.indexOf('--plugin-integrity') + 1] = 'sha512-' + Buffer.alloc(64).toString('base64')
await assert.rejects(main(brokenArgs), /integrity mismatch/)
assert.equal(await readFile(join(root, 'current.json'), 'utf8'), firstCurrent)
const note = join(home, 'profiles', first.profile, 'preserved-preset.json')
await writeFile(note, '{"agentPreset":"preserve-exact-binding"}\n')
const second = await main(args)
assert.notEqual(second.profile, first.profile)
assert.equal(await readFile(join(home, 'profiles', second.profile, 'preserved-preset.json'), 'utf8'), await readFile(note, 'utf8'))
await main(['rollback', '--root', root])
assert.equal((await main(['status', '--root', root])).profile, first.profile)
assert.equal((await main(['verify', '--root', root])).unchanged, true)
await main(['uninstall', '--root', root])
assert.equal(await readFile(join(home, 'profiles', 'unrelated', 'sentinel.json'), 'utf8'), '{"keep":true}\n')
assert.equal(existsSync(backend), true)
assert.equal(existsSync(note), true)
const result = { backend, node: process.version, pnpm, plugin, integrity, root, home,
  existingOfficialInstall: 'passed', officialUnchanged: 'passed', corruptedArtifactPreservesEntry: 'passed',
  firstInstallPreservesOfficialSourceProfile: 'passed (user setting preserved; active translator explicitly bound; source byte-for-byte unchanged)',
  checkoutIndependentEntry: 'passed (copied manager invokes official Web --help from data directory)',
  checkoutIndependentCommunity: 'passed (copied manager locates pinned manifest with --check true)',
  generationSettingsCopy: 'passed (byte preservation only; semantic preset safety tested separately)',
  rollbackSelection: 'passed; no data conversion', uninstallPreservesOtherProfiles: 'passed',
  freshOfficialInstall: 'not exercised by this runner', webRuntime: 'installer authenticated HTML/startup audit passed; interactive browser behavior requires separate acceptance' }
await writeFile(join(directory, 'installed-consumer-result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
