import { existsSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { snapshot } from './integrity.mjs'

const json = async path => JSON.parse(await readFile(path, 'utf8'))

// Node resolves dependencies from the real declaring package, including pnpm's
// per-package node_modules links. Reading metadata must not resolve from a caller's
// lexical junction, a checkout, NODE_PATH, or an unrelated outer installation.
export async function resolveDependencyManifest(anchor, name) {
  let directory = dirname(await realpath(anchor))
  for (;;) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpath(candidate)
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`Missing dependency ${name} required from ${anchor}`)
    directory = parent
  }
}

export async function dependencyInventory(backendManifest, options = {}) {
  const pending = [await realpath(backendManifest)]
  const packages = {}
  const optionalMissing = []
  while (pending.length) {
    const manifest = await realpath(pending.pop())
    const root = dirname(manifest)
    if (packages[root]) continue
    const metadata = await json(manifest)
    packages[root] = options.snapshotFiles === false ? {} : await snapshot(root, { excludeNodeModules: true })
    const required = { ...metadata.dependencies, ...metadata.peerDependencies }
    const optional = { ...metadata.optionalDependencies }
    for (const [name, peer] of Object.entries(metadata.peerDependenciesMeta ?? {})) {
      if (peer.optional) {
        optional[name] = required[name]
        delete required[name]
      }
    }
    for (const name of Object.keys(metadata.optionalDependencies ?? {})) delete required[name]
    const enqueue = async (name, spec) => {
      const dependency = await resolveDependencyManifest(manifest, name)
      let expectedName = name
      if (typeof spec === 'string' && spec.startsWith('npm:')) {
        const alias = spec.slice(4)
        const separator = alias.lastIndexOf('@')
        expectedName = separator > 0 ? alias.slice(0, separator) : alias
      }
      if ((await json(dependency)).name !== expectedName) throw new Error(`Dependency identity mismatch for ${name} from ${manifest}`)
      pending.push(dependency)
    }
    for (const [name, spec] of Object.entries(required)) await enqueue(name, spec)
    for (const name of Object.keys(optional)) {
      try {
        await enqueue(name, optional[name])
      } catch (error) {
        if (!error.message.startsWith('Missing dependency ')) throw error
        optionalMissing.push({ declaringPackage: metadata.name, name, reason: 'Optional dependency is not installed for this target' })
      }
    }
  }
  return { packages, optionalMissing }
}
