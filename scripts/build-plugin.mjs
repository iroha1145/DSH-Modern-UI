import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildQuotesTypes } from './build-quotes-types.mjs'
import { defaultHostVersion, runtimeVersions, supportedHostVersions, getHostCompatibility } from './distribution/compatibility.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = path.join(root, 'packages/modern-ui')
const manifestPath = path.join(pkg, 'package.json')
const manifestSource = await readFile(manifestPath, 'utf8')
const manifest = JSON.parse(manifestSource)
const hostRange = supportedHostVersions.join(' || ')
manifest.version = runtimeVersions.plugin
manifest.engines = { ...manifest.engines, node: runtimeVersions.node, dsh: hostRange }
manifest.dsh.compatibleHost = hostRange
for (const name of Object.keys(manifest.peerDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) manifest.peerDependencies[name] = hostRange
}
const manifestOutput = JSON.stringify(manifest, null, 2) + '\n'
if (manifestOutput !== manifestSource) await writeFile(manifestPath, manifestOutput)
await writeFile(path.join(root, 'scripts/distribution/community-lock.json'), JSON.stringify({
  plugins: getHostCompatibility(defaultHostVersion).communityPlugins,
}, null, 2) + '\n')
// An explicit external development dependency directory is useful for hermetic builds.
const require = createRequire(process.env.MODERN_UI_BUILD_DEPS
  ? path.join(path.resolve(process.env.MODERN_UI_BUILD_DEPS), 'package.json')
  : path.join(root, 'package.json'))
