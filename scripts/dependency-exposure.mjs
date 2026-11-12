import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async file => JSON.parse(await readFile(file, 'utf8'))
const packageName = specifier =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/')
function pathResolver(root) {
  const cache = new Map()
  return input => {
    const file = path.resolve(root, input.replace(/^(?:owned-css|inline-css|worker-source):/, '').replaceAll('\\', '/'))
    if (!cache.has(file))
      cache.set(
        file,
        realpath(file).then(
          physical => ({ physical }),
          error => ({ error: { path: input, code: error.code, reason: error.message } }),
        ),
      )
    return cache.get(file)
  }
}
const inside = (directory, file) => file.startsWith(`${directory}${path.sep}`) && !path.relative(directory, file).split(path.sep).includes('node_modules')

export async function artifactExposure(root, packageDirectory, metafiles, resolve = pathResolver(root)) {
  const directory = await resolve(packageDirectory)
  return Promise.all(
    metafiles.map(async ({ name, data }) => {
      const inputs = [...new Set([...Object.keys(data.inputs), ...Object.values(data.outputs).flatMap(output => Object.keys(output.inputs))])]
      const resolved = new Map(await Promise.all(inputs.map(async input => [input, await resolve(input)])))
      const matches = input => directory.physical && resolved.get(input).physical && inside(directory.physical, resolved.get(input).physical)
      const resolutionErrors = [directory.error, ...inputs.map(input => resolved.get(input).error && { ...resolved.get(input).error, path: input })].filter(
        Boolean,
      )
      const parsedInputs = Object.keys(data.inputs).filter(matches)
      const retainedOutputBytes = Object.values(data.outputs).reduce(
        (total, output) =>
          total + Object.entries(output.inputs).reduce((sum, [input, contribution]) => sum + (matches(input) ? contribution.bytesInOutput : 0), 0),
        0,
      )
      return {
        artifact: name,
        parsedInputs,
        physicalDirectory: directory.physical ?? null,
        resolvedInputs: inputs.filter(matches).map(input => ({ input, physical: resolved.get(input).physical })),
        retainedOutputBytes,
        parsedOnly: resolutionErrors.length === 0 && parsedInputs.length > 0 && retainedOutputBytes === 0,
        status: resolutionErrors.length ? 'incomplete' : 'complete',
        resolutionErrors,
      }
    }),
  )
}

