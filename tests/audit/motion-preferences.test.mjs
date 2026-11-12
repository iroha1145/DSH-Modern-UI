import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const fixture = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {SessionNodeItem} from './packages/modern-ui/src/vendor/workspace/client/rows/Rows.tsx';
import {deriveFlat} from './packages/modern-ui/src/vendor/workspace/client/tree.ts';
import rowsCss from './packages/modern-ui/src/vendor/workspace/client/rows/Rows.module.css';
import {createFlowMotion} from './packages/modern-ui/src/vendor/chat/client/chat/flow-motion.ts';
import {ScrollFollow,scrollMetrics} from './packages/modern-ui/src/vendor/chat/client/chat/use-scroll-follow.ts';
import './packages/modern-ui/src/vendor/settings-shell/settings-shell.css';
const list={phase:'ready',ids:['one'],byId:{one:{id:'one',title:'A long session title whose final words need to remain readable '.repeat(12),blank:false,running:false,retainedBy:{},updatedAt:1}},projectionsBySession:{}};
const node=deriveFlat(list,list.ids,{pinnedSessionIds:[],archivedSessionIds:[],archivedFilter:'default'},new Map())[0];
createRoot(document.getElementById('app')).render(<SessionNodeItem node={node} currentId={undefined} now={2} onOpen={()=>{}} onRenameRequest={()=>{}} renderSlot={()=>null} useSessionAccess={()=>true} t={key=>key}/>);
window.readTitle=()=>{const title=document.querySelector('.'+rowsCss.title);return {left:title.scrollLeft,range:title.scrollWidth-title.clientWidth,scrolled:title.hasAttribute('data-scrolled'),clipped:title.hasAttribute('data-clipped')}};
window.observePreference=()=>{window.preferenceChanged=new Promise(resolve=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',()=>requestAnimationFrame(()=>resolve()),{once:true});
})};
let flow,record,unbind;const scroller=document.getElementById('scroller');
window.startFlow=withDriver=>{
 const closing=document.getElementById('closing'),opening=document.getElementById('opening');closing.hidden=false;opening.hidden=false;
 record={done:0,folding:[],progress:[],finished:[]};
 const driver={begin:()=>new Set(),prepare:()=>{},frame:(progress,cancelled)=>{record.progress.push(progress);return 0},finish:cancelled=>record.finished.push(cancelled)};
 flow=createFlowMotion(()=>withDriver?driver:null,active=>record.folding.push(active));
 flow.collapse(closing,()=>{closing.hidden=true;record.done++});flow.reveal(opening);
};
window.readFlow=()=>({active:flow.inputActive(),folding:flow.foldActive(),closingHidden:document.getElementById('closing').hidden,
closingHeight:document.getElementById('closing').getBoundingClientRect().height,openingHeight:document.getElementById('opening').getBoundingClientRect().height,
animations:document.getAnimations().length,record});
window.clearFlow=()=>flow.clear();
window.startScroll=bound=>{const follow=new ScrollFollow(false,20);window.follow=follow;
 if(bound)unbind=follow.bind(scroller);window.scrollCalls=[];const native=scroller.scrollTo.bind(scroller);
 scroller.scrollTo=options=>{window.scrollCalls.push(options);native(options)};
 follow.toBottom(scroller,scrollMetrics(scroller),'smooth');};
