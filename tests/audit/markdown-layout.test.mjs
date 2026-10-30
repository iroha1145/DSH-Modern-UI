import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = process.env.AUDIT_SOURCE_ROOT ?? resolve(import.meta.dirname, '../..')
const css = (await readFile(resolve(root, 'packages/modern-ui/src/vendor/primitives/markdown/MarkdownText.module.css'), 'utf8')).replace(
  /:global\(([^)]+)\)/g,
  '$1',
)
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())
test('inline code shares paragraph lines without overflowing a narrow viewport', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent(
      `<style>${css} .markdown { width: 240px; font: 16px Arial } code {font-family:monospace}</style><div class="markdown"><p>路径 <code>${'a/'.repeat(100)}file.ts</code> 文本</p></div>`,
    )
    const geometry = await page
      .locator('code')
      .evaluate(code => ({ rects: code.getClientRects().length, width: code.parentElement.scrollWidth, max: code.parentElement.clientWidth }))
    assert.ok(geometry.rects > 1, JSON.stringify(geometry))
    // Inline end decoration may extend by the existing 5px padding plus its border.
    assert.ok(geometry.width <= geometry.max + 6, JSON.stringify(geometry))
  } finally {
    await page.close()
  }
})
test('wide table hover does not shift the next paragraph with a native size scrollbar', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent(
      `<style>${css} .markdown {width:240px} .tableScroll::-webkit-scrollbar {height:17px} table {width:600px}</style><div class="markdown"><div class="tableScroll md-table-wide"><table><tr><td>Wide table</td></tr></table></div><p id="after">After</p></div>`,
    )
    await page.mouse.move(700, 700)
    const before = await page.locator('#after').boundingBox()
    await page.locator('table').hover({ position: { x: 20, y: 10 } })
    const after = await page.locator('#after').boundingBox()
    assert.equal(after.y, before.y)
  } finally {
    await page.close()
  }
})
