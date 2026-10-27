import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export function checkIntegrity(bytes, integrity) {
  if (!/^sha(256|512)-[A-Za-z0-9+/]+=*$/.test(integrity ?? '')) throw new Error('An explicit sha256/sha512 integrity is required')
  const [algorithm, expected] = integrity.split('-')
  if (createHash(algorithm).update(bytes).digest('base64') !== expected) throw new Error('Artifact integrity mismatch')
}

// Include code, assets, native binaries, permissions and link destinations. Never follow links
// out of a package tree; dependency trees can be recorded separately as additional roots.
export async function snapshot(root, options = {}) {
  const files = {}
  async function visit(path) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Snapshot requires a symlink-free official package: ${path}`)
    if (stat.isDirectory()) {
      if (relative(join(root, 'node_modules'), path) === '' && options.excludeNodeModules) return
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry))
    } else if (stat.isFile()) {
      files[relative(root, path).replaceAll('\\', '/')] = {
        sha256: createHash('sha256').update(await readFile(path)).digest('hex'), mode: stat.mode & 0o777,
      }
    }
  }
  await visit(root)
  return files
}

export async function verifySnapshot(root, expected, options = {}) {
  const actual = await snapshot(root, options)
  const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
  if (changed.length) throw new Error(`Official files changed: ${changed.join(', ')}`)
  return { files: Object.keys(actual).length, unchanged: true }
}
