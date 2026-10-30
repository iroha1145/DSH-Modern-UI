import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')

/** Emit only the public text interaction contract and the registry types it references. */
export function buildQuotesTypes(outDir = path.join(root, 'packages/modern-ui/lib/types')) {
  const configPath = path.join(root, 'tsconfig.quotes.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, { outDir }, configPath)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  const emit = diagnostics.length ? undefined : program.emit()
  if (emit) diagnostics.push(...emit.diagnostics)
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: name => name,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    )
}
