import { test } from 'vitest'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from './helpers/client-build.mjs'
import { chromium, firefox, webkit } from 'playwright-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const result = await build({
  absWorkingDir: root,
  bundle: true,
  write: false,
  outfile: 'fixture.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `
import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkspacePickFlow} from './packages/modern-ui/src/vendor/workspace/client/WorkspacePicker.tsx';
import {ProjectRowItem} from './packages/modern-ui/src/vendor/workspace/client/rows/Rows.tsx';
import hero from './packages/modern-ui/src/vendor/conversation/client/skeleton/HeroShell.module.css';
import browser from './packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.module.css';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
function Fixture(){
const [open,setOpen]=useState(false),[phase,setPhase]=useState('pending'),[items,setItems]=useState([]),[available,setAvailable]=useState(true);const anchor=useRef(null);
window.setSnapshot=(phase,items)=>{setPhase(phase);setItems(items)};window.setAvailable=setAvailable;
return <><div id="hero" style={{display:'flex',width:500,alignItems:'center',justifyContent:'center'}}>
<button id="trigger" ref={anchor} className={hero.workspace} onClick={()=>setOpen(v=>!v)}>Workspace</button>
<WorkspacePickFlow t={key=>key} open={open} anchorRef={anchor} useWorkspaces={select=>select({phase,items})}
useDirectoryFlow={select=>select(available)} createWorkspace={()=>{window.records.created++;return new Promise((resolve,reject)=>{window.resolveAdoption=resolve;window.rejectAdoption=reject})}}
onPick={id=>window.records.picked.push(id)} onClose={()=>setOpen(false)} renderDirectoryFlow={owner=>owner.open?<div role="dialog" aria-label="flow"><button id="pick" disabled={owner.busy} onClick={()=>owner.onPicked('/test')}>pick</button><button id="cancel" onClick={owner.onCancel}>cancel</button></div>:null}/></div>
<div id="row" style={{width:300}}><ProjectRowItem group={{key:'w',workspaceId:'w',label:'Workspace',cwd:'/w',expanded:false}} useWorkspaceAccess={()=>true} useRemoteAccess={()=>true} onToggle={()=>{}} onCreate={()=>{}} actions={{rename(){},delete(){}}} t={key=>key}/></div>
<input id="rename" aria-label="Rename" className={browser.renameInput}/><div className={browser.search+' '+browser.searchExpanded}><input id="search" aria-label="Search" className={browser.searchInput}/></div></>
}window.records={picked:[],created:0};createRoot(document.getElementById('app')).render(<Fixture/>);`,
  },
  plugins: [
    {
      name: 'workspace-primitives',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          loader: 'tsx',
          resolveDir: root,
          contents: `
