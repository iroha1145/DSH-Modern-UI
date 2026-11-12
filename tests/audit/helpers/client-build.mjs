import { build as esbuild } from 'esbuild'
import { highlightWorkerPlugin } from '../../../scripts/highlight-worker.mjs'

/** Client fixtures use the production worker-source transform, including real worker code and dependencies. */
export function build(options) {
  return esbuild({ ...options, plugins: [highlightWorkerPlugin(esbuild), ...(options.plugins ?? [])] })
}
