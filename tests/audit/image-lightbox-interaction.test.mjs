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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-image-lightbox-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
import {ImageLightbox} from './packages/modern-ui/src/vendor/primitives/ImageLightbox.tsx';
const src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="teal"/></svg>');
function Fixture(){const [open,setOpen]=useState(false);return <div style={{transform:'translateZ(0)',width:100,height:100}}><button id="opener" onClick={()=>setOpen(true)}>Open</button>{open && <ImageLightbox src={src} alt="Landscape" labels={{dialog:'Preview',close:'Close preview',zoomIn:'Zoom in',zoomOut:'Zoom out',resetZoom:'Fit to window',zoomHelp:'Drag or use arrow keys to pan'}} onClose={()=>setOpen(false)}/>}</div>}
createRoot(document.getElementById('app')).render(<Fixture/>);`,
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
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/client.css"><style>:root{--dsw-specific-input-major:white;--dsw-alias-label-primary:black;--dsw-focus-ring-width:2px;--dsw-focus-ring-color:blue}body{margin:0;height:2000px}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
// Windows can allocate service ports (for example 2049) for listen(0).
// Browser fixtures need a port that Chromium permits for HTTP navigation.
const blockedPorts = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080])
do {
  if (server.listening) await new Promise(resolve => server.close(resolve))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
} while (server.address().port < 1024 || blockedPorts.has(server.address().port))
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
async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...options })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.width === 720)
  return { context, page, image: page.getByRole('img'), view: page.getByRole('group') }
}
const scroll = view => view.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))

test('lightbox double-click/wheel zoom, pointer drag, reset and modal focus return', async () => {
  const { context, page, image, view } = await fixture()
  try {
    assert.equal(await page.getByRole('button', { name: 'Close preview' }).evaluate(node => node === document.activeElement), true)
    assert.equal(await page.getByRole('dialog').evaluate(node => node.parentNode === document.body), true)
    await image.dblclick()
    assert.equal(await image.evaluate(node => node.width), 1440)
    const before = await scroll(view)
    await page.mouse.move(400, 300)
    await page.mouse.down()
    await page.mouse.move(300, 220, { steps: 5 })
    await page.mouse.up()
    const dragged = await scroll(view)
    assert.ok(dragged.x > before.x + 90 && dragged.y > before.y + 70, JSON.stringify({ before, dragged }))
    await page.mouse.move(400, 300)
    await page.mouse.wheel(0, -80)
    await page.waitForFunction(() => document.querySelector('[role="dialog"] img').width > 1440)
    assert.equal(await page.evaluate(() => window.scrollY), 0)
    await page.getByRole('button', { name: 'Fit to window' }).click()
    assert.equal(await image.evaluate(node => node.width), 720)
    assert.deepEqual(await scroll(view), { x: 0, y: 0 })
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.locator('#opener').evaluate(node => node === document.activeElement), true)
  } finally {
    await context.close()
  }
})

test('keyboard zoom and native arrow panning keep controls reachable; browser zoom is unclaimed', async () => {
  const { context, page, image, view } = await fixture({ reducedMotion: 'reduce', forcedColors: 'active' })
  try {
    await page.keyboard.press('+')
    assert.equal(await image.evaluate(node => node.width), 900)
    await view.focus()
    const before = await scroll(view)
    await page.keyboard.press('ArrowRight')
    await page.waitForFunction(x => document.querySelector('[role="group"]').scrollLeft > x, before.x)
    const cancelled = await image.evaluate(node => {
      const event = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(cancelled, false)
    assert.equal(await image.evaluate(node => node.width), 900)
    await page.keyboard.press('0')
    assert.equal(await image.evaluate(node => node.width), 720)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await image.evaluate(node => node.width), 900)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', { name: 'Close preview' }).evaluate(node => node === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await view.evaluate(node => node === document.activeElement), true)
    assert.notEqual(await view.evaluate(node => getComputedStyle(node).outlineStyle), 'none')
    await page.keyboard.press('Escape')
    await page.locator('#opener').click()
    assert.equal(await image.evaluate(node => node.width), 720)
    await page.mouse.click(20, 300)
    assert.equal(await page.getByRole('dialog').count(), 0)
  } finally {
    await context.close()
  }
})

test('touch keeps native panning and pinch zoom available after button zoom', async () => {
  const { context, page, image, view } = await fixture({ hasTouch: true, isMobile: true })
  try {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).tap()
    assert.equal(await image.evaluate(node => node.width), 900)
    assert.equal(await image.evaluate(node => getComputedStyle(node).touchAction), 'auto')
    assert.equal(await view.evaluate(node => getComputedStyle(node).touchAction), 'auto')
    const cancelled = await image.evaluate(node => {
      const event = new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 42, button: 0, bubbles: true, cancelable: true })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(cancelled, false)
    const before = await scroll(view)
    const session = await context.newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 300, id: 1 }] })
    for (let i = 1; i <= 8; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 400 - i * 12, y: 300 - i * 8, id: 1 }] })
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const after = await scroll(view)
    assert.ok(after.x > before.x || after.y > before.y, JSON.stringify({ before, after }))
    const beforeScale = await page.evaluate(() => visualViewport.scale)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: 350, y: 300, id: 1 },
        { x: 450, y: 300, id: 2 },
      ],
    })
    for (let i = 1; i <= 8; i++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: 350 - i * 10, y: 300, id: 1 },
          { x: 450 + i * 10, y: 300, id: 2 },
        ],
      })
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForFunction(scale => visualViewport.scale > scale, beforeScale, { timeout: 3000 })
    await session.detach()
  } finally {
    await context.close()
  }
})

test('zoom bounds and viewport resize retain a reachable fit image', async () => {
  const { context, page, image } = await fixture()
  try {
    for (let index = 0; index < 8; index++) await page.keyboard.press('+')
    assert.equal(await page.getByRole('button', { name: 'Zoom in', exact: true }).isDisabled(), true)
    assert.equal(await image.evaluate(node => node.width), 2880)
    await page.setViewportSize({ width: 390, height: 700 })
    await page.getByRole('button', { name: 'Fit to window' }).click()
    await page.waitForFunction(() => document.querySelector('[role="dialog"] img').width === 310)
    const box = await image.boundingBox()
    assert.ok(box.x >= 40 && box.x + box.width <= 350)
    assert.equal(await page.getByRole('button', { name: 'Zoom out', exact: true }).isDisabled(), true)
    const bounds = await page.getByRole('dialog').boundingBox()
    assert.deepEqual(bounds, { x: 0, y: 0, width: 390, height: 700 })
  } finally {
    await context.close()
  }
})
