#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2] && resolve(process.argv[2])
if (!source || process.argv.length !== 3) throw new Error('Usage: node scripts/export-patch.mjs <source-checkout>')
const manifestPath = resolve(root, 'dsh-ui.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const git = (...args) => execFileSync('git', ['-C', source, ...args], { maxBuffer: 32 * 1024 * 1024 })
git('merge-base', '--is-ancestor', manifest.upstream.commit, 'HEAD')
const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString('utf8')
if (untracked) throw new Error('Stage the intended new source files before exporting; untracked files would be omitted.')
const patch = git('diff', '--binary', '--full-index', manifest.upstream.commit, '--')
if (!patch.length) throw new Error('Refusing to publish an empty UI patch.')
const destination = resolve(root, manifest.patch.file)
writeFileSync(`${destination}.tmp`, patch)
renameSync(`${destination}.tmp`, destination)
manifest.patch.sha256 = createHash('sha256').update(patch).digest('hex')
writeFileSync(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
renameSync(`${manifestPath}.tmp`, manifestPath)
console.log(`Exported ${patch.length} bytes; SHA-256 ${manifest.patch.sha256}`)
