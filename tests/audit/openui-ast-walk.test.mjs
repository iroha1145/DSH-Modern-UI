import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { countEach, EDITS } from '../../scripts/openui-each-counter.mjs'

const repo = path.resolve(import.meta.dirname, '../..')

test('AST aliases stay linear without losing query dependencies, argument naming or reference collection', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-walk-'))
  try {
    const results = {}
    for (const variant of ['before', 'after']) {
      const outfile = path.join(directory, `${variant}.cjs`)
      await build({
        stdin: {
          resolveDir: repo,
          loader: 'ts',
          contents: `
import assert from 'node:assert/strict';
import {createParser,createLibrary,defineComponent,walkAST,evaluate,mergeStatements,__dshSetCounters} from '@openuidev/lang-core';
import {z} from 'zod/v4';
import './packages/modern-ui/src/vendor/intelligent/client/openui-budget.ts';
const library=createLibrary({components:[defineComponent({name:'Text',props:z.object({text:z.string()}),component:()=>null})],root:'Text'});
const parser=createParser(library.toJSONSchema(),library.root);
const samples=[];
for(const depth of [4,8,12]){
  let expr='1';for(let n=0;n<depth;n++)expr='@Round('+expr+')';
  globalThis.walkVisits=0;globalThis.walkBudgetChecks=0;
  const code='root = Text("ok")\\nq = Query("fetch", {x:'+expr+'})\\nm = Mutation("save", {x:'+expr+'})';
  const parsed=parser.parse(code);
  assert.equal(parsed.root.typeName,'Text');
  const ctx={getState:()=>null,resolveRef:()=>null};
  assert.deepEqual(evaluate(parsed.queryStatements[0].argsAST,ctx),{x:1});
  assert.deepEqual(evaluate(parsed.mutationStatements[0].argsAST,ctx),{x:1});
  samples.push({depth,bytes:code.length,visits:globalThis.walkVisits,budgetChecks:globalThis.walkBudgetChecks});
}
globalThis.walkVisits=0;
const parsed=parser.parse('$n = 2.75\\nroot = Text("ok")\\nq = Query("fetch", {x:@Round($n), y:$other}, {cached: true}, 2500)\\nm = Mutation("save", {x:@Round($n)})');
assert.deepEqual(parsed.queryStatements[0].deps,['$n','$other']);
assert.equal(parsed.stateDeclarations.$other,null);
const ctx={getState:n=>n==='$n'?2.75:'present',resolveRef:()=>null};
assert.deepEqual(evaluate(parsed.queryStatements[0].argsAST,ctx),{x:3,y:'present'});
assert.deepEqual(evaluate(parsed.queryStatements[0].defaultsAST,ctx),{cached:true});
assert.equal(evaluate(parsed.queryStatements[0].refreshAST,ctx),2500);
assert.deepEqual(evaluate(parsed.mutationStatements[0].argsAST,ctx),{x:3});
assert.equal(parser.parse('$flag = true\\nroot = $flag ? Text("yes") : Text("no")').rootExpression.k,'Ternary');
const merged=mergeStatements('root = Text(label)\\nlabel = "before"\\norphan = "drop"','$n = 1\\nlabel = "after"');
assert.ok(merged.includes('label = "after"'));assert.ok(merged.includes('$n = 1'));assert.ok(!merged.includes('orphan'));
if(${JSON.stringify(variant)}==='after'){
  // A visitor may create distinct mapped nodes; they must be visited after the positional args.
  const leaf={k:'StateRef',n:'$shared'};
  const root={k:'Comp',name:'Probe',args:[leaf]};
  const names=[];
  walkAST(root,node=>{names.push(node.name??node.n);if(node===root)node.mappedProps={alias:leaf,extra:{k:'StateRef',n:'$extra'}}});
  assert.deepEqual(names,['Probe','$shared','$extra']);
  root.args.push(root);let cycleVisits=0;walkAST(root,()=>cycleVisits++);assert.equal(cycleVisits,3);
  // A small injected ceiling proves the production parse counter is called before visiting a node.
  __dshSetCounters({parsed:n=>{if(n>8)throw new Error('walk ceiling')}});
  let deep={k:'Num',v:1};for(let n=0;n<16;n++)deep={k:'UnaryOp',op:'!',operand:deep};
  let visited=0;assert.throws(()=>walkAST(deep,()=>visited++),/walk ceiling/);assert.equal(visited,8);
}
console.log(JSON.stringify(samples));
`,
        },
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'silent',
        plugins: [
          {
            name: 'bounded-walk-comparison',
            setup(builder) {
              builder.onLoad({ filter: /[\\/]@openuidev[\\/]lang-core[\\/]dist[\\/]index\.mjs$/ }, async args => {
                let source = countEach(await readFile(args.path, 'utf8'))
                const edit = EDITS.find(edit => edit.find.startsWith('function walkAST('))
                assert.ok(edit)
                if (variant === 'before') source = source.replace(edit.replace, edit.find)
                // Independent visit ceiling in addition to the child-process heap/time limits.
                source = source
                  .replace('visit(current);', 'if (++globalThis.walkVisits > 100000) throw Error("probe visit ceiling"); visit(current);')
                  .replace('__dshCounters?.parsed(++nodes);', 'globalThis.walkBudgetChecks++; __dshCounters?.parsed(++nodes);')
                return { contents: source, loader: 'js' }
              })
            },
          },
        ],
      })
      const child = spawnSync(process.execPath, ['--max-old-space-size=128', outfile], { encoding: 'utf8', timeout: 10_000, maxBuffer: 10_000 })
      assert.equal(child.error, undefined, child.error?.message)
      assert.equal(child.status, 0, child.stderr)
      results[variant] = JSON.parse(child.stdout)
    }
    assert.ok(results.before[2].visits > results.before[1].visits * 10)
    assert.ok(results.after[2].visits < results.after[1].visits * 2)
    for (const sample of results.after) assert.equal(sample.budgetChecks, sample.visits)
    console.info('OpenUI AST walk comparison:', JSON.stringify(results))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
