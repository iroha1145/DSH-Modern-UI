import { isAbsolute, relative, sep } from 'node:path'

/** Compare already resolved paths without following links or touching the filesystem. */
export function containsPath(parent, child) {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
}
