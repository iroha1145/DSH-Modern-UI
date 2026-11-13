import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = process.env.AUDIT_SOURCE_ROOT ?? path.resolve(import.meta.dirname, '../..')
const css = async file => (await readFile(path.join(root, 'packages/modern-ui/src', file), 'utf8')).replace(/:global\(([^)]+)\)/g, '$1')
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

test('mobile title remains centered when a new session is unavailable', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await page.setContent(
      `<style>${await css('vendor/sidebar/client/SidebarRoot.module.css')}</style><nav class="mobileNavigation"><button>Open</button><span class="mobileCurrentTitle">Current session</span></nav>`,
    )
    const title = await page.locator('.mobileCurrentTitle').boundingBox()
    assert.ok(Math.abs(title.x + title.width / 2 - 195) <= 1, JSON.stringify(title))
    await page.locator('nav').evaluate(nav => nav.insertAdjacentHTML('beforeend', '<button>New</button>'))
    const withButton = await page.locator('.mobileCurrentTitle').boundingBox()
    assert.equal(withButton.x, title.x)
    assert.equal(withButton.width, title.width)
  } finally {
    await page.close()
  }
})

test('attachment cards fit a conversation narrower than 240px', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent(
      `<style>${await css('vendor/chat/client/chat/MessageItem.module.css')}</style><div style="width:180px"><div class="attachmentRow"><div class="fileCard"><div class="fileIcon"></div><div class="fileContent"><div class="fileName">${'filename'.repeat(20)}.txt</div><div class="fileMeta">Text</div></div></div></div></div>`,
    )
    const row = await page.locator('.attachmentRow').boundingBox()
    const card = await page.locator('.fileCard').boundingBox()
    assert.ok(card.x >= row.x && card.x + card.width <= row.x + row.width + 1, JSON.stringify({ row, card }))
  } finally {
    await page.close()
  }
})

test('collapsed desktop sidebar does not paint over the conversation or clip caption controls', async () => {
  const page = await browser.newPage()
  try {
    await page.setContent(
      `<style>${await css('vendor/layout/AppFrame.module.css')} body{margin:0} .frame{height:400px;grid-template-columns:0px 1fr 0px}.sidebarCol{background:red}.fading{width:232px;height:300px;background:red}.centerCol{background:white}.caption{position:fixed;top:0;left:12px;width:80px;height:30px;z-index:30}</style><div class="frame" data-sidebar-collapsed="true"><div class="sidebarCol"><div class="caption">Controls</div><div class="fading"></div></div><main class="centerCol"></main><aside></aside></div>`,
    )
    await page.locator('html').evaluate(html => (html.dataset.platform = 'darwin'))
    for (const x of [8, 40, 220]) {
      assert.equal(await page.evaluate(x => document.elementFromPoint(x, 80).className, x), 'centerCol')
    }
    assert.equal(await page.evaluate(() => document.elementFromPoint(30, 15).className), 'caption')
    await page.locator('.fading').evaluate(element => (element.hidden = true))
    assert.equal((await page.locator('.sidebarCol').boundingBox()).width, 0)
    await page.locator('html').evaluate(html => {
      delete html.dataset.platform
      html.setAttribute('data-windows-titlebar', '')
    })
    assert.equal(await page.evaluate(() => document.elementFromPoint(30, 15).className), 'caption')
    // Ordinary desktop web keeps its 68px rail; it does not use the native zero-width state.
    await page.locator('html').evaluate(html => html.removeAttribute('data-windows-titlebar'))
    await page.locator('.frame').evaluate(frame => (frame.style.gridTemplateColumns = '68px 1fr 0px'))
    assert.equal((await page.locator('.sidebarCol').boundingBox()).width, 68)
    assert.equal((await page.locator('.centerCol').boundingBox()).x, 68)
    for (const x of [68, 80, 220]) assert.equal(await page.evaluate(x => document.elementFromPoint(x, 80).className, x), 'centerCol')
  } finally {
    await page.close()
  }
})

test('macOS desktop paints the page ground across the whole frame, as the web does', async () => {
  const page = await browser.newPage()
  try {
    // The Electron window is see-through: whatever the frame leaves unpainted shows the OS material instead of the page.
    await page.setContent(
      `<style>${await css('vendor/layout/AppFrame.module.css')} html,body{margin:0;height:100%;background:transparent} body{--page:rgb(255, 255, 255);--dsw-alias-bg-base:var(--page);--dsw-specific-sidebar-fill:var(--page);--dsw-alias-border-l3:rgb(0, 0, 0)} body[data-ds-dark-theme]{--page:rgb(17, 17, 17)} .frame{grid-template-columns:240px 1fr 320px}</style><div class="frame"><div class="sidebarCol"></div><main class="centerCol"></main><aside class="rightbarCol"></aside></div>`,
    )
    const session = await page.context().newCDPSession(page)
    const read = () =>
      page.evaluate(() => {
        const style = name => getComputedStyle(document.querySelector(name))
        const ground = name => [style(name).backgroundColor, style(name).backgroundImage]
        return {
          frame: ground('.frame'),
          sidebar: ground('.sidebarCol'),
          centre: ground('.centerCol'),
          right: ground('.rightbarCol'),
          seam: style('.centerCol').borderLeftWidth,
        }
      })
    for (const [dark, ground] of [
      [false, 'rgb(255, 255, 255)'],
      [true, 'rgb(17, 17, 17)'],
    ]) {
      await page.locator('body').evaluate((body, dark) => body.toggleAttribute('data-ds-dark-theme', dark), dark)
      for (const collapsed of [false, true]) {
        await page.locator('.frame').evaluate((frame, collapsed) => frame.toggleAttribute('data-sidebar-collapsed', collapsed), collapsed)
        for (const value of ['no-preference', 'reduce']) {
          await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] })
          const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)
          assert.equal(reduced, value === 'reduce', 'the reduced-transparency preference is not emulated')
          await page.locator('html').evaluate(html => delete html.dataset.platform)
          const web = await read()
          await page.locator('html').evaluate(html => (html.dataset.platform = 'darwin'))
          const state = JSON.stringify({ dark, collapsed, value })
          assert.deepEqual(await read(), web, state)
          assert.deepEqual(web.frame, [ground, 'none'], state)
          assert.deepEqual(web.sidebar, ['rgba(0, 0, 0, 0)', 'none'], state)
          assert.deepEqual(web.centre, [ground, 'none'], state)
          assert.equal(web.seam, '0px', state)
        }
      }
    }
  } finally {
    await page.close()
  }
})
