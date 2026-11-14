import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-menu-motion-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {Menu} from './packages/modern-ui/src/vendor/primitives/Menu.tsx';
import {Button} from './packages/modern-ui/src/vendor/primitives/Button.tsx';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
const app = createRoot(document.getElementById('app'));
function Fixture({portal=true, side='bottom', align='start', x=120, y=120, custom=false}) {
 const [open,setOpen] = useState(false); const [count,setCount] = useState(3);
 window.resizeMenu = setCount; window.toggleMenu = setOpen;
 return <div id="moving" style={{position:'absolute',left:x,top:y}}><Menu open={open} portal={portal} side={side} align={align}
 autoFocus onClose={()=>setOpen(false)} onSelect={id=>{window.selected=id;setOpen(false)}}
 getAnchorRect={custom ? ()=>window.anchorReady === false ? null : document.getElementById('trigger').getBoundingClientRect() : undefined}
 anchor={<Button id="trigger" onClick={()=>setOpen(v=>!v)}>Open menu</Button>}
 items={[{id:'first',label:'First action'}, {id:'nested',label:'Submenu',submenu:[{id:'child',label:'Child action'}]},
 ...Array.from({length:count},(_,i)=>({id:'row'+i,label:'Additional action '+i}))]} /></div>
}
window.show = props => app.render(<Fixture key={JSON.stringify(props)} {...props}/>);`,
  },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : '<!doctype html><link rel="stylesheet" href="/client.css"><style>body{margin:0}button{font-family:Arial}</style><div id="app"></div><script type="module" src="/client.js"></script>',
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

async function fixture(props = {}, contextOptions = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...contextOptions })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(props => window.show(props), props)
  await page.locator('#trigger').waitFor()
  return { context, page }
}

const record = page =>
  page.evaluate(async () => {
    const frames = []
    const start = performance.now()
    while (performance.now() - start < 420) {
      await new Promise(requestAnimationFrame)
      const menu = document.querySelector('[role="menu"]')
      if (!menu) continue
      const r = menu.getBoundingClientRect(),
        a = document.querySelector('#trigger').getBoundingClientRect()
      const style = getComputedStyle(menu)
      frames.push({
        time: Math.round(performance.now() - start),
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        left: menu.style.left,
        top: menu.style.top,
        transform: style.transform,
        animation: style.animationName,
        anchorX: a.x,
        anchorY: a.y,
      })
    }
    return frames
  })

test('long menus indicate only remaining scroll directions and keep keyboard rows readable', async () => {
  const { context, page } = await fixture({}, { reducedMotion: 'reduce' })
  try {
    await page.evaluate(() => window.resizeMenu(40))
    await page.locator('#trigger').click()
    const viewport = page.locator('[data-menu-viewport]')
    const hints = () =>
      viewport.evaluate(element => ({
        top: Number(getComputedStyle(element, '::before').opacity),
        bottom: Number(getComputedStyle(element, '::after').opacity),
        height: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-menu-viewport]'), '::after').opacity === '1')
    assert.equal((await hints()).top, 0)
    await viewport.evaluate(element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    })
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-menu-viewport]'), '::before').opacity === '1')
    assert.equal((await hints()).bottom, 1)
    await page.keyboard.press('End')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-menu-viewport]'), '::after').opacity === '0')
    assert.equal((await hints()).top, 1)
    assert.equal(
      await page
        .locator('[role="menuitem"]')
        .last()
        .evaluate(element => element === document.activeElement),
      true,
    )
    assert.ok(
      await viewport.evaluate(element => {
        const focused = document.activeElement.getBoundingClientRect(),
          bounds = element.getBoundingClientRect()
        return focused.top >= bounds.top && focused.bottom <= bounds.bottom + 1
      }),
    )
    await page.keyboard.press('Home')
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-menu-viewport]'), '::before').opacity === '0')
    await page.evaluate(() => window.resizeMenu(0))
    await page.waitForFunction(() => {
      const element = document.querySelector('[data-menu-viewport]')
      return element.scrollHeight <= element.clientHeight + 1 && getComputedStyle(element, '::after').opacity === '0'
    })
    const short = await hints()
    assert.equal(short.top, 0)
    assert.ok(short.height > 50 && short.height < 80, 'hints add no space to a two-row menu')
  } finally {
    await context.close()
  }
})

test('menu placement stays still while the trigger releases its pressed scale', async () => {
  const { context, page } = await fixture()
  try {
    const trigger = page.locator('#trigger')
    await trigger.hover()
    await page.mouse.down()
    await page.waitForTimeout(100)
    const recording = record(page)
    await page.mouse.up()
    const frames = await recording
    console.log('menu opening frames', JSON.stringify([frames[0], frames[Math.floor(frames.length / 4)], frames.at(-1)]))
    assert.ok(frames.length > 5)
    assert.ok(Math.max(...frames.map(f => f.x)) - Math.min(...frames.map(f => f.x)) < 0.1)
    assert.equal(new Set(frames.map(f => f.top)).size, 1, 'visual entrance never changes the positioned top')
    assert.ok(
      frames.every(f => f.y >= 158 && f.y <= 160.1),
      JSON.stringify(frames),
    )
    assert.ok(
      frames.every((f, i) => i === 0 || f.y >= frames[i - 1].y - 0.1),
      'the entrance settles in one direction without overshoot',
    )
    assert.ok(
      frames.some(f => f.transform !== 'none'),
      'the menu retains a visible entrance animation',
    )
  } finally {
    await context.close()
  }
})

test('a moving ancestor is followed without restarting placement or menu geometry', async () => {
  const { context, page } = await fixture()
  try {
    await page.locator('#trigger').click()
    await page
      .locator('#moving')
      .evaluate(el => el.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(180px)' }], { duration: 250, fill: 'forwards' }))
    const frames = await record(page)
    const last = frames.at(-1)
    assert.ok(Math.abs(last.x - 300) < 0.1, JSON.stringify(last))
    assert.ok(frames.every(f => Math.abs(f.width - 144) < 0.01 && Math.abs(f.height - 178) < 0.01))
    // Tracking can lag one frame, but never adds an independent easing trajectory.
    assert.ok(
      frames.every(f => Math.abs(f.x - f.anchorX) < 28),
      JSON.stringify(frames),
    )
  } finally {
    await context.close()
  }
})

test('end/top positioning remains inside the viewport while menu dimensions change and reopen', async () => {
  const { context, page } = await fixture({ x: 760, y: 540, align: 'end', side: 'top' })
  try {
    await page.locator('#trigger').evaluate(el => el.click())
    await page.waitForFunction(() => document.querySelector('[role="menu"]')?.style.left)
    const bounds = () => page.locator('[role="menu"]').first().boundingBox()
    const initial = await bounds()
    assert.ok(initial.x >= 12 && initial.x + initial.width <= 788 && initial.y >= 12 && initial.y + initial.height <= 588, JSON.stringify(initial))
    await page.evaluate(() => window.resizeMenu(8))
    await page.waitForFunction(() => document.querySelector('[role="menu"]').offsetHeight > 300)
    await page.waitForFunction(() => {
      const r = document.querySelector('[role="menu"]').getBoundingClientRect()
      return r.bottom <= document.querySelector('#trigger').getBoundingClientRect().top
    })
    await page.locator('[role="menu"]').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    const grown = await bounds()
    assert.ok(grown.y < initial.y && grown.x + grown.width <= 788, JSON.stringify(grown))
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[role="menu"]').count(), 0)
    assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true)
    await page.locator('#trigger').evaluate(el => el.click())
    await page.locator('[role="menu"]').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)))
    const reopened = await bounds()
    assert.ok(
      Object.keys(grown).every(key => Math.abs(reopened[key] - grown[key]) < 0.1),
      JSON.stringify({ reopened, grown }),
    )
  } finally {
    await context.close()
  }
})

test('placement and changing content use layout dimensions throughout the entrance', async () => {
  const { context, page } = await fixture({ align: 'end', x: 600, y: 200 })
  try {
    await page.locator('#trigger').click()
    await page.evaluate(() => window.resizeMenu(7))
    const frames = await record(page)
    assert.ok(frames.length > 5)
    assert.equal(new Set(frames.map(f => f.left)).size, 1)
    assert.ok(
      frames.every(f => f.top === '240px'),
      JSON.stringify(frames[0]),
    )
    assert.ok(
      frames.some(f => f.height > 300),
      JSON.stringify(frames),
    )
    assert.ok(
      frames.every((f, i) => i === 0 || f.y >= frames[i - 1].y - 0.1),
      JSON.stringify(frames),
    )
  } finally {
    await context.close()
  }
})

test('an unavailable host anchor stays hidden and begins its entrance only after placement', async () => {
  const { context, page } = await fixture({ custom: true })
  try {
    await page.evaluate(() => {
      window.anchorReady = false
      window.toggleMenu(true)
    })
    await page.locator('[role="menu"]').waitFor({ state: 'attached' })
    await page.waitForTimeout(280)
    assert.equal(await page.locator('[role="menu"]').evaluate(el => getComputedStyle(el).visibility), 'hidden')
    assert.equal(await page.locator('[role="menu"]').evaluate(el => getComputedStyle(el).animationName), 'none')
    await page.evaluate(() => {
      window.anchorReady = true
    })
    await page.waitForFunction(() => document.querySelector('[role="menu"]').dataset.menuPositioned === 'true')
    const frames = await record(page)
    assert.ok(
      frames.some(f => f.transform !== 'none'),
      'delayed placement still shows an entrance',
    )
    assert.ok(frames.every(f => f.left === '120px' && f.top === '160px'))
  } finally {
    await context.close()
  }
})

test('reduced motion displays root and nested menus immediately at their final geometry', async () => {
  const { context, page } = await fixture({}, { reducedMotion: 'reduce' })
  try {
    await page.locator('#trigger').click()
    await page.getByRole('menuitem', { name: 'Submenu', exact: true }).focus()
    await page.getByRole('menuitem', { name: 'Child action', exact: true }).waitFor()
    const styles = await page
      .locator('[role="menu"]')
      .evaluateAll(menus => menus.map(menu => ({ animation: getComputedStyle(menu).animationName, transform: getComputedStyle(menu).transform })))
    assert.deepEqual(styles, [
      { animation: 'none', transform: 'none' },
      { animation: 'none', transform: 'none' },
    ])
  } finally {
    await context.close()
  }
})

test('nested menus retain keyboard selection and non-portaled menus retain their anchor', async () => {
  for (const portal of [false, true]) {
    const { context, page } = await fixture({ portal })
    try {
      await page.locator('#trigger').click()
      await page.getByRole('menuitem', { name: 'Submenu', exact: true }).focus()
      await page.getByRole('menuitem', { name: 'Child action', exact: true }).waitFor()
      assert.equal(await page.locator('[role="menu"]').count(), 2)
      await page.getByRole('menuitem', { name: 'Child action', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate(() => window.selected), 'child')
      assert.equal(await page.locator('[role="menu"]').count(), 0)
      assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true)
    } finally {
      await context.close()
    }
  }
})

test('CSS-anchor backings follow root and nested entrances on the simulated macOS branch', async () => {
  const { context, page } = await fixture()
  try {
    await page.evaluate(() => (document.documentElement.dataset.platform = 'darwin'))
    await page.locator('#trigger').click()
    await page.getByRole('menuitem', { name: 'Submenu', exact: true }).focus()
    await page.getByRole('menuitem', { name: 'Child action', exact: true }).waitFor()
    const samples = await page.evaluate(async () => {
      const samples = []
      for (let i = 0; i < 35; i++) {
        await new Promise(requestAnimationFrame)
        for (const menu of document.querySelectorAll('[role="menu"]')) {
          const anchor = menu.style.getPropertyValue('--dsh-menu-anchor')
          const backing = Array.from(document.querySelectorAll('[data-menu-backing]')).find(el => el.style.getPropertyValue('--dsh-menu-anchor') === anchor)
          const r = menu.getBoundingClientRect(),
            b = backing.getBoundingClientRect()
          samples.push({ menu: [r.x, r.y, r.width, r.height], backing: [b.x, b.y, b.width, b.height] })
        }
      }
      return samples
    })
    console.log('macOS backing frames', JSON.stringify([samples[0], samples[1], samples.at(-1)]))
    assert.ok(
      samples.every(s => s.menu.every((v, i) => Math.abs(v - s.backing[i]) < 0.1)),
      JSON.stringify(samples),
    )
  } finally {
    await context.close()
  }
})
