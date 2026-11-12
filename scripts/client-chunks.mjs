import { readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

/** Adapt esbuild's split graph to the official synchronous factories and require.async transport. */
export async function emitClientChunks(root, id, result, transform) {
  const outputs = new Map(Object.entries(result.metafile.outputs).map(([name, value]) => [path.resolve(root, name), { name, ...value }]))
  const files = new Map(result.outputFiles.map(file => [file.path, file.text]))
  const entry = [...outputs].find(([, value]) => value.entryPoint !== undefined && /(?:^|\/)src\/client\.tsx$/.test(value.entryPoint))?.[0]
  if (entry === undefined) throw new Error('Client split build has no client.tsx entry')
  const dependencies = file =>
    outputs
      .get(file)
      .imports.filter(imported => imported.kind === 'import-statement' && !imported.external)
      .map(imported => path.resolve(root, imported.path))
  const closure = file => {
    const visited = new Set(),
      visiting = new Set(),
      ordered = []
    const visit = current => {
      if (visited.has(current)) return
      if (visiting.has(current)) throw new Error(`Client chunks have a synchronous require cycle at ${current}`)
      visiting.add(current)
      for (const dependency of dependencies(current)) visit(dependency)
      visiting.delete(current)
      visited.add(current)
      ordered.push(current)
    }
    visit(file)
    return ordered
  }
  const initial = closure(entry)
  const initialSet = new Set(initial)
  const moduleId = file => (file === entry ? id : `${id}/${path.basename(file)}`)
  const registrations = new Map()
  for (const [file, text] of files) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
    const edits = []
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier
        if (specifier.text.startsWith('./')) {
          const target = path.resolve(path.dirname(file), specifier.text)
          edits.push({ start: specifier.getStart(source), end: specifier.end, text: JSON.stringify(moduleId(target)) })
        }
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [specifier] = node.arguments
        if (!ts.isStringLiteral(specifier)) throw new Error(`Nonliteral import in emitted client chunk ${file}`)
        const target = path.resolve(path.dirname(file), specifier.text)
        const required = closure(target).filter(dependency => !initialSet.has(dependency) || dependency === target)
        const load = initialSet.has(file) ? 'importChunk' : 'require.async'
        const calls = required.map(dependency => `${load}(${JSON.stringify(`./${path.basename(dependency)}`)})`)
        edits.push({ start: node.getStart(source), end: node.end, text: calls.slice(1).reduce((value, call) => `${value}.then(()=>${call})`, calls[0]) })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    let rewritten = text
    for (const edit of edits.sort((left, right) => right.start - left.start)) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end)
    const compiled = await transform(rewritten, { format: 'cjs', target: 'es2022', minify: true, charset: 'utf8', legalComments: 'inline' })
    const chunk = file === entry ? '' : `,chunk:${JSON.stringify(path.basename(file))}`
    const bindImport = file === entry ? 'importChunk=require.async;' : ''
    registrations.set(
      file,
      `window.__ModuleLoader__.load({id:${JSON.stringify(id)}${chunk},factory:(require)=>{${bindImport}const module={exports:{}};const exports=module.exports;${compiled.code}return module.exports;}});\n`,
    )
  }
  const finalOutputs = {}
  const emitted = [...outputs].sort(([left], [right]) => Number(left === entry) - Number(right === entry))
  for (const [file, output] of emitted) {
    if (initialSet.has(file) && file !== entry) continue
    const included = file === entry ? initial : [file]
    const factories = included.map(dependency => registrations.get(dependency)).join('')
    // Synchronous shared factories inherit a chunk id from the Host; relative async requests belong to the package entry.
    const code = file === entry ? `{let importChunk;${factories}}\n` : factories
    await writeFile(file, code)
    const inputs = {},
      imports = []
    for (const dependency of included) {
      for (const [input, contribution] of Object.entries(outputs.get(dependency).inputs)) {
        inputs[input] = { bytesInOutput: (inputs[input]?.bytesInOutput ?? 0) + contribution.bytesInOutput }
      }
      for (const imported of outputs.get(dependency).imports) {
        if (!imported.external && initialSet.has(path.resolve(root, imported.path))) continue
        imports.push(imported)
      }
    }
    finalOutputs[output.name] = { ...output, bytes: Buffer.byteLength(code), inputs, imports }
  }
  const retained = new Set(Object.keys(finalOutputs).map(filename => path.basename(filename)))
  for (const filename of await readdir(path.dirname(entry))) {
    if (/^client\.[\w.-]+-[A-Z0-9]{8}\.js$/.test(filename) && !retained.has(filename)) await unlink(path.join(path.dirname(entry), filename))
  }
  return { ...result.metafile, outputs: finalOutputs }
}
