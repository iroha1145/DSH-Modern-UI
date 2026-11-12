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

test('Svg titles, descriptions and decoration retain old positional DSL', async () => {
  await withPage(async (page, show) => {
    await show(
      'root = Col([Svg([SvgText("Inside", 5, 10)], "0 0 20 20", null, null, "Process", "Input leads to output"), Svg([Circle(5, 5, 3)], "0 0 20 20", null, null, "Shape", "Circle marks the start"), Svg([Rect(0, 0, 5, 5)], "0 0 20 20", null, null, null, null, true), Svg([], "0 0 10 10")])',
    )
    assert.equal(await page.getByRole('img', { name: 'Process' }).count(), 1)
    assert.equal(await page.getByRole('img', { name: 'Shape' }).count(), 1)
    assert.equal(await page.getByRole('img', { name: 'Diagram' }).count(), 1)
    assert.equal(await page.locator('svg[aria-hidden="true"]').count(), 1)
    const svg = page.getByRole('img', { name: 'Process' })
    assert.equal(await svg.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent), 'Input leads to output')
  })
})

test('radio group has one Tab entry, arrow selection, duplicate labels and focus after removing selected option', async () => {
  await withPage(async (page, show) => {
    await show(
      'root = Col([SegmentedControl($pick, $options, false, "Plan", "Select one"), Button("Remove", @Set($options, [{value: "a", label: "Same"}, {value: "c", label: "Last"}]))])\n$pick = ""\n$options = [{value: "a", label: "Same"}, {value: "b", label: "Same"}, {value: "c", label: "Last"}]',
    )
    const group = page.getByRole('radiogroup', { name: 'Plan' })
    const radios = group.getByRole('radio')
    assert.equal(await group.locator('[tabindex="0"]').count(), 1)
    await radios.nth(0).focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await radios.nth(2).getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    assert.equal(await radios.nth(1).getAttribute('aria-checked'), 'true')
    await page.getByRole('button', { name: 'Remove' }).evaluate(el => el.click())
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'radio')
    assert.equal(await group.getByRole('radio').count(), 2)
    assert.equal(await group.locator('[tabindex="0"]').count(), 1)
    await page.keyboard.press('ArrowRight')
    assert.equal(await group.getByRole('radio', { checked: true }).count(), 1)
  })
})

