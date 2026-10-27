import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { checkIntegrity } from './integrity.mjs'

export async function download(url, integrity, output) {
  if (!url.startsWith('https://')) throw new Error('Only HTTPS artifact URLs are accepted')
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  checkIntegrity(bytes, integrity)
  await writeFile(output, bytes)
}

export async function unpack(archive, target) {
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' })
  if (listing.error || listing.status !== 0) throw new Error('Cannot inspect release archive')
  if (listing.stdout.split(/\r?\n/).some(path => path.startsWith('/') || path.split(/[\\/]/).includes('..'))) throw new Error('Unsafe archive entry')
  await mkdir(target, { recursive: true })
  const result = spawnSync('tar', ['-xf', archive, '-C', target], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`Cannot extract release archive: ${result.error ?? result.stderr}`)
}
