import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fileMediaUrl, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

const root = resolve(import.meta.dirname, '../..')
const sourceRoot = process.env.AUDIT_SOURCE_ROOT ?? root
async function load(relative, source = sourceRoot) {
  const result = await build({entryPoints: [resolve(source, relative)], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external', jsx: 'automatic', plugins: [{name: 'test-ui', setup(b) {
    b.onResolve({filter: /^@deepseek-ai\/dsh-client-ui-primitives$/}, () => ({path: fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-primitives'))}))
    b.onResolve({filter: /^@iroha1145\/dsh-modern-ui\/primitives$/}, () => ({path: 'markdown', namespace: 'test'}))
    b.onLoad({filter: /.*/, namespace: 'test'}, () => ({contents: `export {MarkdownText} from '${resolve(source, 'packages/modern-ui/src/vendor/primitives/markdown/MarkdownText.tsx').replaceAll('\\', '/')}'; export {MarkdownDelegateProvider} from '${resolve(source, 'packages/modern-ui/src/vendor/primitives/markdown/MarkdownDelegate.tsx').replaceAll('\\', '/')}';`, loader: 'js', resolveDir: root}))
    b.onLoad({filter: /Tooltip\.tsx$/}, () => ({contents: 'export const Tooltip = ({children}) => children', loader: 'js'}))
    b.onResolve({filter: /\.css$/}, args => ({path: args.path, namespace: 'style'}))
    b.onLoad({filter: /\.css$/}, () => ({contents: 'export default new Proxy({}, {get: (_, key) => key})', loader: 'js'}))
  }}]})
  const file = resolve(root, 'tests/audit', `.plan-${process.pid}-${Math.random()}.mjs`)
  await writeFile(file, result.outputFiles[0].text)
  try {return await import(pathToFileURL(file).href)} finally {await rm(file)}
}
const base = 'packages/modern-ui/src/vendor/plan/client/'
const {planSessionId, planNavigation} = await load(base + 'navigation.ts', root)
const {PlanPreview} = await load(base + 'PlanPreview.tsx')
const labels = {open:'Open',loading:'Loading',failed:'Failed',dialog:'Image',close:'Close'}
const dom = new JSDOM('<div id="root"></div>', {url:'https://example.test/prefix/'})
for (const key of ['window','document','navigator','Node','HTMLElement','DOMParser']) Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
test.after(() => dom.window.close())
function fixture() {
  let cwd = '/child/live'
  const calls = []
  const state = {byId:{child:{cwd:'/child/catalog'}, parent:{cwd:'/parent'}, active:{cwd:'/wrong'}}}
  const ctx = {sessions:{list:{getSnapshot:()=>state},binding:id=>id==='child'?{session:{projections:{faceOf:()=>({getSnapshot:()=>cwd})}}}:undefined},sidebarRight:{openResource:(...args)=>calls.push(args)}}
  return {ctx,state,calls,setCwd:value=>{cwd=value}}
}
test('plan resource identity handles session, review, and direct-parent child grammars', () => {
  assert.equal(planSessionId('dsh-resource://plan/parent/call'),'parent')
  assert.equal(planSessionId('dsh-resource://plan-review/child/request'),'child')
  for (const mode of ['one-shot','continuable','unknown']) assert.equal(planSessionId(`dsh-resource://plan/subagent/parent/child/${mode}/call`),'child')
  for (const value of ['dsh-resource://plan/a/b?x','dsh-resource://plan/a/%zz','dsh-resource://plan//call','dsh-resource://plan/subagent/p/c/invalid/call','dsh-resource://plan-review/subagent/p/c/unknown/call']) assert.equal(planSessionId(value),undefined)
})
test('file and image capabilities use the resource child cwd and preserve line navigation', () => {
  const f=fixture()
  const nav=planNavigation(f.ctx,'dsh-resource://plan/subagent/parent/child/one-shot/call',labels)
  assert.equal(nav.fileImages.resolve('image.png'),fileMediaUrl(document.baseURI,'/child/live/image.png'))
  nav.openFile('src/main.ts',{line:42})
  assert.deepEqual(f.calls,[[sessionFileAddress('child','/child/live/src/main.ts'),{params:{line:42}}]])
  f.setCwd('/child/changed')
  nav.openFile('other.ts')
  assert.deepEqual(f.calls[1],[sessionFileAddress('child','/child/changed/other.ts')])
  f.setCwd(null)
  assert.equal(nav.fileImages.resolve('image.png'),fileMediaUrl(document.baseURI,'/child/catalog/image.png'))
})
test('unknown identity and missing cwd never borrow the active or parent session', () => {
  const f=fixture()
  assert.deepEqual(planNavigation(f.ctx,'dsh-resource://plan/missing/call',labels),{})
  assert.deepEqual(planNavigation(f.ctx,'invalid',labels),{})
  f.setCwd(null); delete f.state.byId.child.cwd
  const nav=planNavigation(f.ctx,'dsh-resource://plan/child/call',labels)
  assert.equal(nav.fileImages.resolve('image.png'),undefined)
  nav.openFile('relative.ts')
  assert.equal(f.calls.length,0)
  nav.openFile('/absolute.ts')
  assert.deepEqual(f.calls,[[sessionFileAddress('child','/absolute.ts')]])
})
test('real PlanPreview resolves local images and activates authored file links through its delegate', async () => {
  const f=fixture()
  const root=createRoot(document.getElementById('root'))
  const address='dsh-resource://plan/subagent/parent/child/continuable/call'
  try {
    await act(async()=>root.render(React.createElement(PlanPreview,{
      useTabInfo:()=>({tab:{navigation:{address}}}),
      useResource:()=>({value:{title:'Plan',markdown:'![Diagram](diagram.png)\n\n[Source](src/main.ts#L12)',callId:'call'}}),
      useSessions:selector=>selector(f.state),
      navigation:address=>planNavigation(f.ctx,address,labels),t:key=>key,
    })))
    const img=document.querySelector('img')
    assert.ok(img,document.body.innerHTML)
    const src=new URL(img.src); src.searchParams.delete('load')
    assert.equal(src.href,fileMediaUrl(document.baseURI,'/child/live/diagram.png'))
    const link=[...document.querySelectorAll('a,button')].find(el=>el.textContent.includes('Source'))
    assert.ok(link,document.body.innerHTML)
    await act(async()=>link.click())
    assert.deepEqual(f.calls,[[sessionFileAddress('child','/child/live/src/main.ts'),{params:{line:12}}]])
  } finally {await act(async()=>root.unmount())}
})


