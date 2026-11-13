import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
await mkdir(path.join(root, '.artifacts/frontend-audit-20261111'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.artifacts/frontend-audit-20261111/model-extras-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
import {ModelSeat} from './packages/modern-ui/src/model-extras.tsx';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
const app=createRoot(document.getElementById('app'));
function Row({model,fieldsOnly}) { useEffect(()=>{window.rowMounts=(window.rowMounts??0)+1},[]); return fieldsOnly ? <input id="only-field"/> : <div data-model={model}>
<button role="menuitem" id="first" onKeyDown={e=>{if(e.key==='Escape' && window.consume){ e.preventDefault(); window.consume=false; }}}>First</button>
<div data-model-parameters-fields><input id="field"/><button id="inner">Inner</button></div>
<button role="menuitem" id="last" onKeyDown={e=>{if(e.key==='Tab' && window.consumeTab) e.preventDefault()}}>Last</button></div> }
function Fixture({model='good',fieldsOnly=false,parameters=1,options=0}={}) {
 const [selected,setSelected]=useState(model); window.selectModel=setSelected;
 const state={groups:[{id:'provider',name:'Provider',models:[{id:selected,name:selected}]}],current:{provider:'provider',model:selected},pending:null,status:'ready',error:null,failures:[]};
 return <><button id="before">Before</button><div id="moving" style={{position:'absolute',left:600,top:400}}><ModelSeat available locked={false}
 useModelDirectory={selector=>selector(state)} useModelPicker={selector=>selector(undefined)} useModelParameters={selector=>selector(parameters)} useModelOptions={selector=>selector(options)}
 useCodexSpeed={selector=>selector({status:'unknown',mode:'standard',writable:false,ultrafastModels:[]})} codex={{refresh(){},choose(){}}}
 t={key=>key} renderSlot={name=> name==='conversation.input.model.options' ? <button role="switch" aria-checked="false" id="team">Team</button> : <Row model={selected} fieldsOnly={fieldsOnly}/>}/></div><button id="after">After</button></>
}
window.show=props=>app.render(<Fixture {...props}/>);`,
  },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'picker-primitives',
      setup(builder) {
        builder.onResolve({ filter: /vendor\/model\/client\/ModelSelect\.tsx$/ }, () => ({ path: 'stub-picker', namespace: 'stub-picker' }))
        builder.onLoad({ filter: /.*/, namespace: 'stub-picker' }, () => ({ contents: 'export const ModelSelect=()=>null', loader: 'tsx' }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'picker-primitives', namespace: 'picker-primitives' }))
        builder.onLoad({ filter: /.*/, namespace: 'picker-primitives' }, () => ({
          resolveDir: path.join(root, 'packages/modern-ui/src/vendor/primitives'),
          loader: 'tsx',
          contents: `export * from './icons/index.tsx'; export {focusWithoutRing} from './focus.ts'; export {MenuSurface} from './MenuSurface.tsx'; export {Toast} from './Toast.tsx'; export {useDismissOnOutsidePointer} from './useDismissOnOutsidePointer.ts';`,
        }))
      },
    },
  ],
})
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : '<!doctype html><link rel="stylesheet" href="/client.css"><style>body{margin:0}button,input{font-family:Arial}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch(
  process.env.MODERN_UI_BROWSER
    ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
    : existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: 'msedge', headless: true },
)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})
async function fixture(props = {}, options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...options }),
    page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(props => window.show(props), props)
  if (props.model !== 'bad') await page.locator('[aria-haspopup="menu"]').waitFor()
  return { context, page }
}
test('changing selected models preserves extension row state', async () => {
  const { context, page } = await fixture()
  try {
    await page.evaluate(() => window.selectModel('other'))
    await page.waitForFunction(() => document.querySelector('[data-model]')?.dataset.model === 'other')
    assert.equal(await page.evaluate(() => window.rowMounts), 1)
    await page.locator('[aria-haspopup="menu"]').click()
    assert.equal(await page.locator('#first').isVisible(), true)
  } finally {
    await context.close()
  }
})
test('mouse opening starts on the panel and Tab enters its first control before leaving at the edge', async () => {
  const { context, page } = await fixture()
  try {
    await page.locator('[aria-haspopup="menu"]').click()
    await page.waitForFunction(() => document.activeElement === document.querySelector('[role="menu"]'))
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('#first').evaluate(el => el === document.activeElement), true)
    for (const id of ['field', 'inner', 'last']) {
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#' + id).evaluate(el => el === document.activeElement), true)
    }
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('#after').evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})
test('nested Escape consumption and own-key fields preserve the panel, then outer Escape dismisses', async () => {
  const { context, page } = await fixture()
  try {
    await page.locator('[aria-haspopup="menu"]').focus()
    await page.keyboard.press('Enter')
    await page.locator('#first').focus()
    await page.evaluate(() => (window.consume = true))
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    await page.locator('#field').focus()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    await page.locator('#first').focus()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('[aria-haspopup="menu"]').evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})
test('Tab visits all row controls and leaves at either boundary without a lingering portal', async () => {
  const { context, page } = await fixture()
  try {
    const trigger = page.locator('[aria-haspopup="menu"]')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.locator('#first').focus()
    for (const id of ['field', 'inner', 'last']) {
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#' + id).evaluate(el => el === document.activeElement), true)
      assert.equal(await page.locator('[role="menu"]').count(), 1)
    }
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('#after').evaluate(el => el === document.activeElement), true)
    await trigger.click()
    await page.locator('#first').focus()
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('#before').evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})
test('a nested control can consume Tab and the final page Tab still closes explicitly', async () => {
  const { context, page } = await fixture()
  try {
    await page.locator('[aria-haspopup="menu"]').click()
    await page.locator('#last').focus()
    await page.evaluate(() => (window.consumeTab = true))
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('[role="menu"]').count(), 1)
    assert.equal(await page.locator('#last').evaluate(el => el === document.activeElement), true)
    await page.evaluate(() => {
      window.consumeTab = false
      document.getElementById('after').remove()
    })
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('[aria-hidden="true"][data-menu-positioned]').evaluate(el => el.inert), true)
  } finally {
    await context.close()
  }
})
test('idle anchor polling reads one rect per frame without repeated menu measurements and follows position-only animation', async () => {
  const { context, page } = await fixture()
  try {
    await page.locator('[aria-haspopup="menu"]').click()
    await page.waitForTimeout(300)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const before = await cdp.send('Performance.getMetrics')
    const measurements = await page.evaluate(async () => {
      const trigger = document.querySelector('[aria-haspopup="menu"]'),
        panel = document.querySelector('[role="menu"]')
      let reads = 0,
        frames = 0,
        layouts = 0
      const rect = trigger.getBoundingClientRect.bind(trigger)
      trigger.getBoundingClientRect = () => {
        reads++
        return rect()
      }
      for (const key of ['offsetHeight', 'offsetWidth']) {
        const proto = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)
        Object.defineProperty(panel, key, {
          configurable: true,
          get() {
            layouts++
            return proto.get.call(this)
          },
        })
      }
      const start = performance.now()
      while (performance.now() - start < 300) {
        await new Promise(requestAnimationFrame)
        frames++
      }
      return { reads, frames, layouts }
    })
    assert.ok(measurements.reads >= measurements.frames - 1)
    assert.equal(measurements.layouts, 0)
    const after = await cdp.send('Performance.getMetrics')
    measurements.browserLayouts =
      after.metrics.find(metric => metric.name === 'LayoutCount').value - before.metrics.find(metric => metric.name === 'LayoutCount').value
    assert.equal(measurements.browserLayouts, 0)
    const movement = await page.evaluate(async () => {
      const anchor = document.querySelector('[aria-haspopup="menu"]'),
        moving = document.getElementById('moving'),
        panel = document.querySelector('[role="menu"]')
      const samples = []
      const animation = moving.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-200px)' }], { duration: 350, fill: 'forwards' })
      while (animation.playState !== 'finished') {
        await new Promise(requestAnimationFrame)
        const a = anchor.getBoundingClientRect(),
          p = panel.getBoundingClientRect()
        samples.push(Math.abs(a.right - p.right))
      }
      return samples
    })
    assert.ok(movement.length > 5)
    assert.ok(Math.max(...movement) < 18, JSON.stringify(movement))
    await writeFile(
      path.join(root, '.artifacts/frontend-audit-20261111/model-extras-measurements.json'),
      JSON.stringify({ idle: measurements, maximumAnchorLag: Math.max(...movement), animationSamples: movement.length }),
    )
  } finally {
    await context.close()
  }
})
test('plain input-only rows admit Tab from the panel and allow normal Escape dismissal', async () => {
  const { context, page } = await fixture({ fieldsOnly: true })
  try {
    await page.locator('[aria-haspopup="menu"]').click()
    await page.waitForFunction(() => document.activeElement === document.querySelector('[role="menu"]'))
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('#only-field').evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('[aria-haspopup="menu"]').evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})

// Official 0.2.2-rc.2 registers session options (its Team mode switch) beside the provider's rows.
test('session options alone get their own button name, no provider heading, and the keyboard reaches the switch', async () => {
  const { context, page } = await fixture({ parameters: 0, options: 1 })
  try {
    const button = page.locator('[aria-haspopup="menu"]')
    assert.equal(await button.getAttribute('aria-label'), 'extras.trigger.session')
    // The mark a phone-width composer hides the button by.
    assert.equal(await button.getAttribute('data-session-only'), '')
    await button.focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.id === 'team')
    assert.equal((await page.locator('[role="menu"]').innerText()).includes('extras.heading'), false)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-haspopup') === 'menu')
  } finally {
    await context.close()
  }
})

test('beside provider rows the button keeps the provider name and heading, and arrow keys run on into the switch', async () => {
  const { context, page } = await fixture({ options: 1 })
  try {
    const button = page.locator('[aria-haspopup="menu"]')
    await page.waitForFunction(() => document.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-label') === 'extras.trigger')
    assert.equal(await button.getAttribute('data-session-only'), null)
    await button.click()
    assert.equal((await page.locator('[role="menu"]').innerText()).includes('extras.heading'), true)
    await page.locator('#last').focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(() => document.activeElement?.id === 'team')
  } finally {
    await context.close()
  }
})
