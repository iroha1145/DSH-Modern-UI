import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-select-picker-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
const app=createRoot(document.getElementById('app'));window.actions=[];window.outsideClicks=0;
window.show=(code,streaming=false)=>app.render(<><button id="before">Before</button><section id="block" className="iui-root" data-theme="light"><Renderer library={library} response={code} isStreaming={streaming} onAction={event=>window.actions.push(event)}/></section><button id="outside" onClick={()=>window.outsideClicks++}>Outside</button></>);
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
      : '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/client.css"><style>body{margin:12px;font:14px Arial}#block{max-width:420px;margin-block:8px}#outside{position:fixed;bottom:12px;right:12px}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

for (const engine of [chromium, firefox, webkit]) {
  test(`Select uses the same app picker, keyboard contract and field binding in ${engine.name()}`, async () => {
    const browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 340, height: 600 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(7000)
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.waitForFunction(() => typeof window.show === 'function')
      const choices = ['Apple', 'Apricot', 'Banana', ...Array.from({ length: 40 }, (_, n) => `Option ${String(n).padStart(2, '0')}`), 'Zulu']
      await page.evaluate(
        code => window.show(code),
        `$fruit="Apple"\nroot=Form([Select($fruit,${JSON.stringify(choices)},"Fruit"),Text("Chosen: "+$fruit),Button("Propose",@ToAssistant("Use selection"))])`,
      )
      const combo = page.getByRole('combobox', { name: 'Fruit' })
      assert.equal(await page.locator('select').count(), 0)
      await combo.click()
      await page.getByRole('listbox').waitFor()
      await combo.click()
      assert.equal(await page.getByRole('listbox').count(), 0)
      await combo.press('ArrowDown')
      await combo.press('ArrowDown')
      assert.equal(await page.locator('.iui-text').textContent(), 'Chosen: Apple', 'browsing does not mutate the binding')
      await combo.press('Escape')
      assert.equal(await combo.getAttribute('aria-expanded'), 'false')
      assert.equal(await combo.evaluate(el => el === document.activeElement), true)
      await combo.press('b')
      assert.equal(await page.locator('.iui-select-option.is-active').textContent(), 'Banana')
      await combo.press('Enter')
      assert.equal(await page.locator('.iui-text').textContent(), 'Chosen: Banana')
      await combo.press('End')
      const visible = await page.locator('.iui-select-option.is-active').evaluate(el => {
        const r = el.getBoundingClientRect(),
          p = el.parentElement.getBoundingClientRect()
        return r.top >= p.top && r.bottom <= p.bottom
      })
      assert.equal(visible, true, 'active descendant stays in the scroll viewport')
      await combo.press('Tab')
      assert.equal(await page.locator('.iui-text').textContent(), 'Chosen: Zulu')
      assert.equal(await page.getByRole('button', { name: 'Propose', exact: true }).evaluate(el => el === document.activeElement), true)
      await page.getByRole('button', { name: 'Propose', exact: true }).click()
      assert.match(JSON.stringify(await page.evaluate(() => window.actions)), /Zulu/)
      await combo.click()
      await page.locator('#block').evaluate(el => (el.dataset.theme = 'dark'))
      await page.waitForFunction(() => document.querySelector('.iui-select-popup')?.closest('.iui-root')?.dataset.theme === 'dark')
      const box = await page.getByRole('listbox').boundingBox()
      assert.ok(box.x >= 12 && box.y >= 12 && box.x + box.width <= 328 && box.y + box.height <= 588)
      await page.getByRole('button', { name: 'Outside', exact: true }).click()
      assert.equal(await page.getByRole('listbox').count(), 0)
      assert.equal(await page.evaluate(() => window.outsideClicks), 1, 'outside dismissal preserves the target click')
      assert.deepEqual(errors, [])
    } finally {
      await page.close()
      await browser.close()
    }
  }, 45_000)
}

test('nested popovers, empty and duplicate choices, checkbox/radio semantics and forced colors', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 700, height: 650 } })
  page.setDefaultTimeout(7000)
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => typeof window.show === 'function')
    await page.evaluate(() =>
      window.show(
        '$v="A"\nroot=Col([Popover("Details",[Select($v,["A","B"],"Nested"),Text("value="+$v)]),Checkbox(false,"Agree"),RadioGroup("A",["A","B"],"Plan")])',
      ),
    )
    await page.getByRole('button', { name: 'Details', exact: true }).click()
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'B', exact: true }).click()
    assert.match(await page.getByRole('dialog').textContent(), /value=B/)
    await page.getByRole('combobox').press('ArrowDown')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('listbox').count(), 0)
    assert.equal(await page.getByRole('dialog').count(), 1, 'Escape only closes the inner picker')
    await page.keyboard.press('Escape')
    const check = page.getByRole('checkbox', { name: 'Agree' })
    await check.focus()
    await check.press('Space')
    assert.equal(await check.isChecked(), true)
    const radio = page.getByRole('radio', { name: 'A', exact: true })
    await radio.focus()
    await radio.press('ArrowDown')
    assert.equal(await page.getByRole('radio', { name: 'B', exact: true }).isChecked(), true)
    await page.emulateMedia({ forcedColors: 'active' })
    const color = await check.evaluate(el => ({
      appearance: getComputedStyle(el).appearance,
      fg: getComputedStyle(el).color,
      bg: getComputedStyle(el).backgroundColor,
      mark: getComputedStyle(el, '::before').transform,
    }))
    assert.equal(color.appearance, 'none')
    assert.notEqual(color.fg, color.bg)
    assert.notEqual(color.mark, 'matrix(0, 0, 0, 0, 0, 0)')
    await page.evaluate(() =>
      window.show('$v="x"\nroot=Col([Select($v,[{value:"",label:"None"},{value:"x",label:"Same"},{value:"y",label:"Same"}],"Duplicates"),Text("value="+$v)])'),
    )
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Same', exact: true }).last().click()
    assert.equal(await page.locator('.iui-text').textContent(), 'value=y')
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'None', exact: true }).click()
    assert.equal(await page.getByRole('combobox').textContent(), 'None')
    assert.equal(await page.locator('.iui-text').textContent(), 'value=')
  } finally {
    await page.close()
    await browser.close()
  }
}, 45_000)