export * from './packages/modern-ui/src/vendor/primitives/icons/index.tsx';
export {Menu,MenuItemButton} from './packages/modern-ui/src/vendor/primitives/Menu.tsx';
export {Modal} from './packages/modern-ui/src/vendor/primitives/Modal.tsx';
export {Button} from './packages/modern-ui/src/vendor/primitives/Button.tsx';
export {useRowDragPreview} from './packages/modern-ui/src/vendor/primitives/useRowDragPreview.ts';
export {relativeTime} from './packages/modern-ui/src/vendor/primitives/relative-time.ts';
export {writeClipboard} from './packages/modern-ui/src/vendor/primitives/clipboard.ts';
export const HoverCard=({anchor})=>anchor,Tooltip=({children})=>children,StateDot=()=>null;`,
        }))
      },
    },
  ],
  logLevel: 'silent',
})

for (const engine of [chromium, firefox, webkit])
  test(`${engine.name()}: workspace loading, stable anchors, keyboard and touch fields`, async () => {
    const browser = await engine.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>')
      await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
      await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
      const trigger = page.locator('#trigger')
      await trigger.waitFor()
      await page.waitForTimeout(250)
      const rest = await trigger.boundingBox()
      await trigger.hover()
      await page.waitForTimeout(250)
      const hover = await trigger.boundingBox()
      await page.mouse.down()
      await page.waitForTimeout(250)
      const pressed = await trigger.boundingBox()
      await page.mouse.up()
      await page.waitForTimeout(250)
      const opened = await trigger.boundingBox()
      assert.deepEqual(hover, rest)
      assert.deepEqual(pressed, rest)
      assert.deepEqual(opened, rest)
      assert.equal(await page.locator('#hero [role="status"]').count(), 0)
      assert.equal(await page.locator('[role="menu"] [role="status"]').textContent(), 'picker.loading')
      assert.equal(await page.locator('[role="menu"] [role="status"]').getAttribute('tabindex'), null)
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('[role="menu"]').count(), 0)
      await trigger.focus()
      await page.keyboard.press('Enter')
      await page.evaluate(() => window.setSnapshot('ready', [{ workspaceId: 'w', title: 'Workspace', path: '/w' }]))
      await page.locator('[role="menuitemradio"]').waitFor()
      assert.equal(await page.locator('[role="menu"] [role="status"]').count(), 0)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      assert.deepEqual(await page.evaluate(() => window.records.picked), ['w'])
      await page.keyboard.press('Escape')
      await trigger.click()
      await page.getByRole('menuitem', { name: 'menu.addWorkspace' }).click()
      await page.locator('#pick').click()
      assert.equal(await page.locator('#pick').isDisabled(), true)
      assert.equal(await page.evaluate(() => window.records.created), 1)
      await page.evaluate(() => window.rejectAdoption(Error('adoption failed')))
      await page.getByRole('alert').waitFor()
      assert.equal(await page.getByRole('alert').textContent(), 'adoption failed')
      await page.getByRole('button', { name: 'folderError.retry' }).click()
      await page.locator('#cancel').click()
      await page.evaluate(() => {
        window.setAvailable(false)
        window.setSnapshot('pending', [])
      })
      await trigger.click()
      await page.locator('[role="menu"] [role="status"]').waitFor()
      assert.equal(await page.locator('[role="menu"] button').count(), 0)
      await page.keyboard.press('Escape')
      const action = page.locator('#row button').first()
      await page.locator('#row').hover()
      await action.hover()
      await page.waitForTimeout(200)
      const before = await action.boundingBox()
      await page.mouse.down()
      await page.waitForTimeout(200)
      assert.deepEqual(await action.boundingBox(), before)
      await page.mouse.up()
      await page.keyboard.press('Escape')
      await page.locator('#row [role="treeitem"]').hover({ position: { x: 80, y: 15 } })
      const rowBefore = await page.locator('#row [role="treeitem"]').boundingBox()
      await page.mouse.down()
      await page.waitForTimeout(200)
      assert.ok((await page.locator('#row [role="treeitem"]').boundingBox()).y > rowBefore.y + 0.9)
      await page.mouse.up()
      const rename = page.locator('#rename')
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
        await rename.blur()
        const unfocused = await rename.evaluate(e => getComputedStyle(e).borderColor)
        await rename.focus()
        assert.notEqual(await rename.evaluate(e => getComputedStyle(e).borderColor), unfocused)
        assert.equal(await rename.evaluate(e => getComputedStyle(e).outlineStyle), 'none')
      }
      if (engine === chromium) {
        await page.emulateMedia({ forcedColors: 'active' })
        assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true)
        await rename.focus()
        assert.equal(await rename.evaluate(e => getComputedStyle(e).outlineStyle), 'solid')
        assert.equal(await rename.evaluate(e => getComputedStyle(e).outlineWidth), '1px')
      }
      await page.close()
      const touch = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } })
      await touch.setContent('<div id="app"></div>')
      await touch.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
      await touch.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
      for (const id of ['rename', 'search']) assert.ok(await touch.locator('#' + id).evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 16))
      await touch.close()
    } finally {
      await browser.close()
    }
  }, 30_000)
