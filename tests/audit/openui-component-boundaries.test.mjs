import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-boundaries-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {onColor} from './packages/modern-ui/src/vendor/openui/components/style.ts';
const app=createRoot(document.getElementById('app'));window.actions=[];
window.show=(response,streaming=false,scheme='light')=>app.render(<><main id="scrollport"><button id="before">Earlier message</button><section id="block" className="iui-root" data-theme={scheme}><Renderer library={library} response={response} isStreaming={streaming} onAction={event=>window.actions.push(event)}/></section></main><button id="composer">Composer</button></>);
window.onColor=onColor;
`,
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
  const filename = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', filename?.endsWith('.js') ? 'text/javascript' : filename ? 'text/css' : 'text/html')
  response.end(
    filename
      ? await readFile(path.join(directory, filename))
      : `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>
body{margin:0;font:14px Arial;--dsw-font-family:Arial}#scrollport{position:relative;width:600px;height:500px;overflow:hidden}#before{position:absolute;left:120px;top:110px;width:140px;height:32px}#block{position:absolute;left:100px;top:180px;width:300px;--ink:#171717;--page:white;color:var(--ink);background:var(--page)}#block[data-theme=dark]{--ink:#eeeeee;--page:#171717}#composer{position:fixed;z-index:7;left:120px;top:450px;width:140px;height:32px}
</style><div id="app"></div><script type="module" src="/client.js"></script>`,
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(async () => {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})
async function pageFor(response, streaming = false, setup = async () => {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.route('https://example.invalid/**', () => {})
  await setup(page)
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(([code, streaming]) => window.show(code, streaming), [response, streaming])
  await page.locator('#block').waitFor({ state: 'attached' })
  return page
}

test('an SVG shape cannot claim a click outside its viewport; the composer remains above the answer', async () => {
  const page = await pageFor(
    'root = Col([Pressable([Svg([Rect(-2000, -2000, 4000, 4000, "transparent")], "0 0 100 100", 100, 100)], @ToAssistant("draft-only"))])',
  )
  try {
    await page.locator('.iui-svg rect').waitFor()
    // Reinstating the old declaration isolates the cause without changing the DSL or the surrounding stacking.
    const old = await page.addStyleTag({ content: '.iui-root .iui-svg { overflow: visible !important; }' })
    assert.equal(await page.evaluate(() => document.elementFromPoint(190, 126)?.tagName), 'rect')
    await page.mouse.click(190, 126)
    await page.waitForFunction(() => window.actions.length === 1)
    await old.evaluate(node => node.remove())
    await page.evaluate(() => {
      window.actions = []
    })
    const hit = await page.evaluate(() => [document.elementFromPoint(190, 126)?.id, document.elementFromPoint(190, 466)?.id])
    assert.deepEqual(hit, ['before', 'composer'])
    await page.locator('#before').click()
    assert.equal(await page.evaluate(() => window.actions.length), 0)
    await page.locator('.iui-svg').click({ position: { x: 50, y: 50 } })
    await page.waitForFunction(() => window.actions.length === 1)
  } finally {
    await page.close()
  }
})

test('popover font, native select, card shadow and keyboard focus survive the SVG boundary', async () => {
  const page = await pageFor(
    '$choice = "A"\nroot = Col([Card([Popover("Definition", [Text("Panel outside its trigger")]), Select($choice, ["A", "B"], "Choice"), Button("Action", @ToAssistant("ok"))])])',
  )
  try {
    await page.locator('.iui-popover-trigger').click()
    const panel = page.locator('.iui-popover')
    await panel.waitFor()
    const styles = await page.evaluate(() => ({
      font: getComputedStyle(document.querySelector('.iui-popover')).fontFamily,
      token: getComputedStyle(document.querySelector('.iui-popover')).getPropertyValue('--iui-font'),
      size: getComputedStyle(document.querySelector('.iui-popover')).fontSize,
      shadow: getComputedStyle(document.querySelector('.iui-card')).boxShadow,
    }))
    assert.equal(styles.token.trim(), 'Arial')
    assert.equal(styles.font, 'Arial')
    assert.equal(styles.size, '14px')
    assert.notEqual(styles.shadow, 'none')
    const box = await panel.boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 800 && box.y + box.height <= 600)
    await page.keyboard.press('Escape')
    await page.locator('select').selectOption('B')
    assert.equal(await page.locator('select').inputValue(), 'B')
    await page.locator('select').focus()
    await page.keyboard.press('Tab')
    const focus = await page.evaluate(() => ({
      visible: document.activeElement.matches(':focus-visible'),
      outline: getComputedStyle(document.activeElement).outlineStyle,
    }))
    assert.equal(focus.visible, true)
    assert.notEqual(focus.outline, 'none')
  } finally {
    await page.close()
  }
})

test('reduced motion disables the loading-image shimmer at computed-style level', async () => {
  const page = await pageFor('root = Col([Image("https://example.invalid/pending.png", "pending")])')
  try {
    await page.locator('.iui-image').waitFor()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('.iui-image').evaluate(node => getComputedStyle(node, '::before').animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.equal(await page.locator('.iui-image').evaluate(node => getComputedStyle(node, '::before').animationName), 'iui-shimmer')
  } finally {
    await page.close()
  }
})

test('Grid and Carousel use bounded spacing and inherited transform names are ignored', async () => {
  const page = await pageFor(
    'root = Col([Grid([Text("one"), Text("two")], 2, 1e9, 1e9), Carousel([Text("one"), Text("two")], 240, 1e9), Svg([G([Rect(0, 0, 10, 10, "blue")], "constructor(1)")], "0 0 100 100", 100, 100)])',
  )
  try {
    const values = await page.evaluate(() => ({
      grid: getComputedStyle(document.querySelector('.iui-grid')).gap,
      carousel: getComputedStyle(document.querySelector('.iui-carousel-track')).gap,
      transform: document.querySelector('.iui-svg g').getAttribute('transform'),
      cssSrcSupported: CSS.supports('background', 'src("https://example.invalid/image")'),
    }))
    assert.equal(values.grid, '4000px')
    assert.equal(values.carousel, '4000px')
    assert.equal(values.transform, null)
    console.info('OpenUI component boundaries:', JSON.stringify({ browser: browser.version(), ...values }))
  } finally {
    await page.close()
  }
})

test('transparent backgrounds inherit the surrounding foreground in both schemes', async () => {
  const page = await pageFor('root = Box([Text("Readable")], "col", null, null, "rgba(0,0,0,0.05)")')
  try {
    for (const [scheme, expected] of [
      ['light', 'rgb(23, 23, 23)'],
      ['dark', 'rgb(238, 238, 238)'],
    ]) {
      await page.evaluate(scheme => window.show('root = Box([Text("Readable")], "col", null, null, "rgba(0,0,0,0.05)")', false, scheme), scheme)
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('.iui-text')).color === expected, expected, { timeout: 1500 })
    }
  } finally {
    await page.close()
  }
})

test('photo search waits for the fence to settle while explicit image URLs remain usable', async () => {
  const urls = []
  const code = 'root = Col([SearchImage("streaming query example"), Image("https://example.invalid/explicit.png", "explicit image")])'
  const page = await pageFor(code, true, async page => {
    await page.route(/^https:\/\/(?:[^/]+\.wikipedia\.org|commons\.wikimedia\.org)\//, async route => {
      urls.push(route.request().url())
      await route.fulfill({ json: {} })
    })
  })
  try {
    await page.locator('img[alt="explicit image"]').waitFor()
    assert.equal(await page.locator('img[alt="explicit image"]').getAttribute('src'), 'https://example.invalid/explicit.png')
    await page.waitForTimeout(650)
    assert.deepEqual(urls, [])
    await page.evaluate(code => window.show(code, false), code)
    await page.waitForTimeout(800)
    assert.ok(urls.some(url => url.includes('/page/summary/')))
  } finally {
    await page.close()
  }
})

test('charts retain finite geometry for extreme values and expose unrepresentable stacked totals as data', async () => {
  const page = await pageFor('root = Col([])')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const extreme = [
      { k: 'negative', v: -1e308 },
      { k: 'positive', v: 1e308 },
    ]
    const cases = [
      [
        'bar',
        [
          { k: 'bad', v: 'Infinity' },
          { k: 'bad2', v: '-Infinity' },
        ],
      ],
      ['bar', extreme],
      ['line', extreme],
      ['area', extreme],
      ['bar', [{ k: 'smallest', v: Number.MIN_VALUE }]],
      ['bar', [{ k: 'large', v: 1e308 }]],
      [
        'scatter',
        [
          { k: -1e308, v: 1e308 },
          { k: 1e308, v: -1e308 },
        ],
      ],
      [
        'pie',
        [
          { k: 'A', v: 1e308 },
          { k: 'B', v: 1e308 },
        ],
      ],
      ['area', extreme, true],
    ]
    for (const [index, [type, rows, stacked = false]] of cases.entries()) {
      const code = `root = Col([Chart(${JSON.stringify(type)}, ${JSON.stringify(rows)}, "k", ["v"], "number", null, ${stacked}, 240, null, null, "case-${index}")])`
      await page.evaluate(code => window.show(code), code)
      await page.getByText(`case-${index}`, { exact: true }).first().waitFor()
      await page.locator('.iui-chart svg').waitFor()
      const invalid = await page
        .locator('.iui-chart svg')
        .evaluate(svg =>
          [...svg.querySelectorAll('*')].flatMap(node =>
            [...node.attributes].filter(attr => /NaN|Infinity/.test(attr.value)).map(attr => `${node.tagName}.${attr.name}=${attr.value}`),
          ),
        )
      assert.deepEqual(invalid, [], `${type}: ${JSON.stringify(rows)}`)
      if (type === 'pie') assert.deepEqual(await page.locator('.iui-pie-legend b').allTextContents(), ['50%', '50%'])
    }
    const overflow = 'root = Col([Chart("bar", [{k:"A", first:1e308, second:1e308}], "k", ["first", "second"], "number", null, true)])'
    await page.evaluate(code => window.show(code), overflow)
    await page.getByRole('status').filter({ hasText: 'outside the chart' }).waitFor()
    assert.equal(await page.locator('.iui-chart svg').count(), 0)
    assert.equal(await page.locator('.iui-chart details').getAttribute('open'), '')
    assert.equal(await page.locator('.iui-chart tbody td').count(), 2)
    assert.ok((await page.locator('.iui-chart tbody td').allTextContents()).every(text => text.length > 100))
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
