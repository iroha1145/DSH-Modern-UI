import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from './helpers/client-build.mjs'
import { countEach } from '../../scripts/openui-each-counter.mjs'

const repo = path.resolve(import.meta.dirname, '../..')

test('shared data is bounded before cloning, coercion and serialization in a disposable process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-recursion-'))
  try {
    const outfile = path.join(directory, 'probe.cjs')
    await build({
      stdin: {
        resolveDir: repo,
        loader: 'ts',
        contents: `
import assert from 'node:assert/strict';
import { toLiteralAST, substituteRef, evaluateElementProps, evaluate, createParser, createLibrary, defineComponent } from '@openuidev/lang-core';
import { z } from 'zod/v4';
import { budgeted, ExpansionBudget } from './packages/modern-ui/src/vendor/intelligent/client/openui-budget.ts';
import { assistantMessage } from './packages/modern-ui/src/vendor/intelligent/client/openui-source.ts';
import { same } from './packages/modern-ui/src/vendor/openui/functions/shared.ts';
const dag = (n, leaf) => { let value=leaf; for(let i=0;i<n;i++) value=[value,value]; return value; };
const budget = new ExpansionBudget();
const library = budgeted({components:{},functions:{Probe:{fn:()=>null}}}, budget);
const context = {functions:library.functions,getState:()=>null,resolveRef:()=>null};
const large = dag(35, [0]);
const started = performance.now();
assert.deepEqual(toLiteralAST(large, context), {k:'Null'});
assert.equal(budget.exceeded(), true);
assert.deepEqual(toLiteralAST({get value(){throw new Error('traversed after budget exhaustion')}},context),{k:'Null'});
budget.reset();
const small = dag(4, [1]);
const literal = toLiteralAST(small, context);
assert.deepEqual(evaluate(literal,context), small);
assert.equal(budget.exceeded(), false);
budget.reset();
assert.deepEqual(substituteRef({k:'Ref',n:'row'}, 'row', large, context), {k:'Null'});
assert.equal(budget.exceeded(), true);
budget.reset();
let template={k:'Ref',n:'row'};for(let i=0;i<22;i++)template={k:'Arr',els:[template,template]};
assert.deepEqual(substituteRef(template, 'row', 1, context), {k:'Null'});
assert.equal(budget.exceeded(), true);
budget.reset();
assert.equal(evaluateElementProps({type:'element',typeName:'Probe',props:{data:large},hasDynamicProps:true},{ctx:context,library}),null);
assert.equal(budget.exceeded(), true);
budget.reset();
const stateContext={...context,getState:()=>large};
assert.equal(evaluate({k:'BinOp',op:'+',left:{k:'Str',v:''},right:{k:'StateRef',n:'$x'}},stateContext),null);
assert.equal(budget.exceeded(),true);
budget.reset();
// Empty objects used to contribute no drawnSize steps, so walking this DAG could be exponential.
const empty=dag(35,{});
const result=evaluate({k:'Comp',name:'Each',args:[{k:'Arr',els:[{k:'Num',v:0}]},{k:'Str',v:'i'},{k:'StateRef',n:'$x'}]},{...context,getState:()=>empty});
assert.deepEqual(result,[null]);assert.equal(budget.exceeded(),true);
const message=assistantMessage({message:'Use',context:large});
assert.ok(message.length<=320);assert.ok(message.endsWith('…'));
assert.equal(assistantMessage({message:'Use',context:{first:[1,2],second:[1,2]}}),'Use\\n\\n- context: {"first":[1,2],"second":[1,2]}');
assert.equal(same(dag(35, {id:1}),dag(35,{id:'1'})),true);
assert.equal(same(dag(35, {id:1}),dag(35,{id:2})),false);
assert.equal(same([1,{n:'2'}],['1',{n:2}]),true);
assert.equal(same({a:1},{b:1}),false);
const cyclic={};cyclic.self=cyclic;assert.equal(same(cyclic,{self:cyclic}),true);
// Actual schema conversion is synchronous work; retain timing as evidence without a hardware-specific gate.
const sample=createLibrary({components:[defineComponent({name:'Text',props:z.object({text:z.string()}),component:()=>null})],root:'Text'});
const parseStart=performance.now();createParser(sample.toJSONSchema(),sample.root);
console.log(JSON.stringify({sharedDepth:35,elapsedMs:performance.now()-started,schemaMs:performance.now()-parseStart}));
`,
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      plugins: [
        {
          name: 'instrument-pinned-runtime',
          setup(builder) {
            builder.onLoad({ filter: /[\\/]@openuidev[\\/]lang-core[\\/]dist[\\/]index\.mjs$/ }, async args => ({
              contents: countEach(await readFile(args.path, 'utf8')) + '\nexport { toLiteralAST, substituteRef };',
              loader: 'js',
            }))
          },
        },
      ],
    })
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', outfile], { encoding: 'utf8', timeout: 15_000, maxBuffer: 10_000 })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).sharedDepth, 35)
    console.info('OpenUI bounded shared data:', result.stdout.trim())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