const { build } = require('esbuild')
const { transform } = require('lightningcss')
const rootRequire = createRequire(path.join(root, 'package.json'))
const ts = rootRequire('typescript')
const configPath = path.join(root, 'tsconfig.client.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {}, configPath)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
}))
const id = '@iroha1145/dsh-modern-ui'
const platform = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives']
const pure = new Set([
  '@deepseek-ai/dsh-util-workspace-path', '@deepseek-ai/dsh-util-code-language',
  '@deepseek-ai/dsh-file-reference/grammar', '@deepseek-ai/dsh-session/surface',
  '@deepseek-ai/dsh-util-values', '@deepseek-ai/dsh-util-crypto',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-agent-preset-registry/display',
  '@deepseek-ai/dsh-api-workspace-controller/default-workspace',
  '@deepseek-ai/dsh-spill-policy/notice', '@deepseek-ai/dsh-output-retention',
  // Pure Turn token-usage derivation the vendored chat data layer (turn-tail) folds into its snapshot,
  // and the pure assistant-stream assembler it reads the last chunk through.
  '@deepseek-ai/dsh-token-meter/client', '@deepseek-ai/dsh-llm/assistant-stream',
])
const stylePlugin = {
  name: 'modern-ui-owned-resources',
  setup(builder) {
    builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: path.join(pkg, 'src/vendor/primitives/index.ts') }))
    builder.onResolve({ filter: /\.css(?:\?inline)?$/ }, args => ({
      path: args.path.startsWith('.') ? path.resolve(args.resolveDir, args.path.replace(/\?inline$/, '')) : require.resolve(args.path.replace(/\?inline$/, '')),
      namespace: args.path.endsWith('?inline') ? 'inline-css' : 'owned-css',
    }))
    const css = async args => {
      let source = await readFile(args.path, 'utf8')
      // Keep font resources inside the precompiled artifact, with no external checkout paths.
      const matches = [...source.matchAll(/url\(([^)]+)\)/g)]
      for (const match of matches) {
        const relative = match[1].replace(/['"]/g, '')
        if (/^(data:|https?:|#)/.test(relative)) continue
        const bytes = await readFile(path.resolve(path.dirname(args.path), relative))
        const mime = relative.endsWith('.woff2') ? 'font/woff2' : relative.endsWith('.woff') ? 'font/woff' : 'font/ttf'
        source = source.replace(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`)
      }
      const result = transform({ filename: path.relative(pkg, args.path).replaceAll('\\', '/'), code: Buffer.from(source), minify: true, cssModules: args.path.endsWith('.module.css') })
      const text = result.code.toString()
      if (args.namespace === 'inline-css') return { contents: `export default ${JSON.stringify(text)}`, loader: 'js' }
      const names = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]))
      return { contents: `import {registerStyle} from ${JSON.stringify(path.join(pkg, 'src/styles.ts'))};registerStyle(${JSON.stringify(path.relative(pkg, args.path).replaceAll('\\', '/'))},${JSON.stringify(text)});export default ${JSON.stringify(names)};`, loader: 'js', resolveDir: pkg }
    }
    builder.onLoad({ filter: /.*/, namespace: 'owned-css' }, css)
    builder.onLoad({ filter: /.*/, namespace: 'inline-css' }, css)
  },
}
await mkdir(path.join(pkg, 'lib'), { recursive: true })
const client = await build({
  absWorkingDir: root, entryPoints: [path.join(pkg, 'src/client.tsx')],
  outfile: path.join(pkg, 'lib/client.js'), bundle: true, platform: 'browser', format: 'cjs',
  jsx: 'automatic', target: 'es2022', minify: true, legalComments: 'inline', metafile: true,
  external: platform, nodePaths: [path.dirname(require.resolve('esbuild/package.json')).replace(/[/\\]esbuild$/, '')],
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl' },
  plugins: [stylePlugin, {
    name: 'shared-runtime-boundary',
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\// }, args => {
        if (pure.has(args.path) || /^@deepseek-ai\/(schemastery|cosmokit)(\/|$)/.test(args.path)) return null
        if (!platform.includes(args.path)) throw new Error(`Undeclared shared runtime import: ${args.path}`)
        return { path: args.path, external: true }
      })
    },
  }],
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{const module={exports:{}};const exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
})
await build({
  absWorkingDir: root,
  entryPoints: [path.join(pkg, 'src/index.ts')], outfile: path.join(pkg, 'lib/index.js'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['@deepseek-ai/*'],
})
await import('./build-host.mjs')
buildQuotesTypes()
const licensed = new Map()
for (const input of Object.keys(client.metafile.inputs)) {
  const physical = input.replace(/^(?:owned-css|inline-css):/, '')
  if (!physical.replaceAll('\\', '/').includes('/node_modules/') && !physical.startsWith('node_modules/')) continue
  let directory = path.dirname(path.resolve(root, physical))
  while (directory !== path.dirname(directory)) {
    let manifest
    try { manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (manifest?.name && manifest?.version) {
      licensed.set(`${manifest.name}@${manifest.version}`, { manifest, directory })
      break
    }
    directory = path.dirname(directory)
  }
}
const licenseDirectory = path.join(pkg, 'licenses/npm')
await mkdir(licenseDirectory, { recursive: true })
const licenseIndex = []
for (const [identity, { manifest, directory }] of [...licensed].sort(([left], [right]) => left.localeCompare(right))) {
  const files = (await readdir(directory)).filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name))
  let texts = await Promise.all(files.map(async name => `--- ${name} ---\n${await readFile(path.join(directory, name), 'utf8')}`))
  if (texts.length === 0 && manifest.name.startsWith('@deepseek-ai/')) texts = [await readFile(path.join(pkg, 'LICENSE'), 'utf8')]
  if (texts.length === 0) {
    const readme = (await readdir(directory)).find(name => /^readme(?:[.-]|$)/i.test(name))
    if (readme === undefined) throw new Error(`No license or attribution text found for bundled ${identity}`)
    texts = [`--- ${readme} ---\n${await readFile(path.join(directory, readme), 'utf8')}`]
  }
  const file = `${identity.replaceAll('/', '_').replaceAll('@', '')}.txt`
  await writeFile(path.join(licenseDirectory, file), `${identity}\nDeclared license: ${JSON.stringify(manifest.license)}\n${texts.join('\n\n')}\n`)
  licenseIndex.push({ name: manifest.name, version: manifest.version, license: manifest.license, file: `licenses/npm/${file}` })
}
await writeFile(path.join(pkg, 'licenses/bundled-dependencies.json'), JSON.stringify(licenseIndex, null, 2) + '\n')
function logicalInput(input) {
  const prefix = input.match(/^(?:owned-css|inline-css):/)?.[0] ?? ''
  const physical = path.resolve(root, input.slice(prefix.length)).replaceAll('\\', '/')
  const dependency = physical.lastIndexOf('/node_modules/')
  return prefix + (dependency < 0 ? path.relative(root, physical).replaceAll('\\', '/') : physical.slice(dependency + 1))
}
await writeFile(path.join(pkg, 'lib/build-inputs.json'), JSON.stringify({
  host: defaultHostVersion, compatibleHosts: supportedHostVersions, shared: platform,
  inputs: Object.keys(client.metafile.inputs).map(logicalInput),
  outputs: Object.fromEntries(Object.entries(client.metafile.outputs).map(([name, value]) => [path.basename(name), { bytes: value.bytes, imports: value.imports }])),
}, null, 2) + '\n')
console.log(`Built ${id} for the official host; ${Object.keys(client.metafile.inputs).length} browser inputs.`)
