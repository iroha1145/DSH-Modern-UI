import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.env.AUDIT_SOURCE_ROOT ?? path.resolve(import.meta.dirname, '../..')
const css = async file => (await readFile(path.join(root, 'packages/modern-ui/src/vendor', file), 'utf8')).replace(/:global\(([^)]+)\)/g, '$1')
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

// Real layout styles, with InputBar's module-local classes kept separate from
// ConversationRoot's. The 68px header and 98px composer chrome match the
// official-host mobile session (controls, card padding, dock and stats).
async function fixture(page) {
  const input = (await css('conversation/client/skeleton/InputBar.module.css')).replace(/\.([a-zA-Z][\w-]*)/g, '.input-$1')
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>
    ${await css('layout/AppFrame.module.css')}
    ${await css('conversation/client/skeleton/ConversationRoot.module.css')}
    ${input}
    html,body{height:100%;margin:0} .frame{grid-template-columns:1fr}
    .history{height:1200px} .controls{height:32px;flex:none}
    .root>.header{height:68px;min-height:68px;display:block} .stats{height:28px;flex:none}
    .popover{position:fixed;top:70px;left:20px;width:120px;height:60px;z-index:20}
  </style><div class="frame" data-mobile-layout><main class="centerCol"><div class="root" data-phase="active" style="--dsh-conversation-header-height:68px"><header class="header">Session navigation</header><div class="body"><div class="scrollBody"><div class="viewArea"><div class="history">History</div></div><div class="composerSeat"><div class="input-root"><div class="input-card"><div class="input-scroll"><div class="input-input" contenteditable="true">${'Long draft line\n'.repeat(60)}</div></div><div class="controls">Send</div><div class="popover">Menu</div></div><div class="stats">Stats</div></div></div></div></div></div></main></div>`)
  await page.evaluate(() => {
    // ConversationContent's existing observer publishes the same clientHeight.
    const scroll = document.querySelector('.scrollBody')
    const observer = new ResizeObserver(() => scroll.style.setProperty('--dsh-conversation-viewport-height', `${scroll.clientHeight}px`))
    observer.observe(scroll)
  })
  await settled(page)
}

async function settled(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const { top, bottom, height } = document.querySelector(selector).getBoundingClientRect()
      return { top, bottom, height }
    }
    return {
      seat: rect('.composerSeat'),
      scroll: rect('.scrollBody'),
      input: rect('.input-scroll'),
      headerInset: Number.parseFloat(getComputedStyle(document.querySelector('.scrollBody')).paddingTop),
      documentHeight: document.documentElement.scrollHeight,
      windowY: window.scrollY,
    }
  })
}

test('long drafts leave transcript space in short phone and landscape viewports', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 320 }, hasTouch: true })
  try {
    await fixture(page)
    for (const viewport of [
      { width: 390, height: 320 },
      { width: 390, height: 430 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport)
      await settled(page)
      await page.locator('.scrollBody').evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      const result = await geometry(page)
      assert.ok(result.seat.height <= result.scroll.height - result.headerInset - 24, JSON.stringify({ viewport, ...result }))
      assert.ok(result.seat.top >= result.scroll.top + result.headerInset + 24, JSON.stringify(result))
      assert.ok(result.seat.bottom <= viewport.height + 1, JSON.stringify(result))
      assert.equal(result.documentHeight, viewport.height)
      assert.equal(result.windowY, 0)
      assert.ok(await page.locator('.input-scroll').evaluate(el => el.scrollHeight > el.clientHeight))
      await page.locator('.input-scroll').evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      assert.ok(await page.locator('.input-scroll').evaluate(el => el.scrollTop > 0))
    }
    await page.locator('.input-input').fill('Short draft')
    assert.equal((await geometry(page)).input.height, 36)
  } finally {
    await page.close()
  }
})

test('visible viewport cap restores after keyboard-height changes without moving fixed menus', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, hasTouch: true })
  try {
    await fixture(page)
    const full = (await geometry(page)).input.height
    assert.equal(full, 336)
    for (const height of [430, 320, 900]) {
      // AppFrame publishes this measured visualViewport height. Browser
      // emulation does not reproduce a native IME or its viewport events.
      await page.locator('.frame').evaluate((el, height) => el.style.setProperty('--dsh-mobile-viewport-height', `${height}px`), height)
      await settled(page)
      const result = await geometry(page)
      assert.ok(result.seat.height <= result.scroll.height - 24, JSON.stringify(result))
      assert.equal((await page.locator('.popover').boundingBox()).y, 70)
    }
    assert.equal((await geometry(page)).input.height, full)
  } finally {
    await page.close()
  }
})

test('history stays internally scrollable and long drafts retain the desktop cap', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await fixture(page)
    assert.equal((await geometry(page)).input.height, 336)
    await page.locator('.scrollBody').evaluate(el => {
      el.scrollTop = 300
    })
    const before = await page.locator('.history').boundingBox()
    await page.locator('.popover').evaluate(el => {
      el.hidden = true
    })
    const after = await page.locator('.history').boundingBox()
    assert.equal(after.y, before.y)
    assert.equal(await page.locator('.scrollBody').evaluate(el => el.scrollTop), 300)
    await page.evaluate(() => window.scrollTo(0, 10000))
    assert.equal((await geometry(page)).windowY, 0)
    await page.setViewportSize({ width: 1280, height: 390 })
    await settled(page)
    const short = await geometry(page)
    assert.ok(short.input.height < 336)
    await page.setViewportSize({ width: 1280, height: 900 })
    await settled(page)
    assert.equal((await geometry(page)).input.height, 336)
  } finally {
    await page.close()
  }
})

test('short desktop windows keep the composer below the header and retain a line of history', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 390 }, hasTouch: false })
  try {
    await fixture(page)
    for (const height of [390, 320]) {
      await page.setViewportSize({ width: 1280, height })
      await settled(page)
      await page.locator('.scrollBody').evaluate(el => {
        el.scrollTop = el.scrollHeight
      })
      const result = await geometry(page)
      assert.ok(result.seat.top >= result.scroll.top + result.headerInset + 24, JSON.stringify({ height, ...result }))
      assert.ok(result.seat.bottom <= height + 1, JSON.stringify(result))
      assert.ok(result.input.height >= 36)
    }
  } finally {
    await page.close()
  }
})

test('an oversized welcome stack starts in the scrollable area and remains centered when it fits', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 390 } })
  try {
    await fixture(page)
    await page.evaluate(() => {
      document.querySelector('.root').dataset.phase = 'hero'
      document.querySelector('.scrollBody').innerHTML =
        '<div class="composerSeat composerStack composerHero" style="height:500px;box-sizing:border-box"><div id="welcome-title">Welcome</div><div style="flex:1"></div><button id="welcome-send">Send</button></div>'
    })
    await settled(page)
    const read = () =>
      page.evaluate(() => {
        const scroll = document.querySelector('.scrollBody'),
          stack = document.querySelector('.composerHero')
        const a = scroll.getBoundingClientRect(),
          b = stack.getBoundingClientRect()
        return { scrollTop: a.top, scrollBottom: a.bottom, scrollHeight: a.height, top: b.top, bottom: b.bottom, height: b.height }
      })
    const short = await read()
    assert.ok(short.top >= short.scrollTop, JSON.stringify(short))
    await page.locator('.scrollBody').evaluate(node => {
      node.scrollTop = node.scrollHeight
    })
    const end = await read()
    assert.ok(end.bottom <= end.scrollBottom + 1, JSON.stringify(end))
    await page.setViewportSize({ width: 1280, height: 900 })
    await settled(page)
    const tall = await read()
    assert.ok(Math.abs(tall.top + tall.height / 2 - (tall.scrollTop + tall.scrollHeight / 2)) < 1, JSON.stringify(tall))
  } finally {
    await page.close()
  }
})
