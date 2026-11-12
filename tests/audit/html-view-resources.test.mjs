import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import path from 'node:path'
import { build } from './helpers/client-build.mjs'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const source = path.join(repo, 'packages/modern-ui/src/vendor/openui/components/html-view.tsx')
const require = createRequire(import.meta.url)
const result = await build({
  stdin: { contents: (await readFile(source, 'utf8')) + '\nexport { innerDocument, outerDocument };', resolveDir: path.dirname(source), loader: 'tsx' },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  packages: 'external',
  logLevel: 'silent',
})
const loaded = new Module(source)
loaded.paths = Module._nodeModulePaths(repo)
loaded.require = require
loaded._compile(result.outputFiles[0].text, source)
const { innerDocument, outerDocument } = loaded.exports
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

test('HtmlView bounded CPU, allocation and message stress recovers without changing its sandbox', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent('<button id="outside">Outside action</button><div id="mount"></div>')
    await page.evaluate(() => {
      window.gaps = []
      let before = performance.now()
      window.timer = setInterval(() => {
        const now = performance.now()
        window.gaps.push(now - before)
        before = now
      }, 20)
      document.querySelector('button').onclick = () => {
        window.clicked = true
      }
    })
    const html = `<button id="inside">Ready</button><script>setTimeout(()=>{
      const until=performance.now()+600;while(performance.now()<until){}
      const bounded=new Uint8Array(8*1024*1024);bounded.fill(1);
      for(let i=0;i<200;i++)parent.postMessage({type:'dsh:openui-html-view:v1',height:200},'*');
      document.querySelector('button').textContent='Recovered';
    },100)</script>`
    const document = outerDocument(
      innerDocument(html, 'light', { fg: '#171717', bg: '#fff', muted: '#555', line: '#aaa', accent: '#08f' }),
      'test-token',
      'Pressure test',
    )
    await page.evaluate(srcDoc => {
      const frame = document.createElement('iframe')
      frame.sandbox = 'allow-scripts'
      frame.srcdoc = srcDoc
      document.querySelector('#mount').append(frame)
    }, document)
    await page.frameLocator('iframe').frameLocator('iframe').getByRole('button', { name: 'Recovered' }).waitFor({ timeout: 10_000 })
    await page.locator('#outside').click()
    const metrics = await page.evaluate(() => {
      clearInterval(window.timer)
      const frame = document.querySelector('iframe')
      const sandbox = frame.getAttribute('sandbox')
      frame.remove()
      return { maxParentGapMs: Math.max(...window.gaps), parentTicks: window.gaps.length, clicked: window.clicked, sandbox }
    })
    console.info('HtmlView bounded stress:', JSON.stringify({ browser: browser.version(), ...metrics }))
    assert.equal(metrics.clicked, true)
    assert.equal(metrics.sandbox, 'allow-scripts')
    assert.ok(metrics.parentTicks > 0)
    assert.equal(await page.locator('iframe').count(), 0)
  } finally {
    await page.close()
  }
})
