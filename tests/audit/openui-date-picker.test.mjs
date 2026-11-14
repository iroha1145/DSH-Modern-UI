import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-date-picker-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useState,useRef} from 'react';import {useModalLayer} from '@deepseek-ai/dsh-client-ui-primitives';import {createRoot} from 'react-dom/client';
import {Renderer} from '@openuidev/react-lang';import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {OpenUiDatePicker} from './packages/modern-ui/src/openui-date-picker.tsx';
import {UiLocaleContext,UiTextContext} from './packages/modern-ui/src/vendor/openui/components/ui-text.ts';
import {de} from './packages/modern-ui/src/vendor/intelligent/client/locales.ts';
import './packages/modern-ui/src/vendor/openui/components/theme.css';import './packages/modern-ui/src/vendor/openui/components/components.css';
const app=createRoot(document.getElementById('app'));
function Fixture({locale='en-US',value='2024-02-29',min='2023-01-01',max='2025-12-31'}){const [date,setDate]=useState(value);window.setDate=setDate;return <UiLocaleContext.Provider value={locale}><div className="iui-root" data-theme="light"><button id="before">Before</button><OpenUiDatePicker label="Travel date" value={date} onChange={setDate} min={min} max={max}/><output>{date}</output><button id="after">After</button></div></UiLocaleContext.Provider>}
function ModalFixture(){const [open,setOpen]=useState(true);const [date,setDate]=useState('2024-02-29');const modal=useRef(null);useModalLayer(modal,open,()=>setOpen(false));return <><button id="outside-before">Outside before</button>{open&&<div ref={modal} role="dialog" aria-modal="true" aria-label="Official modal" className="iui-root"><button id="modal-first" data-modal-autofocus>Modal first</button><OpenUiDatePicker label="Modal date" value={date} onChange={setDate}/></div>}<button id="outside-after">Outside after</button></>}
window.modal=()=>app.render(<ModalFixture/>);
window.show=(props={})=>app.render(<Fixture {...props}/>);
window.german=()=>app.render(<UiTextContext.Provider value={de}><Fixture locale="de-DE"/></UiTextContext.Provider>);
window.renderer=()=>app.render(<div className="iui-root"><Renderer library={library} response={'root=Col([DatePicker($day,"Trip","2024-02-01","2024-03-31"),Text($day)])\\n$day="2024-02-29"'} isStreaming={false}/></div>);
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
  const file = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html')
  response.end(
    file
      ? await readFile(path.join(directory, file))
      : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/client.css"><style>body{margin:12px}#app{max-width:450px}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

for (const engine of [chromium, firefox, webkit]) {
  test(`DatePicker official modal keyboard boundary in ${engine.name()}`, async () => {
    const browser = await engine.launch(
      engine === chromium && !existsSync(engine.executablePath()) ? { channel: 'msedge', headless: true } : { headless: true },
    )
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.modal === 'function')
      await page.evaluate(() => window.modal())
      const modal = page.getByRole('dialog', { name: 'Official modal', exact: true })
      const trigger = page.getByRole('button', { name: 'Choose date', exact: true })
      await trigger.click()
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-day'))
      await page.keyboard.press('Tab')
      const clear = page.getByRole('button', { name: 'Clear date', exact: true })
      assert.equal(await clear.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Shift+Tab')
      assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-day')), true)
      await page.getByRole('button', { name: 'Previous month', exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByRole('button', { name: 'Next month', exact: true }).evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Escape')
      assert.equal(await modal.count(), 1)
      assert.equal(await page.getByRole('dialog').count(), 1)
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      await trigger.click()
      await clear.focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#modal-first').evaluate(el => el === document.activeElement), true)
      assert.equal(await modal.count(), 1)
      assert.equal(await page.getByRole('dialog').count(), 1)
      await trigger.click()
      await page.getByRole('button', { name: 'Previous month', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      assert.equal(await modal.count(), 1)
      assert.equal(await page.getByRole('dialog').count(), 1)
    } finally {
      await page.close()
      await browser.close()
    }
  }, 30_000)

  test(`DatePicker adjacent-month pointer selection in ${engine.name()}`, async () => {
    const browser = await engine.launch(
      engine === chromium && !existsSync(engine.executablePath()) ? { channel: 'msedge', headless: true } : { headless: true },
    )
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } })
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.show === 'function')
      await page.evaluate(() => window.show())
      const trigger = page.getByRole('button', { name: 'Choose date', exact: true })
      const input = page.getByRole('textbox', { name: 'Travel date' })
      await trigger.click()
      await page.getByRole('button', { name: 'Friday, March 1, 2024', exact: true }).click()
      assert.equal(await input.inputValue(), '2024-03-01')
      assert.equal(await page.locator('output').textContent(), '2024-03-01')
      assert.equal(await page.getByRole('dialog').count(), 0)
      await page.evaluate(() => window.setDate('2024-02-29'))
      await page.waitForFunction(() => document.querySelector('input').value === '2024-02-29')
      await trigger.click()
      await page.getByRole('button', { name: 'Wednesday, January 31, 2024', exact: true }).click()
      assert.equal(await input.inputValue(), '2024-01-31')
      assert.equal(await page.locator('output').textContent(), '2024-01-31')
      assert.equal(await page.getByRole('dialog').count(), 0)
    } finally {
      await page.close()
      await browser.close()
    }
  }, 30_000)

  test(`DatePicker calendar, binding, validation and locale in ${engine.name()}`, async () => {
    const browser = await engine.launch(
      engine === chromium && !existsSync(engine.executablePath()) ? { channel: 'msedge', headless: true } : { headless: true },
    )
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, timezoneId: 'America/Los_Angeles' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.show === 'function')
      await page.evaluate(() => window.show())
      const input = page.getByRole('textbox', { name: 'Travel date' })
      const trigger = page.getByRole('button', { name: 'Choose date', exact: true })
      assert.equal(await page.locator('input[type=date]').count(), 0)
      assert.equal(await input.inputValue(), '2024-02-29')
      await trigger.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('February 29, 2024'))
      const nextMonth = page.getByRole('button', { name: 'Next month', exact: true })
      await nextMonth.focus()
      await page.keyboard.press('Enter')
      assert.equal(await nextMonth.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      assert.equal(await nextMonth.evaluate(el => el === document.activeElement), true)
      await page.getByRole('button', { name: /April 29, 2024/ }).focus()
      await page.keyboard.press('PageUp')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /March 29, 2024/)
      await page.keyboard.press('PageUp')
      await page.keyboard.press('PageDown')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /March 29, 2024/)
      await page.keyboard.press('Shift+PageUp')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /March 29, 2023/)
      await page.keyboard.press('Home')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /Sunday/)
      await page.keyboard.press('End')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /Saturday/)
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0)
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      await trigger.click()
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-day'))
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      assert.equal(await input.inputValue(), '2024-03-01')
      assert.equal(await page.locator('output').textContent(), '2024-03-01')
      await input.fill('2023-02-29')
      assert.equal(await page.locator('output').textContent(), '')
      assert.equal(await input.getAttribute('aria-invalid'), null)
      await input.press('Tab')
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
      assert.match(await page.getByRole('alert').textContent(), /valid date/)
      await input.fill('2024-02-29')
      assert.equal(await input.getAttribute('aria-invalid'), null)
      await trigger.click()
      const selected = dialog.locator('button[aria-pressed=true]')
      const colors = await selected.evaluate(el => {
        const s = getComputedStyle(el)
        return [s.backgroundColor, s.color, s.paddingTop]
      })
      assert.notEqual(colors[0], 'rgba(0, 0, 0, 0)')
      assert.notEqual(colors[0], colors[1])
      assert.equal(colors[2], '4px')
      const rect = await dialog.boundingBox()
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 320)
      await page.getByRole('button', { name: 'Clear date', exact: true }).click()
      assert.equal(await input.inputValue(), '')
      assert.equal(await page.locator('output').textContent(), '')
      await page.evaluate(() => window.setDate('2024-12-31'))
      await page.waitForFunction(() => document.querySelector('input').value === '2024-12-31')
      assert.equal(await input.inputValue(), '2024-12-31')
      await page.evaluate(() => window.show({ min: '2024-12-30', max: '2025-01-01' }))
      await trigger.click()
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-day'))
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      assert.match(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), /January 1, 2025/)
      await page.keyboard.press('Space')
      assert.equal(await input.inputValue(), '2025-01-01')
      await trigger.click()
      await page.getByRole('button', { name: 'Previous month', exact: true }).focus()
      await page.keyboard.press('Shift+Tab')
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      assert.equal(await dialog.count(), 0)
      await trigger.click()
      await page.getByRole('button', { name: 'Clear date', exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#after').evaluate(el => el === document.activeElement), true)
      assert.equal(await dialog.count(), 0)
      await page.evaluate(() => window.show({ min: '0001-01-01', max: '9999-12-31' }))
      await page.waitForFunction(() => !document.querySelector('[id$="hint"]').textContent.includes('2024-12-30'))
      await input.fill('1900-02-29')
      await input.press('Tab')
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
      await input.fill('2000-02-29')
      assert.equal(await page.locator('output').textContent(), '2000-02-29')
      await input.fill('0099-02-28')
      assert.equal(await page.locator('output').textContent(), '0099-02-28')
      await trigger.click()
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-day'))
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
      assert.equal(await input.inputValue(), '0099-03-01')
      await page.evaluate(() => window.german())
      await page.getByRole('button', { name: 'Datum auswählen', exact: true }).click()
      assert.ok(await page.getByRole('button', { name: /Donnerstag, 29. Februar 2024/ }).count())
      await page.keyboard.press('Escape')
      await page.evaluate(() => window.renderer())
      const bound = page.getByRole('textbox', { name: 'Trip' })
      await bound.fill('2024-03-02')
      assert.equal(await page.locator('.iui-text').textContent(), '2024-03-02')
      await bound.fill('2024-02-30')
      assert.equal(await page.locator('.iui-text').textContent(), '')
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
      await browser.close()
    }
  }, 60_000)
}
