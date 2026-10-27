import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')
const { build } = require('esbuild')
const configPath = path.join(root, 'tsconfig.host-build.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {}, configPath)
const host = ts.createCompilerHost(parsed.options)
host.getCurrentDirectory = () => root
const program = ts.createProgram(parsed.fileNames, parsed.options, host)
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
}))
const emitted = program.emit()
if (emitted.emitSkipped || emitted.diagnostics.length) throw new Error('Host TypeScript emission failed')
// TypeScript emission is required: published Cordis has const enums with no JS export.
const result = await build({
  absWorkingDir: root,
  entryPoints: {
    translator: path.join(root, '.artifacts/host-build/translator/index.js'),
    'mcp-client': path.join(root, '.artifacts/host-build/mcp-client/index.js'),
    migration: path.join(root, 'scripts/migration/preflight.mjs'),
  },
  outdir: path.join(root, 'packages/modern-ui/lib'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['@deepseek-ai/*', '@modelcontextprotocol/*'], metafile: true,
})
await writeFile(path.join(root, 'packages/modern-ui/lib/host-build-inputs.json'), JSON.stringify({
  officialHost: '0.2.1-rc.4', typescript: ts.version,
  inputs: Object.keys(result.metafile.inputs).map(name => name.replaceAll('\\', '/')),
  outputs: Object.fromEntries(Object.entries(result.metafile.outputs).map(([name, output]) => [path.basename(name),
    { bytes: output.bytes, imports: output.imports }])),
}, null, 2) + '\n')
