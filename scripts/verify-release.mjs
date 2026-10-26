#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Check pinned release inputs and, optionally, the installed patch contents. */
export function verifyRelease(root, appliedSource) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'dsh-ui.json'), 'utf8'))
  if (!/^[a-f0-9]{40}$/.test(manifest.upstream?.commit ?? '')) {
    throw new Error('The upstream commit must be a full immutable Git commit.')
  }
  const patchName = manifest.patch?.file
  if (typeof patchName !== 'string' || isAbsolute(patchName)) throw new Error('The patch path must be relative.')
  const patch = resolve(root, patchName)
  if (relative(root, patch).startsWith('..')) throw new Error('The patch must stay inside the release repository.')
  const bytes = readFileSync(patch)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== manifest.patch.sha256) throw new Error('The release patch SHA-256 does not match dsh-ui.json.')
  if (!/diff --git a\//.test(bytes.toString('utf8'))) throw new Error('The patch has no Git file changes.')
  if (!/^[a-f0-9]{64}$/.test(manifest.upstream.tarballSha256 ?? '')) {
    throw new Error('The upstream archive SHA-256 must contain 64 hexadecimal characters.')
  }
  if (appliedSource !== undefined) {
    const source = resolve(appliedSource)
    execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply', '--reverse', '--check', '--whitespace=nowarn', patch], {
      cwd: source,
      env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(source) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  return { upstream: manifest.upstream.commit, patchBytes: bytes.length, sha256, appliedSource: appliedSource ?? null }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'applied-source': { type: 'string' } }, allowPositionals: false })
  console.log(JSON.stringify(verifyRelease(repository, values['applied-source']), null, 2))
}
