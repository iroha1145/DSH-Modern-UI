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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-openui-table-badges-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
const app = createRoot(document.getElementById('app'));
window.show = (response, theme) => app.render(<div className="iui-root" data-theme={theme} style={{color: 'var(--iui-ink)'}}><Renderer library={library} response={response} isStreaming={false}/></div>);`,
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
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>body{margin:0;padding:24px;font:14px Arial}#app{max-width:800px;margin:auto}</style><div id="app"></div><script type="module" src="/client.js"></script>'
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(name ? await readFile(path.join(directory, name)) : html)
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

const statuses = ['偏紧但未坏', '尚正常', '严重不足', '结构性恶化', '持续流失', '需要继续观察']
// A short status column competing with long prose reproduces the auto-table intrinsic sizing failure.
const rows = statuses.map(
  (status, index) =>
    `["层次 ${index + 1}", "这是一段比较详细的当前读数和背景说明，需要在窄屏中自然折行而不挤压状态文字。", Badge(${JSON.stringify(status)}, "warning", ${index === 5 ? '"clock"' : 'null'})]`,
)
const shortFixture = `root = Col([Card([Table(["层次", "现在的读数", "状态"], [${rows.join(',')}])]), Box([Badge("需要继续观察", "warning", "clock")], "col", null, null, null, null, null, 72)])`
const chinese = '这是需要保留全部文字的很长状态说明'.repeat(8)
const english = 'AwaitingAdditionalVerificationWithoutWhitespace'.repeat(8)
const longFixture = `root = Col([Card([Table(["对象", "说明", "状态"], [["中文", "长文字不得撑开页面或截断。", Badge(${JSON.stringify(chinese)}, "warning", "clock")], ["English", "Long tokens wrap inside the badge.", Badge(${JSON.stringify(english)}, "info")]])])])`

async function inspect(page) {
  return page.evaluate(() => {
    const badges = [...document.querySelectorAll('.iui-table .iui-badge')].map(badge => {
      const label = badge.querySelector('.iui-badge-label')
      const bounds = badge.getBoundingClientRect()
      const cell = badge.closest('td').getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(label)
      const textRects = [...range.getClientRects()]
      const icon = badge.querySelector('svg')?.getBoundingClientRect()
      return {
        text: label.textContent,
        width: bounds.width,
        lineCount: new Set(textRects.map(rect => Math.round(rect.y))).size,
        textInside: textRects.every(
          rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1,
        ),
        cellInside: bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1,
        clipped: label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
        iconInside: !icon || (icon.width > 0 && icon.left >= bounds.left && icon.right <= bounds.right && icon.bottom <= bounds.bottom),
      }
    })
    return {
      badges,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      wrappersInside: [...document.querySelectorAll('.iui-table-scroll')].every(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth
      }),
      outside: document.querySelector('.iui-box > .iui-badge')?.getBoundingClientRect().width,
      outsideHeight: document.querySelector('.iui-box > .iui-badge')?.getBoundingClientRect().height,
    }
  })
}

for (const width of [390, 1100]) {
  for (const theme of ['light', 'dark']) {
    test(`table badges retain compact statuses and wrap long labels at ${width}px in ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 700 } })
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        await page.waitForFunction(() => typeof window.show === 'function')
        await page.evaluate(([code, theme]) => window.show(code, theme), [shortFixture, theme])
        await page.locator('.iui-table .iui-badge').last().waitFor()
        const short = await inspect(page)
        assert.deepEqual(
          short.badges.map(badge => badge.text),
          statuses,
        )
        assert.equal(short.pageOverflow, false)
        assert.equal(short.wrappersInside, true)
        for (const badge of short.badges) {
          assert.equal(badge.lineCount, 1, badge.text)
          assert.equal(badge.textInside && badge.cellInside && badge.iconInside, true, badge.text)
          assert.equal(badge.clipped, false, badge.text)
        }
        // The same badge outside a table still shrinks and wraps in its 72px container.
        assert.ok(short.outside <= 72)
        assert.ok(short.outsideHeight > 26)

        await page.evaluate(([code, theme]) => window.show(code, theme), [longFixture, theme])
        await page.waitForFunction(expected => document.querySelector('.iui-table .iui-badge-label')?.textContent === expected, chinese)
        const long = await inspect(page)
        assert.deepEqual(
          long.badges.map(badge => badge.text),
          [chinese, english],
        )
        assert.equal(long.pageOverflow, false)
        assert.equal(long.wrappersInside, true)
        for (const badge of long.badges) {
          assert.ok(badge.width <= 201, badge.text)
          assert.ok(badge.lineCount > 1)
          assert.equal(badge.textInside && badge.cellInside && badge.iconInside, true)
          assert.equal(badge.clipped, false)
        }
      } finally {
        await page.close()
      }
    })
  }
}
