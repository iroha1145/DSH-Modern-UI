// A Popover from the vendored component library, rendered by the real Renderer in a browser: the panel opens on the
// side with room, never runs past the viewport, and follows the viewport and its own content as they change.
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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-popover-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
const app = createRoot(document.getElementById('app'));
window.show = (offset, response) => app.render(<><div style={{height: offset}} /><div className="iui-root" data-theme="light"><Renderer library={library} response={response} isStreaming={false} /></div><div style={{height: 2000}} /></>);`,
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
const html =
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>body{margin:0;font:14px Arial}</style><div id="app"></div><script type="module" src="/client.js"></script>'
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(name ? await readFile(path.join(directory, name)) : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

const paragraphs = count => `[${Array.from({ length: count }, (_, i) => `Text("Paragraph ${i + 1} explains one more detail of the term.")`).join(', ')}]`

/** Open a Popover whose trigger sits `offset` px down an 800x600 page; the geometry of trigger and panel. */
async function open(offset, content) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  const failed = new Promise((_, reject) => {
    page.once('pageerror', reject)
  })
  await page.goto(url)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(([offset, response]) => window.show(offset, response), [offset, `root = Col([Popover("Definition", ${content})])`])
  await Promise.race([page.locator('.iui-popover-trigger').waitFor({ timeout: 10_000 }), failed])
  await page.locator('.iui-popover-trigger').click()
  await page.locator('.iui-popover').waitFor()
  return { context, page }
}
const geometry = page =>
  page.evaluate(() => {
    const trigger = document.querySelector('.iui-popover-trigger').getBoundingClientRect()
    const panel = document.querySelector('.iui-popover')
    const box = panel.getBoundingClientRect()
    return {
      trigger: { top: trigger.top, bottom: trigger.bottom },
      top: box.top,
      bottom: box.bottom,
      scrolls: panel.scrollHeight > panel.clientHeight,
      view: innerHeight,
    }
  })

test('a long popover opens on the side with more room and stays inside the viewport', async () => {
  // The trigger's bottom at 372px of 600: below has 208px, above has more.
  const { context, page } = await open(356, paragraphs(32))
  try {
    const box = await geometry(page)
    assert.ok(box.trigger.bottom > 360 && box.trigger.bottom < 385, JSON.stringify(box))
    assert.ok(box.top >= 0 && box.bottom <= box.view, `panel runs past the viewport: ${JSON.stringify(box)}`)
    assert.ok(box.bottom <= box.trigger.top, `panel opens above the trigger: ${JSON.stringify(box)}`)
    assert.ok(box.scrolls, 'the rest of the content scrolls inside the panel')
    await page.locator('.iui-popover').evaluate(panel => {
      panel.scrollTop = panel.scrollHeight
    })
    assert.equal(await page.locator('.iui-popover').count(), 1, 'scrolling inside the panel keeps it open')
  } finally {
    await context.close()
  }
})

test('a short popover still opens below its trigger', async () => {
  const { context, page } = await open(352, paragraphs(2))
  try {
    const box = await geometry(page)
    assert.ok(box.top >= box.trigger.bottom && box.bottom <= box.view, JSON.stringify(box))
    assert.ok(!box.scrolls, JSON.stringify(box))
  } finally {
    await context.close()
  }
})

test('the panel follows a smaller viewport and content that grows after it opens', async () => {
  const { context, page } = await open(40, paragraphs(6))
  try {
    const first = await geometry(page)
    assert.ok(first.top >= first.trigger.bottom && !first.scrolls, JSON.stringify(first))
    await page.setViewportSize({ width: 800, height: 260 })
    await page.waitForFunction(() => document.querySelector('.iui-popover').getBoundingClientRect().bottom <= innerHeight, null, { timeout: 5000 })
    const smaller = await geometry(page)
    assert.ok(smaller.top >= 0 && smaller.bottom <= smaller.view && smaller.scrolls, JSON.stringify(smaller))
    await page.setViewportSize({ width: 800, height: 600 })
    // Content that grows on its own (an image loading, a component updating) moves the panel as well.
    await page.locator('.iui-popover').evaluate(panel => {
      const tall = document.createElement('div')
      tall.style.height = '900px'
      panel.firstElementChild.append(tall)
    })
    await page.waitForFunction(
      () => {
        const panel = document.querySelector('.iui-popover')
        return panel.scrollHeight > panel.clientHeight && panel.getBoundingClientRect().bottom <= innerHeight
      },
      null,
      { timeout: 5000 },
    )
    const grown = await geometry(page)
    assert.ok(grown.top >= 0 && grown.bottom <= grown.view, JSON.stringify(grown))
  } finally {
    await context.close()
  }
})

test('a control trigger toggles once per key in a real browser, whether it is a native button or a Pressable', async () => {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  const page = await context.newPage()
  try {
    await page.goto(url)
    await page.waitForFunction(() => typeof window.show === 'function')
    const response =
      'root = Col([Popover(Button("Native"), [Text("first")]), Popover(Pressable([Text("Tile")], @ToAssistant("UNEXPECTED")), [Text("second")])])'
    await page.evaluate(([offset, code]) => window.show(offset, code), [40, response])
    const panels = () => page.locator('.iui-popover').count()
    for (const control of [page.getByRole('button', { name: 'Native' }), page.locator('.iui-pressable')]) {
      await control.focus()
      // A native button turns Enter into a click; the Pressable acts on the key. Either way the panel toggles once.
      await page.keyboard.press('Enter')
      assert.equal(await panels(), 1, 'Enter opens it')
      assert.equal(await control.getAttribute('aria-expanded'), 'true')
      await control.focus()
      await page.keyboard.press(' ')
      assert.equal(await panels(), 0, 'Space closes it')
      assert.equal(await control.getAttribute('aria-expanded'), 'false')
    }
  } finally {
    await context.close()
  }
})
