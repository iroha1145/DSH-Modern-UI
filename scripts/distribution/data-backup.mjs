import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, readdir, readlink, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isAbsolute, join, relative, sep } from 'node:path'

const contains = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
}

/** Stream all files, include empty directories and link text, never traverse links. */
export async function dataTree(root) {
  const entries = {}
  const stamps = {}
  let bytes = 0
  async function visit(path, key) {
    const before = await lstat(path, { bigint: true })
    stamps[key] = [before.dev, before.ino, before.size, before.mtimeNs, before.ctimeNs].map(String)
    const mode = Number(before.mode & 0o777n)
    if (before.isSymbolicLink()) entries[key] = { type: 'link', target: await readlink(path) }
    else if (before.isDirectory()) {
      entries[key] = { type: 'directory', mode }
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), key ? `${key}/${name}` : name)
    } else if (before.isFile()) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      entries[key] = { type: 'file', mode, size: Number(before.size), sha256: hash.digest('hex') }
      bytes += Number(before.size)
    } else throw new Error(`Cannot back up special data file: ${path}`)
    const after = await lstat(path, { bigint: true })
    if (!isDeepStrictEqual(stamps[key], [after.dev, after.ino, after.size, after.mtimeNs, after.ctimeNs].map(String))) throw new Error('Data home changed during backup; stop all DSH processes and retry')
  }
  await visit(root, '')
  return { entries, stamps, bytes }
}

/** Caller holds the program root and home operation leases. Older/direct DSH processes must be stopped first. */
export async function backupDataHome(home, root, { copy = cp, space = statfs } = {}) {
  home = await realpath(home)
  root = await realpath(root)
  if (contains(home, root) || contains(root, home)) throw new Error('Data backup requires separate program and data directories')
  if ((await readdir(home)).length === 0) return { state: 'empty-home' }
  const before = await dataTree(home)
  const parent = join(root, 'data-backups')
  await mkdir(parent, { recursive: true })
  if (await realpath(parent) !== parent) throw new Error('Backup directory must not be a symlink or junction')
  // An interrupted or killed run leaves its unpublished copy; under the root lease no other backup is writing one.
  for (const name of await readdir(parent)) {
    if (/^home-[0-9a-f-]{36}\.pending$/u.test(name)) await rm(join(parent, name), { recursive: true, force: true })
  }
  const available = await space(parent, { bigint: true })
  // A directory copy expands hardlinks and sparse files; reserve logical size plus metadata/headroom.
  const required = BigInt(before.bytes) + BigInt(Object.keys(before.entries).length) * 4096n + 16n * 1024n * 1024n
  if (available.bavail * available.bsize < required) throw new Error('Insufficient free space for the complete data backup')
  const id = randomUUID()
  const pending = join(parent, `home-${id}.pending`)
  const destination = join(parent, `home-${id}`)
  await mkdir(pending)
  try {
    const tree = join(pending, 'data')
    await copy(home, tree, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false })
    const copied = await dataTree(tree)
    const after = await dataTree(home)
    if (!isDeepStrictEqual(before.entries, copied.entries) || !isDeepStrictEqual(before, after)) throw new Error('Data home changed or backup verification failed; stop all DSH processes and retry')
    const receipt = { format: 1, source: home, created: new Date().toISOString(), bytes: before.bytes, entries: before.entries,
      note: 'Verified file-tree copy, not an online filesystem snapshot. Symlinks are preserved without copying external targets.' }
    await writeFile(join(pending, 'backup.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(pending, destination)
    return { state: 'verified', path: destination, bytes: before.bytes, entries: Object.keys(before.entries).length }
  } catch (error) {
    // This exact fresh child is the only cleanup target; the source and completed backups remain.
    await rm(pending, { recursive: true, force: true })
    throw error
  }
}
