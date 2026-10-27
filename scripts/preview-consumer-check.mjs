// Copied beside installer/ in the preview artifact; runs with the installed private Node.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url))
const { main } = await import(pathToFileURL(join(here, 'installer/manager.mjs')).href)
const root = resolve(process.argv[2])
const output = resolve(process.argv[3])
const state = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'))
assert.equal(process.version, 'v24.22.1')
assert.equal(state.sourceProof.verified, true)
assert.ok(state.sourceProof.ledgerSha256)
const verified = await main(['verify', '--root', root])
assert.equal(verified.unchanged, true)
const run = spawnSync(state.node, [join(root, 'launch.mjs'), '--help'], { cwd: state.home, encoding: 'utf8', windowsHide: true })
assert.equal(run.status, 0, run.stderr)
assert.match(run.stdout, /--trusted-host/)
const community = await main(['community', '--root', root, '--check', 'true'])
const expectedCommunity = JSON.parse(await readFile(join(here, 'installer/community-lock.json'), 'utf8')).plugins
assert.equal(community.length, expectedCommunity.length)
for (const expected of expectedCommunity) {
  const actual = community.find(value => value.name === expected.name)
  assert.equal(actual?.state, 'same-skip', `${expected.name} must be installed for this consumer acceptance run`)
  assert.equal(actual.installed, expected.version)
  assert.equal(actual.selected, true, `${expected.name} must be selected in the official profile`)
}
const result = { node: process.version, platform: process.platform, arch: process.arch,
  backend: state.officialSource, plugin: state.plugin, officialUnchanged: verified,
  sourceProof: state.sourceProof, nativeProbe: state.nativeProbe, webSelfTest: state.webSelfTest,
  powershell: state.powershell ? { path: state.powershell.path, version: state.powershell.version, source: state.powershell.source } : undefined,
  isolatedLauncher: 'passed', community }
await mkdir(output, { recursive: true })
await writeFile(join(output, 'consumer-result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
