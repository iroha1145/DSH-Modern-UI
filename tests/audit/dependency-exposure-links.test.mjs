import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { build } from './helpers/client-build.mjs'
import { collectExposure } from '../../scripts/dependency-exposure.mjs'

const json = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}
const install = async (directory, name, version, source) => {
  await json(path.join(directory, 'package.json'), { name, version, main: 'index.js', sideEffects: false })
  await writeFile(path.join(directory, 'index.js'), source)
}

for (const layout of ['ordinary', 'modules-link', 'package-link']) {
  for (const retained of [true, false]) {
    test(`${layout}: distinguishes patched root from nested affected package (${retained ? 'retained' : 'tree-shaken'})`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'exposure-links-'))
      try {
        const modules = path.join(root, layout === 'modules-link' ? 'dependency-store/node_modules' : 'node_modules')
        const affected = 'node_modules/owner/node_modules/affected'
        const logical = path.join(root, affected)
        const physical = layout === 'package-link' ? path.join(root, 'store/affected') : path.join(modules, 'owner/node_modules/affected')
        await install(path.join(modules, 'affected'), 'affected', '2.0.0', 'export const patched = "PATCHED_ROOT"')
        await install(physical, 'affected', '1.0.0', 'export const vulnerable = "AFFECTED_NESTED_MARKER"')
        await install(
          path.join(modules, 'owner'),
          'owner',
          '1.0.0',
          `import { vulnerable } from 'affected'; export const value = ${retained ? 'vulnerable' : '"OWNER_ONLY"'};`,
        )
        if (layout === 'modules-link') await symlink(modules, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
        if (layout === 'package-link') {
          await mkdir(path.dirname(logical), { recursive: true })
          await symlink(physical, logical, process.platform === 'win32' ? 'junction' : 'dir')
        }
        await writeFile(path.join(root, 'entry.js'), 'import { value } from "owner"; import { patched } from "affected"; console.log(value, patched);')
        const result = await build({ absWorkingDir: root, entryPoints: ['entry.js'], bundle: true, write: false, metafile: true, outfile: 'out.js' })
        assert.equal(result.outputFiles[0].text.includes('AFFECTED_NESTED_MARKER'), retained)
        const auditFile = path.join(root, 'audit.json')
        await json(auditFile, { vulnerabilities: { affected: { nodes: [affected], via: [{ url: 'https://example.test/GHSA-fixture', range: '<2' }] } } })
        await json(path.join(root, 'packages/modern-ui/package.json'), { name: 'plugin' })
        for (const name of ['client', 'host-main', 'host-compat']) await json(path.join(root, '.artifacts/build-metafiles', `${name}.json`), result.metafile)
        const report = await collectExposure({ root, auditFile })
        const installed = report.advisories[0].packages[0].installedPaths[0]
        const artifact = installed.artifacts[0]
        assert.equal(installed.path, affected)
        assert.equal(installed.version, '1.0.0')
        assert.equal(artifact.physicalDirectory, await realpath(physical))
        assert.equal(artifact.status, 'complete')
        assert.equal(artifact.parsedInputs.length, 1)
        assert.ok(Object.hasOwn(result.metafile.inputs, artifact.parsedInputs[0]))
        assert.equal(artifact.resolvedInputs[0].physical, await realpath(path.join(physical, 'index.js')))
        assert.equal(artifact.retainedOutputBytes > 0, retained)
        assert.equal(artifact.parsedOnly, !retained)
        assert.equal(report.gate.passed, !retained)
        assert.deepEqual(report.gate.incompletePaths, [])

        // A stale metafile cannot establish zero contribution after its input disappears.
        await rm(path.join(physical, 'index.js'))
        const missingInput = await collectExposure({ root, auditFile })
        assert.equal(missingInput.gate.passed, false)
        assert.equal(missingInput.gate.incompletePaths.length, 1)
        assert.equal(missingInput.advisories[0].packages[0].installedPaths[0].artifacts[0].status, 'incomplete')
        await rm(physical, { recursive: true })
        const missingPackage = await collectExposure({ root, auditFile })
        assert.equal(missingPackage.gate.passed, false)
        assert.equal(missingPackage.advisories[0].packages[0].installedPaths[0].status, 'unknown-missing-installed-path')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
}
