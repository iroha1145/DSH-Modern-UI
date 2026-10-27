import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, win32 } from 'node:path'
import { checkIntegrity } from './integrity.mjs'

export async function download(url, integrity, output) {
  if (!url.startsWith('https://')) throw new Error('Only HTTPS artifact URLs are accepted')
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  checkIntegrity(bytes, integrity)
  await writeFile(output, bytes)
}

export function archiveEntries(listing) {
  const entries = listing.split(/\r?\n/).filter(Boolean)
  if (!entries.length) throw new Error('Release archive is empty')
  for (const entry of entries) {
    const name = entry.replace(/^(?:\.\/)+/, '')
    if (name.startsWith('/') || name.startsWith('\\') || win32.isAbsolute(name)
      || name.includes(':') || name.includes('\0') || name.split(/[\\/]/).includes('..')) {
      throw new Error(`Unsafe archive entry: ${entry}`)
    }
  }
  return entries
}

function runTar(args, cwd, action) {
  const executable = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}, signal ${result.signal}`
    throw new Error(`Cannot ${action} release archive (${executable}): ${detail.slice(0, 2000)}`)
  }
  return result.stdout
}

export async function unpack(archive, target) {
  const archivePath = resolve(archive)
  const directory = dirname(archivePath)
  // Keep the archive name independent of the install root's drive spelling and encoding.
  const filename = './' + basename(archivePath)
  const entries = archiveEntries(runTar(['-tf', filename], directory, 'inspect'))
  await mkdir(target, { recursive: true })
  runTar(['-xf', filename, '-C', relative(directory, resolve(target)) || '.'], directory, 'extract')
  return entries
}
