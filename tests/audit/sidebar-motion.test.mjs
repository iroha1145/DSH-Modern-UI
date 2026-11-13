import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.env.AUDIT_SOURCE_ROOT ?? path.resolve(import.meta.dirname, '../..')
const artifactRoot = path.resolve(import.meta.dirname, '../../.artifacts/motion')
await mkdir(artifactRoot, { recursive: true })
const directory = await mkdtemp(path.join(artifactRoot, 'sidebar-run-'))
const previousTemp = Object.fromEntries(['TMP', 'TEMP', 'TMPDIR'].map(key => [key, process.env[key]]))
for (const key of Object.keys(previousTemp)) process.env[key] = directory
const result = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useSyncExternalStore} from 'react';import {createRoot} from 'react-dom/client';
import {AppFrame} from './packages/modern-ui/src/vendor/layout/AppFrame.tsx';
import {createLayoutStore} from './packages/modern-ui/src/vendor/layout/stores.ts';
import {SidebarRoot} from './packages/modern-ui/src/vendor/sidebar/client/SidebarRoot.tsx';
import {en} from './packages/modern-ui/src/vendor/sidebar/client/locales.ts';
import frame from './packages/modern-ui/src/vendor/layout/AppFrame.module.css';
import sidebar from './packages/modern-ui/src/vendor/sidebar/client/SidebarRoot.module.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
const store=createLayoutStore().create();
const useStore=selector=>useSyncExternalStore(store.subscribe,()=>selector(store.getSnapshot()));
const usePanelInfo=selector=>useStore(s=>selector(s.panelInfo));
const useModernViewport=selector=>useStore(s=>selector({mobile:s.layoutInfo.viewportWidth<=640}));
const sessions={byId:{}};const stable=value=>selector=>selector(value);const noop=()=>{};const t=key=>en[key]??key;
const sidebarSlot=(name,p,options)=>name==='sidebar.workspaces'?<div data-motion-workspace={p.wide?'wide':'rail'}>Workspace</div>:options?.fallback??null;
const renderSlot=(name,p)=>name==='sidebar'?<SidebarRoot {...p} useModernViewport={useModernViewport} buildVersion="0.2.1-test" startSession={()=>window.started++} toggleSidebar={store.actions.toggleSidebar}
 selectPanel={store.actions.selectPanel} setPinned={noop} trackEntryClick={noop} useRemoteAccess={()=>true} useSessions={stable(sessions)} usePanels={stable([{id:'chat',label:'Conversations'}])} useEntryPins={stable([])} useEntryActions={stable(false)} useShortcuts={stable([])} usePanelInfo={usePanelInfo} t={t} renderSlot={sidebarSlot}/>
 :name==='main'?<main data-motion-main><button id="outside">Main action</button></main>:null;
window.started=0;createRoot(document.getElementById('app')).render(<AppFrame useStore={useStore} useSessions={stable(sessions)} usePanelInfo={usePanelInfo} actions={store.actions} renderSlot={renderSlot} t={t}/>);
function snapshot(){
 const shell=document.querySelector('.'+frame.frame);const col=shell.querySelector('.'+frame.sidebarCol);const content=shell.querySelector('.'+frame.centerCol);const side=shell.querySelector('.'+sidebar.root);const glyph=side.querySelector('.'+sidebar.panelGlyph);const handle=shell.querySelector('[data-side="sidebar"]');
 const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};
 const opacity=el=>{let value=1;for(let node=el;node&&node!==side.parentElement;node=node.parentElement)value*=Number(getComputedStyle(node).opacity);return value};
 return {time:performance.now(),viewport:store.getSnapshot().layoutInfo.viewportWidth,frameWidth:shell.getBoundingClientRect().width,track:rect(col),center:rect(content),sidebar:rect(side),body:rect(side.querySelector('.'+sidebar.panelList)),workspaceWide:side.querySelector('[data-motion-workspace]').dataset.motionWorkspace==='wide',glyph:rect(glyph),handle:rect(handle),glyphOpacity:opacity(glyph),hidden:side.hidden,inert:side.inert,ariaHidden:side.getAttribute('aria-hidden'),role:side.getAttribute('role'),display:getComputedStyle(side).display,collapsed:shell.hasAttribute('data-sidebar-collapsed'),animating:shell.hasAttribute('data-animating'),dragging:shell.hasAttribute('data-dragging'),rail:side.classList.contains(sidebar.collapsed),drawerOpen:side.hasAttribute('data-drawer-open'),transform:getComputedStyle(side).transform,animations:document.getAnimations().filter(a=>a.playState==='running').length};
}
window.motionFixture={snapshot,toggle:()=>store.actions.toggleSidebar(),resize:width=>document.getElementById('app').style.width=width+'px',
 async sample(steps,duration){const start=performance.now();const frames=[];let next=0;return new Promise(resolve=>{function frame(){const elapsed=performance.now()-start;while(next<steps.length&&elapsed>=steps[next].at){const step=steps[next++];if(step.type==='toggle')store.actions.toggleSidebar();else document.getElementById('app').style.width=step.width+'px'}frames.push({...snapshot(),elapsed});if(elapsed>=duration)resolve(frames);else requestAnimationFrame(frame)}requestAnimationFrame(frame)})}};
