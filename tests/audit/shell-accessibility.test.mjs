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
const directory = await mkdtemp(path.join(tmpdir(), 'modern-shell-a11y-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {Tooltip} from './packages/modern-ui/src/vendor/primitives/Tooltip.tsx';
import {Input} from './packages/modern-ui/src/vendor/primitives/Input.tsx';
import {InlineEditor} from './packages/modern-ui/src/vendor/primitives/InlineEditor.tsx';
import {SidebarRoot} from './packages/modern-ui/src/vendor/sidebar/client/SidebarRoot.tsx';
import {ProjectRowItem} from './packages/modern-ui/src/vendor/workspace/client/rows/Rows.tsx';
import {en} from './packages/modern-ui/src/vendor/sidebar/client/locales.ts';
import workspace from './packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.module.css';
import './packages/modern-ui/src/vendor/theme/styles/focus.css';
const app=createRoot(document.getElementById('app'));
const noop=()=>{};
window.opened=0;window.created=0;window.folded=0;
window.show=(mode, disabled=false)=>app.render(<React.Fragment key={mode}>
{mode==='tooltip' && <><p id="prior">Existing description</p><Tooltip label="Extra description" focusDelayMs={80} portal disabled={disabled}><button id="trigger" aria-describedby="prior">Trigger</button></Tooltip></>}
{mode==='pinned' && <Tooltip label="Pinned description" openOnClick portal disabled={disabled}><button id="trigger">Pin</button></Tooltip>}
{mode==='nested' && <Tooltip label="Outer description"><div id="outer" tabIndex={0}><Tooltip label="Inner description" portal><button id="inner">Inner</button></Tooltip></div></Tooltip>}
{mode==='focus' && <><Input aria-label="Search"/><InlineEditor label="Draft" value="Draft" onChange={noop} onSave={noop} onCancel={noop}/><input aria-label="Rename" className={workspace.renameInput}/></>}
{mode==='sidebar' && <SidebarRoot useModernViewport={f=>f({mobile:false})} buildVersion="0.2.1-test" collapsed={false} width={300} startSession={()=>window.created++} toggleSidebar={noop} selectPanel={noop} setPinned={noop} trackEntryClick={noop} useRemoteAccess={()=>true} useSessions={f=>f([])} usePanels={f=>f([])} useEntryPins={f=>f([])} useEntryActions={f=>f(false)} useShortcuts={f=>f([])} usePanelInfo={f=>f({})} t={k=>en[k]??k} renderSlot={(id,p,options)=>options?.fallback??null}/>}
{mode==='row' && <ProjectRowItem group={{key:'w',workspaceId:'w',label:'Workspace',expanded:true,containsCurrent:false}} onToggle={()=>window.folded++} onCreate={()=>window.opened++} actions={{rename:noop,delete:noop}} useRemoteAccess={()=>true} useWorkspaceAccess={()=>true} t={k=>k} />}
</React.Fragment>);`,
  },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>
:root {--dsw-alias-state-business-primary:#065bd6;--dsw-alias-border-l4:#999;--dsw-alias-label-primary:#111;--control-h-sm:32px} body{font:14px Arial;margin:20px} #app{max-width:380px} button{font:inherit} [data-theme=dark]{background:#111;color:#eee;--dsw-alias-state-business-primary:#8ac0ff;--dsw-alias-label-primary:#eee}
</style><div id="app"></div><script type="module" src="/client.js"></script>`
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(name ? await readFile(path.join(directory, name)) : html)
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
async function open(mode, options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 700 }, ...options })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  await page.evaluate(mode => window.show(mode), mode)
  await page.locator('#app > *').first().waitFor()
  return { context, page }
}
async function description(page, selector) {
  return page.locator(selector).evaluate(el => ({
    ids: el.getAttribute('aria-describedby')?.split(/\s+/) ?? [],
    text: (el.getAttribute('aria-describedby')?.split(/\s+/) ?? []).map(id => document.getElementById(id)?.textContent),
  }))
}
test('ordinary portal tooltip preserves descriptions through delayed focus, disable and removal', async () => {
  const { context, page } = await open('tooltip')
  try {
    await page.keyboard.press('Tab')
    assert.deepEqual((await description(page, '#trigger')).ids, ['prior'])
    await page.getByRole('tooltip').waitFor()
    const value = await description(page, '#trigger')
    assert.equal(value.ids.length, 2)
    assert.ok(value.text.includes('Extra description'))
    const cdp = await context.newCDPSession(page)
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("#trigger")' })
    const { node } = await cdp.send('DOM.describeNode', { objectId: result.objectId })
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId })
    assert.equal(nodes.find(node => node.role?.value === 'button')?.description?.value, 'Existing description Extra description')
    await cdp.detach()
    await page.evaluate(() => window.show('tooltip', true))
    await page.getByRole('tooltip').waitFor({ state: 'detached' })
    assert.deepEqual((await description(page, '#trigger')).ids, ['prior'])
    await page.evaluate(() => window.show('tooltip'))
    await page.locator('#trigger').blur()
    await page.keyboard.press('Tab')
    await page.evaluate(() => window.show('focus'))
    assert.equal(await page.getByRole('tooltip').count(), 0)
  } finally {
    await context.close()
  }
})
test('pinned and nested tooltips only describe bubbles that remain mounted', async () => {
  const { context, page } = await open('pinned')
  try {
    await page.locator('#trigger').click()
    await page.getByRole('tooltip').waitFor()
    assert.equal((await description(page, '#trigger')).ids.length, 1)
    await page.keyboard.press('Escape')
    assert.deepEqual((await description(page, '#trigger')).ids, [])
    await page.evaluate(() => window.show('nested'))
    await page.locator('#outer').focus()
    await page.getByRole('tooltip').waitFor()
    await page.locator('#inner').focus()
    await page.getByRole('tooltip').filter({ hasText: 'Inner description' }).waitFor()
    assert.deepEqual((await description(page, '#outer')).ids, [])
    assert.equal((await description(page, '#inner')).text[0], 'Inner description')
  } finally {
    await context.close()
  }
})
test('input focus indicators keep geometry in light, dark, zoom and forced colors', async () => {
  const { context, page } = await open('focus')
  try {
    for (const theme of ['light', 'dark'])
      for (const forcedColors of ['none', 'active']) {
        await page.emulateMedia({ forcedColors })
        await page.evaluate(theme => {
          document.body.dataset.theme = theme
          document.body.style.zoom = '2'
        }, theme)
        for (const label of ['Search', 'Draft', 'Rename']) {
          const field = page.getByRole('textbox', { name: label })
          await field.blur()
          const before = await field.boundingBox()
          await field.focus()
          const ring = await field.evaluate(el => {
            const target = el.tagName === 'INPUT' && el.getAttribute('aria-label') === 'Search' ? el.parentElement : el
            const s = getComputedStyle(target)
            return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }
          })
          assert.equal(ring.style, 'solid')
          assert.equal(ring.width, '2px')
          assert.notEqual(ring.color, 'rgba(0, 0, 0, 0)')
          assert.deepEqual(await field.boundingBox(), before)
        }
      }
    await page.emulateMedia({ forcedColors: 'none' })
    await page.getByRole('textbox', { name: 'Search' }).click()
    assert.equal(await page.getByRole('textbox', { name: 'Search' }).evaluate(el => getComputedStyle(el.parentElement).outlineStyle), 'none')
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
  } finally {
    await context.close()
  }
})
test('version copy is an independent keyboard button with success and failure feedback', async () => {
  const { context, page } = await open('sidebar')
  try {
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => {
            window.copied = text
          },
        },
      }),
    )
    const copy = page.getByRole('button', { name: 'Copy version', exact: true })
    await copy.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('alert').filter({ hasText: 'Version copied' }).waitFor()
    assert.equal(await page.evaluate(() => window.copied), '0.2.1-test')
    assert.equal(await page.evaluate(() => window.created), 0)
    assert.equal(await copy.evaluate(el => !!el.parentElement.closest('button,[aria-hidden="true"]')), false)
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw Error('denied')
          },
        },
      }),
    )
    await page.keyboard.press('Space')
    await page.getByRole('alert').filter({ hasText: 'Could not copy version' }).waitFor()
    assert.equal(await page.evaluate(() => window.created), 0)
  } finally {
    await context.close()
  }
})
test('row targets measure 24px desktop and 44px coarse without activating the containing row', async () => {
  for (const hasTouch of [false, true]) {
    const { context, page } = await open('row', { hasTouch, isMobile: hasTouch, viewport: { width: 390, height: 700 } })
    try {
      await page.getByRole('treeitem').hover()
      const actions = page.getByRole('treeitem').getByRole('button')
      assert.equal(await actions.count(), 2)
      const boxes = await actions.evaluateAll(nodes =>
        nodes.map(el => {
          const r = el.getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width, height: r.height }
        }),
      )
      for (const box of boxes) {
        assert.ok(box.width >= (hasTouch ? 44 : 24))
        assert.ok(box.height >= (hasTouch ? 44 : 24))
      }
      assert.ok(boxes[0].right <= boxes[1].x)
      const create = page.getByRole('button', { name: 'actions.newSession.aria' })
      const box = await create.boundingBox()
      await page.mouse.click(box.x + 2, box.y + 2)
      assert.equal(await page.evaluate(() => window.opened), 1)
      assert.equal(await page.evaluate(() => window.folded), 0)
      await page.getByRole('treeitem').click({ position: { x: 3, y: 3 } })
      assert.equal(await page.evaluate(() => window.folded), 1)
    } finally {
      await context.close()
    }
  }
})
