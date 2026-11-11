import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'header-transparency-'))
const unsupported = '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {ConversationHeader} from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationHeader.tsx';
import css from './packages/modern-ui/src/vendor/conversation/client/skeleton/ConversationRoot.module.css';
import './packages/modern-ui/src/vendor/theme/styles/gradient-shadow-text.css';
createRoot(document.getElementById('app')).render(<main className={css.root} data-phase="active">
<div id="underlay">HIGH CONTRAST SCROLLED CONTENT</div>
<ConversationHeader sessionId="fixture" useSession={s=>s({blank:false})} useConversation={s=>s({activeTargets:new Set()})}
renderSlot={name=>name==='conversation.header.leading'?<button id="action" popoverTarget="menu">Actions</button>:<div className={css.titleRow}>Conversation title</div>}/>
<div id="menu" popover="auto"><button id="item" onClick={()=>document.body.dataset.selected='yes'}>Select action</button></div>
</main>);`,
  },
  outfile: path.join(directory, 'client.js'),
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const script = await readFile(path.join(directory, 'client.js'))
const css = await readFile(path.join(directory, 'client.css'), 'utf8')
// Exercise the actual fallback declarations in an engine which supports blur.
// This replaces only the @supports gate, never CSS.supports or the declarations.
const simulatedCss = css.replaceAll(unsupported, '@media all')
assert.notEqual(simulatedCss, css)
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>
body{margin:0;font:14px Arial;--page:rgb(255,255,255);--bui-surface:white;--dsw-alias-bg-base:white;--line-soft:transparent}
body[data-ds-dark-theme]{--page:rgb(21,21,23);--bui-surface:rgb(35,35,37);color:white}
#app{width:900px;height:400px;margin:20px}#underlay{position:absolute;inset:0;background:red;color:black;font:bold 20px Arial;forced-color-adjust:none;pointer-events:none}
</style><div id="app"></div><script type="module" src="/client.js"></script>`
const server = createServer((request, response) => {
  const name = request.url.split('?')[0]
  response.setHeader('Content-Type', name === '/client.js' ? 'text/javascript' : name === '/client.css' ? 'text/css' : 'text/html')
  response.end(
    name === '/client.js'
      ? script
      : name === '/client.css'
        ? request.url.includes('simulate')
          ? simulatedCss
          : css
        : html.replace('/client.css', request.url.includes('simulate') ? '/client.css?simulate' : '/client.css'),
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

async function inspect({ dark = false, reducedTransparency = 'no-preference', forcedColors = 'none', simulate = false, width = 1000, hero = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 500 }, forcedColors, colorScheme: dark ? 'dark' : 'light' })
  try {
    if (reducedTransparency === 'reduce') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/${simulate ? '?simulate' : ''}`)
    await page.locator('header').waitFor()
    await page.evaluate(
      ({ dark, hero }) => {
        if (dark) document.body.setAttribute('data-ds-dark-theme', '')
        if (hero) document.querySelector('main').dataset.phase = 'hero'
      },
      { dark, hero },
    )
    const style = await page.locator('header').evaluate(header => {
      const computed = getComputedStyle(header, '::before')
      return {
        mask: computed.maskImage,
        webkitMask: computed.webkitMaskImage,
        blur: computed.backdropFilter,
        background: computed.backgroundColor,
        pointerEvents: computed.pointerEvents,
        content: computed.content,
        supports: CSS.supports('backdrop-filter', 'blur(1px)'),
        reduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        forced: matchMedia('(forced-colors: active)').matches,
      }
    })
    if (width > 640 && !hero) {
      const box = await page.locator('header').boundingBox()
      const clip = { x: box.x + 2, y: box.y + box.height - 10, width: 8, height: 8 }
      const red = await page.screenshot({ clip })
      await page.locator('#underlay').evaluate(element => {
        element.style.background = 'blue'
      })
      const blue = await page.screenshot({ clip })
      style.underlayHidden = red.equals(blue)
    }
    await page.locator('#action').click()
    await page.locator('#item').click()
    assert.equal(await page.locator('body').getAttribute('data-selected'), 'yes')
    if (process.env.HEADER_TEST_DIAGNOSTICS) console.log(JSON.stringify({ dark, reducedTransparency, forcedColors, simulate, width, hero, ...style }))
    return style
  } finally {
    await page.close()
  }
}

for (const dark of [false, true]) {
  test(`glass header retains its shadow fade and controls (${dark ? 'dark' : 'light'})`, async () => {
    const style = await inspect({ dark })
    assert.match(style.mask, /linear-gradient/)
    assert.match(style.webkitMask, /linear-gradient/)
    assert.match(style.blur, /blur/)
    assert.equal(style.pointerEvents, 'none')
    assert.equal(style.underlayHidden, false)
  })
  test(`reduced transparency hides underlying content (${dark ? 'dark' : 'light'})`, async () => {
    const style = await inspect({ dark, reducedTransparency: 'reduce' })
    assert.equal(style.reduced, true)
    assert.equal(style.mask, 'none')
    assert.equal(style.webkitMask, 'none')
    assert.equal(style.blur, 'none')
    assert.equal(style.underlayHidden, true)
  })
  test(`simulated no-backdrop supports branch is opaque (${dark ? 'dark' : 'light'})`, async () => {
    const style = await inspect({ dark, simulate: true })
    assert.equal(style.mask, 'none')
    assert.equal(style.webkitMask, 'none')
    assert.equal(style.blur, 'none')
    assert.equal(style.underlayHidden, true)
  })
}

test('forced colors clears both masks and hides underlying content', async () => {
  const style = await inspect({ forcedColors: 'active' })
  assert.equal(style.forced, true)
  assert.equal(style.mask, 'none')
  assert.equal(style.webkitMask, 'none')
  assert.equal(style.blur, 'none')
  assert.equal(style.underlayHidden, true)
})

for (const options of [{ width: 640 }, { hero: true }]) {
  test(`header without a glass pseudo-element remains unchanged ${JSON.stringify(options)}`, async () => {
    const style = await inspect(options)
    assert.equal(style.mask, 'none')
    assert.equal(style.content, 'none')
  })
}
