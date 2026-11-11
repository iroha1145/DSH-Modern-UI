import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
const root = path.resolve(import.meta.dirname, '../..')
await mkdir(path.join(root, '.artifacts'), { recursive: true })
const directory = await mkdtemp(path.join(root, '.artifacts/keyboard-'))
await build({
  absWorkingDir: root,
  entryPoints: ['tests/fixtures/complete-audit-keyboard.tsx'],
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const server = createServer(async (req, res) => {
  const file = req.url === '/client.js' ? 'client.js' : req.url === '/client.css' ? 'client.css' : null
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html')
  res.end(
    file
      ? await readFile(path.join(directory, file))
      : '<!doctype html><html data-input-modality="keyboard"><link rel="stylesheet" href="/client.css"><style>body{margin:0;font:14px Arial}#app{width:100vw;height:100vh}button{font:inherit}:root{--dsw-alias-border-focus:#06f}</style><div id="app"></div><script type="module" src="/client.js"></script>',
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
async function fixture(mode, props = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(([mode, props]) => window.show(mode, props), [mode, props])
  return { page, errors }
}
const active = page => page.evaluate(() => document.activeElement?.textContent)
test('Menu Tab enters an already-open submenu, radio/checkbox roles share navigation and selection focus', async () => {
  const { page, errors } = await fixture('menu')
  try {
    await page.locator('#trigger').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    assert.equal(await active(page), 'Parent')
    await page.keyboard.press('Tab')
    assert.equal(await active(page), 'Child')
    await page.keyboard.press('ArrowLeft')
    assert.equal(await active(page), 'Parent')
    await page.keyboard.press('Tab')
    assert.equal(await active(page), 'Child')
    await page.keyboard.press('Escape')
    assert.equal(await active(page), 'Parent')
    await page.keyboard.press('ArrowDown')
    assert.equal(await active(page), 'One')
    assert.equal(await page.getByRole('menuitemradio', { name: 'One', exact: true }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('group', { name: 'Group by' }).count(), 1)
    assert.equal(await page.getByRole('group', { name: 'Sort by' }).count(), 1)
    await page.keyboard.press('ArrowDown')
    assert.equal(await active(page), 'Sort A')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    assert.equal(await active(page), 'Check')
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('menuitemcheckbox').getAttribute('aria-checked'), 'true')
    assert.equal(await active(page), 'Check')
    await page.keyboard.press('Space')
    assert.equal(await page.getByRole('menuitemcheckbox').getAttribute('aria-checked'), 'false')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Tab')
    await page.waitForFunction(() => document.activeElement?.id === 'trigger')
    assert.deepEqual(await page.evaluate(() => window.calls), ['check', 'check', 'sort-b'])
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('disabled submenu children leave Tab safe; outside Tab and Shift+Tab keep their contract', async () => {
  const { page, errors } = await fixture('menu', { disabled: true })
  try {
    await page.locator('#trigger').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await active(page), 'Parent')
    await page.keyboard.press('Shift+Tab')
    await page.waitForFunction(() => document.activeElement?.id === 'trigger')
    await page.keyboard.press('Enter')
    await page.locator('#before').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'trigger')
    assert.equal((await page.locator('[role=menu]').count()) > 0, true)
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('preference names contain distinct settings and live current values, descriptions and IDs stay unique', async () => {
  const { page, errors } = await fixture('preferences')
  try {
    const first = page.getByRole('button', { name: 'First setting On', exact: true })
    await first.focus()
    assert.equal((await first.getAttribute('aria-describedby')) !== null, true)
    assert.equal(await page.getByRole('button', { name: 'Second setting On', exact: true }).count(), 1)
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: 'First setting Off', exact: true }).waitFor()
    await page.waitForFunction(() => document.activeElement?.textContent === 'Off')
    assert.equal(await page.getByRole('button', { name: 'settings.enter.title settings.enter.queue', exact: true }).count(), 1)
    assert.equal(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(n => n.id)
        return ids.length === new Set(ids).size
      }),
      true,
    )
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('sidebar keyboard arrows/Home/End use pointer width state; rightbar values reflect the concession limit', async () => {
  const { page, errors } = await fixture('frame')
  try {
    const side = page.getByRole('separator', { name: 'resizeSidebar' })
    await side.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await side.getAttribute('aria-valuenow'), '274')
    await page.keyboard.press('End')
    assert.equal(await page.evaluate(() => window.store.getSnapshot().layoutInfo.sidebar), 360)
    await page.keyboard.press('Home')
    assert.equal(await side.getAttribute('aria-valuenow'), '228')
    await page.evaluate(() => window.store.actions.openRightbar(true, false))
    const right = page.getByRole('separator', { name: 'resizeRightbar' })
    await right.waitFor()
    assert.equal(await right.getAttribute('aria-valuemax'), '572')
    await right.focus()
    await page.keyboard.press('End')
    assert.equal(await right.getAttribute('aria-valuenow'), '572')
    await page.keyboard.press('ArrowRight')
    assert.equal(await right.getAttribute('aria-valuenow'), '562')
    await page.keyboard.press('Home')
    assert.equal(await right.getAttribute('aria-valuenow'), '300')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('copy actions work without mutation permission and return focus with exact full values and feedback', async () => {
  const { page, errors } = await fixture('copy')
  try {
    await page.evaluate(() => {
      window.copies = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => {
            window.copies.push(text)
          },
        },
      })
    })
    for (const [name, value] of [
      ['actions.workspace.aria Workspace', '/home/user/full/path'],
      ['actions.session.aria Full session title', 'Full session title'],
    ]) {
      await page.locator(name.startsWith('actions.workspace') ? '[data-row-key="workspace:w"]' : '[data-row-key="session:s"]').focus()
      const trigger = page.getByRole('button', { name, exact: true })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.waitForFunction(() => !document.querySelector('[role=menu]'))
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      assert.equal((await page.getByRole('status').filter({ hasText: 'hover.copied' }).count()) > 0, true)
      assert.equal(await page.evaluate(() => window.copies.at(-1)), value)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('question groups name the current heading and repeated request instances have unique IDs', async () => {
  const { page, errors } = await fixture('questions')
  try {
    await page.getByRole('radiogroup', { name: 'Choose a color' }).first().waitFor()
    assert.equal(await page.getByRole('radiogroup', { name: 'Choose a color' }).count(), 2)
    assert.equal(
      await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map(n => n.id)
        return ids.length === new Set(ids).size
      }),
      true,
    )
    await page.getByRole('radio', { name: /Red/ }).first().focus()
    await page.keyboard.press('Space')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('radio and checkbox siblings collapse submenus; ordinary action and footer activate once and restore focus', async () => {
  const { page, errors } = await fixture('menu')
  try {
    await page.locator('#trigger').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.getByRole('menuitem', { name: 'Child', exact: true }).waitFor()
    await page.getByRole('menuitemcheckbox').focus()
    assert.equal(await page.getByRole('menuitem', { name: 'Child', exact: true }).count(), 0)
    await page.getByRole('menuitem', { name: 'Parent', exact: true }).focus()
    await page.getByRole('menuitem', { name: 'Child', exact: true }).waitFor()
    await page.getByRole('menuitemradio', { name: 'One', exact: true }).focus()
    assert.equal(await page.getByRole('menuitem', { name: 'Child', exact: true }).count(), 0)
    await page.getByRole('menuitem', { name: 'Action', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.activeElement?.id === 'trigger')
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Footer', exact: true }).focus()
    await page.keyboard.press('Space')
    await page.waitForFunction(() => document.activeElement?.id === 'trigger')
    assert.deepEqual(await page.evaluate(() => window.calls), ['action', 'footer'])
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('copy fallback restores the trigger and denied clipboard writes never claim success', async () => {
  const { page, errors } = await fixture('copy')
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
      document.execCommand = command => {
        window.fallbackText = document.activeElement.value
        return command === 'copy'
      }
    })
    await page.locator('[data-row-key="workspace:w"]').focus()
    const trigger = page.getByRole('button', { name: 'actions.workspace.aria Workspace', exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.evaluate(() => window.fallbackText), '/home/user/full/path')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error('denied')
          },
        },
      })
    })
    await page.locator('[data-row-key="session:s"]').focus()
    const session = page.getByRole('button', { name: 'actions.session.aria Full session title', exact: true })
    await session.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await session.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.locator('[data-row-key="session:s"] [role=status]').textContent(), 'toast.sessionIdCopyFailed')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('production Discover label filters are independent checkboxes and source/sort choices remain radio with action footers', async () => {
  const { page, errors } = await fixture('discover')
  try {
    await page.getByRole('button', { name: 'filterCount 1', exact: true }).focus()
    await page.keyboard.press('Enter')
    const alpha = page.getByRole('menuitemcheckbox', { name: 'Alpha', exact: true }),
      beta = page.getByRole('menuitemcheckbox', { name: 'Beta', exact: true })
    assert.equal(await alpha.getAttribute('aria-checked'), 'true')
    assert.equal(await beta.getAttribute('aria-checked'), 'false')
    await beta.focus()
    await page.keyboard.press('Tab')
    assert.equal(await beta.getAttribute('aria-checked'), 'true')
    assert.equal(await alpha.getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Space')
    assert.equal(await beta.getAttribute('aria-checked'), 'false')
    assert.equal(await alpha.getAttribute('aria-checked'), 'true')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'marketMenu Market', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('menuitemradio', { name: 'Market', exact: true }).getAttribute('aria-checked'), 'true')
    assert.equal(await page.getByRole('menuitem', { name: 'manageSources' }).count(), 1)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'sortBy sortDefault', exact: true }).focus()
    await page.keyboard.press('Enter')
    assert.equal(await page.getByRole('menuitemradio', { name: 'sortDefault', exact: true }).getAttribute('aria-checked'), 'true')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
test('copy feedback changes success to failure and back without keeping stale success', async () => {
  const { page, errors } = await fixture('copy')
  try {
    await page.evaluate(() => {
      window.denied = false
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            if (window.denied) throw Error('denied')
          },
        },
      })
    })
    await page.locator('[data-row-key="workspace:w"]').focus()
    const trigger = page.getByRole('button', { name: 'actions.workspace.aria Workspace', exact: true }),
      status = page.locator('[data-row-key="workspace:w"] [role=status]')
    for (const [denied, message] of [
      [false, 'hover.copied'],
      [true, 'toast.sessionIdCopyFailed'],
      [false, 'hover.copied'],
    ]) {
      await page.evaluate(denied => {
        window.denied = denied
      }, denied)
      await trigger.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.waitForFunction(message => document.querySelector('[data-row-key="workspace:w"] [role=status]')?.textContent === message, message)
      assert.equal(await status.textContent(), message)
      assert.equal(await trigger.getAttribute('title'), message)
    }
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }
})
