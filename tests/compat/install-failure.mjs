import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { packFixture } from './pack-fixture.mjs'

/** A real failed staged Host activation must leave the selected generation and source profile intact. */
export async function checkFailedUpgrade(state, output) {
  output = path.resolve(output)
  const directory = path.join(output, 'package')
  await mkdir(directory, { recursive: true })
  const manifest = JSON.parse(await readFile(path.join(state.plugin.path, 'package.json'), 'utf8'))
  for (const file of manifest.files) await cp(path.join(state.plugin.path, file), path.join(directory, file), { recursive: true })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const marker = path.join(output, `activation-attempted-${randomUUID()}.txt`)
  await writeFile(
    path.join(directory, 'lib/index.js'),
    `import { writeFileSync } from 'node:fs'\nexport function apply() { writeFileSync(${JSON.stringify(marker)}, 'actual staged activation'); throw new Error('compatibility staged activation failure fixture') }\n`,
  )
  const archive = path.join(output, 'failed-activation.tgz')
  await packFixture(directory, archive)
  const integrity =
    'sha512-' +
    createHash('sha512')
      .update(await readFile(archive))
      .digest('base64')
  const { main } = await import(pathToFileURL(state.manager).href)
  const { snapshot } = await import(pathToFileURL(path.join(path.dirname(state.manager), 'integrity.mjs')).href)
  const selected = await readFile(path.join(state.root, 'current.json'))
  const profile = path.join(state.home, 'profiles', state.profile)
  const originalProfile = await snapshot(profile, { excludeNodeModules: true })
  const generations = (await readdir(path.join(state.root, 'versions'))).sort()
  const profiles = (await readdir(path.join(state.home, 'profiles'))).sort()
  let failure
  try {
    await main([
      'install',
      '--root',
      state.root,
      '--home',
      state.home,
      '--backend',
      state.backend,
      '--node',
      state.node,
      '--pnpm',
      state.pnpm,
      '--plugin',
      archive,
      '--plugin-integrity',
      integrity,
    ])
  } catch (error) {
    failure = error
  }
  assert.ok(failure, 'The deliberately invalid plugin must not become selected')
  assert.equal(await readFile(marker, 'utf8'), 'actual staged activation', 'A network or setup error is not the intended failure test')
  assert.deepEqual(await readFile(path.join(state.root, 'current.json')), selected)
  assert.deepEqual(await snapshot(profile, { excludeNodeModules: true }), originalProfile)
  assert.deepEqual((await readdir(path.join(state.root, 'versions'))).sort(), generations)
  assert.deepEqual((await readdir(path.join(state.home, 'profiles'))).sort(), profiles)
  const result = {
    state: 'passed',
    failure: failure.message,
    stagedActivationAttempted: true,
    activationMarker: marker,
    previousSelectionUnchanged: true,
    originalProfileUnchanged: true,
    failedGenerationRemoved: true,
    official: await main(['verify', '--root', state.root]),
    boundary: 'The data-home backup is retained; program/profile rollback does not downgrade shared session data.',
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
