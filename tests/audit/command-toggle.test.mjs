import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterAll, test } from 'vitest'
import { chromium } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const officialTrigger = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-input-trigger/client'), 'utf8')
// Load the published controller and capture the actual registered MenuView.
// InputBar, Lexical focus/selection commits and document pointer dismissal are real.
const result = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useSyncExternalStore} from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createEditor,$getRoot,$createParagraphNode,$createTextNode,$getSelection,$isRangeSelection} from 'lexical';
import {registerPlainText} from '@lexical/plain-text';
import {InputBar} from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.tsx';
const store=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}};
window.__ModuleLoader__={load({factory}){window.triggerPlugin=factory(name=>({
  'react':React,'react/jsx-runtime':JSXRuntime,'@deepseek-ai/cordis':{Service:class{}},
  '@deepseek-ai/dsh-client-store':{createSnapshotStore:store},
  '@deepseek-ai/dsh-client-ui-primitives':{
    useAnchoredMaxHeight:()=>400,MenuSurface:React.forwardRef(({children,...props},ref)=><div {...props} ref={ref}>{children}</div>),
  },
})[name])}};
window.mountCommandFixture=()=>{
  const events=[];
  const source={name:'command',trigger:'/',title:'Commands',candidates:async()=>[{id:'help',name:'Help'}]};
  const controller=new window.triggerPlugin.InputTriggerController({sessionId:'fixture',roster:{all:()=>[source],sources:()=>[source]}});
  let MenuView;
  const scope={inputTriggers:{sessionOf:()=>controller},sessions:{scope:()=>({})},slots:{inject:(_name,fn)=>fn(),register:(_options,view)=>{MenuView=view}}};
  window.triggerPlugin.apply({plugin(){},effect(){},inject:(_names,fn)=>fn(scope)});
  const editor=createEditor({namespace:'command-toggle',onError:error=>{throw error}});
  registerPlainText(editor);
  editor.update(()=>{$getRoot().append($createParagraphNode().append($createTextNode('Existing draft')))},{discrete:true});
  // This is the official InputMachine.onEditorUpdate contract: every editor
  // commit, including a selection-only focus commit, feeds controller.track.
  editor.registerUpdateListener(({editorState})=>editorState.read(()=>{
    const selection=$getSelection();
    if($isRangeSelection(selection)){
      events.push({type:'track',launcher:controller.launcher.getSnapshot()});
      controller.track($getRoot().getTextContent(),selection.anchor.offset,{tier:'plain'},0);
    }
  }));
  const bind=value=>select=>select(value);
  const keyboard={editor,bindFilePicker:()=>()=>{},arbitrate:(key,composing)=>controller.arbitrate(key,composing),dismissPopup(){},space:()=>false,submit(){},caretSpan:()=>editor.getEditorState().read(()=>{const s=$getSelection();return {start:s?.anchor.offset??0,end:s?.focus.offset??0}})};
  const toggle=span=>{events.push({type:'toggle',launcher:controller.launcher.getSnapshot(),span});controller.toggleSource('command',{trigger:'/',query:'',quoted:false,position:'leading',span:{...span,draftRev:0}})};
  const menuProps={menu:controller.menu,headers:controller.headers,onPick:()=>{},onCrumb:()=>{},onHover:()=>{},onDismiss:()=>{events.push({type:'outside-dismiss'});controller.dismiss()},t:key=>key};
  function Demo(){return <InputBar sessionId="fixture" variant="composer" useSession={bind({running:false})}
    useInput={bind({draft:'Existing draft',attachmentIds:[],queue:[],phase:'plain'})} inputActions={{pruneAttachments(){}}}
    keyboard={keyboard} toggleCommandMenu={toggle} useBusyEnter={bind('queue')} useFileUploads={bind({})}
    useNotices={bind(undefined)} useLexicon={bind(undefined)} useStopShortcut={bind([])} useAccess={()=>true}
    useMenuLauncher={select=>useSyncExternalStore(controller.launcher.subscribe,()=>select(controller.launcher.getSnapshot()))}
    useProjection={(_name,select)=>select?.(undefined)} t={key=>key}
    renderSlot={name=>name==='conversation.input.overlay'?<MenuView {...menuProps}/>:null}/>}
  flushSync(()=>createRoot(document.getElementById('app')).render(<Demo/>));
  window.commandFixture={events,state:()=>({open:controller.menu.getSnapshot().open,launcher:controller.launcher.getSnapshot(),text:editor.getEditorState().read(()=>$getRoot().getTextContent()),selection:keyboard.caretSpan()}),
    select:()=>{editor.getRootElement().focus();editor.update(()=>{$getRoot().getFirstChild().getFirstChild().select(3,8)},{discrete:true})}};
};`,
  },
  bundle: true,
  write: false,
  outfile: 'command-fixture.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'command-surroundings',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onResolve({ filter: /\.\/runtime\.ts$/ }, args =>
          args.importer.endsWith('view-binding.ts') ? { path: args.path, namespace: 'fixture' } : undefined,
        )
        builder.onResolve({ filter: /(?:ContextMeter\.tsx|original-image-drop\.ts)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents:
            args.path === 'primitives'
              ? `import React from 'react';export const QuotePreview=()=>null;export const formatQuoteText=()=>'';export const isMobileDevice=()=>false;export const focusWithoutRing=(el,options)=>el.focus(options);export const IconPlusOutlineMedium=()=>null;export const IconWarningOutlineRegular=()=>null;export const Toast=()=>null;export const Tooltip=({children})=>children;export const HoverCardGroup=({children,...props})=><div {...props}>{children}</div>;`
              : args.path.endsWith('runtime.ts')
                ? `export const DRAFT_SUBMITTED_TAG='draft-submitted';`
                : args.path.endsWith('ContextMeter.tsx')
                  ? 'export const ContextMeter=()=>null;'
                  : 'export const useOriginalImageDrop=()=>{};',
          loader: 'tsx',
          resolveDir: root,
        }))
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

async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 600, height: 700 }, ...options })
  await page.setContent('<div id="app"></div><button id="outside">Outside</button>')
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.addScriptTag({ content: officialTrigger })
  await page.evaluate(() => window.mountCommandFixture())
  await page.evaluate(() => window.commandFixture.select())
  return page
}

async function check(page, open) {
  await page.waitForFunction(expected => window.commandFixture.state().open === expected, open)
  assert.equal(await page.getByRole('button', { name: 'input.commands', exact: true }).getAttribute('aria-expanded'), String(open))
  assert.equal(await page.locator('[data-trigger-menu]').count(), open ? 1 : 0)
  assert.equal(await page.evaluate(() => window.commandFixture.state().text), 'Existing draft')
}

test('command launcher closes on its second mouse press without outside dismissal or caret mutation', async () => {
  const page = await open()
  try {
    const button = page.getByRole('button', { name: 'input.commands', exact: true })
    await button.click()
    await check(page, true)
    await button.click()
    await check(page, false)
    const events = await page.evaluate(() => window.commandFixture.events)
    assert.equal(events.filter(event => event.type === 'outside-dismiss').length, 0)
    assert.deepEqual(
      events.filter(event => event.type === 'toggle').map(event => event.launcher),
      [null, 'command'],
    )
    assert.deepEqual(await page.evaluate(() => window.commandFixture.state().selection), { start: 3, end: 8 })
    assert.equal(await page.locator('[data-composer-input]').evaluate(element => element === document.activeElement), true)
  } finally {
    await page.close()
  }
})

test('command launcher supports touch toggling, outside dismissal and Escape', async () => {
  const page = await open({ hasTouch: true, isMobile: true })
  try {
    const button = page.getByRole('button', { name: 'input.commands', exact: true })
    await button.tap()
    await check(page, true)
    await button.tap()
    await check(page, false)
    await button.tap()
    await check(page, true)
    await page.locator('#outside').tap()
    await check(page, false)
    await button.tap()
    await check(page, true)
    await page.keyboard.press('Escape')
    await check(page, false)
  } finally {
    await page.close()
  }
})

test('command launcher toggles from Enter and Space activation', async () => {
  const page = await open()
  try {
    const button = page.getByRole('button', { name: 'input.commands', exact: true })
    for (const key of ['Enter', 'Space']) {
      await button.focus()
      await page.keyboard.press(key)
      await check(page, true)
      assert.equal(await page.locator('[data-composer-input]').evaluate(element => element === document.activeElement), true)
      await button.focus()
      await page.keyboard.press(key)
      await check(page, false)
    }
  } finally {
    await page.close()
  }
})
