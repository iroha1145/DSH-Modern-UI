import compatibility from './compatibility.json' with { type: 'json' }

export const defaultHostVersion = compatibility.defaultHostVersion
export const runtimeVersions = compatibility.runtimeVersions
/** Declared host range, written to the package's engines, compatibleHost and host peers. */
export const hostRange = compatibility.hostRange
/** Hosts that passed the full compatibility suite; each records its exact official source. */
export const supportedHostVersions = Object.keys(compatibility.verifiedHosts)
export const knownBrokenHosts = compatibility.knownBroken

// The thin installer ships without node_modules, so the range check is self-contained. It covers
// the SemVer 2.0.0 precedence rules and npm's prerelease rule; ranges are space-separated comparators.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

/**
 * Parse a strict SemVer version without build metadata.
 * @param {string} version - candidate version.
 * @returns {{ core: number[], prerelease: string[] } | undefined} parsed parts, or undefined when invalid.
 */
export function parseVersion(version) {
  const match = VERSION.exec(version)
  if (!match) return undefined
  return { core: match.slice(1, 4).map(Number), prerelease: match[4] === undefined ? [] : match[4].split('.') }
}

/**
 * Compare two strict SemVer versions by precedence.
 * @param {string} left - first version.
 * @param {string} right - second version.
 * @returns {number} negative, zero or positive.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) throw new Error(`Invalid SemVer version: ${a ? right : left}`)
  for (let index = 0; index < 3; index++) if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numeric = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (numeric[0] && numeric[1]) return Number(x) - Number(y)
    if (numeric[0] !== numeric[1]) return numeric[0] ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

/**
 * Whether a version satisfies a space-separated comparator set such as `>=0.2.1-rc.2 <0.3.0`.
 * Like npm, a prerelease only matches when a comparator names a prerelease of the same major.minor.patch.
 * @param {string} version - candidate version.
 * @param {string} range - comparator set.
 * @returns {boolean} whether the version is in range.
 */
export function satisfiesRange(version, range) {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const comparators = range
    .trim()
    .split(/\s+/)
    .map(item => {
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(item)
      if (!match || !parseVersion(match[2])) throw new Error(`Unsupported host range comparator: ${item}`)
      return { operator: match[1] ?? '=', version: match[2] }
    })
  const holds = { '>=': n => n >= 0, '<=': n => n <= 0, '>': n => n > 0, '<': n => n < 0, '=': n => n === 0 }
  if (!comparators.every(({ operator, version: bound }) => holds[operator](compareVersions(version, bound)))) return false
  if (!parsed.prerelease.length) return true
  return comparators.some(({ version: bound }) => {
    const other = parseVersion(bound)
    return other.prerelease.length > 0 && other.core.every((part, index) => part === parsed.core[index])
  })
}
if (!satisfiesRange(defaultHostVersion, hostRange) || supportedHostVersions.some(version => !satisfiesRange(version, hostRange))) {
  throw new Error('Every verified host must satisfy the declared host range')
}

/** Platforms any verified host was accepted on; an unverified host gets no wider set. */
const verifiedPlatforms = [...new Set(Object.values(compatibility.verifiedHosts).flatMap(host => host.platforms))]

/**
 * Describe how this release treats one official DSH version.
 * Verified hosts carry their recorded source and community set. A host that satisfies the
 * range but was never verified is allowed with a warning: no recorded integrity, no community plugins.
 * Known broken and out-of-range hosts are refused.
 * @param {string} version - official `@deepseek-ai/dsh` version.
 * @returns {object} the host's compatibility record with `status` and, when unverified, `warning`.
 */
export function getHostCompatibility(version) {
  const shared = {
    node: runtimeVersions.node,
    pnpm: runtimeVersions.pnpm,
    excludedDefaultPlugins: compatibility.excludedDefaultPlugins,
  }
  const plugin = { ...compatibility.plugin, version: runtimeVersions.plugin, compatibleHosts: supportedHostVersions, hostRange }
  if (Object.hasOwn(compatibility.verifiedHosts, version)) {
    const host = compatibility.verifiedHosts[version]
    return { status: 'verified', ...host, ...shared, plugin: { ...plugin, ...host.plugin } }
  }
  if (Object.hasOwn(compatibility.knownBroken, version)) {
    throw new Error(`Official DSH ${version} is known to be incompatible: ${compatibility.knownBroken[version]}`)
  }
  if (!satisfiesRange(version, hostRange)) {
    throw new Error(`Unsupported official DSH version ${version}; supported range: ${hostRange} (verified: ${supportedHostVersions.join(', ')})`)
  }
  return {
    status: 'unverified',
    warning: `Official DSH ${version} satisfies ${hostRange} but has not been verified by the Modern UI compatibility suite; verified: ${supportedHostVersions.join(', ')}`,
    platforms: verifiedPlatforms,
    officialSource: { name: '@deepseek-ai/dsh', version, channel: 'npm registry metadata (unverified host)' },
    communityPlugins: [],
    ...shared,
    plugin,
  }
}
