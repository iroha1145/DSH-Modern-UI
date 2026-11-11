// Build-time patch of @openuidev/lang-core: the evaluator asks counters the plugin installs before it expands a
// loop, builds a list, object or text, hands back what a loop pass produced, or hands out a component's props,
// and the parser reports every node it builds, so a block's budget also covers work that never reaches plugin
// code. Only the bundled copy changes; node_modules stays as installed.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const LANG_CORE_VERSION = '1.0.2'
// Each edit: the exact 1.0.2 source and its counted replacement. A counter answering false refuses the work, and the
// evaluator returns an empty value instead of throwing, so an over-budget @Set in a click handler cannot reject.
export const EDITS = [
  {
    // Visitors collect sets/flags or name a call's args once. Naming introduces aliases between args and
    // mappedProps, so walking both paths again turns a short chain of Query/Mutation calls exponential.
    // Keep the original preorder and read children after visit (which may add mappedProps), but visit each
    // object once. This walk has its own parse ceiling because classification happens before a parse ctx exists.
    find: 'function walkAST(node, visit) {\n\tconst walk = (current) => {\n\t\tvisit(current);\n',
    replace:
      'function walkAST(node, visit) {\n\tconst seen = new WeakSet();\n\tlet nodes = 0;\n\tconst walk = (current) => {\n\t\tif (seen.has(current)) return;\n\t\tif (current && typeof current === "object") seen.add(current);\n\t\t__dshCounters?.parsed(++nodes);\n\t\tvisit(current);\n',
  },
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
  {
    // Joining text: a chain of s = s + s doubles its length at every step.
    find: '\t\t\t\t\tif (typeof left === "string" || typeof right === "string") return String(left ?? "") + String(right ?? "");\n',
    replace: `\t\t\t\t\tif (typeof left === "string" || typeof right === "string") {
\t\t\t\t\t\tif (__dshCounters?.cloned([left, right], context) === false) return "";
\t\t\t\t\t\tconst texts = [String(left ?? ""), String(right ?? "")];
\t\t\t\t\t\treturn __dshCounters?.text(texts[0].length + texts[1].length, context) === false ? "" : texts[0] + texts[1];
\t\t\t\t\t}
`,
  },
  {
    // A component the parser fixed entirely is returned as is, and so are the components inside it.
    find: 'function evaluateElementProps(el, evalCtx) {\n\tif (el.hasDynamicProps === false) return el;\n',
    replace:
      'function evaluateElementProps(el, evalCtx) {\n\tif (el.hasDynamicProps === false) return __dshCounters?.drawn(el.props, evalCtx.ctx, true) === false ? null : el;\n',
  },
  {
    // A component's resolved props, which it draws (table rows, chart points, raw text); components among them are
    // resolved, and charged, on their own.
    find: '\treturn {\n\t\t...el,\n\t\tprops: evaluated\n\t};\n}\n/** Evaluate `root`',
    replace:
      '\tif (__dshCounters?.drawn(evaluated, evalCtx.ctx, false) === false) return null;\n\treturn {\n\t\t...el,\n\t\tprops: evaluated\n\t};\n}\n/** Evaluate `root`',
  },
  {
    // Every node the parser builds, with a reference inlined at each use: a few short statements can nest millions.
    find: 'function materializeExprInternal(node, ctx, scopedRefs) {\n',
    replace: 'function materializeExprInternal(node, ctx, scopedRefs) {\n\t__dshCounters?.parsed(ctx.dshNodes = (ctx.dshNodes ?? 0) + 1);\n',
  },
  {
    find: 'function materializeValue(node, ctx) {\n',
    replace: 'function materializeValue(node, ctx) {\n\t__dshCounters?.parsed(ctx.dshNodes = (ctx.dshNodes ?? 0) + 1);\n',
  },
]
// Guard recursive cloning before allocating, including literal capture in deferred @Each actions.
EDITS.push(
  {
    find: `function toLiteralAST(value) {
	if (value === null || value === void 0) return { k: "Null" };
	if (typeof value === "string") return {
		k: "Str",
		v: value
	};
	if (typeof value === "number") return {
		k: "Num",
		v: value
	};
	if (typeof value === "boolean") return {
		k: "Bool",
		v: value
	};
	if (Array.isArray(value)) return {
		k: "Arr",
		els: value.map(toLiteralAST)
	};
	if (typeof value === "object") return {
		k: "Obj",
		entries: Object.entries(value).map(([k, v]) => [k, toLiteralAST(v)])
	};
	return { k: "Null" };
}
`,
    replace: `function toLiteralAST(value, context) {
	if (context && __dshCounters?.cloned(value, context) === false) return { k: "Null" };
	return toLiteralASTUnchecked(value);
}
function toLiteralASTUnchecked(value) {
	if (value === null || value === void 0) return { k: "Null" };
	if (typeof value === "string") return {
		k: "Str",
		v: value
	};
	if (typeof value === "number") return {
		k: "Num",
		v: value
	};
	if (typeof value === "boolean") return {
		k: "Bool",
		v: value
	};
	if (Array.isArray(value)) return {
		k: "Arr",
		els: value.map(toLiteralASTUnchecked)
	};
	if (typeof value === "object") return {
		k: "Obj",
		entries: Object.entries(value).map(([k, v]) => [k, toLiteralASTUnchecked(v)])
	};
	return { k: "Null" };
}
`,
  },
  {
    find: `function substituteRef(node, varName, value) {
	switch (node.k) {
		case "Ref": return node.n === varName ? toLiteralAST(value) : node;
		case "Member":
			if (isASTNode(node.obj)) {
				const subObj = substituteRef(node.obj, varName, value);
				if (subObj.k === "Obj") {
					const entry = subObj.entries.find(([k]) => k === node.field);
					if (entry) return entry[1];
				}
				return {
					...node,
					obj: subObj
				};
			}
			return node;
		case "Index": return {
			...node,
			obj: isASTNode(node.obj) ? substituteRef(node.obj, varName, value) : node.obj,
			index: isASTNode(node.index) ? substituteRef(node.index, varName, value) : node.index
		};
		case "BinOp": return {
			...node,
			left: substituteRef(node.left, varName, value),
			right: substituteRef(node.right, varName, value)
		};
		case "UnaryOp": return {
			...node,
			operand: substituteRef(node.operand, varName, value)
		};
		case "Ternary": return {
			...node,
			cond: substituteRef(node.cond, varName, value),
			then: substituteRef(node.then, varName, value),
			else: substituteRef(node.else, varName, value)
		};
		case "Arr": return {
			...node,
			els: node.els.map((e) => substituteRef(e, varName, value))
		};
		case "Obj": return {
			...node,
			entries: node.entries.map(([k, v]) => [k, substituteRef(v, varName, value)])
		};
		case "Comp": {
			const sub = (a) => substituteRef(a, varName, value);
			const result = {
				...node,
				args: node.args.map(sub)
			};
			if (node.mappedProps) result.mappedProps = mapValues(node.mappedProps, sub);
			return result;
		}
		case "Assign": return {
			...node,
			value: substituteRef(node.value, varName, value)
		};
		default: return node;
	}
}
`,
    replace: `function substituteRef(node, varName, value, context) {
	if (__dshCounters?.cloned(node, context) === false) return { k: "Null" };
	function substitute(node) {
		switch (node.k) {
			case "Ref": return node.n === varName ? toLiteralAST(value, context) : node;
			case "Member":
				if (isASTNode(node.obj)) {
					const subObj = substitute(node.obj);
					if (subObj.k === "Obj") {
						const entry = subObj.entries.find(([k]) => k === node.field);
						if (entry) return entry[1];
					}
					return {
						...node,
						obj: subObj
					};
				}
				return node;
			case "Index": return {
				...node,
				obj: isASTNode(node.obj) ? substitute(node.obj) : node.obj,
				index: isASTNode(node.index) ? substitute(node.index) : node.index
			};
			case "BinOp": return {
				...node,
				left: substitute(node.left),
				right: substitute(node.right)
			};
			case "UnaryOp": return {
				...node,
				operand: substitute(node.operand)
			};
			case "Ternary": return {
				...node,
				cond: substitute(node.cond),
				then: substitute(node.then),
				else: substitute(node.else)
			};
			case "Arr": return {
				...node,
				els: node.els.map((e) => substitute(e))
			};
			case "Obj": return {
				...node,
				entries: node.entries.map(([k, v]) => [k, substitute(v)])
			};
			case "Comp": {
				const sub = (a) => substitute(a);
				const result = {
					...node,
					args: node.args.map(sub)
				};
				if (node.mappedProps) result.mappedProps = mapValues(node.mappedProps, sub);
				return result;
			}
			case "Assign": return {
				...node,
				value: substitute(node.value)
			};
			default: return node;
		}
	}
	return substitute(node);
}
`,
  },
  { find: `const substituted = substituteRef(template, varName, item);`, replace: `const substituted = substituteRef(template, varName, item, context);` },
  {
    find: `function evaluatePropValue$1(value, context, schemaCtx, reactiveSchema, callbacks) {
`,
    replace: `function evaluatePropValue$1(value, context, schemaCtx, reactiveSchema, callbacks) {
	if (__dshCounters?.built(1 + (Array.isArray(value) ? value.length : 0), context) === false) return null;
`,
  },
  {
    find: `	const schemaCtx = { library: evalCtx.library };
	const def = evalCtx.library.components[el.typeName];`,
    replace: `	if (__dshCounters?.cloned(el.props, evalCtx.ctx) === false) return null;
	const schemaCtx = { library: evalCtx.library };
	const def = evalCtx.library.components[el.typeName];`,
  },
  {
    find: `function evaluateElementInline(el, context, schemaCtx) {
`,
    replace: `function evaluateElementInline(el, context, schemaCtx) {
	if (__dshCounters?.cloned(el.props, context) === false) return null;
`,
  },
)
// Validation and implicit coercion can also walk nested runtime data.
EDITS.push(
  {
    find: `function checkValue(value, schema, name, path, context, strict = false) {
`,
    replace: `function checkValue(value, schema, name, path, context, strict = false) {
	if (__dshCounters?.cloned(value, context) === false) return INVALID;
`,
  },
  {
    find: `	for (const key in named) args[key] = evaluate(named[key], context);
	return args;`,
    replace: `	for (const key in named) args[key] = evaluate(named[key], context);
	return __dshCounters?.cloned(args, context) === false ? {} : args;`,
  },
  {
    find: `			const right = evaluate(node.right, context);
			switch (node.op)`,
    replace: `			const right = evaluate(node.right, context);
			if (__dshCounters?.cloned([left, right], context) === false) return null;
			switch (node.op)`,
  },
  {
    find: `			return obj[String(idx)];`,
    replace: `			if (__dshCounters?.cloned(idx, context) === false) return null;
			return obj[String(idx)];`,
  },
)
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
/** Added by DSH Modern UI: each, built, text, result and drawn answer false to refuse; parsed(nodes) throws to stop a parse. */
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
