import compatibility from './compatibility.json' with { type: 'json' }

export const defaultHostVersion = compatibility.defaultHostVersion
export const runtimeVersions = compatibility.runtimeVersions
export const supportedHostVersions = Object.keys(compatibility.hosts)

export function getHostCompatibility(version) {
  if (!Object.hasOwn(compatibility.hosts, version)) {
    throw new Error(`Unsupported official DSH version ${version}; supported versions: ${supportedHostVersions.join(', ')}`)
  }
  const host = compatibility.hosts[version]
  return {
    ...host,
    node: runtimeVersions.node,
    pnpm: runtimeVersions.pnpm,
    excludedDefaultPlugins: compatibility.excludedDefaultPlugins,
    plugin: { ...compatibility.plugin, version: runtimeVersions.plugin, compatibleHosts: supportedHostVersions, ...host.plugin },
  }
}
