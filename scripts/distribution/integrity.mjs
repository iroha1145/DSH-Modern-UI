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
// Every launch re-verifies the whole official closure (hundreds of packages, tens of thousands of
// files), so file reads run a bounded number at a time instead of one round trip after another.
const HASH_CONCURRENCY = 32
export async function snapshot(root, options = {}) {
  const files = {}
  const pending = []
  async function visit(path) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Snapshot requires a symlink-free official package: ${path}`)
    if (stat.isDirectory()) {
      if (relative(join(root, 'node_modules'), path) === '' && options.excludeNodeModules) return
      for (const entry of (await readdir(path)).sort()) await visit(join(path, entry))
    } else if (stat.isFile()) pending.push({ key: relative(root, path).replaceAll('\\', '/'), path, mode: stat.mode & 0o777 })
  }
  await visit(root)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, pending.length) }, async () => {
    while (next < pending.length) {
      const file = pending[next++]
      files[file.key] = { sha256: createHash('sha256').update(await readFile(file.path)).digest('hex'), mode: file.mode }
    }
  }))
  return files
}

export async function verifySnapshot(root, expected, options = {}) {
  const actual = await snapshot(root, options)
  const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(key => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
  if (changed.length) throw new Error(`Official files changed: ${changed.join(', ')}`)
  return { files: Object.keys(actual).length, unchanged: true }
}
