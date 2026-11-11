import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-flashcard-popover-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {UiLocaleContext} from './packages/modern-ui/src/vendor/openui/components/ui-text.ts';
const app=createRoot(document.getElementById('app'));window.actions=[];
window.show=response=>app.render(<><button id="before">Before</button><div className="iui-root" data-theme="light"><UiLocaleContext.Provider value="en-US"><Renderer library={library} response={response} isStreaming={false} onAction={event=>window.actions.push(event)}/></UiLocaleContext.Provider></div><button id="after">After</button></>);`,
  },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: process.env.AUDIT_FLASHCARD_BASELINE
    ? [
        {
          name: 'flashcard-baseline',
          setup(builder) {
            builder.onLoad({ filter: /openui[/\\]components[/\\]extra\.tsx$/ }, args => ({
              contents: execFileSync('git', ['show', `${process.env.AUDIT_FLASHCARD_BASELINE}:packages/modern-ui/src/vendor/openui/components/extra.tsx`], {
                cwd: root,
                encoding: 'utf8',
              }),
              resolveDir: path.dirname(args.path),
              loader: 'tsx',
            }))
          },
        },
      ]
    : [],
})
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>body{margin:20px;font:14px Arial}#app{width:860px}</style><div id="app"></div><script type="module" src="/client.js"></script>',
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

async function withPage(code, run) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => typeof window.show === 'function')
    await page.evaluate(code => window.show(code), code)
    await page.locator('#before').waitFor()
    await run(page)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
}
async function tabTo(page, target, key = 'Tab') {
  for (let step = 0; step < 8 && !(await target.evaluate(el => el === document.activeElement)); step++) await page.keyboard.press(key)
  assert.equal(await target.evaluate(el => el === document.activeElement), true)
}
const popover = 'Popover("Front details",[Button("Panel action",@ToAssistant("panel proposal"))],"Front panel")'

for (const key of ['Enter', 'Space']) {
  test(`Flashcard ${key} closes its front portal, keeps flip focus and requires an explicit reopen`, async () => {
    await withPage(`root=Col([Flashcard([${popover}],"Back face")])`, async page => {
      const details = page.getByRole('button', { name: 'Front details', exact: true })
      const toggle = page.getByRole('button', { name: 'Tap to flip', exact: true })
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#before').evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Tab')
      assert.equal(await details.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Front panel', exact: true }).waitFor()
      await tabTo(page, toggle, 'Shift+Tab')
      await page.keyboard.press(key)
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Panel action', exact: true }).count(), 0)
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#after').evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press(key)
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await details.getAttribute('aria-expanded'), 'false')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await details.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Front panel', exact: true }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'Panel action', exact: true }).evaluate(el => el === document.activeElement), true)
      assert.deepEqual(await page.evaluate(() => window.actions), [])
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate(() => window.actions[0].humanFriendlyMessage), 'panel proposal')
    })
  })
}

test('pointer flips close the face portal and retain the independent flip button', async () => {
  await withPage(`root=Flashcard([Row([Text("Front context places the details trigger beside the flip control"),${popover}])],"Back face")`, async page => {
    const details = page.getByRole('button', { name: 'Front details', exact: true })
    const toggle = page.getByRole('button', { name: 'Tap to flip', exact: true })
    await details.click()
    await page.getByRole('dialog', { name: 'Front panel', exact: true }).waitFor()
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await details.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.actions), [])
  })
})

test('nested cards inherit activity through nested portals and keep form values and their own flipped state', async () => {
  const code =
    '$outer=""\n$inner=""\n$back=""\nroot=Flashcard([Input($outer,"Outer field"),Flashcard([Input($inner,"Inner field"),Popover("Inner details",[Popover("More details",[Button("Deep action",@ToAssistant("deep proposal"))],"Deep panel")],"Inner panel")],[Input($back,"Inner back field"),Text("Inner back")])],"Outer back")'
  await withPage(code, async page => {
    const outer = page.locator('.iui-flashcard').first()
    const outerToggle = outer.locator(':scope > .iui-flashcard-toggle')
    const innerToggle = page.locator('.iui-flashcard').nth(1).locator(':scope > .iui-flashcard-toggle')
    const details = page.getByRole('button', { name: 'Inner details', exact: true, includeHidden: true })
    await page.getByRole('textbox', { name: 'Outer field', exact: true }).fill('Outer draft')
    await page.getByRole('textbox', { name: 'Inner field', exact: true }).fill('Inner draft')
    const openDeep = async () => {
      await tabTo(page, details)
      await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Inner panel', exact: true }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'More details', exact: true }).evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      await page.getByRole('dialog', { name: 'Deep panel', exact: true }).waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'Deep action', exact: true }).evaluate(el => el === document.activeElement), true)
    }
    await openDeep()
    await outerToggle.evaluate(el => el.click())
    assert.equal(await outerToggle.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await innerToggle.evaluate(el => el.closest('[inert]') !== null), true)
    // A scripted click on an inert descendant must not arm a portal for the return trip.
    await details.evaluate(el => el.click())
    await page.keyboard.press('Enter')
    assert.equal(await outerToggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await innerToggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await page.getByRole('textbox', { name: 'Outer field', exact: true }).inputValue(), 'Outer draft')
    assert.equal(await page.getByRole('textbox', { name: 'Inner field', exact: true }).inputValue(), 'Inner draft')
    await openDeep()
    await innerToggle.evaluate(el => el.click())
    assert.equal(await innerToggle.evaluate(el => el === document.activeElement), true)
    assert.equal(await innerToggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await outerToggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('textbox', { name: 'Inner back field', exact: true }).fill('Inner back draft')
    await outerToggle.evaluate(el => el.click())
    assert.equal(await outerToggle.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    assert.equal(await innerToggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByRole('textbox', { name: 'Inner back field', exact: true }).inputValue(), 'Inner back draft')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.deepEqual(await page.evaluate(() => window.actions), [])
  })
})

test('a card inside an independent Popover closes only the card-owned portal and preserves host Escape behavior', async () => {
  await withPage(`root=Popover("Host details",[Flashcard([${popover}],"Back face")],"Host panel")`, async page => {
    const host = page.getByRole('button', { name: 'Host details', exact: true })
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await host.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'Host panel', exact: true }).waitFor()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: 'Front panel', exact: true }).waitFor()
    const toggle = page.getByRole('button', { name: 'Tap to flip', exact: true })
    await tabTo(page, toggle, 'Shift+Tab')
    await page.keyboard.press('Space')
    assert.equal(await toggle.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.getByRole('dialog', { name: 'Front panel', exact: true }).count(), 0)
    assert.equal(await page.getByRole('dialog', { name: 'Host panel', exact: true }).count(), 1)
    await page.keyboard.press('Space')
    assert.equal(await page.getByRole('dialog').count(), 1)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
    assert.equal(await host.evaluate(el => el === document.activeElement), true)
    assert.deepEqual(await page.evaluate(() => window.actions), [])
  })
})