// Walk upward from the resolved entry: package.json may be hidden by exports.
export async function resolvePackage(fromPackage, name) {
  try {
    await readJson(fromPackage)
    // Match Node's default module loading through pnpm symlinks: dependencies belong to the physical owner.
    const entry = createRequire(await realpath(fromPackage)).resolve(name)
    let directory = path.dirname(entry)
    while (directory !== path.dirname(directory)) {
      try {
        const manifest = await readJson(path.join(directory, 'package.json'))
        if (manifest.name === name) return { status: 'resolved', name, version: manifest.version, directory, entry }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      directory = path.dirname(directory)
    }
    return { status: 'unknown', name, reason: 'Resolved entry has no matching package manifest', entry }
  } catch (error) {
    return { status: 'unknown', name, reason: error.message }
  }
}

export async function inspectRuntimeDependencies(pluginPackage, backendPackage) {
  if (typeof pluginPackage !== 'string' || !pluginPackage || typeof backendPackage !== 'string' || !backendPackage)
    throw new Error('Explicit pluginPackage and backendPackage paths are required')
  const plugin = await readJson(pluginPackage)
  const declarations = { ...plugin.dependencies, ...plugin.peerDependencies }
  const runtimeNames = ['@modelcontextprotocol/client', 'undici', 'fflate', 'katex', 'zod', 'happy-dom']
  const pluginResolution = await Promise.all(runtimeNames.map(name => resolvePackage(pluginPackage, name)))
  const backendResolution = await Promise.all(
    ['@deepseek-ai/dsh-http-proxy', '@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-web-fetch-http', '@deepseek-ai/libreoffice-kit'].map(name =>
      resolvePackage(backendPackage, name),
    ),
  )
  const hostDependencies = await Promise.all(
    backendResolution.map(async owner => {
      if (owner.status !== 'resolved') return { owner, dependencies: [] }
      const manifestPath = path.join(owner.directory, 'package.json')
      const manifest = await readJson(manifestPath)
      const declared = { ...manifest.dependencies, ...manifest.peerDependencies }
      return {
        owner,
        dependencies: await Promise.all(runtimeNames.filter(name => Object.hasOwn(declared, name)).map(name => resolvePackage(manifestPath, name))),
      }
    }),
  )
  return { plugin: pluginResolution.map(item => ({ ...item, declared: Object.hasOwn(declarations, item.name) })), hostDependencies }
}

export async function collectExposure({
  root = repository,
  auditFile,
  pluginPackage = path.join(root, 'packages/modern-ui/package.json'),
  backendPackage = path.join(root, 'node_modules/@deepseek-ai/dsh/package.json'),
}) {
  const audit = await readJson(auditFile)
  if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object') throw new Error('Expected npm audit JSON with vulnerabilities')
  const metafiles = await Promise.all(
    ['client', 'host-main', 'host-compat'].map(async name => ({ name, data: await readJson(path.join(root, '.artifacts/build-metafiles', `${name}.json`)) })),
  )
  const plugin = await readJson(pluginPackage)
  const declarations = { ...plugin.dependencies, ...plugin.peerDependencies }
  const externals = metafiles.map(({ name, data }) => ({
    artifact: name,
    imports: [
      ...new Set(
        Object.values(data.outputs)
          .flatMap(output => output.imports)
          .filter(item => item.external && !isBuiltin(item.path))
          .map(item => item.path),
      ),
    ],
  }))
  // Browser shared modules have a separate loader contract; Node externals must be declared by the published plugin.
  const missingRuntimeDeclarations = externals
    .filter(item => item.artifact !== 'client')
    .flatMap(item =>
      item.imports.filter(specifier => !Object.hasOwn(declarations, packageName(specifier))).map(specifier => ({ artifact: item.artifact, specifier })),
    )
  const resolve = pathResolver(root)
  const advisories = new Map()
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities)) {
    const directAdvisories = vulnerability.via.filter(item => typeof item === 'object')
    if (!directAdvisories.length) continue
    const installedPaths = await Promise.all(
      vulnerability.nodes.map(async node => {
        let manifest
        try {
          manifest = await readJson(path.join(root, node, 'package.json'))
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        return {
          path: node,
          version: manifest?.version ?? null,
          status: manifest ? 'installed-audit-affected-path' : 'unknown-missing-installed-path',
          artifacts: await artifactExposure(root, node, metafiles, resolve),
        }
      }),
    )
    for (const advisory of directAdvisories) {
      const key = advisory.url ?? String(advisory.source)
      if (!advisories.has(key))
        advisories.set(key, {
          id: key.split('/').at(-1),
          url: advisory.url,
          title: advisory.title,
          severity: advisory.severity,
          affectedRange: advisory.range,
          packages: [],
        })
      advisories.get(key).packages.push({ name, installedPaths })
    }
  }
  const runtime = await inspectRuntimeDependencies(pluginPackage, backendPackage)
  const vulnerableRetainedPaths = [...advisories.values()].flatMap(advisory =>
    advisory.packages.flatMap(pkg =>
      pkg.installedPaths
        .filter(installed => installed.artifacts.some(artifact => artifact.retainedOutputBytes > 0))
        .map(installed => ({ advisory: advisory.id, name: pkg.name, path: installed.path, version: installed.version })),
    ),
  )
  const incompletePaths = [...advisories.values()].flatMap(advisory =>
    advisory.packages.flatMap(pkg =>
      pkg.installedPaths
        .filter(installed => installed.status !== 'installed-audit-affected-path' || installed.artifacts.some(artifact => artifact.status === 'incomplete'))
        .map(installed => ({ advisory: advisory.id, name: pkg.name, path: installed.path })),
    ),
  )
  return {
    generatedAt: new Date().toISOString(),
    auditFile: path.resolve(auditFile),
    pluginPackage: path.resolve(pluginPackage),
    backendPackage: path.resolve(backendPackage),
    limitations: [
      'Affected paths come from the supplied npm audit snapshot; installed versions are observed now. A stale snapshot must be regenerated before interpreting version changes.',
      'No devDependency exemption is applied. Zero retained bytes only describes direct metafile inputs; prebundled or vendored embedded code is not proven safe.',
      'External imports execute outside this bundle. Resolution records installation ownership, not feature reachability or exploitability.',
      'Root development overrides do not repair dependencies owned by a separately installed official host.',
      'Resolution can fall back to ancestor node_modules; only declared plugin dependencies are its supported runtime contract.',
    ],
    advisories: [...advisories.values()],
    externals,
    runtime,
    gate: {
      passed: !incompletePaths.length && !vulnerableRetainedPaths.length && !missingRuntimeDeclarations.length,
      incompletePaths,
      vulnerableRetainedPaths,
      missingRuntimeDeclarations,
    },
  }
}

async function main() {
  const options = {
    auditFile: path.join(repository, '.artifacts/audit-20261110/npm-audit.json'),
    output: path.join(repository, '.artifacts/audit-20261110/dependency-exposure.json'),
  }
  const keys = { '--audit': 'auditFile', '--output': 'output', '--plugin-package': 'pluginPackage', '--backend-package': 'backendPackage' }
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 2) {
    if (!keys[args[index]] || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Expected --audit/--output/--plugin-package/--backend-package followed by a path: ${args[index]}`)
    options[keys[args[index]]] = path.resolve(args[index + 1])
  }
  const report = await collectExposure(options)
  await mkdir(path.dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`${report.advisories.length} advisories; bundle/runtime declaration gate ${report.gate.passed ? 'passed' : 'failed'}; ${options.output}`)
  if (!report.gate.passed) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
