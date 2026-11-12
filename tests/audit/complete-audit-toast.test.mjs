import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const bundle = await build({
  absWorkingDir: repo,
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Toast} from './packages/modern-ui/src/vendor/primitives/Toast.tsx';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
import './packages/modern-ui/src/vendor/theme/styles/focus.css';
const root=createRoot(document.getElementById('app'));window.done=0;window.acted=0;
window.show=({anchor=true,text='Long notification '.repeat(12),action='Undo',holdMs=10000,sequence=1}={})=>flushSync(()=>root.render(
<Toast key={sequence} text={text} anchor={anchor?document.getElementById('composer'):null} holdMs={holdMs}
actions={[{label:action,onClick:()=>window.acted++}]} onDone={()=>window.done++}/>));`,
  },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch(
  process.env.MODERN_UI_BROWSER
    ? { executablePath: process.env.MODERN_UI_BROWSER, headless: true }
    : existsSync(chromium.executablePath())
      ? { headless: true }
      : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

async function fixture(width = 800) {
  const context = await browser.newContext({ viewport: { width, height: 700 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.setContent(
    '<style>body{margin:0}#composer{position:absolute;left:0;top:400px;width:200px;height:40px;transform:translateZ(0)}</style><div id="composer"><div id="app"></div></div><button id="outside">Outside</button>',
  )
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith('.css')) await page.addStyleTag({ content: file.text })
    else await page.addScriptTag({ content: file.text })
  }
  return { context, page }
}

async function withinViewport(page) {
  await page.waitForFunction(() => {
    const element = document.querySelector('[role=alert]')
    if (!element) return false
    const box = element.getBoundingClientRect()
    return box.left >= 23.5 && box.right <= innerWidth - 23.5 && element.scrollWidth <= element.clientWidth + 1
  })
  const geometry = await page.locator('[role=alert]').evaluate(element => {
    const box = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    return { left: box.left, right: box.right, rects: Array.from(range.getClientRects(), rect => ({ left: rect.left, right: rect.right })) }
  })
  for (const rect of geometry.rects) assert.ok(rect.left >= geometry.left - 1 && rect.right <= geometry.right + 1, JSON.stringify(geometry))
  assert.equal(await page.locator('[role=alert]').evaluate(element => element.parentElement === document.body), true)
  return geometry
}

test('long text and actions stay readable for left, right and unanchored banners at narrow and desktop widths', async () => {
  for (const width of [320, 380, 390, 800]) {
    const { context, page } = await fixture(width)
    try {
      for (const anchor of [true, false]) {
        for (const left of [0, width - 100]) {
          await page.locator('#composer').evaluate((element, value) => {
            element.style.left = `${value}px`
          }, left)
          await page.evaluate(
            ({ anchor, left }) =>
              window.show({
                anchor,
                text: 'A'.repeat(200) + '完整通知内容'.repeat(8),
                action: 'Wiederherstellungsaktion'.repeat(4),
                sequence: left + Number(anchor),
              }),
            { anchor, left },
          )
          await withinViewport(page)
          assert.equal(await page.getByRole('button', { name: 'Wiederherstellungsaktion'.repeat(4) }).count(), 1)
        }
      }
    } finally {
      await context.close()
    }
  }
})

test('placement follows position-only sidebar movement, anchor removal and live resizing', async () => {
  const { context, page } = await fixture()
  try {
    await page.evaluate(() => window.show({ text: 'Saved', action: 'Undo' }))
    await withinViewport(page)
    await page.locator('#composer').evaluate(element => {
      element.style.left = '500px'
    })
    await page.waitForFunction(() => {
      const box = document.querySelector('[role=alert]').getBoundingClientRect()
      return Math.abs((box.left + box.right) / 2 - 600) < 1
    })
    await page.setViewportSize({ width: 320, height: 700 })
    await withinViewport(page)
    await page.evaluate(() => window.show({ anchor: false, text: 'Saved', action: 'Undo' }))
    await page.waitForFunction(() => {
      const box = document.querySelector('[role=alert]').getBoundingClientRect()
      return Math.abs((box.left + box.right) / 2 - 160) < 1
    })
  } finally {
    await context.close()
  }
})

test('remeasuring preserves focused/hovered action pauses, remaining lifetime and exactly-once completion', async () => {
  const { context, page } = await fixture()
  try {
    await page.clock.install()
    await page.evaluate(() => window.show({ text: 'Saved', action: 'Undo', holdMs: 1000 }))
    await page.clock.runFor(700)
    await page.getByRole('button', { name: 'Undo' }).focus()
    await page.locator('#composer').evaluate(element => {
      element.style.left = '450px'
    })
    await page.clock.runFor(3000)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.acted), 1)
    await page.getByRole('button', { name: 'Outside' }).focus()
    await page.clock.runFor(800)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.getByRole('button', { name: 'Undo' }).hover()
    await page.clock.runFor(3000)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.mouse.move(790, 690)
    await page.clock.runFor(600)
    assert.equal(await page.evaluate(() => window.done), 1)
    await page.clock.runFor(2000)
    assert.equal(await page.evaluate(() => window.done), 1)
  } finally {
    await context.close()
  }
})
