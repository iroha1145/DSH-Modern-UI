import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyInventory, resolveDependencyManifest } from '../../scripts/distribution/dependency-inventory.mjs'
import { verifySnapshot } from '../../scripts/distribution/integrity.mjs'

test('pnpm/junction anchors resolve real host dependencies and inventory cross-store native leaves', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-inventory-'))
  const backend = join(root, 'store', 'backend', 'node_modules', '@deepseek-ai', 'dsh')
  const shared = join(root, 'store', 'shared', 'node_modules', 'shared')
  const native = join(root, 'store', 'native', 'node_modules', 'native-leaf')
  const lexical = join(root, 'outer', 'node_modules', '@deepseek-ai', 'dsh')
  const wrong = join(root, 'outer', 'node_modules', 'shared')
  async function pkg(path, metadata) {
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify({ version: '1.0.0', ...metadata }))
    await writeFile(join(path, 'entry.js'), 'export const original = true')
  }
  try {
    await pkg(backend, { name: '@deepseek-ai/dsh', dependencies: { shared: '1.0.0' }, optionalDependencies: { 'other-platform': '1.0.0' } })
    await pkg(shared, { name: 'shared', dependencies: { 'native-leaf': '1.0.0' } })
    await pkg(native, { name: 'native-leaf' })
    await pkg(wrong, { name: 'shared', version: '999.0.0' })
    await mkdir(join(root, 'outer', 'node_modules', '@deepseek-ai'), { recursive: true })
    await symlink(backend, lexical, 'junction')
    await symlink(shared, join(root, 'store', 'backend', 'node_modules', 'shared'), 'junction')
    const nativeLink = join(root, 'store', 'shared', 'node_modules', 'native-leaf')
    await symlink(native, nativeLink, 'junction')
    assert.equal(await resolveDependencyManifest(join(lexical, 'package.json'), 'shared'), await realpath(join(shared, 'package.json')))
    const inventory = await dependencyInventory(join(lexical, 'package.json'))
    assert.equal(Object.keys(inventory.packages).length, 3)
    assert.equal(inventory.packages[await realpath(wrong)], undefined)
    assert.equal(inventory.optionalMissing[0].name, 'other-platform')
    const nativeRoot = await realpath(native)
    await writeFile(join(native, 'entry.js'), 'modified native loader')
    await assert.rejects(verifySnapshot(nativeRoot, inventory.packages[nativeRoot], { excludeNodeModules: true }), /entry.js/)
    await writeFile(join(native, 'package.json'), '{"name":"unrelated-package","version":"1.0.0"}')
    await assert.rejects(dependencyInventory(join(lexical, 'package.json')), /Dependency identity mismatch for native-leaf/)
    await writeFile(join(native, 'package.json'), '{"name":"native-leaf","version":"1.0.0"}')
    await rm(nativeLink)
    await assert.rejects(dependencyInventory(join(lexical, 'package.json')), /Missing dependency native-leaf/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
