import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, '.artifacts/frontend-audit-20261111')
await mkdir(out, { recursive: true })
const directory = await mkdtemp(path.join(out, 'sidebar-short-run-'))
const previousTemp = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(key => [key, process.env[key]]))
for (const key of Object.keys(previousTemp)) process.env[key] = directory
const fixture = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SidebarRoot} from './packages/modern-ui/src/vendor/sidebar/client/SidebarRoot.tsx';
import {en} from './packages/modern-ui/src/vendor/sidebar/client/locales.ts';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';import './packages/modern-ui/src/vendor/theme/styles/base.css';
const stable=value=>selector=>selector(value);const noop=()=>{};
function Workspace(){const [search,setSearch]=useState(false);return <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
 <div style={{height:42,flex:'none',display:'flex'}}><button data-layout-kind="search" aria-label="Search sessions" onClick={()=>setSearch(true)}>Search</button>{search&&<input data-layout-kind="search" aria-label="Search sessions" autoFocus style={{minWidth:0,width:'100%',fontSize:16}}/>}</div>
 <div data-session-list style={{overflowY:'auto',flex:1,minHeight:0}}>{Array.from({length:10},(_,i)=><button key={i} data-layout-kind="session" style={{display:'block',height:44,width:'100%'}}>Session {i}</button>)}</div>
 </div>}
function Demo(){const [collapsed,setCollapsed]=useState(true);return <SidebarRoot collapsed={collapsed} width={innerWidth} useModernViewport={stable({mobile:true})} buildVersion="test" startSession={noop} toggleSidebar={()=>setCollapsed(v=>!v)} selectPanel={noop} setPinned={noop} trackEntryClick={noop} useRemoteAccess={()=>true} useSessions={stable({byId:{}})} usePanels={stable([{id:'plugins',label:'Plugins'},{id:'schedules',label:'Automation tasks'}])} useEntryPins={stable([])} useEntryActions={stable(true)} useShortcuts={stable([])} usePanelInfo={stable({})} t={key=>en[key]??key}
renderSlot={(name,p,options)=>name==='sidebar.workspaces'?<Workspace/>:name==='sidebar.settings'?<button data-layout-kind="settings" style={{height:44,width:'100%'}}>Settings</button>:options?.fallback??null}/>}
createRoot(document.getElementById('app')).render(<Demo/>);`,
  },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  outfile: 'sidebar-short.js',
  write: false,
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
const evidence = []
afterAll(async () => {
  await browser.close()
  await writeFile(path.join(out, 'sidebar-short-viewport-regression.json'), JSON.stringify(evidence, null, 2))
  await rm(directory, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousTemp))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})

for (const [width, height] of [
  [390, 260],
  [390, 320],
  [640, 300],
  [390, 844],
])
  test(`short mobile drawer search, sessions and settings remain reachable at ${width}×${height}`, async () => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    const row = { width, height, focus: [] }
    evidence.push(row)
    try {
      await page.setContent(
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;font:14px Arial}:root{--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#111;--dsw-alias-bg-mask-1:#0004}</style><div id="app"></div>',
      )
      await page.addStyleTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.css')).text })
      await page.addScriptTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.js')).text })
      const trigger = page.locator('[data-mobile-navigation] button').first()
      await trigger.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
      await page.getByRole('button', { name: 'Search sessions', exact: true }).click()
      await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('Session')
      await page.getByRole('button', { name: 'Session 0', exact: true }).click()
      await page.getByRole('button', { name: 'Session 9', exact: true }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const close = page.getByRole('button', { name: 'Close navigation panel', exact: true })
      await close.focus()
      const seen = new Set()
      for (let at = 0; at < 26; at++) {
        const focus = await page.evaluate(() => {
          const side = document.querySelector('[data-mobile-drawer]')
          const active = document.activeElement
          const rect = el => {
            const r = el.getBoundingClientRect()
            return { top: r.top, bottom: r.bottom, height: r.height }
          }
          const heading = [...side.children].find(el => [...el.classList].some(name => name.endsWith('_mobileHeading')))
          const bounds = active.getBoundingClientRect()
          const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          return {
            kind: heading.contains(active) ? 'close' : active.dataset.layoutKind,
            label: active.textContent || active.getAttribute('aria-label'),
            active: rect(active),
            heading: rect(heading),
            side: rect(side),
            hit: active === hit || active.contains(hit),
            scrollTop: side.scrollTop,
          }
        })
        row.focus.push(focus)
        if (focus.kind) seen.add(focus.kind)
        assert.ok(focus.active.top >= focus.side.top - 1 && focus.active.bottom <= focus.side.bottom + 1, JSON.stringify(focus))
        if (focus.kind !== 'close') assert.ok(focus.active.top >= focus.heading.bottom - 1, JSON.stringify(focus))
        assert.equal(focus.hit, true, JSON.stringify(focus))
        await page.keyboard.press('Tab')
      }
      assert.deepEqual([...seen].sort(), ['close', 'search', 'session', 'settings'])
      await close.click()
      await page.waitForFunction(() => document.activeElement === document.querySelector('[data-mobile-navigation] button'))
    } finally {
      await context.close()
    }
  })
