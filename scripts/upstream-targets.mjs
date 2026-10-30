// Pick the official DSH versions the upstream canary should exercise: the newest prerelease and the
// newest release that are neither verified nor recorded as known broken.
//   node scripts/upstream-targets.mjs [--host <version>]
// Prints a JSON array; inside GitHub Actions it is also written as the `hosts` step output.
import { appendFileSync } from 'node:fs'
import { compareVersions, knownBrokenHosts, parseVersion, supportedHostVersions } from './distribution/compatibility.mjs'

const override = process.argv[2] === '--host' ? process.argv[3] : undefined
let hosts
if (override) {
  if (!parseVersion(override)) throw new Error(`Invalid --host version: ${override}`)
  hosts = [override]
} else {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', { headers: { accept: 'application/vnd.npm.install-v1+json' } })
  if (!response.ok) throw new Error(`Registry metadata request failed (HTTP ${response.status})`)
  const { versions } = await response.json()
  const candidates = Object.keys(versions).filter(
    version => parseVersion(version) && !supportedHostVersions.includes(version) && !Object.hasOwn(knownBrokenHosts, version),
  )
  const newest = list => list.sort(compareVersions).at(-1)
  hosts = [
    newest(candidates.filter(version => parseVersion(version).prerelease.length > 0)),
    newest(candidates.filter(version => parseVersion(version).prerelease.length === 0)),
  ].filter(version => version !== undefined && compareVersions(version, supportedHostVersions.toSorted(compareVersions).at(-1)) > 0)
}
console.log(JSON.stringify(hosts))
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `hosts=${JSON.stringify(hosts)}\n`)
