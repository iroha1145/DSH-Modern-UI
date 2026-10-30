import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { checkIntegrity, snapshot } from './integrity.mjs'
import { unpack } from './artifacts.mjs'

const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function cacheWrite(path, bytes) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, bytes)
  await rename(temporary, path)
}
export function sourceArchivePath(cache, source) {
  return join(cache, createHash('sha256').update(source.url + '\n' + source.integrity).digest('hex') + '.tgz')
}
export async function fetchBytes(url) {
  if (new URL(url).origin !== 'https://registry.npmjs.org') throw new Error('Release provenance requires the official npm registry')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(180000) })
      if ([429, 503].includes(response.status) && attempt < 2) { await delay(500 * (attempt + 1)); continue }
      if (!response.ok) throw new Error(`Release source download failed (HTTP ${response.status})`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt >= 2 || !['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code)) throw error
      await delay(500 * (attempt + 1))
    }
  }
}
export async function verifyReleaseSource(packageRoot, source, cache, scratch) {
  await mkdir(cache, { recursive: true })
  const archive = sourceArchivePath(cache, source)
  const bytes = existsSync(archive) ? await readFile(archive) : await fetchBytes(source.url)
  checkIntegrity(bytes, source.integrity)
  if (!existsSync(archive)) await cacheWrite(archive, bytes)
  const staging = join(scratch, randomUUID())
  await mkdir(staging, { recursive: true })
  try {
    const entries = await unpack(archive, staging)
    const roots = [...new Set(entries.map(path => path.replace(/^(?:\.\/)+/, '').split(/[\\/]/)[0]))]
    const unpacked = existsSync(join(staging, 'package.json')) ? staging : roots.length === 1 ? join(staging, roots[0]) : undefined
    if (!unpacked || !existsSync(join(unpacked, 'package.json'))) throw new Error(`Release archive has no unique package root for ${source.name}@${source.version}`)
    const metadata = await json(join(unpacked, 'package.json'))
    if (metadata.name !== source.name || metadata.version !== source.version) throw new Error('Release archive identity mismatch')
    const expected = await snapshot(unpacked, { excludeNodeModules: true })
    const actual = await snapshot(packageRoot, { excludeNodeModules: true })
    const derivedFiles = {}
    // The upstream node-pty postinstall copies these two published ConPTY helpers.
    // Accept only byte-identical copies, never arbitrary build output or addons.
    if (source.name === 'node-pty' && source.version === '1.2.0-beta.15' && process.platform === 'win32') {
      for (const name of ['OpenConsole.exe', 'conpty.dll']) {
        const destination = `build/Release/conpty/${name}`
        const original = `prebuilds/win32-${process.arch}/conpty/${name}`
        if (actual[destination] && actual[destination].sha256 === expected[original]?.sha256) {
          expected[destination] = expected[original]
          derivedFiles[destination] = original
        }
      }
    }
    const changed = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
      .filter(path => expected[path]?.sha256 !== actual[path]?.sha256)
    if (changed.length) throw new Error(`Installed ${source.name}@${source.version} differs from its published release: ${changed.slice(0, 12).join(', ')}`)
    return { ...source, path: packageRoot, files: Object.keys(actual).length, derivedFiles }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function verifyReleaseSources(packages, cache, scratch, pins = {}) {
  await mkdir(cache, { recursive: true })
  const roots = [...Object.keys(packages)]
  const ledger = []
  // Bound network and extraction concurrency; all workers are awaited before returning.
  let next = 0
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(6, roots.length) }, async () => {
    while (next < roots.length) {
      const root = roots[next++]
      const metadata = await json(join(root, 'package.json'))
      if (typeof metadata.name !== 'string' || typeof metadata.version !== 'string') throw new Error(`Missing package identity at ${root}`)
      const identity = `${metadata.name}@${metadata.version}`
      const metadataCache = join(cache, createHash('sha256').update(identity).digest('hex') + '.json')
      let source = pins[identity]
      if (!source) {
        if (existsSync(metadataCache)) source = await json(metadataCache)
        else {
          const published = JSON.parse((await fetchBytes(`https://registry.npmjs.org/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}`)).toString())
          if (published.name !== metadata.name || published.version !== metadata.version) throw new Error(`Registry identity mismatch for ${identity}`)
          source = { name: published.name, version: published.version, url: published.dist.tarball, integrity: published.dist.integrity }
          await cacheWrite(metadataCache, JSON.stringify(source, null, 2) + '\n')
        }
      }
      ledger.push(await verifyReleaseSource(root, source, cache, scratch))
    }
  }))
  const failures = outcomes.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), `Release provenance failed: ${failures.map(result => result.reason.message).join('; ')}`)
  return ledger.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}