window.growScroll=()=>{document.getElementById('long-content').style.height='3600px';if(window.follow.active)window.follow.toBottom(scroller,scrollMetrics(scroller),'instant')};
window.interruptScroll=()=>{window.follow.interrupt(scroller,scrollMetrics(scroller));window.follow.setFollowing(false)};
window.readScroll=()=>({...scrollMetrics(scroller),active:window.follow.active,animating:window.follow.animating,calls:window.scrollCalls});
window.cleanupScroll=()=>{unbind?.();window.follow.interrupt(scroller,scrollMetrics(scroller))};`,
  },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  outfile: 'motion-preferences.js',
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  logLevel: 'silent',
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

async function open() {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(`<style>
body{margin:0;font:14px Arial;--ease-spring:ease;--ink-2:#555;--ink:#111;--hover:#eee}
#app{width:240px}button{font:inherit}
#controls{display:flex;gap:20px;margin:40px}#controls button{display:block;width:140px;background:white;border:0}
#closing{height:200px;margin-top:12px}#opening{height:120px;margin-top:8px}
#scroller{height:200px;width:300px;overflow:auto;overflow-anchor:none}#long-content{height:3000px}
</style><div id="app"></div>
<div id="controls"><div data-modern-settings-seat><button id="account" aria-haspopup="menu" data-signed-out="true">Account</button><button id="settings" aria-haspopup="dialog" aria-expanded="false">Settings</button></div>
<div role="dialog" data-shortcut-modal="settings"><nav><div><button id="section" aria-current="true">General</button></div></nav></div></div>
<div id="flow"><div id="closing">Closing content</div><div id="opening">Opening content</div></div>
<div id="scroller"><div id="long-content">Conversation</div></div>`)
  await page.addStyleTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.locator('[data-row-key="session:one"]').waitFor()
  return { context, page, errors }
}

async function reduce(page) {
  await page.evaluate(() => window.observePreference())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.preferenceChanged)
}

for (const id of ['account', 'settings', 'section'])
  test(`settings ${id} stops a running press transition at its unshifted position`, async () => {
    const { context, page, errors } = await open()
    try {
      const button = page.locator('#' + id)
      const before = await button.boundingBox()
      await button.hover()
      await page.mouse.down()
      await page.waitForFunction(
        id => {
          const button = document.getElementById(id)
          return button.getBoundingClientRect().y > Number(button.dataset.initialY) + 0.1
        },
        await button.evaluate((element, top) => {
          element.dataset.initialY = String(top)
          return element.id
        }, before.y),
      )
      await reduce(page)
      const after = await button.evaluate(element => ({
        top: element.getBoundingClientRect().y,
        transform: getComputedStyle(element).transform,
        duration: getComputedStyle(element).transitionDuration,
        animations: element.getAnimations().length,
      }))
      assert.equal(after.top, before.y)
      assert.equal(after.transform, 'none')
      assert.equal(after.duration, '0s')
      assert.equal(after.animations, 0)
      await page.mouse.up()
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  })

test('an already crawling session title jumps to its readable tail and stays there after reduced motion changes', async () => {
  const { context, page, errors } = await open()
  try {
    await page.locator('[data-row-key="session:one"]').hover()
    await page.waitForFunction(() => {
      const title = window.readTitle()
      return title.left > 1 && title.left < title.range - 100
    })
    await reduce(page)
    const landed = await page.evaluate(() => window.readTitle())
    assert.ok(Math.abs(landed.left - landed.range) <= 1)
    assert.equal(landed.scrolled, true)
    assert.equal(landed.clipped, false)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal((await page.evaluate(() => window.readTitle())).left, landed.left)
    await page.mouse.move(1000, 800)
    assert.equal((await page.evaluate(() => window.readTitle())).left, 0)
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
})

for (const withDriver of [true, false])
  test(`active ${withDriver ? 'shared fold batch' : 'row CSS folds'} finish their real final state on reduced motion change`, async () => {
    const { context, page, errors } = await open()
    try {
      await page.evaluate(value => window.startFlow(value), withDriver)
      await page.waitForFunction(() => {
        const flow = window.readFlow()
        return flow.folding && flow.closingHeight > 10 && flow.closingHeight < 195
      })
      const moving = await page.evaluate(() => window.readFlow())
      assert.equal(moving.record.done, 0)
      await reduce(page)
      const finished = await page.evaluate(() => window.readFlow())
      assert.equal(finished.active, false)
      assert.equal(finished.folding, false)
      assert.equal(finished.closingHidden, true)
      assert.equal(finished.closingHeight, 0)
      assert.equal(finished.openingHeight, 120)
      assert.equal(finished.animations, 0)
      assert.equal(finished.record.done, 1)
      assert.deepEqual(finished.record.folding, [true, false])
      if (withDriver) {
        assert.equal(finished.record.progress.at(-1), 1)
        assert.deepEqual(finished.record.finished, [false])
      }
      await page.evaluate(() => window.clearFlow())
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  })

for (const bound of [true, false])
  test(`reduced motion ends ${bound ? 'bound' : 'direct'} native following before appending streamed content`, async () => {
    const { context, page, errors } = await open()
    try {
      await page.evaluate(value => window.startScroll(value), bound)
      await page.waitForFunction(() => {
        const scroll = window.readScroll()
        return scroll.top > 1 && scroll.top < scroll.floor - 500
      })
      await reduce(page)
      const interrupted = await page.evaluate(() => window.readScroll())
      assert.equal(interrupted.animating, !bound)
      if (bound) assert.equal(interrupted.top, interrupted.floor)
      await page.evaluate(() => window.growScroll())
      const landed = await page.evaluate(() => window.readScroll())
      assert.equal(landed.top, landed.floor)
      assert.equal(landed.active, true)
      assert.equal(landed.animating, false)
      assert.equal(landed.calls.filter(call => call.behavior === 'smooth').length, 1)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal((await page.evaluate(() => window.readScroll())).top, landed.top)
      await page.evaluate(() => window.cleanupScroll())
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  })

for (const withDriver of [true, false])
  test(`already reduced motion completes ${withDriver ? 'shared' : 'individual'} folds without leaving a native transition`, async () => {
    const { context, page, errors } = await open()
    try {
      await reduce(page)
      await page.evaluate(value => window.startFlow(value), withDriver)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
      const finished = await page.evaluate(() => window.readFlow())
      assert.equal(finished.active, false)
      assert.equal(finished.folding, false)
      assert.equal(finished.closingHidden, true)
      assert.equal(finished.openingHeight, 120)
      assert.equal(finished.animations, 0)
      assert.equal(finished.record.done, 1)
      await page.evaluate(() => window.clearFlow())
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  })

test('changing reduced motion while reading history retains the reader position and follow intent during content growth', async () => {
  const { context, page, errors } = await open()
  try {
    await page.evaluate(() => window.startScroll(true))
    await page.waitForFunction(() => {
      const scroll = window.readScroll()
      return scroll.top > 1 && scroll.top < scroll.floor - 500
    })
    await page.evaluate(() => window.interruptScroll())
    const history = await page.evaluate(() => window.readScroll())
    await reduce(page)
    await page.evaluate(() => window.growScroll())
    const after = await page.evaluate(() => window.readScroll())
    assert.equal(after.top, history.top)
    assert.equal(after.active, false)
    assert.equal(after.animating, false)
    assert.ok(after.top < after.floor - 500)
    assert.equal(after.calls.filter(call => call.behavior === 'smooth').length, 1)
    await page.evaluate(() => window.cleanupScroll())
    assert.deepEqual(errors, [])
  } finally {
    await context.close()
  }
})
