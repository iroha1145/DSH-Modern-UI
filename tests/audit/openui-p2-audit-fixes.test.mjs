import { afterAll, describe, expect, test } from 'vitest'
import { build } from './helpers/client-build.mjs'
import { officialModalLayerPlugin } from './helpers/official-modal-layer.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Audit findings P2-04 .. P2-07: chart missing data, localized decimals, date bounds, select type-ahead.
// One jsdom probe runs every scenario; each scenario reports its own result so one failure does not hide the rest.
const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-p2-audit-'))
afterAll(() => rm(directory, { recursive: true, force: true }))

const outfile = path.join(directory, 'probe.cjs')
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import {createRequire} from 'node:module';
import {Renderer,createLibrary} from '@openuidev/react-lang';
import * as Controls from './packages/modern-ui/src/vendor/openui/components/controls.tsx';
const {Input,DatePicker,Button}=Controls;
import {Chart} from './packages/modern-ui/src/vendor/openui/components/chart.tsx';
import {Col} from './packages/modern-ui/src/vendor/openui/components/layout.tsx';
import {FieldRegistry,FieldRegistryContext} from './packages/modern-ui/src/vendor/openui/components/fields.ts';
import {UiLocaleContext} from './packages/modern-ui/src/vendor/openui/components/ui-text.ts';
import {OpenUiSelect} from './packages/modern-ui/src/openui-select.tsx';
const require=createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
const dom=globalThis.__testDom;
const React=require('react');const {act,useState}=React;const {createRoot}=require('react-dom/client');
const library=createLibrary({components:[Col,Input,DatePicker,Button,Chart],root:'Col'});
async function mount(code,locale='en-US'){
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),registry=new FieldRegistry(),proposals=[];
 await act(async()=>root.render(<UiLocaleContext.Provider value={locale}><FieldRegistryContext.Provider value={registry}><Renderer library={library} response={code} isStreaming={false} onAction={event=>proposals.push(registry.read(event.formName))}/></FieldRegistryContext.Provider></UiLocaleContext.Provider>));
 const click=async label=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label);if(!button)throw Error('no button '+label);await act(async()=>button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));};
 const type=async(input,text)=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,text);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 const value=label=>registry.read(undefined).find(([name])=>name===label)?.[1];
 return {host,root,click,type,value,proposals,close:()=>act(async()=>{root.unmount();host.remove()})};
}
const key=async(button,k,init={})=>act(async()=>{button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...init}))});
const results={};
async function scenario(name,fn){try{results[name]=await fn()}catch(error){results[name]={error:String(error&&error.stack||error)}}}

