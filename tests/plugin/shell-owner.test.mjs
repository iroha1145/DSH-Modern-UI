import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild'), { JSDOM } = require('jsdom')
const React = require('react'), { Context } = require('@deepseek-ai/cordis')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const scratch = path.join(root, '.artifacts/tool-ui'); mkdirSync(scratch, { recursive: true })
const built = await build({
  absWorkingDir: root,
  stdin: { contents: `export {layoutOwner} from './packages/modern-ui/src/layout-owner.ts'; export {sidebarOwner} from './packages/modern-ui/src/sidebar-owner.ts'; export {workspaceOwner} from './packages/modern-ui/src/workspace-owner.ts'; export {settingsOwner} from './packages/modern-ui/src/settings-owner.ts'; export * as primitives from '@deepseek-ai/dsh-client-ui-primitives';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'],
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl' },
  plugins: [{ name: 'css-fixture', setup(builder) {
    builder.onResolve({filter:/\.css\?inline$/}, args => ({path:path.resolve(args.resolveDir,args.path.slice(0,-7)),namespace:'inline-style'}))
    builder.onLoad({filter:/.*/,namespace:'inline-style'}, args => ({contents:`export default ${JSON.stringify(readFileSync(args.path,'utf8'))}`,loader:'js'}))
    builder.onLoad({filter:/\.css$/}, () => ({contents:`module.exports = new Proxy({}, {get: (_, key) => String(key)});`,loader:'js'}))
  } }],
})
writeFileSync(path.join(scratch, 'shell-fixture.cjs'), built.outputFiles[0].text)
const client = require(path.join(scratch, 'shell-fixture.cjs'))
const wait = () => new Promise(resolve => setTimeout(resolve, 25))
const summary = id => ({ id, title:id, displayTitle:id, cwd:'/work', blank:false, updatedAt:1, running:false, retainedBy:{} })
async function fixture() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {url:'http://localhost/'})
  const names=['window','document','localStorage','HTMLElement','Element','Node','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IS_REACT_ACT_ENVIRONMENT']
  const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]))
  for(const name of ['window','document','localStorage','HTMLElement','Element','Node','MutationObserver']) globalThis[name]=name==='window'?dom.window:name==='document'?dom.window.document:dom.window[name]
  globalThis.ResizeObserver=class {observe(){} disconnect(){}}
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const requests=[],retained=new Map(),shortcuts=new Map(),dictionaries=new Map(),localeStore=createSnapshotStore({revision:0,active:'en'})
  // Existing language packs own these official namespace/language pairs.
  const registeredLocales=new Set(['shortcuts.layout:ja','workspace:ja','sidebar:ja'])
  const registerLocale=(ns,language,dict)=>{
    const keys=dict===undefined?Object.keys(language).map(id=>`${ns}:${id}`):[`${ns}:${language}`]
    for(const key of keys)if(registeredLocales.has(key))throw new Error(`duplicate locale ${key}`)
    keys.forEach(key=>registeredLocales.add(key))
    dictionaries.set(dict===undefined?ns:`${ns}:${language}`,dict??language)
    return()=>{keys.forEach(key=>registeredLocales.delete(key));dictionaries.delete(ns)}
  }
  const sessionList=createSnapshotStore({phase:'loading',ids:['session-a'],byId:{'session-a':summary('session-a')},projectionsBySession:{}})
  const workspaceList=createSnapshotStore({phase:'loading',state:'loading',items:[{workspaceId:'workspace-a',path:'/work',title:'Workspace A',createdAt:'2026-01-01',sessionIds:['session-a']}],pinnedSessionIds:[],archivedSessionIds:[]})
  const sessions={list:sessionList,searchResultLimit:30,subagentAddress:()=>undefined,refreshProjections:async()=>{},binding:id=>({sessionId:id,session:{rename:async title=>{requests.push(['rename',id,title]);return{ok:true}}}}),using:async(id,_source,run)=>run(sessions.binding(id)),create:async request=>{requests.push(['create',request]);return 'blank-created'},fork:async request=>{requests.push(['fork',request]);return 'fork-created'},search:async query=>({ok:true,value:{items:[],hasMore:false}}),retain:(target,source)=>{const id=typeof target==='string'?target:target.childSessionId;const ref={sessionId:id,binding:sessions.binding(id),release:()=>{retained.delete(ref)}};retained.set(ref,{id,source});return ref}}
  const workspaces={list:workspaceList,initializeDefault:async()=>undefined,archiveSession:async(id,options)=>requests.push(['archive',id,options]),unarchiveSession:async id=>requests.push(['unarchive',id]),pinSession:async id=>requests.push(['pin',id]),unpinSession:async id=>requests.push(['unpin',id]),rename:async(id,title)=>requests.push(['renameWorkspace',id,title]),delete:async id=>requests.push(['deleteWorkspace',id]),insertBefore:async(id,before)=>requests.push(['reorderWorkspace',id,before]),create:async input=>{requests.push(['createWorkspace',input]);return{workspaceId:'new',path:input.path,sessionIds:[]}}}
  const ctx=new Context()
  const form={getSnapshot:()=>({value:{enabled:true,welcomeNoticeVersion:'fixture'}}),subscribe:()=>()=>{},set:async()=>true,mutate:async()=>true}
  const directoryPicker={pick:async()=>({ok:true,value:'/picked'}),list:async()=>({ok:true,value:{entries:[],ancestors:[]}}),createDirectory:async(p,n)=>({ok:true,value:`${p}/${n}`})}
  await ctx.plugin({apply(scope){
    scope.provide('locale',{register:registerLocale,bind:ns=>(key,params={})=>Object.entries(params).reduce((s,[name,value])=>s.replace(`{${name}}`,String(value)),dictionaries.get(ns)?.en?.[key]??key),subscribe:localeStore.subscribe,getSnapshot:localeStore.getSnapshot})
    scope.provide('theme',{getTheme:()=>({preference:'system',active:{colorScheme:'light',tokens:{}},fontSizes:{text:14,code:13,terminal:13},fontFamilies:{text:'',code:'',terminal:''}})})
    scope.provide('sessions',sessions);scope.provide('workspaces',workspaces)
    scope.provide('shortcuts',{catalog:createSnapshotStore([]),register:command=>{shortcuts.set(command.id,command);return()=>shortcuts.delete(command.id)}})
    scope.provide('remote',{$host:{home:'/home',isLoopback:false},directoryPicker,$on:()=>()=>{}});scope.provide('remote.directoryPicker',directoryPicker);scope.provide('remote.settings',{})
    scope.provide('remoteAccess',{source:()=>createSnapshotStore(true),whenResourceAccess:(_kind,_id,_action,run)=>run()})
    scope.provide('configForms',{get:()=>form,developerTools:{enabled:createSnapshotStore(true),setEnabled:async()=>{}},describe:()=>({getSnapshot:()=>({status:'ready',view:{namespaces:[],writable:true,hasDocument:false}}),subscribe:()=>()=>{},ensure:async()=>{}})})
    scope.provide('connection',{state:createSnapshotStore(undefined),reconnect:()=>requests.push(['reconnect'])})
    scope.provide('modules',{manifest:{release:{version:'0.2.1-rc.4'}},entries:{releaseChange:createSnapshotStore(undefined),dismissRelease(){}}})
  }}).await()
  function load(id){let registration;dom.window.__ModuleLoader__={load:value=>registration=value};vm.runInNewContext(readFileSync(require.resolve(id+'/client'),'utf8'),{window:dom.window,document:dom.window.document,console,setTimeout,clearTimeout,URL,URLSearchParams,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame});return registration.factory(id=>id==='@deepseek-ai/dsh-client-ui-primitives'?client.primitives:require(id))}
  await ctx.plugin(load('@deepseek-ai/dsh-client-ui-renderer').SlotRegistry).await()
  const layout=ctx.plugin(client.layoutOwner);await layout.await()
  const workspace=ctx.plugin(client.workspaceOwner),sidebar=ctx.plugin(client.sidebarOwner)
  await workspace.await();await sidebar.await();await wait()
  const officialSettings=ctx.plugin(load('@deepseek-ai/dsh-client-ui-settings-general'));await officialSettings.await()
  const settings=ctx.plugin(client.settingsOwner);await settings.await();await wait()
  const community=ctx.plugin({inject:['slots'],apply(scope){
    scope.slots.inject('main',()=>scope.slots.register({name:'main',key:'community-panel'},()=>null))
    scope.slots.inject('sidebar.panellist',()=>scope.slots.register({name:'sidebar.panellist',id:'community-panel',label:'Community'},()=>null))
    scope.slots.inject('sidebar.workspaces.session.menu.item',()=>scope.slots.register({name:'sidebar.workspaces.session.menu.item',id:'community-row-action'},()=>null))
    scope.slots.inject('settings.section',()=>scope.slots.register({name:'settings.section',id:'community-settings',label:'Community Settings'},()=>null))
  }});await community.await();await wait()
  return {ctx,dom,layout,workspace,sidebar,settings,officialSettings,sessions,workspaces,sessionList,workspaceList,shortcuts,requests,retained,form,registeredLocales,async dispose(){await ctx.fiber.dispose();Object.assign(globalThis,previous)}}
}

test('sidebar/workspace owners retain original children, community rows, and the untouched official settings provider',async()=>{
  const f=await fixture()
  try{
    assert.equal(f.ctx.slots.entriesOfSlot('sidebar').length,1)
    assert.ok(f.registeredLocales.has('shortcuts.layout:ja'))
    assert.ok(f.registeredLocales.has('workspace:ja'))
    assert.ok(f.registeredLocales.has('modern-layout-shortcuts:ja'))
    assert.ok(f.registeredLocales.has('modern-workspace:ja'))
    const side=f.ctx.slots.entriesOfSlot('sidebar')[0]
    assert.deepEqual(Object.keys(side.children).sort(),['sidebar.brand.mark','sidebar.brand.name','sidebar.toggle.badge','sidebar.panellist','sidebar.panellist.actions','sidebar.workspaces','sidebar.settings','sidebar.footer.action'].sort())
    assert.equal(f.ctx.slots.entriesOfSlot('sidebar.workspaces').length,1)
    assert.equal(f.ctx.slots.entriesOfSlot('sidebar.workspaces.session.menu.item').length,6)
    assert.ok(f.ctx.slots.entriesOfSlot('settings.section').some(e=>e.options.id==='community-settings'))
    const configForms=f.ctx.configForms,settingsEntry=f.ctx.slots.entriesOfSlot('sidebar.settings')[0]
    assert.ok(settingsEntry.children['settings.onboarding']);assert.ok(settingsEntry.children['settings.launcher'])
    assert.equal(f.ctx.slots.entriesOfSlot('settings.general.item').filter(e=>e.options.id==='developer-tools').length,1)
    assert.ok(f.dom.window.document.querySelector('style[data-plugin-css="settings-shell"]'))
    await f.settings.dispose()
    assert.equal(f.ctx.configForms,configForms);assert.equal(f.ctx.slots.entriesOfSlot('sidebar.settings')[0],settingsEntry)
    assert.equal(f.dom.window.document.querySelector('style[data-plugin-css="settings-shell"]'),null)
  }finally{await f.dispose()}
})

test('workspace public navigation delegates to existing controllers and keeps directory, pin, fork and archive operations',async()=>{
  const f=await fixture()
  try{
    f.ctx.uiWorkspace.openSession('session-a');assert.equal([...f.retained.values()][0].id,'session-a')
    await f.ctx.uiWorkspace.openWorkspace('workspace-a');assert.ok(f.requests.some(x=>x[0]==='create'&&x[1].workspaceId==='workspace-a'))
    assert.equal([...f.retained.values()][0].id,'blank-created')
    await f.ctx.uiWorkspace.pinSession('session-a');await f.ctx.uiWorkspace.unpinSession('session-a')
    await f.ctx.uiWorkspace.forkSession('session-a',undefined,{allowMigration:false})
    await f.ctx.uiWorkspace.archiveSession('blank-created',{stopActivity:true})
    assert.equal(f.retained.size,0)
    assert.ok(f.requests.some(x=>x[0]==='fork'&&x[1].allowMigration===false))
    assert.ok(f.requests.some(x=>x[0]==='archive'&&x[2].stopActivity===true))
    assert.equal(await f.ctx.uiWorkspace.pickDirectory(),'/picked')
    assert.equal(await f.ctx.uiWorkspace.createDirectory('/picked','child'),'/picked/child')
    const viewStore=f.ctx.slots.entriesOfSlot('sidebar.workspaces')[0].store.create()
    viewStore.actions.setGroupBy('flat')
    viewStore.actions.setSessionOrder('workspace-a',['session-b','session-a'],{'workspace-a':['session-a','session-b']})
    assert.equal(JSON.parse(f.dom.window.localStorage.getItem('dsh.workspace.view.v5')).groupBy,'flat')
    const owner=f.ctx.uiWorkspace;await f.workspace.dispose();await wait();assert.equal(f.ctx.get('uiWorkspace'),undefined)
    const again=f.ctx.plugin(client.workspaceOwner);await again.await();await wait();assert.notEqual(f.ctx.uiWorkspace,owner)
    assert.equal(f.ctx.slots.entriesOfSlot('sidebar.workspaces.session.menu.item').length,6)
    const restored=f.ctx.slots.entriesOfSlot('sidebar.workspaces')[0].store.create().getSnapshot()
    assert.equal(restored.groupBy,'flat');assert.equal(restored.orderBy,'manual')
    assert.deepEqual(restored.sessionOrderByAccount['workspace-a'],['session-b','session-a'])
    await again.dispose()
  }finally{await f.dispose()}
})
test('phone navigation closes only on explicit workspace/session actions, preserves focus and public owner contracts',async()=>{
  const f=await fixture(), mount=f.dom.window.document.createElement('div');f.dom.window.document.body.append(mount)
  const {createRoot}=require('react-dom/client'),view=createRoot(mount)
  const layoutStore=f.ctx.slots.entriesOfSlot('root')[0].store.create()
  layoutStore.actions.setViewportWidth(390)
  const sidebar=f.ctx.slots.entriesOfSlot('sidebar')[0],browser=f.ctx.slots.entriesOfSlot('sidebar.workspaces')[0],browserStore=browser.store.create()
  const sidebarInjected=sidebar.inject(),browserInjected=browser.inject()
  const selectorHook=source=>selector=>selector(React.useSyncExternalStore(source.subscribe,source.getSnapshot,source.getSnapshot))
  const hooks=face=>Object.fromEntries(Object.entries(face.hooks).map(([name,source])=>['use'+name[0].toUpperCase()+name.slice(1),selectorHook(source)]))
  const shared={useRemoteAccess:()=>true,useSessionAccess:()=>true,useWorkspaceAccess:()=>true,useSessionStatus:selector=>selector(new Map()),usePanelInfo:selectorHook(f.ctx.layout.panelInfo),useSessions:selector=>selector({...React.useSyncExternalStore(f.sessionList.subscribe,f.sessionList.getSnapshot,f.sessionList.getSnapshot),phase:'ready'}),useWorkspaces:selector=>selector({...React.useSyncExternalStore(f.workspaceList.subscribe,f.workspaceList.getSnapshot,f.workspaceList.getSnapshot),phase:'ready',state:'ready'})}
  const observed=[]
  function Sidebar(){
    const info=React.useSyncExternalStore(layoutStore.subscribe,layoutStore.getSnapshot,layoutStore.getSnapshot).layoutInfo
    return React.createElement(sidebar.component,{...shared,...sidebarInjected,...hooks(sidebarInjected),collapsed:!info.narrowExpanded,width:390,t:f.ctx.locale.bind('modern-sidebar'),renderSlot:(name,owner)=>{
      if(name==='sidebar.workspaces'){
        observed.push(Object.keys(owner).sort())
        return React.createElement(browser.component,{...shared,...owner,...browserInjected,...hooks(browserInjected),useStore:selectorHook(browserStore),actions:browserStore.actions,t:f.ctx.locale.bind('modern-workspace'),renderSlot:()=>null})
      }
      return null
    }})
  }
  try{
    await React.act(async()=>view.render(React.createElement(Sidebar)))
    assert.ok(mount.querySelector('[data-mobile-navigation]'))
    const trigger=mount.querySelector('[data-mobile-navigation] button')
    assert.equal(trigger.getAttribute('aria-expanded'),'false')
    await React.act(async()=>trigger.click())
    assert.equal(trigger.getAttribute('aria-expanded'),'true')
    assert.ok(mount.querySelector('[data-mobile-drawer][role="dialog"]'))
    await React.act(async()=>f.sessionList.set({...f.sessionList.getSnapshot(),byId:{'session-a':{...summary('session-a'),running:true}}}))
    assert.equal(trigger.getAttribute('aria-expanded'),'true','a background update must not dismiss navigation')
    await React.act(async()=>mount.querySelector('[role="treeitem"]').click())
    const row=[...mount.querySelectorAll('[role="treeitem"]')].find(element=>element.textContent.includes('session-a'))
    if (!row) writeFileSync(path.join(scratch,'phone-drawer.html'),mount.innerHTML)
    assert.ok(row,'session row is visible inside the real workspace browser')
    await React.act(async()=>row.click())
    assert.equal(trigger.getAttribute('aria-expanded'),'false')
    assert.equal([...f.retained.values()][0].id,'session-a')
    assert.equal(f.dom.window.document.activeElement,trigger)
    assert.ok(observed.every(keys=>JSON.stringify(keys)===JSON.stringify(['expandSidebar','wide'])))
    await React.act(async()=>trigger.click())
    const keyboardRow=[...mount.querySelectorAll('[role="treeitem"]')].find(element=>element.textContent.includes('session-a'))
    await React.act(async()=>keyboardRow.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})))
    assert.equal(trigger.getAttribute('aria-expanded'),'false')
    await React.act(async()=>trigger.click())
    await React.act(async()=>f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
    assert.equal(trigger.getAttribute('aria-expanded'),'false')
    await React.act(async()=>f.ctx.modernLayout.closeMobileSidebar())
    await React.act(async()=>f.ctx.modernLayout.closeMobileSidebar())
    assert.equal(trigger.getAttribute('aria-expanded'),'false','closing is idempotent')
    await React.act(async()=>view.unmount())
  }finally{await f.dispose()}
})

test('settings styles retain the actual official modal, section navigation, Escape, and shared store',async()=>{
  const f=await fixture(),mount=f.dom.window.document.createElement('div');f.dom.window.document.body.append(mount)
  const {createRoot}=require('react-dom/client'),view=createRoot(mount)
  const entry=f.ctx.slots.entriesOfSlot('sidebar.settings')[0],store=entry.store.create(),injected=entry.inject()
  const selectorHook=source=>selector=>selector(React.useSyncExternalStore(source.subscribe,source.getSnapshot,source.getSnapshot))
  const hooks=Object.fromEntries(Object.entries(injected.hooks).map(([name,source])=>['use'+name[0].toUpperCase()+name.slice(1),selectorHook(source)]))
  const originalScroll=f.dom.window.HTMLElement.prototype.scrollIntoView
  f.dom.window.HTMLElement.prototype.scrollIntoView=function(){}
  const rendered=[]
  try{
    await React.act(async()=>view.render(React.createElement(entry.component,{wide:true,...injected,...hooks,useStore:selectorHook(store),actions:store.actions,useSessions:selector=>selector(f.sessionList.getSnapshot()),t:f.ctx.locale.bind('settings'),renderSlot:(name,owner,options)=>{
      if(name==='settings.launcher')return options?.fallback??null
      if(name==='settings.header')return 'Settings'
      if(name==='settings.close')return 'Close settings'
      if(name==='settings.section'){rendered.push(options.only);return React.createElement('div',{'data-section':options.only},options.only)}
      return null
    }})))
    const trigger=mount.querySelector('button[aria-haspopup="dialog"]')
    await React.act(async()=>trigger.click())
    const panel=f.dom.window.document.querySelector('[data-shortcut-modal="settings"][role="dialog"]')
    assert.ok(panel)
    assert.ok(panel.querySelector('nav button'))
    const community=[...panel.querySelectorAll('nav button')].find(button=>button.textContent==='Community Settings')
    await React.act(async()=>community.click())
    assert.equal(community.getAttribute('aria-current'),'true');assert.equal(rendered.at(-1),'community-settings')
    assert.equal(store.getSnapshot().open,true)
    const style=f.dom.window.document.querySelector('style[data-plugin-css="settings-shell"]')
    assert.match(style.textContent,/data-shortcut-modal/)
    await React.act(async()=>f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})))
    assert.equal(store.getSnapshot().open,false)
    assert.equal(f.dom.window.document.querySelector('[data-shortcut-modal="settings"]'),null)
    await React.act(async()=>view.unmount())
  }finally{f.dom.window.HTMLElement.prototype.scrollIntoView=originalScroll;await f.dispose()}
})
