import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, win32 } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { checkIntegrity } from './integrity.mjs'

const RETRIED_CAUSES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])
export async function download(url, integrity, output) {
  if (!url.startsWith('https://')) throw new Error('Only HTTPS artifact URLs are accepted')
  let bytes
  // A dropped connection during one of the release downloads otherwise ends the whole install
  // with a bare "fetch failed"; three attempts cover the usual transient break and name the URL.
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
      if ([429, 502, 503, 504].includes(response.status) && attempt < 3) {
        await delay(1000 * attempt)
        continue
      }
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
      bytes = Buffer.from(await response.arrayBuffer())
      break
    } catch (error) {
      const code = error.cause?.code ?? error.code
      if (attempt >= 3 || !(RETRIED_CAUSES.has(code) || error.name === 'TimeoutError')) {
        throw new Error(`Download failed for ${url}: ${error.message}${code ? ` (${code})` : ''}`, { cause: error })
      }
      await delay(1000 * attempt)
    }
  }
  checkIntegrity(bytes, integrity)
  await writeFile(output, bytes)
}

export function archiveEntries(listing) {
  const entries = listing.split(/\r?\n/).filter(Boolean)
  if (!entries.length) throw new Error('Release archive is empty')
  for (const entry of entries) {
    const name = entry.replace(/^(?:\.\/)+/, '')
    if (
      name.startsWith('/') ||
      name.startsWith('\\') ||
      win32.isAbsolute(name) ||
      name.includes(':') ||
      name.includes('\0') ||
      name.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`Unsafe archive entry: ${entry}`)
    }
  }
  return entries
}

function runTar(args, cwd, action) {
  const executable = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
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
