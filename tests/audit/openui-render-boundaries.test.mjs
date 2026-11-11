// Exercise math resource limits and rich Flashcard faces through the real OpenUI Renderer.
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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-a11y-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts'; import {UiLocaleContext} from './packages/modern-ui/src/vendor/openui/components/ui-text.ts';
const app = createRoot(document.getElementById('app'));
window.show = (offset, response, locale = "en-US", isStreaming = false) => app.render(<><div style={{height: offset}} /><div className="iui-root" data-theme="light"><UiLocaleContext.Provider value={locale}><Renderer library={library} response={response} isStreaming={isStreaming} /></UiLocaleContext.Provider></div><div style={{height: 2000}} /></>);`,
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

async function withPage(run, timezoneId) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, timezoneId })
  const page = await context.newPage()
  try {
    await page.goto(url)
    await page.waitForFunction(() => typeof window.show === 'function')
    await run(page, async (code, locale = 'en-US') => {
      await page.evaluate(([code, locale]) => window.show(20, code, locale), [code, locale])
      await page.waitForTimeout(50)
    })
  } finally {
    await context.close()
  }
}

test('OpenUI Math bounds author dimensions, blocks trusted commands and recovers from recursion', async () => {
  await withPage(async (page, show) => {
    for (const inline of [false, true]) {
      await show(`root = Math(${JSON.stringify(String.raw`\rule{999999em}{999999em}`)}, ${inline})`)
      const math = page.locator('.iui-math')
      const dimensions = await math
        .locator('[style]')
        .evaluateAll(nodes => nodes.flatMap(node => [...node.getAttribute('style').matchAll(/([\d.]+)em/g)].map(match => Number(match[1]))))
      assert.ok(dimensions.includes(20), JSON.stringify(dimensions))
      assert.ok(
        dimensions.every(value => value <= 21),
        JSON.stringify(dimensions),
      )
      assert.ok((await math.boundingBox()).height < 500)
      assert.equal(await page.locator('.katex-error').count(), 0)
    }
    await show(`root = Math(${JSON.stringify(String.raw`\frac{x^2 + 1}{\sqrt{y}}`)})`)
    assert.equal(await page.locator('.katex-html').count(), 1)
    assert.equal(await page.locator('.katex-error').count(), 0)
    await show(`root = Math(${JSON.stringify(String.raw`\href{https://example.com}{click}\includegraphics{https://example.com/a.png}`)})`)
    assert.equal(await page.locator('.iui-math a, .iui-math img').count(), 0)
    const recursive = String.raw`\def\a{\a}\a`
    await show(`root = Math(${JSON.stringify(recursive)})`)
    assert.equal(await page.locator('.katex-error').textContent(), recursive)
  })
})

test('Flashcard keeps independent face controls operable and removes the hidden face from keyboard and accessibility navigation', async () => {
  await withPage(async (page, show) => {
    await show(
      'root = Col([Button("Before"), Flashcard(Col([Text("Front face"), Link("Front link", "https://example.com/front"), Button("Front action", @Set($status, "Front activated")), Input($front, "Front field")]), Col([Text("Back face"), Link("Back link", "https://example.com/back"), Button("Back action", @Set($status, "Back activated")), Input($back, "Back field")]), "Study hint"), Text($status), Button("After")])\n$status = "Ready"\n$front = ""\n$back = ""',
    )
    const card = page.locator('.iui-flashcard')
    const toggle = card.getByRole('button', { name: 'Tap to flip', exact: true })
    assert.equal(await card.evaluate(el => el.tagName), 'ARTICLE')
    assert.equal(await card.locator('button button, button input, button a').count(), 0)
    const checkFace = async (visible, hidden) => {
      assert.equal(await card.locator(`.is-${visible}`).getAttribute('aria-hidden'), 'false')
      assert.equal(await card.locator(`.is-${hidden}`).evaluate(el => el.inert), true)
      assert.equal(await card.getByRole('link', { name: `${hidden === 'front' ? 'Front' : 'Back'} link` }).count(), 0)
      const snapshot = await card.ariaSnapshot()
      assert.ok(snapshot.includes(`${visible === 'front' ? 'Front' : 'Back'} face`), snapshot)
      assert.ok(!snapshot.includes(`${hidden === 'front' ? 'Front' : 'Back'} face`), snapshot)
    }
    await checkFace('front', 'back')
    for (const [visible, hidden] of [
      ['front', 'back'],
      ['back', 'front'],
    ]) {
      const label = visible === 'front' ? 'Front' : 'Back'
      await page.getByRole('button', { name: 'Before', exact: true }).focus()
      for (const target of [
        card.getByRole('link', { name: `${label} link` }),
        card.getByRole('button', { name: `${label} action` }),
        card.getByRole('textbox', { name: `${label} field` }),
        toggle,
        page.getByRole('button', { name: 'After', exact: true }),
      ]) {
        await page.keyboard.press('Tab')
        assert.equal(await target.evaluate(el => el === document.activeElement), true)
      }
      await card.getByRole('button', { name: `${label} action` }).click()
      assert.equal(await page.getByText(`${label} activated`, { exact: true }).count(), 1)
      await card.getByRole('textbox', { name: `${label} field` }).fill('Typed text')
      await card.getByRole('textbox', { name: `${label} field` }).press('Space')
      assert.equal(await toggle.getAttribute('aria-pressed'), String(visible === 'back'))
      await card.getByRole('link', { name: `${label} link` }).evaluate(el => el.addEventListener('click', event => event.preventDefault()))
      await card.getByRole('link', { name: `${label} link` }).click()
      assert.equal(await toggle.getAttribute('aria-pressed'), String(visible === 'back'))
      await card.getByRole('textbox', { name: `${label} field` }).focus()
      await toggle.evaluate(el => el.click())
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
      await checkFace(hidden, visible)
      await page.waitForTimeout(500)
    }
    for (const key of ['Enter', 'Space']) {
      await toggle.focus()
      await page.keyboard.press(key)
      assert.equal(await toggle.getAttribute('aria-pressed'), String(key === 'Enter'))
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
    }
  })
})
