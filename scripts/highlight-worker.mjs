import path from 'node:path'

/** Bundle the one classic highlighter worker as a string carried by the normal package chunk transport. */
export function highlightWorkerPlugin(build, workerPlugins = []) {
  const workers = new Map()
  return {
    name: 'modern-highlight-worker',
    setup(builder) {
      builder.onResolve({ filter: /\?worker-source$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -14)), namespace: 'worker-source' }))
      builder.onLoad({ filter: /.*/, namespace: 'worker-source' }, async args => {
        const result = await build({
          absWorkingDir: builder.initialOptions.absWorkingDir,
          entryPoints: [args.path],
          outfile: 'highlight.worker.js',
          bundle: true,
          write: false,
          platform: 'browser',
          format: 'iife',
          target: 'es2022',
          minify: true,
          charset: 'utf8',
          conditions: ['production'],
          define: { 'process.env.NODE_ENV': '"production"' },
          legalComments: 'inline',
          metafile: true,
          plugins: workerPlugins,
        })
        workers.set(args.path, result.metafile)
        return { contents: `export default ${JSON.stringify(result.outputFiles[0].text)}`, loader: 'js' }
      })
      builder.onEnd(result => {
        if (result.metafile === undefined) return
        for (const [file, worker] of workers) {
          const virtual = Object.keys(result.metafile.inputs).find(
            input => input.startsWith('worker-source:') && path.resolve(builder.initialOptions.absWorkingDir ?? process.cwd(), input.slice(14)) === file,
          )
          const inputs = Object.values(worker.outputs)[0].inputs
          const total = Object.values(inputs).reduce((sum, input) => sum + input.bytesInOutput, 0)
          Object.assign(result.metafile.inputs, worker.inputs)
          for (const output of Object.values(result.metafile.outputs)) {
            const embedded = output.inputs[virtual]
            if (embedded === undefined) continue
            delete output.inputs[virtual]
            let remaining = embedded.bytesInOutput
            const entries = Object.entries(inputs)
            for (const [index, [input, contribution]] of entries.entries()) {
              const bytes = index === entries.length - 1 ? remaining : Math.floor((embedded.bytesInOutput * contribution.bytesInOutput) / total)
              output.inputs[input] = { bytesInOutput: (output.inputs[input]?.bytesInOutput ?? 0) + bytes }
              remaining -= bytes
            }
          }
        }
      })
    },
  }
}
