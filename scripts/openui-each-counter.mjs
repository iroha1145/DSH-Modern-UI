// Build-time patch of @openuidev/lang-core: its lazy @Each evaluation calls a counter the plugin installs, so a
// block's step budget also covers loops whose list and body never reach plugin code. Only the bundled copy
// changes; node_modules stays as installed.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const LANG_CORE_VERSION = '1.0.2'
// The one place lang-core expands a template per list item; @Each is its only lazy list builtin.
const EACH = `function evaluateLazyBuiltin(name, args, context, schemaCtx) {
\tif (name === "Each") {
\t\tif (args.length < 3) return [];
\t\tconst arr = evaluate(args[0], context);
\t\tif (!Array.isArray(arr)) return [];
`
const SETTER = '__dshSetEachCounter'

/**
 * Insert the @Each counter into lang-core's ESM build and export its setter.
 * @param {string} source - dist/index.mjs of @openuidev/lang-core.
 * @returns {string} The patched module.
 * @throws When the expected @Each evaluation is missing or ambiguous, so a changed lang-core fails the build.
 */
export function countEach(source) {
  const at = source.indexOf(EACH)
  if (at < 0 || source.indexOf(EACH, at + 1) >= 0 || source.includes(SETTER))
    throw new Error(
      `@openuidev/lang-core no longer matches the ${LANG_CORE_VERSION} @Each evaluation that scripts/openui-each-counter.mjs counts; ` +
        'review the new evaluator and update the patch before building, or blocks lose their loop budget.',
    )
  const end = at + EACH.length
  // The counter may throw: lang-core then abandons this loop and every loop around it, up to its own catch.
  return `${source.slice(0, end)}\t\t__dshEachCounter?.(arr.length, context);\n${source.slice(end)}
let __dshEachCounter = null;
/** Added by DSH Modern UI: the counter receives each @Each list length and the evaluation context. */
export function ${SETTER}(counter) {
\t__dshEachCounter = counter;
}
`
}

/**
 * The esbuild plugin that serves lang-core's ESM build patched. Bundling its CommonJS build or another version
 * fails instead of shipping an uncounted @Each.
 * @returns {import('esbuild').Plugin}
 */
export function eachCounterPlugin() {
  return {
    name: 'openui-each-counter',
    setup(builder) {
      builder.onLoad({ filter: /[\\/]@openuidev[\\/]lang-core[\\/]dist[\\/]index\.[cm]?js$/ }, async args => {
        const { version } = JSON.parse(await readFile(path.join(path.dirname(args.path), '../package.json'), 'utf8'))
        if (version !== LANG_CORE_VERSION || !args.path.endsWith('.mjs'))
          throw new Error(`Only the ESM build of @openuidev/lang-core ${LANG_CORE_VERSION} is patched; got ${version} at ${args.path}`)
        return { contents: countEach(await readFile(args.path, 'utf8')), loader: 'js' }
      })
    },
  }
}
