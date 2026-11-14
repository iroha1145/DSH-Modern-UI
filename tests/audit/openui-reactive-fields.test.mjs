import { test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { officialModalLayerPlugin } from './helpers/official-modal-layer.mjs'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { countEach } from '../../scripts/openui-each-counter.mjs'

const repo = path.resolve(import.meta.dirname, '../..')

test('reactive scalar controls do not coerce structured store values after Set', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'modern-reactive-fields-'))
  try {
    const outfile = path.join(directory, 'probe.cjs')
    await build({
      stdin: {
        resolveDir: repo,
        loader: 'tsx',
        contents: `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Renderer,createLibrary,createParser,defineComponent,reactive} from '@openuidev/react-lang';
import {z} from 'zod/v4';
import {Input,TextArea,Select,SegmentedControl,RadioGroup,Button,Timer,Checkbox,Slider} from './packages/modern-ui/src/vendor/openui/components/controls.tsx';
import {Col} from './packages/modern-ui/src/vendor/openui/components/layout.tsx';
import {FieldRegistry,FieldRegistryContext,useField} from './packages/modern-ui/src/vendor/openui/components/fields.ts';
import {Toggle} from './packages/modern-ui/src/vendor/openui/functions/lists.ts';
import {ExpansionBudget,budgeted} from './packages/modern-ui/src/vendor/intelligent/client/openui-budget.ts';
import {expansionEstimate,EXPANSION_LIMIT} from './packages/modern-ui/src/vendor/intelligent/client/openui-source.ts';
const require=createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
const dom=globalThis.__testDom;
const React=require('react');const {act}=React;const {createRoot}=require('react-dom/client');
const Multi=defineComponent({name:'MultiProbe',props:z.object({value:reactive(z.array(z.string()))}),component:({props,statementId})=>{const field=useField('Multi',statementId,props.value);return <output id="multi">{Array.isArray(field.value)?field.value.join('|'):'invalid'}</output>}});
const library=createLibrary({components:[Col,Input,TextArea,Select,SegmentedControl,RadioGroup,Button,Timer,Checkbox,Slider,Multi],functions:[Toggle],root:'Col'});
const tracked=new WeakSet();let coercions=0,reads=0,identityReads=0,lastState={};
globalThis.__fieldValue=(value,target)=>{if(target==='$x'&&Array.isArray(value)){reads++;if(value===lastState.$x)identityReads++;const stack=[value],seen=new Set();while(stack.length){const v=stack.pop();if(!Array.isArray(v)||seen.has(v))continue;if(seen.size>100)throw Error('probe node ceiling');seen.add(v);tracked.add(v);stack.push(...v);}}return value;};
const original=Array.prototype.toString;
Array.prototype.toString=function(){if(tracked.has(this)&&++coercions>50000)throw Error('probe conversion ceiling');return original.call(this);};
async function mount(code){
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),registry=new FieldRegistry(),budget=new ExpansionBudget(),proposals=[];let totalSteps=0,updates=0;
 const step=budget.step.bind(budget);budget.step=(n=1)=>{totalSteps+=n;return step(n)};
 const parsed=createParser(library.toJSONSchema(),library.root).parse(code);
 await act(async()=>root.render(<FieldRegistryContext.Provider value={registry}><Renderer library={budgeted(library,budget)} response={code} isStreaming={false} onAction={event=>proposals.push(registry.read(event.formName))} onStateUpdate={state=>{lastState=state;updates++;if(expansionEstimate(parsed.root,state)>EXPANSION_LIMIT)budget.exceed()}}/></FieldRegistryContext.Provider>));
 const click=async label=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 return {host,registry,budget,proposals,click,stats:()=>({totalSteps,updates}),close:()=>act(async()=>root.unmount())};
}
async function run(){
 const results=[];
 for(const [name,control,selector] of [['Input','Input($x,"Value")','input'],['TextArea','TextArea($x,"Value")','textarea'],['Select','Select($x,["start","12.5"],"Value")','[role=combobox]'],['SegmentedControl','SegmentedControl($x,["start","12.5"],false,"Value")',null],['RadioGroup','RadioGroup($x,["start","12.5"],"Value")',null],['Timer','Timer($x,"Value")',null]]){
  lastState={};const view=await mount('$data = 0\\n$x = "start"\\nroot = Col(['+control+',Button("Grow",@Set($data,[$data,$data])),Button("Bind",@Set($x,$data)),Button("Reset",@Set($x,12.5))])');
  for(let n=0;n<12;n++)await view.click('Grow');
  assert.equal(lastState.$data[0],lastState.$data[1]);
  const before=coercions,beforeReads=reads;await view.click('Bind');
  results.push({name,coercions:coercions-before,reads:reads-beforeReads,exceeded:view.budget.exceeded(),shown:selector?view.host.querySelector(selector).value.length:null,...view.stats()});
  assert.equal(coercions-before,0,name);assert.equal(view.budget.exceeded(),false,name);
  assert.equal(lastState.$x,lastState.$data,'display validation must not overwrite shared collection state');
  if(selector)assert.equal(view.host.querySelector(selector).value,'',name);
  if(name!=='Timer')assert.equal(view.registry.read(undefined).find(([label])=>label==='Value')[1],'',name);
  await view.click('Reset');
  if(selector)assert.equal(view.host.querySelector(selector).value,'12.5',name);
  if(name!=='Timer')assert.equal(view.registry.read(undefined).find(([label])=>label==='Value')[1],12.5,name);
  await view.close();
 }
 assert.ok(identityReads>0,'resolveStateField returned the same shared array written to the store');
 {
  const view=await mount('$selected = ["A"]\\n$checked = true\\n$n = 5\\nroot = Col([MultiProbe($selected),Checkbox($checked,"Check"),Slider($n,0,10,1,"N"),Input($n,"Numeric","number"),TextArea($n,"Area"),Button("Toggle",@Set($selected,@Toggle($selected,"B")))])');
  await view.click('Toggle');assert.equal(view.host.querySelector('#multi').textContent,'A|B');
  const fields=view.registry.read(undefined);assert.deepEqual(fields.find(([name])=>name==='Multi')[1],['A','B']);assert.equal(fields.find(([name])=>name==='Check')[1],true);assert.equal(fields.find(([name])=>name==='N')[1],5);assert.equal(fields.find(([name])=>name==='Numeric')[1],5);
  const input=view.host.querySelector('input[inputmode="decimal"]');await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'7');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  assert.equal(view.host.querySelector('input[type="range"]').value,'7');assert.equal(view.host.querySelector('textarea').value,'7');
  await view.close();
 }
 {
  const view=await mount('$x = "start"\\nroot = Col([Input($x,"Value"),Button("Hidden",Action([@Set($x,{value:"hidden"}),@ToAssistant("go")])),Button("Number",Action([@Set($x,42),@ToAssistant("go")])),Button("Text",Action([@Set($x,"done"),@ToAssistant("go")]))])');
  await view.click('Hidden');assert.equal(view.host.querySelector('input').value,'');assert.equal(lastState.$x.value,'hidden');assert.deepEqual(view.proposals[0],[['Value','']]);
  await view.click('Number');assert.equal(view.host.querySelector('input').value,'42');assert.deepEqual(view.proposals[1],[['Value',42]]);
  await view.click('Text');assert.equal(view.host.querySelector('input').value,'done');assert.deepEqual(view.proposals[2],[['Value','done']]);await view.close();
 }
 console.log(JSON.stringify({results,identityReads}));
}
run().finally(()=>{Array.prototype.toString=original;dom.window.close();}).catch(error=>{console.error(error);process.exitCode=1;});
`,
      },
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      logLevel: 'silent',
      // React DOM must detect the DOM before fields.ts imports flushSync; the icon is the only UI stub below.
      banner: {
        js: `const __testRequire=require('node:module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
const __testDom=new (__testRequire('jsdom').JSDOM)('<!doctype html><body></body>',{url:'http://localhost/',pretendToBeVisual:true});
globalThis.__testDom=__testDom;
for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MutationObserver'])Object.defineProperty(globalThis,key,{configurable:true,value:__testDom.window[key]});
globalThis.getComputedStyle=__testDom.window.getComputedStyle.bind(__testDom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};`,
      },
      plugins: [
        officialModalLayerPlugin(),
        {
          name: 'real-field-runtime',
          setup(builder) {
            builder.onLoad({ filter: /[\\/]@openuidev[\\/]lang-core[\\/]dist[\\/]index\.mjs$/ }, async args => ({
              contents: countEach(await readFile(args.path, 'utf8')).replace(
                'value: store.get(target),',
                'value: globalThis.__fieldValue(store.get(target), target),',
              ),
              loader: 'js',
            }))
            builder.onResolve({ filter: /^\.\/glyph$/ }, () => ({ path: 'glyph', namespace: 'test-icon' }))
            builder.onLoad({ filter: /.*/, namespace: 'test-icon' }, () => ({ contents: 'export const Glyph=()=>null', loader: 'js' }))
            builder.onResolve({ filter: /^[^./]/ }, args =>
              args.path.startsWith('@openuidev/') || args.path === '@deepseek-ai/dsh-client-ui-primitives' ? undefined : { path: args.path, external: true },
            )
          },
        },
      ],
    })
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', outfile], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 10_000,
      env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules') },
    })
    assert.equal(child.error, undefined, child.error?.message)
    assert.equal(child.status, 0, child.stderr)
    console.info('Reactive field conversion:', child.stdout.trim())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
