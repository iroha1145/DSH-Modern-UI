import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-model-motion-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {ModelSelect} from './packages/modern-ui/src/vendor/model/client/ModelSelect.tsx';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
import './packages/modern-ui/src/vendor/theme/styles/beautiful-ui.css';
const app=createRoot(document.getElementById('app'));
const models=n=>Array.from({length:n},(_,i)=>({id:'example-'+i,name:'Example model '+i,description:'Model description '+i}));
function Fixture({x=600,y=540,count=4,asyncLoad=false,width=160,label}) {
 const [state,setState]=useState({groups:[{id:'provider',name:'Example provider',models:models(count)}],current:{provider:'provider',model:'example-0'},pending:null,status:'ready',error:null,failures:[]});
 window.catalog=n=>setState(v=>({...v,status:'ready',groups:[{id:'provider',name:'Example provider',models:models(n)}]}));
 return <div id="moving" style={{position:'absolute',left:x,top:y,width}}><ModelSelect available locked={false}
 useModelDirectory={selector=>selector(state)} useModelPicker={selector=>selector(undefined)}
 t={(key,values)=>key+(values ? ' '+Object.values(values).join(' ') : '')}
 renderSlot={(name,props,options)=>props.placement==='trigger' && label ? label : options.fallback}
 load={()=>{if(asyncLoad)setState(v=>({...v,status:'loading',groups:[]}))}}
 select={async selection=>{window.selected=selection;setState(v=>({...v,current:selection}));return {ok:true}}} /></div>
}
window.show=props=>app.render(<Fixture key={JSON.stringify(props)} {...props}/>);`,
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
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'picker-primitives', namespace: 'picker-primitives' }))
        builder.onLoad({ filter: /.*/, namespace: 'picker-primitives' }, () => ({
          resolveDir: path.join(root, 'packages/modern-ui/src/vendor/primitives'),
          loader: 'tsx',
          contents: `
      export * from './icons/index.tsx'; export {Input} from './Input.tsx'; export {isMobileDevice} from './focus.ts';
      export {MenuGroup,observeStickyMenuGroups} from './MenuGroup.tsx'; export {MenuSurface} from './MenuSurface.tsx';
      export {rankByName} from './rank-by-name.ts'; export {StateDot} from './StateDot.tsx'; export {Switch} from './Switch.tsx'; export {Toast} from './Toast.tsx';`,
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
  await page.locator('[aria-haspopup="dialog"]').waitFor()
  return { context, page }
}
const record = page =>
  page.evaluate(async () => {
    const start = performance.now(),
      frames = []
    while (performance.now() - start < 400) {
      await new Promise(requestAnimationFrame)
      const menu = document.querySelector('[role="dialog"]'),
        trigger = document.querySelector('[aria-haspopup="dialog"]')
      if (!menu) continue
      const r = menu.getBoundingClientRect(),
        a = trigger.getBoundingClientRect(),
        s = getComputedStyle(menu)
      frames.push({
        time: Math.round(performance.now() - start),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        left: menu.style.left,
        top: menu.style.top,
        bottom: menu.style.bottom,
        transform: s.transform,
        origin: s.transformOrigin,
        anchorRight: a.right,
        anchorTop: a.top,
        anchorBottom: a.bottom,
      })
    }
    return frames
  })
test('pressed model trigger leaves stable placement while its menu enters without scaling or overshoot', async () => {
  const { context, page } = await fixture()
  try {
    const trigger = page.locator('[aria-haspopup="dialog"]')
    await trigger.hover()
    await page.mouse.down()
    await page.waitForTimeout(100)
    const recording = record(page)
    await page.mouse.up()
    const frames = await recording
    console.log('model-picker opening frames', JSON.stringify([frames[0], frames[Math.floor(frames.length / 4)], frames.at(-1)]))
    assert.ok(frames.length > 5)
    assert.equal(new Set(frames.map(f => f.left)).size, 1, 'pressed feedback never changes the menu anchor')
    assert.equal(new Set(frames.map(f => f.bottom)).size, 1)
    assert.ok(
      frames.every(f => Math.abs(f.width - 380) < 0.01 && f.height > 0 && Math.abs(f.height - frames[0].height) < 0.01),
      JSON.stringify(frames[0]),
    )
    assert.ok(
      frames.every((f, i) => i === 0 || f.y <= frames[i - 1].y + 0.1),
      'one direction, no overshoot',
    )
    const last = frames.at(-1)
    assert.ok(Math.abs(last.x + last.width - last.anchorRight) < 0.1, JSON.stringify(last))
    assert.ok(Math.abs(last.y + last.height - (last.anchorTop - 8)) < 0.1, JSON.stringify(last))
    assert.ok(frames.some(f => f.transform !== 'none'))
  } finally {
    await context.close()
  }
})

test('a downward picker starts after placement and enters from its top edge without scaling', async () => {
  const { context, page } = await fixture({ y: 45 })
  try {
    await page.evaluate(() => {
      const property = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
      window.measurements = []
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        ...property,
        get() {
          if (this.getAttribute('role') === 'dialog')
            window.measurements.push({ visibility: getComputedStyle(this).visibility, animation: getComputedStyle(this).animationName })
          return property.get.call(this)
        },
      })
    })
    await page.locator('[aria-haspopup="dialog"]').click()
    const frames = await record(page)
    assert.ok(
      frames.every(f => f.top === '81px' && f.origin === '380px 0px'),
      JSON.stringify(frames[0]),
    )
    assert.ok(frames.every(f => Math.abs(f.width - 380) < 0.01))
    assert.ok(frames.every((f, i) => i === 0 || f.y >= frames[i - 1].y - 0.1))
    const measurements = await page.evaluate(() => window.measurements)
    assert.ok(measurements.some(m => m.visibility === 'hidden'))
    assert.ok(
      measurements.filter(m => m.visibility === 'hidden').every(m => m.animation === 'none'),
      JSON.stringify(measurements),
    )
    const last = frames.at(-1)
    assert.ok(Math.abs(last.y - (last.anchorBottom + 8)) < 0.1, JSON.stringify(last))
  } finally {
    await context.close()
  }
})

test('search, keyboard selection and Escape preserve popover focus', async () => {
  const { context, page } = await fixture({ count: 14 })
  try {
    const trigger = page.locator('[aria-haspopup="dialog"]')
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const search = page.getByRole('combobox')
    await search.waitFor()
    assert.equal(await search.evaluate(el => el === document.activeElement), true)
    await search.fill('Example model 12')
    await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 1)
    await page.keyboard.press('Enter')
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.selected.model), 'example-12')
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    await page.getByRole('combobox').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
  } finally {
    await context.close()
  }
})

test('async catalog arrival resizes the viewport fit without restarting entrance and remains scrollable', async () => {
  const { context, page } = await fixture({ y: 180, count: 0, asyncLoad: true })
  try {
    await page.locator('[aria-haspopup="dialog"]').click()
    const opened = await page.locator('[role="dialog"]').evaluate(el => {
      window.openAnimation = el.getAnimations()[0]
      return { side: el.dataset.menuSide, origin: getComputedStyle(el).transformOrigin }
    })
    assert.equal(opened.side, 'top', 'the short loading card fits above its trigger')
    await page.evaluate(() => window.catalog(20))
    await page.getByRole('combobox').waitFor()
    const geometry = await page.locator('[role="dialog"]').evaluate(el => ({
      sameAnimation: el.getAnimations()[0] === window.openAnimation,
      side: el.dataset.menuSide,
      origin: getComputedStyle(el).transformOrigin,
      rect: el.getBoundingClientRect().toJSON(),
      scrolls: el.querySelector('[role="listbox"]').scrollHeight > el.querySelector('[role="listbox"]').clientHeight,
    }))
    assert.equal(geometry.sameAnimation, true, 'catalog updates retain the running entrance')
    assert.equal(geometry.side, 'bottom', 'the loaded catalog flips to the side with more room')
    assert.equal(geometry.origin, '380px 0px')
    assert.ok(geometry.rect.y >= 12 && geometry.rect.bottom <= 588 && geometry.scrolls, JSON.stringify(geometry))
    await page.getByRole('listbox').evaluate(el => {
      el.scrollTop = el.scrollHeight
    })
    await page.getByRole('option', { name: 'Example model 19', exact: true }).click()
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.selected.model), 'example-19')
  } finally {
    await context.close()
  }
})

test('rapid reopen and repeated arrow keys keep a fresh entrance and return focus to the trigger', async () => {
  const { context, page } = await fixture()
  try {
    const trigger = page.locator('[aria-haspopup="dialog"]')
    for (let i = 0; i < 3; i++) {
      await trigger.focus()
      await page.keyboard.down('ArrowDown')
      await page.locator('[role="dialog"]').waitFor()
      await page.keyboard.down('ArrowDown')
      await page.keyboard.down('ArrowDown')
      await page.keyboard.up('ArrowDown')
      assert.equal(await page.getByRole('listbox').evaluate(el => el === document.activeElement), true)
      const animations = await page
        .locator('[role="dialog"]')
        .evaluate(el => el.getAnimations().map(a => ({ time: a.currentTime, duration: a.effect.getTiming().duration })))
      assert.ok(animations.length === 1 && animations[0].time < animations[0].duration, JSON.stringify(animations))
      await page.keyboard.press('Escape')
      await page.locator('[role="dialog"]').waitFor({ state: 'detached' })
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    }
  } finally {
    await context.close()
  }
})

test('reduced motion disables trigger displacement and picker entrance', async () => {
  const { context, page } = await fixture({}, { reducedMotion: 'reduce' })
  try {
    const trigger = page.locator('[aria-haspopup="dialog"]')
    await trigger.hover()
    await page.mouse.down()
    assert.equal(await trigger.evaluate(el => getComputedStyle(el).transform), 'none')
    await page.mouse.up()
    const style = await page
      .locator('[role="dialog"]')
      .evaluate(el => ({ transform: getComputedStyle(el).transform, animation: getComputedStyle(el).animationName }))
    assert.deepEqual(style, { transform: 'none', animation: 'none' })
  } finally {
    await context.close()
  }
})

test('the stable anchor preserves narrow seats and follows slot-driven trigger resizing', async () => {
  for (const width of [80, 160, 360]) {
    const { context, page } = await fixture({ x: 400, width })
    try {
      const trigger = page.locator('[aria-haspopup="dialog"]')
      await trigger.evaluate(el => el.click())
      const geometry = await trigger.evaluate(el => ({
        trigger: el.getBoundingClientRect().toJSON(),
        anchor: el.parentElement.getBoundingClientRect().toJSON(),
        root: el.parentElement.parentElement.getBoundingClientRect().toJSON(),
      }))
      assert.ok(Math.abs(geometry.trigger.width - geometry.anchor.width) < 0.1, JSON.stringify(geometry))
      assert.ok(geometry.root.width === width && geometry.trigger.width <= width + 0.1, JSON.stringify(geometry))
      await trigger.locator('[data-model-id]').evaluate(el => {
        el.textContent = 'A much longer model label loaded by the slot'
      })
      await page.waitForFunction(() => {
        const menu = document.querySelector('[role="dialog"]'),
          anchor = document.querySelector('[aria-haspopup="dialog"]').parentElement.getBoundingClientRect()
        return Math.abs(parseFloat(menu.style.left) + menu.offsetWidth - anchor.right) < 0.1
      })
      const changed = await trigger.evaluate(el => el.getBoundingClientRect().toJSON())
      assert.ok(changed.width <= width + 0.1, JSON.stringify(changed))
    } finally {
      await context.close()
    }
  }
})

test('simulated macOS backing stays aligned during model-picker entrance', async () => {
  const { context, page } = await fixture()
  try {
    await page.evaluate(() => (document.documentElement.dataset.platform = 'darwin'))
    await page.locator('[aria-haspopup="dialog"]').click()
    const errors = await page.locator('[role="dialog"]').evaluate(async menu => {
      const errors = []
      for (let i = 0; i < 35; i++) {
        await new Promise(requestAnimationFrame)
        const r = menu.getBoundingClientRect(),
          b = document.querySelector('[data-menu-backing]').getBoundingClientRect()
        errors.push(Math.max(Math.abs(r.x - b.x), Math.abs(r.y - b.y), Math.abs(r.width - b.width), Math.abs(r.height - b.height)))
      }
      return errors
    })
    assert.ok(
      errors.every(error => error < 0.05),
      JSON.stringify(errors),
    )
  } finally {
    await context.close()
  }
})
