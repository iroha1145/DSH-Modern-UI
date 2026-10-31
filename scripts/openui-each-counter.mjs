// Build-time patch of @openuidev/lang-core: the evaluator asks counters the plugin installs before it expands a
// loop, builds a list or object, or hands back what a loop pass produced, so a block's step budget also covers
// work that never reaches plugin code. Only the bundled copy changes; node_modules stays as installed.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const LANG_CORE_VERSION = '1.0.2'
// Each edit: the exact 1.0.2 source and its counted replacement. A counter answering false refuses the work, and the
// evaluator returns an empty value instead of throwing, so an over-budget @Set in a click handler cannot reject.
export const EDITS = [
  {
    // @Each, lang-core's only lazy list builtin: refuse the loop up front, then stop each pass once over budget.
    find: `\t\tconst arr = evaluate(args[0], context);
\t\tif (!Array.isArray(arr)) return [];
\t\tconst varName = args[1].k === "Ref" ? args[1].n : args[1].k === "Str" ? args[1].v : null;
\t\tif (!varName) return [];
\t\tconst template = args[2];
\t\treturn arr.map((item, _idx) => {
`,
    replace: `\t\tconst arr = evaluate(args[0], context);
\t\tif (!Array.isArray(arr)) return [];
\t\tif (__dshCounters?.each(arr.length, context) === false) return [];
\t\tconst varName = args[1].k === "Ref" ? args[1].n : args[1].k === "Str" ? args[1].v : null;
\t\tif (!varName) return [];
\t\tconst template = args[2];
\t\treturn arr.map((item, _idx) => {
\t\t\tif (__dshCounters?.each(0, context) === false) return null;
`,
  },
  {
    // What one pass produced, which the loop multiplies: raw text, lists, and the data inside components.
    find: `\t\t\tconst result = evaluate(substituted, childCtx, schemaCtx);
\t\t\tif (schemaCtx && isElementNode(result)) return evaluateElementInline(result, childCtx, schemaCtx);
\t\t\treturn result;
`,
    replace: `\t\t\tconst evaluated = evaluate(substituted, childCtx, schemaCtx);
\t\t\tconst result = schemaCtx && isElementNode(evaluated) ? evaluateElementInline(evaluated, childCtx, schemaCtx) : evaluated;
\t\t\treturn __dshCounters?.result(result, context) === false ? null : result;
`,
  },
  {
    find: '\t\tcase "Arr": return node.els.map((el) => evaluate(el, context));\n',
    replace: '\t\tcase "Arr": return __dshCounters?.built(node.els.length, context) === false ? [] : node.els.map((el) => evaluate(el, context));\n',
  },
  {
    find: '\t\tcase "Obj": return Object.fromEntries(node.entries.map(([k, v]) => [k, evaluate(v, context)]));\n',
    replace:
      '\t\tcase "Obj": return __dshCounters?.built(node.entries.length, context) === false ? {} : Object.fromEntries(node.entries.map(([k, v]) => [k, evaluate(v, context)]));\n',
  },
  {
    // A field read across a list builds a list as long.
    find: '\t\t\t\treturn obj.map((item) => item?.[node.field] ?? null);\n',
    replace: '\t\t\t\tif (__dshCounters?.built(obj.length, context) === false) return [];\n\t\t\t\treturn obj.map((item) => item?.[node.field] ?? null);\n',
  },
  {
    // @Sort, @Filter and the other built-in functions walk their list arguments.
    find: '\t\t\t\treturn builtin.fn(evaluateArgs(node, context));\n',
    replace: `\t\t\t\tconst builtinArgs = evaluateArgs(node, context);
\t\t\t\tif (__dshCounters?.built(__dshListItems(builtinArgs), context) === false) return null;
\t\t\t\treturn builtin.fn(builtinArgs);
`,
  },
]
const SETTER = '__dshSetCounters'

/**
 * Insert the counters into lang-core's ESM build and export their setter.
 * @param {string} source - dist/index.mjs of @openuidev/lang-core.
 * @returns {string} The patched module.
 * @throws When any expected source is missing or ambiguous, so a changed lang-core fails the build.
 */
export function countEach(source) {
  if (source.includes(SETTER)) throw changed('the module is already patched')
  let patched = source
  for (const { find, replace } of EDITS) {
    const at = patched.indexOf(find)
    if (at < 0 || patched.indexOf(find, at + 1) >= 0) throw changed(`expected exactly one ${JSON.stringify(find.trim().split('\n')[0])}`)
    patched = patched.slice(0, at) + replace + patched.slice(at + find.length)
  }
  return `${patched}
let __dshCounters = null;
function __dshListItems(args) {
\tlet items = 0;
\tfor (const key in args) if (Array.isArray(args[key])) items += args[key].length;
\treturn items;
}
/** Added by DSH Modern UI: each(items, context), built(items, context) and result(value, context) answer false to refuse. */
export function ${SETTER}(counters) {
\t__dshCounters = counters;
}
`
}

function changed(detail) {
  return new Error(
    `@openuidev/lang-core no longer matches the ${LANG_CORE_VERSION} evaluator that scripts/openui-each-counter.mjs counts (${detail}); ` +
      'review the new evaluator and update the patch before building, or blocks lose their expansion budget.',
  )
}

/**
 * The esbuild plugin that serves lang-core's ESM build patched. Bundling its CommonJS build or another version
 * fails instead of shipping an uncounted evaluator.
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
