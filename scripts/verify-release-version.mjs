// A release tag, the compatibility manifest and the built package must name one version.
// Usage: node scripts/verify-release-version.mjs <tag>   (for example v0.1.0)
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeVersions } from './distribution/compatibility.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME
if (!tag?.startsWith('v')) throw new Error(`Expected a release tag such as v0.1.0, got ${JSON.stringify(tag)}`)
const manifest = JSON.parse(await readFile(path.join(root, 'packages/modern-ui/package.json'), 'utf8'))
const versions = { tag: tag.slice(1), compatibility: runtimeVersions.plugin, package: manifest.version }
if (new Set(Object.values(versions)).size !== 1) throw new Error(`Release versions disagree: ${JSON.stringify(versions)}`)
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions.tag)) throw new Error(`Not a strict SemVer release: ${versions.tag}`)
console.log(JSON.stringify({ version: versions.tag, prerelease: versions.tag.includes('-') }))
