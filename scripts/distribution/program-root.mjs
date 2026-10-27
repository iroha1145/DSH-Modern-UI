import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

function directory(path) {
  try {
    const entry = statSync(path, { bigint: true })
    return entry.isDirectory() ? entry : undefined
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

export function selectProgramRoot({ root, platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (root) return resolve(root)
  const base = platform === 'win32' ? env.LOCALAPPDATA : env.XDG_DATA_HOME || join(home, '.local/share')
  if (!base) throw new Error('Pass --root when the local application data directory is unavailable')
  if (platform === 'win32') return resolve(base, 'DSH-Modern-UI/program')
  const canonical = join(base, 'dsh-modern-ui')
  const legacy = join(base, 'DSH-Modern-UI')
  const current = directory(canonical)
  const previous = directory(legacy)
  if (current && previous && (current.dev !== previous.dev || current.ino !== previous.ino)) {
    throw new Error(`Both ${canonical} and ${legacy} exist. Pass an explicit program root (--root or PROGRAM_ROOT); no directories were merged.`)
  }
  return resolve(previous && !current ? legacy : canonical, 'program')
}
