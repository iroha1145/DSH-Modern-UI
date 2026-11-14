import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-segment-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {pointerModality} from './packages/modern-ui/src/vendor/primitives/input-modality.ts';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
window.pointerModality = pointerModality;
const app = createRoot(document.getElementById('app'));
window.show = (response, streaming=false, dark=false, revision=0) => {
  document.body.toggleAttribute('data-ds-dark-theme', dark);
  app.render(<div className="iui-root" data-theme={dark?'dark':'light'} data-revision={revision}><Renderer library={library} response={response} isStreaming={streaming} /></div>);
};`,
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
const assets = await Promise.all(['client.js', 'client.css'].map(name => readFile(path.join(directory, name))))
const html =
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>body{margin:0;padding:16px;font:14px Arial}#app{min-width:0}</style><div id="app"></div><script type="module" src="/client.js"></script>'
const server = createServer((request, response) => {
  const index = request.url === '/client.js' ? 0 : request.url === '/client.css' ? 1 : -1
  response.setHeader('Content-Type', index === 0 ? 'text/javascript' : index === 1 ? 'text/css' : 'text/html')
  response.end(index >= 0 ? assets[index] : html)
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

async function withPage(run, options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 }, ...options })
  const page = await context.newPage()
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => typeof window.show === 'function')
    const show = async (code, streaming = false, dark = false, revision = 0) => {
      await page.evaluate(args => window.show(...args), [code, streaming, dark, revision])
      await page.locator('.iui-root').waitFor()
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await run(page, show)
  } finally {
    await context.close()
  }
}
const TWO = '$one = "A"\n$two = "Y"\nroot = Col([SegmentedControl($one, ["A", "B", "C"], true, "First"), SegmentedControl($two, ["X", "Y"], true, "Second")])'
const thumb = group => group.locator('[data-segment-indicator]')
const settle = group => group.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)))
async function aligned(group) {
  const selected = await group.getByRole('radio', { checked: true }).boundingBox()
  const indicator = await thumb(group).boundingBox()
  assert.ok(selected && indicator)
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(selected[key] - indicator[key]) < 1.1, `${key}: ${JSON.stringify({ selected, indicator })}`)
}

test('two segmented instances retain independent selection, roving focus and one moving indicator each', async () => {
  await withPage(async (page, show) => {
    await show(TWO)
    const first = page.getByRole('radiogroup', { name: 'First' }),
      second = page.getByRole('radiogroup', { name: 'Second' })
    assert.equal(await thumb(first).count(), 1)
    assert.equal(await thumb(second).count(), 1)
    const structure = await first.evaluate(el => {
      const track = el.getBoundingClientRect(),
        item = el.querySelector('button').getBoundingClientRect()
      const reference = document.createElement('span')
      reference.style.cssText = 'position:absolute;corner-shape:round'
      el.append(reference)
      const round = getComputedStyle(reference).cornerShape
      reference.remove()
      return {
        insetX: item.x - track.x,
        insetY: item.y - track.y,
        trackCorner: getComputedStyle(el).cornerShape,
        thumbCorner: getComputedStyle(el.querySelector('[data-segment-indicator]')).cornerShape,
        round,
      }
    })
    assert.ok(Math.abs(structure.insetX - 1) < 0.1 && Math.abs(structure.insetY - 1) < 0.1)
    assert.equal(structure.trackCorner, structure.thumbCorner)
    assert.equal(structure.trackCorner, structure.round)
    await aligned(first)
    await aligned(second)
    const secondBefore = await thumb(second).boundingBox()
    await first.getByRole('radio', { name: 'B', exact: true }).click()
    await settle(first)
    await aligned(first)
    assert.deepEqual(await thumb(second).boundingBox(), secondBefore)
    assert.equal(await second.getByRole('radio', { checked: true }).textContent(), 'Y')
    await page.keyboard.press('ArrowRight')
    assert.equal(await first.getByRole('radio', { checked: true }).textContent(), 'C')
    await page.keyboard.press('Home')
    assert.equal(await first.getByRole('radio', { checked: true }).textContent(), 'A')
    await page.keyboard.press('End')
    assert.equal(await first.getByRole('radio', { checked: true }).textContent(), 'C')
    assert.equal(await first.locator('[tabindex="0"]').count(), 1)
    await settle(first)
    await aligned(first)
    assert.equal(await first.getByRole('radio', { checked: true }).evaluate(el => el === document.activeElement), true)
  })
})

test('indicator traverses intermediate frames and finishes beneath the chosen item without remounting', async () => {
  await withPage(async (page, show) => {
    await show(TWO)
    const first = page.getByRole('radiogroup', { name: 'First' })
    const moving = thumb(first)
    assert.equal(await moving.evaluate(el => el.getAnimations().length), 0, 'no initial entrance')
    const start = await moving.boundingBox()
    await first.getByRole('radio', { name: 'C', exact: true }).click()
    const intermediate = await moving.evaluate(async el => {
      const animation = el.getAnimations()[0]
      if (!animation) return null
      animation.pause()
      animation.currentTime = Number(animation.effect.getTiming().duration) / 2
      await new Promise(requestAnimationFrame)
      const box = el.getBoundingClientRect()
      animation.play()
      return box.x
    })
    assert.notEqual(intermediate, null, 'selection creates a movement transition')
    await settle(first)
    const finish = await moving.boundingBox()
    assert.ok(intermediate > start.x && intermediate < finish.x)
    await aligned(first)
    const handle = await moving.elementHandle()
    await show(TWO, false, false, 1)
    assert.equal(await moving.evaluate((el, old) => el === old, handle), true)
    assert.equal(await moving.evaluate(el => el.getAnimations().length), 0, 'unrelated rerender does not replay')
  })
})

test('streaming option changes and fence completion do not animate or reset the active field', async () => {
  await withPage(async (page, show) => {
    const code = choices => '$value = "A"\nroot = Col([SegmentedControl($value, ' + JSON.stringify(choices) + ', true, "Stream")])'
    await show(code(['A', 'B']), true)
    const group = page.getByRole('radiogroup', { name: 'Stream' })
    await group.getByRole('radio', { name: 'B', exact: true }).click()
    assert.equal(await thumb(group).evaluate(el => el.getAnimations().length), 0)
    await show(code(['A', 'B', 'C']), true)
    assert.equal(await thumb(group).evaluate(el => el.getAnimations().length), 0)
    assert.equal(await group.getByRole('radio', { checked: true }).textContent(), 'B')
    await show(code(['A', 'B', 'C']), false)
    assert.equal(await thumb(group).evaluate(el => el.getAnimations().length), 0)
    await aligned(group)
  })
})

test('invalid and empty options hide the indicator, preserve focus ownership and recover', async () => {
  await withPage(async (page, show) => {
    const code = choices => '$value = "Missing"\nroot = Col([SegmentedControl($value, ' + JSON.stringify(choices) + ', true, "Dynamic"), Button("Outside")])'
    await show(code(['A', 'B']))
    const group = page.getByRole('radiogroup', { name: 'Dynamic' })
    assert.equal(await group.getByRole('radio', { checked: true }).count(), 0)
    assert.equal(await thumb(group).filter({ visible: true }).count(), 0)
    await group.getByRole('radio', { name: 'A', exact: true }).focus()
    await page.keyboard.press('End')
    await settle(group)
    await aligned(group)
    await show(code([]))
    assert.equal(await group.getByRole('radio').count(), 0)
    assert.equal(await thumb(group).filter({ visible: true }).count(), 0)
    await page.getByRole('button', { name: 'Outside' }).focus()
    await show(code(['A', 'B', 'C']))
    assert.equal(await page.getByRole('button', { name: 'Outside' }).evaluate(el => el === document.activeElement), true)
    assert.equal(await group.locator('[tabindex="0"]').count(), 1)
  })
})

for (const dark of [false, true]) {
  test(`long labels stay visible at narrow widths and pointer focus stays neutral (${dark ? 'dark' : 'light'})`, async () => {
    await withPage(
      async (page, show) => {
        await show(
          'root = Col([SegmentedControl("A very long option", ["A very long option", "Another lengthy option", "最后一个很长的选项"], true, "Narrow")])',
          false,
          dark,
        )
        const group = page.getByRole('radiogroup', { name: 'Narrow' })
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        for (const radio of await group.getByRole('radio').all()) {
          assert.ok(await radio.evaluate(el => el.clientWidth > 0 && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight + 1))
          assert.ok((await radio.textContent()).length > 0)
        }
        await group.getByRole('radio').nth(1).click()
        await settle(group)
        await aligned(group)
        assert.equal(
          await group
            .getByRole('radio')
            .nth(1)
            .evaluate(el => getComputedStyle(el).outlineStyle),
          'none',
        )
        await page.keyboard.press('ArrowRight')
        assert.equal(
          await group
            .getByRole('radio')
            .nth(2)
            .evaluate(el => getComputedStyle(el).outlineStyle),
          'solid',
        )
        assert.ok(
          Number.parseFloat(
            await group
              .getByRole('radio')
              .nth(2)
              .evaluate(el => getComputedStyle(el).outlineOffset),
          ) <= 0,
          'keyboard ring remains inside the scrollport',
        )
        await settle(group)
        await aligned(group)
      },
      { viewport: { width: 320, height: 700 } },
    )
  })
}

test('reduced motion moves directly to the final selection with no spatial transition', async () => {
  await withPage(
    async (page, show) => {
      await show(TWO)
      const group = page.getByRole('radiogroup', { name: 'First' })
      await group.getByRole('radio', { name: 'C', exact: true }).click()
      assert.equal(await thumb(group).evaluate(el => el.getAnimations().length), 0)
      await aligned(group)
    },
    { reducedMotion: 'reduce' },
  )
})