`,
  },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  plugins: process.env.SIDEBAR_MOTION_BASELINE_REF
    ? [
        {
          name: 'sidebar-motion-baseline',
          setup(builder) {
            builder.onLoad({ filter: /(?:layout[\\/]AppFrame|sidebar[\\/]client[\\/]SidebarRoot)\.(?:tsx|module\.css)$/ }, args => ({
              contents: execFileSync('git', ['show', process.env.SIDEBAR_MOTION_BASELINE_REF + ':' + path.relative(root, args.path).replaceAll('\\', '/')], {
                cwd: root,
                encoding: 'utf8',
              }),
              loader: args.path.endsWith('.css') ? 'local-css' : 'tsx',
              resolveDir: path.dirname(args.path),
            }))
          },
        },
      ]
    : [],
  write: false,
  outfile: 'sidebar.js',
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
const evidence = {
  browser: await browser.version(),
  baselineRef: process.env.SIDEBAR_MOTION_BASELINE_REF ?? null,
  fixture:
    'real AppFrame, SidebarRoot, layout store, Feel/base tokens and primitive implementations; simplified workspace/panel slots and empty session source',
  cases: [],
}
afterAll(async () => {
  await browser.close()
  if (process.env.SIDEBAR_MOTION_EVIDENCE) await writeFile(path.resolve(process.env.SIDEBAR_MOTION_EVIDENCE), JSON.stringify(evidence, null, 2))
  await rm(directory, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousTemp))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})
async function open({ platform, ...options } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options })
  const page = await context.newPage()
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0}body{font:14px Arial}button{font:inherit}:root{--dsw-alias-label-primary:#111;--dsw-alias-state-business-primary:#06c;--dsw-alias-bg-base:#fff;--dsw-radius-panel:16px;--dsw-alias-bg-mask-1:#0004;--dsw-alias-bg-layer-2:#fff}</style><div id="app"></div>',
  )
  await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
  if (platform)
    await page.evaluate(value => {
      if (value === 'windows') {
        document.documentElement.setAttribute('data-windows-titlebar', '')
        document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '32px')
      } else document.documentElement.dataset.platform = value
    }, platform)
  await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.waitForFunction(() => window.motionFixture && document.querySelector('[data-motion-main]'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return { page, context }
}

test('desktop collapse crossfades without a translated rail jump, including rapid reversal', async () => {
  const { page, context } = await open()
  try {
    const collapse = await page.evaluate(() => motionFixture.sample([{ at: 0, type: 'toggle' }], 380))
    const reverse = await page.evaluate(() =>
      motionFixture.sample(
        [
          { at: 0, type: 'toggle' },
          { at: 70, type: 'toggle' },
          { at: 120, type: 'toggle' },
        ],
        500,
      ),
    )
    evidence.cases.push({ name: 'desktop', collapse, reverse })
    const steps = collapse.slice(1).map((frame, index) => Math.abs(frame.glyph.x - collapse[index].glyph.x))
    assert.ok(Math.max(...steps) < 25, `Rail icon jumped ${Math.max(...steps)}px in one frame`)
    assert.ok(Math.abs(collapse.at(-1).track.width - 68) < 1)
    assert.ok(reverse.every(frame => frame.track.width >= 67 && frame.track.width <= 265))
    assert.ok(
      reverse.filter(frame => frame.handle).every(frame => Math.abs(frame.handle.x + 4 - frame.center.x) < 1),
      'Sidebar resize handle left the live grid edge',
    )
    assert.ok(Math.abs(reverse.at(-1).track.width - 264) < 1)
  } finally {
    await context.close()
  }
})

for (const platform of [undefined, 'windows', 'darwin'])
  test(`the ${platform ?? 'web'} capsule follows the whole closing track with one frozen content tree`, async () => {
    const { page, context } = await open({ platform })
    try {
      const initial = await page.evaluate(() => motionFixture.snapshot())
      // The capsule's inset is CSS and its frozen content width is computed in SidebarRoot.tsx; the two must agree,
      // or the content stops short of the capsule's inline padding. The macOS shell uses the narrower inset.
      const inset = platform === 'darwin' ? 8 : 16
      assert.ok(Math.abs(initial.sidebar.x - initial.track.x - inset) < 1, `Capsule inset is ${initial.sidebar.x - initial.track.x}px`)
      assert.ok(Math.abs(initial.sidebar.right - initial.body.right - 12) < 1, `Content ends ${initial.sidebar.right - initial.body.right}px inside the capsule`)
      await page.evaluate(() => {
        window.workspaceElement = document.querySelector('[data-motion-workspace]')
      })
      const frames = await page.evaluate(() => motionFixture.sample([{ at: 0, type: 'toggle' }], 460))
      evidence.cases.push({ name: `continuous-${platform ?? 'web'}`, frames })
      const moving = frames.filter(frame => frame.animating && frame.track.width > (platform ? 40 : 68.5) && frame.elapsed > 30)
      assert.ok(moving.length > 3)
      assert.ok(
        moving.some(frame => frame.elapsed > 140),
        'The regression must sample after the old 120ms content swap',
      )
      for (const frame of moving) {
        assert.ok(Math.abs(frame.sidebar.right - frame.center.x) < 1, JSON.stringify(frame))
        assert.ok(Math.abs(frame.body.width - initial.body.width) < 1, 'Wide content reflowed during the column transition')
        assert.ok(Math.abs(frame.glyph.y - initial.glyph.y) < 1, 'Navigation rows jumped vertically during collapse')
        assert.equal(frame.workspaceWide, true)
      }
      assert.equal(await page.evaluate(() => window.workspaceElement === document.querySelector('[data-motion-workspace]')), true)
      const end = frames.at(-1)
      assert.equal(end.animating, false)
      if (platform) {
        assert.equal(end.hidden, true)
        assert.ok(end.center.x < 1)
      } else {
        assert.equal(end.rail, true)
        assert.equal(end.sidebar.width, 52)
      }
    } finally {
      await context.close()
    }
  })

test('reversing before the column settles keeps the same wide content and continues its geometry', async () => {
  const { page, context } = await open()
  try {
    const frames = await page.evaluate(() =>
      motionFixture.sample(
        [
          { at: 0, type: 'toggle' },
          { at: 170, type: 'toggle' },
        ],
        550,
      ),
    )
    evidence.cases.push({ name: 'wide-content-reversal', frames })
    assert.ok(frames.every(frame => frame.workspaceWide && Math.abs(frame.body.width - frames[0].body.width) < 1))
    const jumps = frames.slice(1).map((frame, index) => Math.abs(frame.sidebar.width - frames[index].sidebar.width))
    assert.ok(Math.max(...jumps) < 35, `Capsule jumped ${Math.max(...jumps)}px during reversal`)
    assert.ok(Math.abs(frames.at(-1).sidebar.width - 248) < 1)
  } finally {
    await context.close()
  }
})

test('resizing an in-flight toggle cancels track easing instead of chasing the new width', async () => {
  const { page, context } = await open()
  try {
    const frames = await page.evaluate(() =>
      motionFixture.sample(
        [
          { at: 0, type: 'toggle' },
          { at: 70, type: 'resize', width: 1100 },
          { at: 120, type: 'resize', width: 1050 },
        ],
        260,
      ),
    )
    evidence.cases.push({ name: 'resize-interruption', frames })
    const resized = frames.filter(frame => frame.viewport === 1100 || frame.viewport === 1050)
    assert.ok(resized.length > 0)
    assert.ok(
      resized.every(frame => !frame.animating),
      'Viewport-driven geometry retained a discrete-toggle transition',
    )
    assert.ok(resized.every(frame => Math.abs(frame.track.width - 68) < 1))
  } finally {
    await context.close()
  }
})

test('pointer resizing keeps the handle on the live column edge and ends without easing', async () => {
  const { page, context } = await open()
  try {
    const handle = page.locator('[data-side="sidebar"]')
    const box = await handle.boundingBox()
    const origin = box.x + box.width / 2
    await page.mouse.move(origin, 200)
    await page.mouse.down()
    await page.waitForFunction(() => motionFixture.snapshot().dragging)
    const frames = []
    for (const dx of [20, 40, 75]) {
      await page.mouse.move(origin + dx, 200)
      await page.waitForFunction(width => Math.abs(motionFixture.snapshot().track.width - width) < 1, 264 + dx)
      frames.push(await page.evaluate(() => motionFixture.snapshot()))
    }
    await page.mouse.up()
    await page.waitForFunction(() => !motionFixture.snapshot().dragging)
    const end = await page.evaluate(() => motionFixture.snapshot())
    evidence.cases.push({ name: 'pointer-drag', frames, end })
    assert.ok(frames.every(frame => !frame.animating && Math.abs(frame.handle.x + 4 - frame.center.x) < 1))
    assert.equal(end.track.width, 339)
    assert.equal(end.animating, false)
  } finally {
    await context.close()
  }
})

test('mobile drawer keeps an inert visual exit and can reverse without restarting offscreen', async () => {
  const { page, context } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    await page.locator('[data-mobile-navigation] button').first().click()
    await page.getByRole('dialog').waitFor()
    await page.evaluate(() => motionFixture.sample([], 350))
    const close = await page.evaluate(() => motionFixture.sample([{ at: 0, type: 'toggle' }], 340))
    const reverse = await page.evaluate(() =>
      motionFixture.sample(
        [
          { at: 0, type: 'toggle' },
          { at: 75, type: 'toggle' },
          { at: 130, type: 'toggle' },
        ],
        500,
      ),
    )
    evidence.cases.push({ name: 'mobile', close, reverse })
    const exiting = close.filter(frame => frame.elapsed > 40 && frame.elapsed < 200)
    assert.ok(
      exiting.every(frame => !frame.hidden),
      'The drawer disappeared before its closing motion',
    )
    assert.ok(exiting.every(frame => frame.inert && frame.ariaHidden === 'true' && frame.role === null))
    assert.ok(close.at(-1).hidden)
    assert.ok(reverse.every(frame => frame.sidebar.x >= -341 && frame.sidebar.x <= 1))
    assert.ok(Math.abs(reverse.at(-1).sidebar.x) < 1)
    await page.getByRole('button', { name: 'Close navigation panel' }).click()
    await page.waitForFunction(() => document.querySelector('[data-mobile-navigation] button') === document.activeElement)
  } finally {
    await context.close()
  }
})

test('reduced motion reaches the collapsed rail and closed drawer without a settle delay', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' })
  try {
    await page.evaluate(() => motionFixture.toggle())
    await page.waitForFunction(() => motionFixture.snapshot().collapsed)
    const desktop = await page.evaluate(() => motionFixture.snapshot())
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.evaluate(() => motionFixture.toggle())
    await page.waitForFunction(() => motionFixture.snapshot().collapsed)
    const mobile = await page.evaluate(() => motionFixture.snapshot())
    evidence.cases.push({ name: 'reduced-motion', desktop, mobile })
    assert.equal(desktop.rail, true)
    assert.equal(desktop.animations, 0)
    assert.equal(mobile.hidden, true)
    assert.equal(mobile.animations, 0)
  } finally {
    await context.close()
  }
})

test('enabling reduced motion during a toggle cancels both feedback and track motion', async () => {
  const { page, context } = await open()
  try {
    await page.evaluate(() => motionFixture.toggle())
    await page.waitForFunction(() => motionFixture.snapshot().animating)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const state = await page.evaluate(() => motionFixture.snapshot())
    evidence.cases.push({ name: 'reduced-motion-interruption', state })
    assert.equal(state.animating, false)
    assert.equal(state.rail, true)
    assert.equal(state.animations, 0)
    assert.equal(state.track.width, 68)
  } finally {
    await context.close()
  }
})

test('reduced-motion sidebar controls retain their geometry on hover and press', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' })
  try {
    const panel = page.getByRole('button', { name: 'Conversations', exact: true })
    const initial = await panel.boundingBox()
    await panel.hover()
    await page.mouse.down()
    const state = await panel.evaluate(element => {
      const box = element.getBoundingClientRect()
      return {
        x: box.x,
        y: box.y,
        transform: getComputedStyle(element).transform,
        transitions: element.getAnimations({ subtree: true }).length,
        glyphTransform: getComputedStyle(element.firstElementChild).transform,
      }
    })
    assert.equal(state.x, initial.x)
    assert.equal(state.y, initial.y)
    assert.equal(state.transform, 'none')
    assert.equal(state.glyphTransform, 'none')
    assert.equal(state.transitions, 0)
    await page.mouse.up()
  } finally {
    await context.close()
  }
})
