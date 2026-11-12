import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from './helpers/client-build.mjs'
import { chromium } from 'playwright-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const icons = [
  'IconArchiveCheckOutlineRegular',
  'IconArchiveOffOutlineRegular',
  'IconArchiveOutlineRegular',
  'IconChevronsUpDownOutlineRegular',
  'IconClockOutlineRegular',
  'IconCloseFillRegular',
  'IconFlatListOutlineRegular',
  'IconFolderCloseRegular',
  'IconFolderOpenRegular',
  'IconProjectAddOutlineRegular',
  'IconQueueOutlineRegular',
  'IconSearchOutlineRegular',
  'IconSlidersTwoOutlineRegular',
  'IconWorkspaceTreeOutlineRegular',
  'IconChevronDownOutlineRegular',
  'IconChevronRightOutlineRegular',
  'IconEllipsisOutlineRegular',
  'IconNewChatOutlineRegular',
  'IconPinFillRegular',
  'IconTrashOutlineRegular',
  'IconTriangleRightFillRegular',
  'IconUnarchiveOutlineRegular',
  'IconEditOutlineRegular',
  'IconCopyOutlineRegular',
  'IconCheckOutlineRegular',
  'IconWarningOutlineRegular',
]
const result = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  bundle: true,
  write: false,
  outfile: 'fixture.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `
    import React,{useSyncExternalStore} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {createSnapshotStore} from '@deepseek-ai/dsh-client-store';
    import {FlatList,SessionTree} from './packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.tsx';
    import {ModelPickerSettingsController} from './packages/modern-ui/src/vendor/model/client/settings/controller.ts';
    import {ModelPickerSettingsCard} from './packages/modern-ui/src/vendor/model/client/settings/ModelPickerSettingsCard.tsx';
    const root=createRoot(document.getElementById('app')); const selectValue=value=>select=>select(value);
    const observe=store=>select=>select(useSyncExternalStore(store.subscribe,store.getSnapshot));
    const t=(key,args)=>key==='time.now'?'now':key==='unnamed'?'Session':key;
    const common={useSessionAccess:()=>true,useRemoteAccess:()=>true,useWorkspaceAccess:()=>true,usePanelInfo:selectValue({activePanelId:null}),workspaceReady:true,animationResetKey:'',open(){},onSessionRenameRequest(){},onSessionRevealed(){},onLeaveArchivedOnly(){},renderSlot:()=>null,t};
    let controller,statuses, mode;
    window.fixture={
      records:{orders:[],workspaces:[],events:[]},
      mount(nextMode,count=500,options={}){
        flushSync(()=>root.render(null)); controller?.dispose();controller=undefined;mode=nextMode;
        this.records.orders=[];this.records.workspaces=[];this.records.events=[];
        const started=performance.now();let projectionMs=0;
        if(mode==='model'){
          const form=createSnapshotStore({status:'ready',value:{models:{},prices:{}},base:{},user:{},revision:1,writable:true});
          const catalog=createSnapshotStore({status:'ready',value:{groups:[{id:'provider',models:Array.from({length:count},(_,i)=>({id:'model-'+i,name:'Model '+i}))}]},error:null});
          controller=new ModelPickerSettingsController({form:{getSnapshot:form.getSnapshot,subscribe:form.subscribe,mutate:async()=>true},catalog,loadCatalog(){},blurb:()=>'',effortName:id=>id});
          projectionMs=performance.now()-started;
          flushSync(()=>root.render(<ModelPickerSettingsCard {...controller.face} useModelSettings={observe(controller.face.hooks.modelSettings)} t={t}/>));
        } else {
          const ids=Array.from({length:count},(_,i)=>'s'+i);
          const list={phase:'ready',ids,byId:Object.fromEntries(ids.map((id,i)=>[id,{id,title:'Session '+i,blank:false,running:false,retainedBy:{},updatedAt:count-i,cwd:'/workspace'}])),projectionsBySession:{}};
          statuses=createSnapshotStore(new Map());
          const props={...common,list,useSessionStatus:observe(statuses),rowState:{pinnedSessionIds:[],archivedSessionIds:[],archivedFilter:'default'},setSessionOrder:(...args)=>this.records.orders.push(args)};
          if(mode==='flat')flushSync(()=>root.render(<FlatList {...props} sessionIds={ids}/>));
          else {
            const groupCount=mode==='workspace-drag'?2:options.groups??1;
            const perGroup=Math.ceil(count/groupCount);
            const workspaces=Array.from({length:groupCount},(_,i)=>({workspaceId:'w'+i,title:'Workspace '+i,path:options.nested?'/workspace'+'/child'.repeat(i):'/workspace/'+i,createdAt:new Date(0).toISOString(),sessionIds:ids.slice(i*perGroup,(i+1)*perGroup)}));
            let groupExpansion=options.expansion??Object.fromEntries(workspaces.map(w=>[w.workspaceId,true]));
            const renderTree=()=>flushSync(()=>root.render(<SessionTree {...props} workspaces={workspaces} ungroupedSessionIds={[]} nestWorkspaces={options.nested??false} groupExpansion={groupExpansion} setGroupExpanded={(key,expanded)=>{groupExpansion={...groupExpansion,[key]:expanded};renderTree()}} startSession={()=>{}} insertWorkspaceBefore={async(...args)=>this.records.workspaces.push(args)} onRenameRequest={()=>{}} onDeleteRequest={()=>{}} shortcuts={[]}/>));
            renderTree();
          }
        }
        return {mode,count,projectionMs,mountMs:performance.now()-started,rows:document.querySelectorAll('#app [data-row-key],#app li').length,nodes:document.querySelectorAll('#app *').length};
      },
      update(times=10){
        const samples=[];
        if(mode==='model')flushSync(()=>controller.face.toggleModel('model-0'));
        for(let i=0;i<times;i++){
          const started=performance.now();
          if(mode==='model')flushSync(()=>controller.face.editField('description','changed '+i));
          else flushSync(()=>statuses.set(new Map([['s0',{running:i%2===0}]])));
          samples.push(performance.now()-started);
        }
        return samples;
      },
    };
    document.addEventListener('dragstart',()=>fixture.records.events.push('start'));
    document.addEventListener('dragend',e=>fixture.records.events.push('end:'+e.dataTransfer.dropEffect));
    document.addEventListener('drop',()=>fixture.records.events.push('drop'));
  `,
  },
  plugins: [
    {
      name: 'isolated-browser-surroundings',
      setup(builder) {
        builder.onLoad({ filter: /WorkspaceBrowser\.tsx$/ }, args => ({
          contents: `${readFileSync(args.path, 'utf8')}\nexport {FlatList,SessionTree}`,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `
      import React from 'react';
      export {AnimatedRows} from './packages/modern-ui/src/vendor/primitives/AnimatedRows.tsx';
      export {useRowDragPreview} from './packages/modern-ui/src/vendor/primitives/useRowDragPreview.ts';
      export {MenuItemButton} from './packages/modern-ui/src/vendor/primitives/Menu.tsx';
      export {writeClipboard} from './packages/modern-ui/src/vendor/primitives/clipboard.ts';
      export {relativeTime} from './packages/modern-ui/src/vendor/primitives/relative-time.ts';
      export const HoverCard=({anchor})=>anchor,Tooltip=({children})=>children,Menu=({anchor})=>anchor;
      export const HoverCardGroup=({children,className})=><div className={className}>{children}</div>;
      export const Button=({children,onClick,disabled})=><button disabled={disabled} onClick={onClick}>{children}</button>,Tag=({children})=><span>{children}</span>;
      export const Checkbox=({checked,onChange,disabled})=><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>;
      export const Input=props=><input {...props}/>;
      export const Modal=()=>null,StateDot=()=> <span style={{width:8,height:8}}/>;
      ${icons.map(name => `export const ${name}=()=>null;`).join('\n')}
    `,
          loader: 'tsx',
          resolveDir: root,
        }))
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'upstream-icons', namespace: 'upstream-icons' }))
        builder.onLoad({ filter: /.*/, namespace: 'upstream-icons' }, () => ({
          contents: 'export const IconChevronLeftOutlineRegular=()=>null; export const observeComposition=()=>({guards:()=>false,dispose(){}})',
        }))
        builder.onResolve({ filter: /WorkspacePicker\.tsx$/ }, () => ({ path: 'picker', namespace: 'picker' }))
        builder.onLoad({ filter: /.*/, namespace: 'picker' }, () => ({ contents: 'export const WorkspacePickFlow=()=>null' }))
      },
    },
  ],
  logLevel: 'silent',
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())
async function pageFixture(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, ...options })
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px Arial}#app{width:350px;height:600px;display:flex;flex-direction:column;--dsh-session-list-scrollbar-offset:0px;--dsh-session-list-edge-inset:8px;--dsh-session-list-scrollbar-width:8px}button{font:inherit}</style><div id="app"></div><div id="outside" style="position:absolute;left:700px;top:200px;width:200px;height:200px">Outside</div>',
  )
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  return page
}

test('measure real flat/grouped session rows and model settings rows at large-list sizes', async () => {
  const page = await pageFixture(),
    measurements = []
  try {
    for (const mode of ['flat', 'grouped', 'model'])
      for (const count of [500, 2000]) {
        const mount = await page.evaluate(([mode, count]) => fixture.mount(mode, count), [mode, count])
        const updates = await page.evaluate(() => fixture.update())
        const sorted = [...updates].sort((a, b) => a - b)
        const frames = await page.evaluate(async () => {
          const scroll = document.querySelector('#app [role="tree"]') ?? document.scrollingElement
          const samples = []
          let previous
          for (let i = 0; i < 12; i++)
            await new Promise(resolve =>
              requestAnimationFrame(now => {
                if (previous !== undefined) samples.push(now - previous)
                previous = now
                scroll.scrollTop += 20
                resolve()
              }),
            )
          return samples
        })
        const scrollFrames = [...frames].sort((a, b) => a - b)
        measurements.push({
          ...mount,
          updateMedianMs: sorted[Math.floor(sorted.length / 2)],
          updateMaxMs: Math.max(...updates),
          scrollMedianFrameMs: scrollFrames[Math.floor(scrollFrames.length / 2)],
          scrollMaxFrameMs: Math.max(...frames),
        })
        assert.ok(mount.rows > 0)
      }
    mkdirSync(new URL('../../.artifacts/frontend-audit-20261111/', import.meta.url), { recursive: true })
    writeFileSync(new URL('../../.artifacts/frontend-audit-20261111/workspace-list-measurements.json', import.meta.url), JSON.stringify(measurements, null, 2))
  } finally {
    await page.close()
  }
})

test('flat paging preserves row focus while expanding and through live status updates', async () => {
  const page = await pageFixture()
  try {
    await page.evaluate(() => fixture.mount('flat', 120))
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 50)
    const overflow = page.locator('#app [data-row-key="overflow:flat"]')
    await overflow.click()
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 100)
    await page.locator('#app [data-row-key="session:s10"]').focus()
    await page.evaluate(() => {
      window.focusedRow = document.activeElement
      fixture.update(2)
    })
    assert.equal(await page.evaluate(() => document.activeElement === window.focusedRow && document.activeElement.dataset.rowKey === 'session:s10'), true)
    await overflow.click()
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 120)
    await overflow.click()
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 50)
  } finally {
    await page.close()
  }
})

test('grouped sessions fill the available viewport without mounting the full inventory', async () => {
  const page = await pageFixture()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    for (const [width, height] of [
      [1280, 800],
      [1280, 1400],
      [390, 844],
      [390, 320],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => {
        document.querySelector('#app').style.cssText = 'width:min(350px,100vw);height:calc(100dvh - 160px);display:flex;flex-direction:column'
      })
      for (const count of [20, 2000]) {
        await page.evaluate(count => fixture.mount('grouped', count), count)
        await page.waitForFunction(() => {
          const tree = document.querySelector('#app [role="tree"]')
          const rows = tree.querySelectorAll('[data-row-key^="session:"]')
          return rows.length === 20 || tree.scrollHeight >= tree.clientHeight
        })
        const geometry = await page.evaluate(() => {
          const tree = document.querySelector('#app [role="tree"]')
          return { height: tree.clientHeight, content: tree.scrollHeight, rows: tree.querySelectorAll('[data-row-key^="session:"]').length }
        })
        assert.ok(geometry.rows <= Math.max(5, Math.ceil(geometry.height / 38)))
        if (geometry.rows < count) assert.ok(geometry.content >= geometry.height, JSON.stringify({ width, height, count, ...geometry }))
        assert.ok(geometry.rows < 100)
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(() => fixture.mount('grouped', 2000))
    const before = await page.locator('#app [data-row-key^="session:"]').count()
    await page.setViewportSize({ width: 1280, height: 1400 })
    await page.waitForFunction(before => document.querySelectorAll('#app [data-row-key^="session:"]').length > before, before)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})

test('automatic group fitting preserves folded ancestors and the manual collapse minimum', async () => {
  const page = await pageFixture()
  try {
    await page.evaluate(() => fixture.mount('grouped', 30, { groups: 3, nested: true, expansion: { w0: false, w1: true, w2: true } }))
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 0)
    assert.equal(await page.locator('#app [data-row-key="workspace:w1"]').count(), 0)
    await page.evaluate(() => fixture.mount('grouped', 60, { groups: 3, expansion: { w0: true, w1: false, w2: true } }))
    assert.equal(await page.locator('#app [data-row-key="session:s20"]').count(), 0)
    assert.equal(await page.locator('#app [data-row-key="workspace:w1"]').getAttribute('aria-expanded'), 'false')
    await page.evaluate(() => fixture.mount('grouped', 35))
    const minimum = await page.locator('#app [data-row-key^="session:"]').count()
    assert.ok(minimum > 5)
    const overflow = page.locator('#app [data-row-key="overflow:w0"]')
    await page.locator('#app [data-row-key="session:s3"]').focus()
    await page.evaluate(() => {
      window.focusedRow = document.activeElement
      fixture.update(2)
    })
    assert.equal(await page.evaluate(() => window.focusedRow === document.activeElement), true)
    while ((await overflow.getAttribute('aria-expanded')) === 'false') await overflow.click()
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), 35)
    await overflow.click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator('#app [data-row-key^="session:"]').count(), minimum)
  } finally {
    await page.close()
  }
})

test('touch session rows fill tall phones and scroll within a short phone viewport', async () => {
  const page = await pageFixture({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  try {
    await page.addStyleTag({ content: '#app{height:calc(100dvh - 160px)}' })
    for (const height of [844, 320]) {
      await page.setViewportSize({ width: 390, height })
      await page.evaluate(() => fixture.mount('grouped', 2000))
      const geometry = await page.evaluate(() => {
        const tree = document.querySelector('#app [role="tree"]')
        const row = tree.querySelector('[data-row-key^="session:"]')
        return {
          rowHeight: row.offsetHeight,
          height: tree.clientHeight,
          content: tree.scrollHeight,
          rows: tree.querySelectorAll('[data-row-key^="session:"]').length,
        }
      })
      assert.equal(geometry.rowHeight, 44)
      assert.ok(geometry.content >= geometry.height)
      assert.ok(geometry.rows < 30)
      await page.evaluate(() => {
        document.querySelector('#app [role="tree"]').scrollTop = 100
      })
      assert.ok(await page.evaluate(() => document.querySelector('#app [role="tree"]').scrollTop > 0))
    }
  } finally {
    await page.close()
  }
})

async function drag(page, source, target, cancel = false, outside = false) {
  const first = await source.boundingBox(),
    last = await target.boundingBox()
  await page.mouse.move(first.x + Math.min(80, first.width / 2), first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + 90, first.y + first.height / 2 + 8, { steps: 5 })
  await page.mouse.move(last.x + 80, last.y + last.height * 0.8, { steps: 10 })
  await page.waitForTimeout(80)
  if (outside) await page.mouse.move(800, 300, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(80)
}

test('native Edge session and workspace drags cancel with Escape or outside release; valid row drop commits once', async () => {
  const page = await pageFixture(),
    errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    for (const mode of ['flat', 'grouped']) {
      await page.evaluate(mode => fixture.mount(mode, 3), mode)
      const source = page.locator('#app [data-row-key="session:s0"]'),
        target = page.locator('#app [data-row-key="session:s2"]')
      await drag(page, source, target, true)
      assert.deepEqual(await page.evaluate(() => fixture.records.orders), [])
      assert.ok((await page.evaluate(() => fixture.records.events)).includes('start'))
      await drag(page, source, target, false, true)
      assert.deepEqual(await page.evaluate(() => fixture.records.orders), [])
      await drag(page, source, target)
      const orders = await page.evaluate(() => fixture.records.orders)
      assert.equal(orders.length, 1)
      assert.deepEqual(orders[0][1], ['s1', 's2', 's0'])
    }
    await page.evaluate(() => fixture.mount('workspace-drag', 6))
    await drag(page, page.locator('#app [data-row-key="workspace:w0"]'), page.locator('#app [data-row-key="workspace:w1"]'), true)
    assert.deepEqual(await page.evaluate(() => fixture.records.workspaces), [])
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