test('nonmodal Popover is named, takes focus, yields Tab, prioritizes modal Escape and restores trigger', async () => {
  await withPage(async (page, show) => {
    await show('root = Col([Popover("Source", [Button("Inside")]), Popover(Icon("info"), [Text("Definition")], "Term details"), Button("Outside")])')
    await page.getByRole('button', { name: 'Source', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Source' })
    assert.equal(await dialog.count(), 1)
    assert.equal(await dialog.getAttribute('aria-modal'), null)
    assert.equal(await dialog.evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('button', { name: 'Inside' }).evaluate(el => el === document.activeElement), true)
    await dialog.evaluate(el => {
      const modal = document.createElement('div')
      modal.role = 'dialog'
      modal.setAttribute('aria-modal', 'true')
      modal.tabIndex = -1
      el.append(modal)
      modal.focus()
    })
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 1)
    await dialog.evaluate(el => {
      el.lastElementChild.remove()
      el.focus()
    })
    await page.keyboard.press('Escape')
    assert.equal(await dialog.count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Source', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.locator('.iui-popover-trigger').nth(1).click()
    assert.equal(await page.getByRole('dialog', { name: 'Term details' }).count(), 1)
    await page.getByRole('button', { name: 'Outside' }).focus()
    assert.equal(await page.getByRole('button', { name: 'Outside' }).evaluate(el => el === document.activeElement), true)
  })
})

test('all chart types expose keyboard-expandable tables from plotted values and retain pie legends', async () => {
  await withPage(async (page, show) => {
    for (const type of ['bar', 'line', 'area', 'scatter', 'pie', 'donut']) {
      await show(
        'root = Col([Chart("' +
          type +
          '", [{label:"Long category", x:1, a:-2, b:0.000005}, {label:"Missing", x:2, b:4}], "' +
          (type === 'scatter' ? 'x' : 'label') +
          '", ["a","b"], "currency", "EUR", false, 240, null, null, "Comparison of measured values")])',
      )
      const details = page.locator('details')
      await details.evaluate(el => {
        el.open = false
      })
      await details.locator('summary').focus()
      await page.keyboard.press('Enter')
      assert.equal(await details.getAttribute('open'), '')
      const table = details.getByRole('table')
      assert.equal(await table.count(), 1)
      assert.equal(await table.locator('tbody tr').count(), 2)
      assert.ok((await table.textContent()).includes(type === 'pie' || type === 'donut' ? '€0' : '-€2'))
      if (type === 'pie' || type === 'donut') assert.equal(await page.locator('.iui-pie-legend').count(), 1)
      else assert.ok((await table.textContent()).includes('€0.000005'))
    }
  })
})

test('locale context changes formatted numbers without changing stored values; date locale is explicit', async () => {
  await withPage(async (page, show) => {
    const code =
      'root = Col([Table(["Number"], [[1234.5], [0.0000005]]), Slider(1234.5, 0, 2000, 0.5, "Amount"), Text(@FormatDate("2026-01-01", "long", "de"))])'
    for (const locale of ['zh', 'ja', 'en', 'de']) {
      await show(code, locale)
      assert.equal(await page.locator('tbody tr').first().textContent(), (1234.5).toLocaleString(locale, { maximumFractionDigits: 4 }))
      assert.equal(await page.getByRole('slider').inputValue(), '1234.5')
      assert.ok((await page.locator('tbody tr').last().textContent()).match(/[eE]/))
      assert.ok((await page.locator('.iui-text').textContent()).includes('Donnerstag'))
    }
  })
})

test('explicit date locale preserves calendar days across browser time zones and timestamp semantics', async () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    await withPage(async (page, show) => {
      for (const locale of ['zh', 'ja', 'en', 'de']) {
        await show(
          'root = Col([Text(@FormatDate("2026-01-01", "long", "' +
            locale +
            '")), Text(@FormatDate("2026-01-01T00:30:00Z", "date", "' +
            locale +
            '")), Text(@FormatDate("2026-01-01", "iso")), Text(@FormatDate("2026-01-01", "date"))])',
        )
        const values = await page.locator('.iui-text').allTextContents()
        const expected = await page.evaluate(
          locale => [
            new Date('2026-01-01').toLocaleString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
            new Date('2026-01-01T00:30:00Z').toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
          ],
          locale,
        )
        assert.deepEqual(values.slice(0, 2), expected)
        assert.equal(values[2], '2026-01-01')
        assert.equal(values[3], 'Jan 1, 2026')
      }
    }, zone)
  }
})

test('streaming radio options keep the existing focus and remain operable when settled', async () => {
  await withPage(async page => {
    const show = async (choices, streaming) => {
      await page.evaluate(
        ([choices, streaming]) =>
          window.show(20, 'root = Col([SegmentedControl("", ' + JSON.stringify(choices) + ', false, "Streaming choice")])', 'en-US', streaming),
        [choices, streaming],
      )
    }
    await show(['One'], true)
    await page.getByRole('radio', { name: 'One' }).focus()
    await show(['One', 'Two'], true)
    assert.equal(await page.getByRole('radio', { name: 'One' }).evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('radio', { name: 'Two' }).getAttribute('aria-checked'), 'true')
    await show(['One', 'Two'], false)
    assert.equal(await page.getByRole('radio', { name: 'Two' }).evaluate(el => el === document.activeElement), true)
    assert.equal(await page.locator('[role="radiogroup"] [tabindex="0"]').count(), 1)
  })
})

test('chart data alternatives retain close decimals, scatter x and percentage-point units', async () => {
  await withPage(async (page, show) => {
    for (const locale of ['en', 'de']) {
      for (const format of ['number', 'currency', 'percent']) {
        await show(
          'root = Col([Chart("scatter", [{x:1.0001, y:1.0001}, {x:1.0002, y:1.0002}, {x:0.000000000000000123456789, y:0.000000000000000123456789}], "x", ["y"], "' +
            format +
            '", "EUR")])',
          locale,
        )
        await page.locator('details').evaluate(el => {
          el.open = true
        })
        const rows = await page.locator('table tbody tr').allTextContents()
        const cells = await page.locator('table tbody td').allTextContents()
        const xs = await page.locator('table tbody th').allTextContents()
        assert.notEqual(cells[0], cells[1])
        assert.notEqual(xs[0], xs[1])
        assert.equal(xs[0], (1.0001).toLocaleString(locale, { maximumSignificantDigits: 21 }))
        for (const [i, value] of [1.0001, 1.0002, 0.000000000000000123456789].entries()) {
          const exact = value.toLocaleString(locale, { maximumSignificantDigits: 21 })
          assert.ok(rows[i].includes(exact), rows[i])
          if (format === 'percent') assert.ok(cells[i].includes(exact) && cells[i].includes('%'), cells[i])
          if (format === 'currency') assert.ok(cells[i].includes('€'), cells[i])
        }
      }
    }
  })
})

