import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const result = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  bundle: true,
  write: false,
  outfile: 'fixture.js',
  format: 'iife',
  stdin: {
    resolveDir: root,
    contents: `
    import { observeControlRow } from './packages/modern-ui/src/vendor/conversation/client/skeleton/control-row-layout.ts';
    import bar from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.module.css';
    import model from './packages/modern-ui/src/vendor/model/client/ModelSelect.module.css';
    const row=document.getElementById('row');
    row.className=bar.row;
    row.innerHTML='<div class="'+bar.tools+'"><button>+</button><button>Permission</button><button>Plan</button></div><div class="'+bar.trailing+'"><div class="'+model.root+'"><div class="'+model.anchor+'"><button id="model" class="'+model.trigger+'"><span>V</span><span class="'+model.triggerLabel+'">A very long provider model label for compact layout testing</span></button></div></div><button>Send</button></div>';
    window.reads=0; window.deliveries=0;
    const rect=Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect=function(){if(this===row||this.parentElement===row)window.reads++;return rect.call(this)};
    const NativeObserver=ResizeObserver;
    window.ResizeObserver=class extends NativeObserver{constructor(callback){super((...args)=>{window.deliveries++;callback(...args)})}};
    window.stop=observeControlRow(row);
    window.changeControls=()=>{row.firstElementChild.append(document.createElement('button'));row.firstElementChild.lastChild.textContent='Extra option'};
  `,
  },
  logLevel: 'silent',
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

test('control-row measurement converges after mount, width changes, and control mutation', async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.setContent('<style>body{margin:0;font:14px Arial}button{flex:none}</style><div id="row"></div><textarea></textarea>')
    await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith('.css')).text })
    await page.addScriptTag({ content: result.outputFiles.find(file => file.path.endsWith('.js')).text })
    const counts = []
    for (const width of [900, 390, 320, 900]) {
      await page.setViewportSize({ width, height: 700 })
      await page.waitForTimeout(120)
      const before = await page.evaluate(() => ({ reads, deliveries }))
      await page.waitForTimeout(120)
      const after = await page.evaluate(() => ({ reads, deliveries }))
      assert.deepEqual(after, before, `observer keeps measuring at width ${width}`)
      assert.ok(after.deliveries < 20, JSON.stringify(after))
      counts.push({ width, ...after })
      const layout = await page.evaluate(() => {
        const row = document.getElementById('row').getBoundingClientRect()
        const model = document.getElementById('model').getBoundingClientRect()
        return { width: model.width, fits: model.left >= row.left && model.right <= row.right + 1 }
      })
      assert.ok(layout.width >= 50 && layout.fits, JSON.stringify(layout))
    }
    const beforeTyping = await page.evaluate(() => reads)
    await page.locator('textarea').fill('ten typing updates')
    await page.waitForTimeout(120)
    assert.equal(await page.evaluate(() => reads), beforeTyping, 'typing outside the control row does not trigger a row measurement')
    await page.evaluate(() => changeControls())
    await page.waitForTimeout(120)
    const before = await page.evaluate(() => ({ reads, deliveries }))
    await page.waitForTimeout(120)
    assert.deepEqual(await page.evaluate(() => ({ reads, deliveries })), before)
    assert.deepEqual(errors, [])
    mkdirSync(new URL('../../.artifacts/frontend-audit-20261111/', import.meta.url), { recursive: true })
    writeFileSync(new URL('../../.artifacts/frontend-audit-20261111/control-row-measurements.json', import.meta.url), JSON.stringify(counts, null, 2))
  } finally {
    await page.close()
  }
})