async function main(){
const chartData='[{month:"Jan",sales:12},{month:"Feb"},{month:"Mar",sales:18},{month:"Apr",sales:0}]';
const cells=host=>[...host.querySelectorAll('details tbody tr')].map(row=>[...row.children].map(c=>c.textContent));
await scenario('chart-line',async()=>{
 const view=await mount('root = Col([Chart("line",'+chartData+',"month",["sales"])])');
 const paths=[...view.host.querySelectorAll('svg path[stroke]')].map(p=>p.getAttribute('d'));
 const out={rows:cells(view.host),subpaths:paths.map(d=>(d.match(/M/g)||[]).length),dots:view.host.querySelectorAll('svg circle').length,ticks:[...view.host.querySelectorAll('.iui-chart-tick')].map(t=>t.textContent)};
 await view.close();return out;
});
await scenario('chart-area',async()=>{
 const view=await mount('root = Col([Chart("area",'+chartData+',"month",["sales"])])');
 const fills=[...view.host.querySelectorAll('svg path:not([stroke])')].map(p=>p.getAttribute('d')).filter(d=>d&&d.startsWith('M'));
 const out={fillSubpaths:fills.map(d=>(d.match(/M/g)||[]).length),rows:cells(view.host)};await view.close();return out;
});
await scenario('chart-bar',async()=>{
 const view=await mount('root = Col([Chart("bar",'+chartData+',"month",["sales"])])');
 const out={bars:[...view.host.querySelectorAll('svg path[fill^="var(--iui-chart"]')].length,rows:cells(view.host)};await view.close();return out;
});
await scenario('chart-pie',async()=>{
 const view=await mount('root = Col([Chart("pie",[{month:"Jan",sales:12},{month:"Feb"},{month:"Mar",sales:18}],"month",["sales"])])');
 const out={legend:[...view.host.querySelectorAll('.iui-pie-legend > div')].map(d=>d.textContent),rows:cells(view.host)};await view.close();return out;
});
await scenario('chart-scatter',async()=>{
 const view=await mount('root = Col([Chart("scatter",[{name:"a",x:1,y:2},{name:"b",x:2},{name:"c",x:3,y:0}],"x",["y"])])');
 const out={dots:view.host.querySelectorAll('svg circle').length,rows:cells(view.host)};await view.close();return out;
});

const typed=async(locale,start,text)=>{
 const view=await mount('$n = '+start+'\\nroot = Col([Input($n,"Qty","number")])',locale);
 const input=view.host.querySelector('input');await view.type(input,text);
 const out={stored:view.value('Qty'),shown:input.value};await view.close();return out;
};
const decimalCases=[['de-DE','1,5'],['de-DE','1.500'],['de-DE','1.234,5'],['de-DE','1,234'],['de-DE','1.5'],['en-US','1.5'],['en-US','1,500'],['en-US','1,234.5'],['en-US','1,5'],['fr-FR','1,5'],['fr-FR','1 234,5'],['fr-FR','1\\u202f234,5'],['fr-FR','1.5'],['de-CH','1\\u2019234.5'],["de-CH","1'234.5"],['de-DE','-2,5'],['de-DE','1,'],['de-DE','abc'],['en-US',',']];
for(const [locale,text] of decimalCases)await scenario('input '+locale+' '+text,()=>typed(locale,5,text));
await scenario('input-clear',async()=>{const view=await mount('$n = 5\\nroot = Col([Input($n,"Qty","number")])','de-DE');const input=view.host.querySelector('input');await view.type(input,'');const out=view.value('Qty');await view.close();return out;});
await scenario('input-display-de',async()=>{const view=await mount('$n = 1.5\\nroot = Col([Input($n,"Qty","number")])','de-DE');const out=view.host.querySelector('input').value;await view.close();return out;});
await scenario('input-display-en',async()=>{const view=await mount('$n = 12.5\\nroot = Col([Input($n,"Qty","number")])');const out=view.host.querySelector('input').value;await view.close();return out;});
await scenario('input-display-digits',async()=>{const out={};for(const locale of ['de-DE','en-US'])for(const n of ['0.1','19.99','1e21','1e-7']){const view=await mount('$n = '+n+'\\nroot = Col([Input($n,"Qty","number")])',locale);const text=view.host.querySelector('input').value;out[locale+' '+n]=[text,Controls.parseLocaleNumber(text,locale)];await view.close();}return out;});
await scenario('parse-direct',async()=>Object.fromEntries([['de-DE','1,5'],['en-US','1,5'],['en-US','1e3'],['en-US','.5'],['en-US','1.']].map(([l,t])=>[l+' '+t,Controls.parseLocaleNumber(t,l)])));

const dateCode=extra=>'$day = "2026-11-21"\\n$min = "2026-11-01"\\nroot = Col([DatePicker($day,"Trip",$min,"2026-12-31"),Button("Raise",@Set($min,"2026-12-01")),Button("Lower",@Set($min,"2026-11-01")),Button("Send",Action([@ToAssistant("go")]))])';
await scenario('date-bounds',async()=>{
 const view=await mount(dateCode());const sent=[];
 const send=async()=>{await view.click('Send');sent.push(view.proposals.at(-1).find(([n])=>n==='Trip')[1]);};
 const input=()=>view.host.querySelector('input');const alert=()=>view.host.querySelector('[role=alert]')?.textContent??null;
 await send();
 await view.click('Raise');await send();const afterRaise={text:input().value,invalid:input().getAttribute('aria-invalid'),alert:alert()};
 await view.click('Lower');await send();const afterLower={text:input().value,invalid:input().getAttribute('aria-invalid'),alert:alert()};
 await view.click('Raise');await send();
 await view.type(input(),'2026-12-15');await send();const afterNew={invalid:input().getAttribute('aria-invalid')};
 await view.click('Raise');await send();
 await view.click('Lower');await send();
 await view.type(input(),'2026-11-20');await send();
 await view.click('Raise');await send();
 await view.close();return {sent,afterRaise,afterLower,afterNew};
});
await scenario('date-initial-out-of-range',async()=>{
 const view=await mount('$day = "2027-05-01"\\nroot = Col([DatePicker($day,"Trip","2026-01-01","2026-12-31"),Button("Send",Action([@ToAssistant("go")]))])');
 await view.click('Send');const out=view.proposals[0].find(([n])=>n==='Trip')[1];await view.close();return out;
});

const choices=[{value:'apple',label:'Apple'},{value:'banana',label:'Banana'},{value:'cherry',label:'Cherry'}];
async function select(steps,start='banana'){
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host);let current=start;
 function Fixture(){const [v,setV]=useState(start);current=v;return <OpenUiSelect value={v} choices={choices} label="Fruit" onChange={setV}/>}
 await act(async()=>root.render(<Fixture/>));
 const trigger=host.querySelector('[role=combobox]');const log=[];
 for(const step of steps){await key(trigger,step);log.push(current+(document.querySelector('[role=listbox]')?'+open':''))}
 await act(async()=>root.unmount());host.remove();return log;
}
await scenario('select-miss-tab',()=>select(['z','Tab']));
await scenario('select-miss-enter',()=>select(['z','Enter']));
await scenario('select-open-miss-tab',()=>select(['ArrowDown','ArrowDown','z','Tab']));
await scenario('select-open-miss-enter',()=>select(['ArrowDown','ArrowDown','z','Enter']));
await scenario('select-open-miss-then-arrow-tab',()=>select(['ArrowDown','ArrowDown','z','ArrowUp','ArrowUp','Tab']));
await scenario('select-hit-tab',()=>select(['c','Tab']));
await scenario('select-hit-tab-prefix',()=>select(['a','Tab']));
await scenario('select-arrow-tab',()=>select(['ArrowDown','Tab']));
console.log(JSON.stringify(results));
}
main().finally(()=>dom.window.close()).catch(error=>{console.error(error);process.exitCode=1});
`,
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  logLevel: 'silent',
  banner: {
    js: `const __testRequire=require('node:module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))});
const __testDom=new (__testRequire('jsdom').JSDOM)('<!doctype html><body></body>',{url:'http://localhost/',pretendToBeVisual:true});
globalThis.__testDom=__testDom;
for(const key of ['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLButtonElement','Event','KeyboardEvent','MouseEvent','MutationObserver','SVGElement'])Object.defineProperty(globalThis,key,{configurable:true,value:__testDom.window[key]});
globalThis.getComputedStyle=__testDom.window.getComputedStyle.bind(__testDom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout;
Object.defineProperty(__testDom.window.HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 600}});
globalThis.ResizeObserver=class{observe(){}disconnect(){}};`,
  },
  plugins: [
    officialModalLayerPlugin(),
    {
      name: 'probe-externals',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/glyph$/ }, () => ({ path: 'glyph', namespace: 'test-icon' }))
        builder.onLoad({ filter: /.*/, namespace: 'test-icon' }, () => ({ contents: 'export const Glyph=()=>null', loader: 'js' }))
        builder.onResolve({ filter: /^[^./]/ }, args =>
          args.path.startsWith('@openuidev/') || args.path === '@deepseek-ai/dsh-client-ui-primitives' ? undefined : { path: args.path, external: true },
        )
      },
    },
  ],
})
const child = spawnSync(process.execPath, [outfile], {
  encoding: 'utf8',
  timeout: 60_000,
  maxBuffer: 5_000_000,
  env: { ...process.env, NODE_PATH: path.join(repo, 'node_modules') },
})
let results = {}
try {
  results = JSON.parse(child.stdout.trim().split('\n').at(-1))
} catch {
  throw new Error(`probe did not report: ${child.stderr}\n${child.stdout}`)
}
const ok = name => {
  expect(results[name], name).toBeDefined()
  expect(results[name].error, name).toBeUndefined()
  return results[name]
}

describe('P2-04 chart missing data is not zero', () => {
  const rows = [
    ['Jan', '12'],
    ['Feb', '—'],
    ['Mar', '18'],
    ['Apr', '0'],
  ]
  test('line: a missing month breaks the line, is no dot, and reads as no data (a real 0 stays 0)', () => {
    const line = ok('chart-line')
    expect(line.rows).toEqual(rows)
    // Jan alone, then Mar to Apr: the line is cut at Feb instead of dropping to 0 and coming back.
    expect(line.subpaths).toEqual([2])
    expect(line.dots).toBe(3)
  })
  test('area: the fill is cut where data is missing', () => {
    const area = ok('chart-area')
    expect(area.rows).toEqual(rows)
    // Jan is a lone point and has no area; Mar to Apr is one closed shape.
    expect(area.fillSubpaths).toEqual([1])
  })
  test('bar: a missing value draws no bar while a real 0 keeps its (empty) bar', () => {
    const bar = ok('chart-bar')
    expect(bar.rows).toEqual(rows)
    expect(bar.bars).toBe(3)
  })
  test('pie: a missing slice takes no share and reads as no data, not 0%', () => {
    const pie = ok('chart-pie')
    expect(pie.rows).toEqual([
      ['Jan', '12'],
      ['Feb', '—'],
      ['Mar', '18'],
    ])
    expect(pie.legend[1]).toBe('Feb—')
    expect(pie.legend[0]).toContain('40%')
    expect(pie.legend[2]).toContain('60%')
  })
  test('scatter: a point missing a value is not plotted at 0', () => {
    const scatter = ok('chart-scatter')
    expect(scatter.dots).toBe(2)
    expect(scatter.rows.map(row => row.at(-1))).toEqual(['2', '—', '0'])
  })
})

describe('P2-05 localized decimals in number fields', () => {
  const cases = [
    ['de-DE', '1,5', 1.5],
    ['de-DE', '1.500', 1500],
    ['de-DE', '1.234,5', 1234.5],
    ['de-DE', '1,234', 1.234],
    ['de-DE', '-2,5', -2.5],
    ['de-DE', '1,', 1],
    ['en-US', '1.5', 1.5],
    ['en-US', '1,500', 1500],
    ['en-US', '1,234.5', 1234.5],
    ['fr-FR', '1,5', 1.5],
    ['fr-FR', '1 234,5', 1234.5],
    ['fr-FR', '1 234,5', 1234.5],
    ['de-CH', '1’234.5', 1234.5],
    ['de-CH', "1'234.5", 1234.5],
    // A plain point decimal that the language cannot read as grouping is still that decimal.
    ['de-DE', '1.5', 1.5],
    ['fr-FR', '1.5', 1.5],
  ]
  for (const [locale, text, expected] of cases)
    test(`${locale} ${JSON.stringify(text)} is ${expected}`, () => {
      expect(ok(`input ${locale} ${text}`).stored).toBe(expected)
    })
  // Ambiguous text is not guessed at: the stored value (5) stays, exactly like text that is no number at all.
  for (const [locale, text] of [
    ['en-US', '1,5'],
    ['de-DE', 'abc'],
  ])
    test(`${locale} ${JSON.stringify(text)} is rejected and keeps the stored value`, () => {
      expect(ok(`input ${locale} ${text}`).stored).toBe(5)
    })
  test('a cleared field still clears, and separators alone count as empty', () => {
    // The field registry reads a cleared $variable (null) as an empty string.
    expect(ok('input-clear')).toBe('')
    expect(ok('input en-US ,').stored).toBe('')
  })
  test('the field shows numbers with the same decimal mark it reads', () => {
    expect(ok('input-display-de')).toBe('1,5')
    expect(ok('input-display-en')).toBe('12.5')
  })
  test('the shown text is the plain digits with the decimal mark swapped, and reads back to the same number', () => {
    expect(ok('input-display-digits')).toEqual({
      'de-DE 0.1': ['0,1', 0.1],
      'de-DE 19.99': ['19,99', 19.99],
      'de-DE 1e21': ['1e+21', 1e21],
      'de-DE 1e-7': ['1e-7', 1e-7],
      'en-US 0.1': ['0.1', 0.1],
      'en-US 19.99': ['19.99', 19.99],
      'en-US 1e21': ['1e+21', 1e21],
      'en-US 1e-7': ['1e-7', 1e-7],
    })
  })
  test('parse helper', () => {
    expect(ok('parse-direct')).toEqual({ 'de-DE 1,5': 1.5, 'en-US 1,5': null, 'en-US 1e3': 1000, 'en-US .5': 0.5, 'en-US 1.': 1 })
  })
})

describe('P2-06 date bounds re-validate the bound value', () => {
  test('raising the minimum clears the bound date and flags the text; lowering it restores; new dates bind', () => {
    const date = ok('date-bounds')
    expect(date.sent).toEqual([
      '2026-11-21', // initial
      '', // minimum raised past it: the form must not carry it
      '2026-11-21', // minimum lowered again: the typed date is valid and bound again
      '', // raised again
      '2026-12-15', // a new valid date is typed
      '2026-12-15', // the same raise keeps a date that is still in range
      '2026-12-15', // lowering keeps it too
      '2026-11-20', // a date typed inside the lowered range binds
      '', // raised again: cleared once more
    ])
    expect(date.afterRaise).toEqual({ text: '2026-11-21', invalid: 'true', alert: 'Enter a valid date within the allowed range (YYYY-MM-DD).' })
    expect(date.afterLower).toEqual({ text: '2026-11-21', invalid: null, alert: null })
    expect(date.afterNew.invalid).toBe(null)
  })
  test('a date already outside the bounds at mount is not bound', () => {
    expect(ok('date-initial-out-of-range')).toBe('')
  })
})

describe('P2-07 select type-ahead with no match', () => {
  test('no match, then Tab or Enter, keeps the selection and opens nothing', () => {
    expect(ok('select-miss-tab')).toEqual(['banana', 'banana'])
    expect(ok('select-miss-enter')).toEqual(['banana', 'banana+open'])
  })
  test('an open list that gets an unmatched key does not commit its stale highlight', () => {
    expect(ok('select-open-miss-tab')).toEqual(['banana+open', 'banana+open', 'banana+open', 'banana'])
    expect(ok('select-open-miss-enter')).toEqual(['banana+open', 'banana+open', 'banana+open', 'banana'])
  })
  test('navigating again after a miss makes the highlight committable again', () => {
    expect(ok('select-open-miss-then-arrow-tab')).toEqual(['banana+open', 'banana+open', 'banana+open', 'banana+open', 'banana+open', 'apple'])
  })
  test('matches still jump to the item and Tab commits it', () => {
    expect(ok('select-hit-tab')).toEqual(['banana+open', 'cherry'])
    expect(ok('select-hit-tab-prefix')).toEqual(['banana+open', 'apple'])
    expect(ok('select-arrow-tab')).toEqual(['banana+open', 'banana'])
  })
})