test('a radio group that becomes empty releases focus ownership before new options arrive', async () => {
  await withPage(async page => {
    const show = async choices => {
      await page.evaluate(
        choices => window.show(20, 'root = Col([SegmentedControl("", ' + JSON.stringify(choices) + ', false, "Dynamic choice"), Button("Outside")])'),
        choices,
      )
    }
    await show(['One'])
    await page.getByRole('radio', { name: 'One' }).focus()
    await show([])
    assert.equal(await page.getByRole('radio').count(), 0)
    await page.getByRole('button', { name: 'Outside' }).focus()
    await show(['One', 'Two'])
    assert.equal(await page.getByRole('button', { name: 'Outside' }).evaluate(el => el === document.activeElement), true)
    assert.equal(await page.getByRole('radiogroup').locator('[tabindex="0"]').count(), 1)
    await page.getByRole('radio', { name: 'One' }).focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await page.getByRole('radio', { name: 'Two' }).getAttribute('aria-checked'), 'true')
  })
})

test('icon Popover trigger uses title or localized details as its fallback name', async () => {
  await withPage(async (page, show) => {
    await show(
      'root = Col([Popover(Icon("info"), [Text("Definition")], "Term details"), Popover("Source", [Text("Text body")], "Other title"), Popover(Text("Text trigger"), [Text("Component body")], "Component title"), Popover(Button("Native"), [Text("Button body")], "Native title")])',
    )
    const trigger = page.getByRole('button', { name: 'Term details', exact: true })
    assert.equal(await trigger.count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Source', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Native', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'Text trigger', exact: true }).count(), 1)
    assert.equal(await page.locator('button button, [role="button"] button').count(), 0)
    for (const key of ['Enter', ' ']) {
      await trigger.focus()
      await page.keyboard.press(key)
      const dialog = page.getByRole('dialog', { name: 'Term details' })
      assert.equal(await dialog.count(), 1)
      assert.equal(await dialog.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Escape')
      assert.equal(await dialog.count(), 0)
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    }
    for (const title of ['', ', "   "']) {
      await show(
        `root = Col([Popover(Icon("info"), [Text("Definition")]${title}), Popover(Text("Text trigger"), [Text("Text body")]${title}), Popover(Button("Native"), [Text("Button body")]${title})])`,
      )
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Details', exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Text trigger', exact: true }).count(), 1)
      assert.equal(await page.getByRole('button', { name: 'Native', exact: true }).count(), 1)
    }
  })
})

test('scatter table retains point names shared with tooltips and numeric series', async () => {
  await withPage(async (page, show) => {
    await show(
      'root = Col([Chart("scatter", [{name:"Store A", x:1.0001, y:2, z:0.000005}, {name:"Store B", x:1.0001, y:2}], "x", ["y","z"], "currency", "EUR")])',
      'de',
    )
    await page.locator('details summary').click()
    assert.deepEqual(await page.locator('table thead th').allTextContents(), ['name', 'x', 'y', 'z'])
    assert.deepEqual(await page.locator('table tbody th').allTextContents(), ['Store A', 'Store B'])
    assert.deepEqual(await page.locator('table tbody tr').first().locator('td').allTextContents(), ['1,0001', '2 €', '0,000005 €'])
    assert.ok((await page.locator('table tbody tr').last().textContent()).includes('0 €'))
    const circles = page.locator('.iui-chart-plot circle')
    for (const [index, name] of [
      [0, 'Store A'],
      [1, 'Store B'],
      [2, 'Store A'],
      [3, 'Store B'],
    ]) {
      await circles.nth(index).dispatchEvent('pointerover')
      await page.waitForFunction(expected => document.querySelector('.iui-chart-tooltip strong')?.textContent === expected, name)
      assert.equal(await page.locator('.iui-chart-tooltip strong').textContent(), name)
    }
    await show('root = Col([Chart("scatter", [{x:1, y:2}, {x:1, y:2}], "x", ["y"])])')
    await page.locator('details summary').click()
    assert.deepEqual(await page.locator('table thead th').allTextContents(), ['x', 'y'])
    await page.locator('.iui-chart-plot circle').first().dispatchEvent('pointerover')
    await page.waitForFunction(() => document.querySelector('.iui-chart-tooltip strong')?.textContent === 'y')
    assert.equal(await page.locator('.iui-chart-tooltip strong').textContent(), 'y')
  })
})
