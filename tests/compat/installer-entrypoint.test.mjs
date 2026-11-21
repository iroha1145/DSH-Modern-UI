import { onTestFinished, test } from 'vitest'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installEntrypoint, main } from '../../scripts/distribution/manager.mjs'
import { receiptReference } from '../../scripts/distribution/lifecycle.mjs'

// The root `dsh-ui` launcher must never depend on a runtime that a failed upgrade deletes. It is
// exercised here through the real POSIX shells (macOS /bin/sh is bash 3.2; dash stands in for
// Debian/Ubuntu /bin/sh) with stub runtimes and stub managers, so no DSH process is started.
const posix = process.platform !== 'win32'
const shells = ['/bin/sh', '/bin/dash'].filter(shell => existsSync(shell))

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'compat-entrypoint-')))
  onTestFinished(() => rm(base, { recursive: true, force: true }))
  const root = join(base, "program root 'quoted' 中文")
  const marker = join(base, 'marker.log')
  await mkdir(root, { recursive: true })
  return { base, root, marker }
}

/** A committed-looking generation whose runtime and manager only record that they ran. */
async function generation(root, name, marker) {
  const directory = join(root, 'versions', name)
  const node = join(directory, 'runtime', 'bin', 'node')
  await mkdir(join(directory, 'runtime', 'bin'), { recursive: true })
  const state = {
    root,
    generation: directory,
    home: join(root, '..', 'data'),
    profile: `modern-ui-${name}`,
    node,
    // Nested `node` keys (runtime lock, legacy embedded previous state) must not be mistaken for the selected runtime.
    runtimeSources: { nodeVersion: '24.0.0', node: { 'darwin-arm64': { executable: 'bin/node' } } },
    officialBaseline: {},
  }
  return {
    state,
    async finish() {
      // installEntrypoint copied the real manager into the generation; replace it with a stub.
      await writeFile(
        join(directory, 'manager', 'manager.mjs'),
        `import { appendFileSync } from 'node:fs'\nexport async function main(argv) { appendFileSync(${JSON.stringify(marker)}, 'manager ${name} ' + JSON.stringify(argv) + '\\n') }\n`,
      )
      await writeFile(
        node,
        `#!/bin/sh\nprintf 'runtime ${name}\\n' >> '${marker.replaceAll("'", "'\\''")}'\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$@"\n`,
        { mode: 0o755 },
      )
      await writeFile(join(directory, 'installation.json'), JSON.stringify(state, null, 2) + '\n')
    },
  }
}

// The same serialization as manager.mjs `save`, which every release has used for current.json.
const commit = (root, state) => writeFile(join(root, 'current.json'), JSON.stringify(state, null, 2) + '\n')

async function launch(shell, root, marker, ...args) {
  await rm(marker, { force: true })
  const result = spawnSync(shell, [join(root, 'dsh-ui'), ...args], { encoding: 'utf8', cwd: root })
  const log = existsSync(marker) ? (await readFile(marker, 'utf8')).trim().split('\n') : []
  return { status: result.status, stderr: result.stderr, log }
}

test.skipIf(!posix)('a failed upgrade that already replaced dsh-ui still launches the committed version', async () => {
  const { root, marker } = await fixture()
  const old = await generation(root, 'old', marker)
  await installEntrypoint(old.state)
  await old.finish()
  await commit(root, old.state)

  // A private-Node upgrade replaces the launcher, then fails before its selection is committed
  // (for example ENOSPC writing installation.json); the failure cleanup deletes the staged runtime.
  const staged = await generation(root, 'staged', marker)
  await installEntrypoint(staged.state)
  await staged.finish()
  await rm(staged.state.generation, { recursive: true, force: true })

  for (const shell of shells) {
    const result = await launch(shell, root, marker, '--port', '0', 'two words')
    assert.equal(result.status, 0, `${shell}: ${result.stderr}`)
    assert.deepEqual(result.log, ['runtime old', `manager old ${JSON.stringify(['launch', '--root', root, '--', '--port', '0', 'two words'])}`])
  }
})

test.skipIf(!posix)('dsh-ui follows the committed selection through upgrade and rollback', async () => {
  const { root, marker } = await fixture()
  const old = await generation(root, 'old', marker)
  await installEntrypoint(old.state)
  await old.finish()
  await commit(root, old.state)
  const next = await generation(root, 'next', marker)
  await installEntrypoint(next.state)
  await next.finish()

  // Launcher replaced but selection not yet committed: still the old version.
  for (const shell of shells) assert.deepEqual((await launch(shell, root, marker)).log.slice(0, 1), ['runtime old'])

  next.state.previous = await receiptReference(old.state)
  await commit(root, next.state)
  for (const shell of shells)
    assert.deepEqual((await launch(shell, root, marker)).log, ['runtime next', `manager next ${JSON.stringify(['launch', '--root', root, '--'])}`])

  // Rollback rewrites current.json through the production serializer; the launcher follows it.
  await main(['rollback', '--root', root])
  for (const shell of shells)
    assert.deepEqual((await launch(shell, root, marker)).log, ['runtime old', `manager old ${JSON.stringify(['launch', '--root', root, '--'])}`])

  // Uninstall removes the selection: a clear message, not a shell error about a missing runtime.
  await rm(join(root, 'current.json'))
  for (const shell of shells) {
    const result = await launch(shell, root, marker)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Modern UI is not installed/)
    assert.deepEqual(result.log, [])
  }
})

test.skipIf(!posix)('a runtime path the launcher cannot read back from current.json is refused before any write', async () => {
  const { root, marker } = await fixture()
  for (const bad of ['quote"d', 'back\\slash']) {
    const staged = await generation(root, `bad-${bad.length}`, marker)
    staged.state.node = join(staged.state.generation, bad, 'node')
    await assert.rejects(installEntrypoint(staged.state), /runtime path/i)
    assert.equal(existsSync(join(root, 'dsh-ui')), false)
  }
})
