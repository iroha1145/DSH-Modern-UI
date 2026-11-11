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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-html-recovery-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
const app=createRoot(document.getElementById('app'));
window.show=html=>app.render(<div className="iui-root"><Renderer library={library} response={'root = HtmlView('+JSON.stringify(html)+', 240, "Example")'} isStreaming={false}/></div>);`,
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
      : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><button id="outside">Outside</button><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const executablePath = process.env.MODERN_UI_BROWSER
const browserServer = await chromium.launchServer(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
const browser = await chromium.connect(browserServer.wsEndpoint())
afterAll(async () => {
  try {
    await browser.close()
  } finally {
    await browserServer.close()
  }
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})
async function mount(html) {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(html => window.show(html), html)
  await page.locator('.iui-html-view > iframe').waitFor()
  return page
}

test('a running view can be stopped with the keyboard, inspected and explicitly restarted', async () => {
  const html = '<button onclick="this.textContent=Number(this.textContent)+1">0</button>'
  const page = await mount(html)
  try {
    const inner = page.frameLocator('.iui-html-view > iframe').frameLocator('iframe')
    await inner.getByRole('button', { name: '0', exact: true }).click()
    await inner.getByRole('button', { name: '1', exact: true }).waitFor()
    await page.waitForTimeout(6200)
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 1, 'normal inner heartbeats keep the view running')
    const stop = page.getByRole('button', { name: 'Stop view' })
    await stop.focus()
    await page.keyboard.press('Space')
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 0)
    assert.equal(await page.getByRole('status').textContent(), 'Interactive view closed.')
    await page.locator('.iui-root').evaluate(element => {
      element.dataset.theme = 'dark'
    })
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.iui-html-view')).colorScheme === 'dark')
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 0, 'theme change cannot restart a stopped page')
    await page.locator('summary').click()
    assert.equal(await page.locator('.iui-html-view pre').textContent(), html)
    await page.getByRole('button', { name: 'Restart view' }).focus()
    await page.keyboard.press('Enter')
    await inner.getByRole('button', { name: '0', exact: true }).waitFor()
  } finally {
    await page.close()
  }
})

test('the watchdog removes a frame whose heartbeat stops and permits a replacement', async () => {
  // A disposable browser owned by this test is terminated by Node even if renderer isolation regresses.
  // This proves recovery in this browser, not a cross-browser hard CPU quota.
  // Runs in Node, independently of any renderer event loop, and force-kills only this test's browser process.
  const failsafe = setTimeout(() => {
    void browserServer.kill()
  }, 20_000)
  let page
  try {
    // A missing heartbeat is reproducible across browsers. Opt into actual CPU blocking to characterize
    // renderer isolation: some Chromium builds share the parent event loop and cannot recover this way.
    const infinite = process.env.MODERN_UI_TEST_INFINITE_LOOP === '1'
    page = await mount(
      infinite
        ? '<p>Loop sample</p><script>setTimeout(()=>{while(true){}},100)</script>'
        : '<p>Stopped reporter</p><script>for(let id=1;id<=64;id++)clearInterval(id)</script>',
    )
    const started = Date.now()
    await page.getByRole('status').filter({ hasText: 'stopped responding' }).waitFor({ timeout: 15_000 })
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 0)
    await page.getByRole('button', { name: 'Outside', exact: true }).click({ timeout: 3000 })
    await page.evaluate(() => window.show('<button>Recovered replacement</button>'))
    await page.frameLocator('.iui-html-view > iframe').frameLocator('iframe').getByRole('button', { name: 'Recovered replacement' }).waitFor({ timeout: 5000 })
    console.info(
      'HtmlView unresponsive recovery:',
      JSON.stringify({ browser: browser.version(), mode: infinite ? 'infinite-loop' : 'stopped-heartbeat', recoveredInMs: Date.now() - started }),
    )
  } finally {
    try {
      await page?.close()
    } finally {
      clearTimeout(failsafe)
    }
  }
})

test('closing a document replacement triggers the second-load guard', async () => {
  const failsafe = setTimeout(() => {
    void browserServer.kill()
  }, 20_000)
  const page = await mount('<button>Replace document</button>')
  try {
    await page.frameLocator('.iui-html-view > iframe').frameLocator('iframe').getByRole('button', { name: 'Replace document' }).waitFor()
    const outer = page.frames().find(frame => frame.parentFrame() === page.mainFrame())
    const inner = page.frames().find(frame => frame.parentFrame() === outer)
    await inner.evaluate(() => {
      document.open()
      document.write('<p>Replacement</p>')
      document.close()
    })
    await page.getByRole('status').filter({ hasText: 'was stopped' }).waitFor()
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 0)
  } finally {
    await page.close()
    clearTimeout(failsafe)
  }
})

test('an open document rewrite stays sandboxed, while authored heartbeats can keep the watchdog alive', async () => {
  const failsafe = setTimeout(() => {
    void browserServer.kill()
  }, 20_000)
  const page = await mount('<button>Replace document</button>')
  try {
    await page.frameLocator('.iui-html-view > iframe').frameLocator('iframe').getByRole('button', { name: 'Replace document' }).waitFor()
    const outer = page.frames().find(frame => frame.parentFrame() === page.mainFrame())
    const inner = page.frames().find(frame => frame.parentFrame() === outer)
    await inner.evaluate(() => {
      for (let id = 1; id <= 64; id++) clearInterval(id)
      document.open()
      document.write('<p id="replacement">Replaced document</p>')
      // No close/load: this is a replacement within the same Document, not a second navigation.
      setInterval(() => parent.postMessage({ type: 'dsh:openui-html-view:v1', heartbeat: true }, '*'), 250)
    })
    await page.waitForTimeout(6200)
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 1)
    const limits = await inner.evaluate(async () => {
      let parentDenied = false
      try {
        void parent.document.body
      } catch {
        parentDenied = true
      }
      let networkDenied = false
      try {
        await fetch('https://example.invalid/blocked-by-inherited-csp')
      } catch {
        networkDenied = true
      }
      return { parentDenied, networkDenied, body: document.body.textContent }
    })
    assert.deepEqual(limits, { parentDenied: true, networkDenied: true, body: 'Replaced document' })
    await page.getByRole('button', { name: 'Outside', exact: true }).click()
    await page.getByRole('button', { name: 'Stop view' }).click()
    assert.equal(await page.locator('.iui-html-view > iframe').count(), 0)
    console.info(
      'HtmlView document rewrite:',
      JSON.stringify({ browser: browser.version(), sameDocumentAllowed: true, authoredHeartbeatAccepted: true, ...limits }),
    )
  } finally {
    await page.close()
    clearTimeout(failsafe)
  }
})
