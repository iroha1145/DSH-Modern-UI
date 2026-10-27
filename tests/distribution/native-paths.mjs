// Record the actual native files loaded by the real public runtime services.
// Usage: private-node native-paths.mjs installed-current.json ABSENT_SCRATCH
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { runNativeProbe } from '../../scripts/distribution/native-probe.mjs'
const state = JSON.parse(await readFile(resolve(process.argv[2]), 'utf8'))
const scratch = resolve(process.argv[3])
if (existsSync(scratch)) throw new Error('Use an absent scratch directory')
await runNativeProbe(state.backend, scratch)
const require = createRequire(await realpath(state.backend))
const addons = []
for (const path of Object.keys(require.cache).filter(path => path.endsWith('.node'))) {
  const canonical = await realpath(path)
  const owners = Object.keys(state.officialBaseline).filter(root => {
    const child = relative(root, canonical)
    return child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child)
  }).sort((a, b) => b.length - a.length)
  assert.ok(owners.length, `Native file outside verified release closure: ${canonical}`)
  const key = relative(owners[0], canonical).replaceAll('\\', '/')
  const expected = state.officialBaseline[owners[0]][key]
  assert.ok(expected, `Native file absent from verified source baseline: ${canonical}`)
  const sha256 = createHash('sha256').update(await readFile(canonical)).digest('hex')
  assert.equal(sha256, expected.sha256)
  addons.push({ path: canonical, sha256 })
}
assert.ok(addons.some(addon => addon.path.replaceAll('\\', '/').includes('/node-pty/prebuilds/win32-x64/')), 'Windows PTY must load its published prebuild, not a local build')
assert.ok(addons.some(addon => addon.path.toLowerCase().includes('koffi')), 'Windows Koffi native helper must be exercised')
const result = { node: process.execPath, version: process.version, backend: state.backend, addons,
  proof: 'Loaded native bytes match the installation baseline already compared to official published archives' }
await writeFile(join(scratch, 'native-paths-result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
process.exit(0)
