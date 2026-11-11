import { lstat, realpath, symlink } from 'node:fs/promises'

/** Create a preview link only when no directory entry already owns its path. */
export async function ensurePreviewDependency(target, destination) {
  const expected = await realpath(target)
  const entry = await lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (entry === null) {
    await symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
    return
  }
  const existing = await realpath(destination).catch(error => {
    if (error.code === 'ENOENT' && entry.isSymbolicLink()) throw new Error(`Dangling preview dependency at ${destination}`, { cause: error })
    throw error
  })
  if (existing !== expected) throw new Error(`Unexpected preview dependency at ${destination}`)
}
