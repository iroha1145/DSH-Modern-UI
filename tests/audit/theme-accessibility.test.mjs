import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const repo = path.resolve(import.meta.dirname, '../..')
const base = path.join(repo, 'packages/modern-ui/src/vendor')
const theme = (
  await Promise.all(
    ['base', 'design-platform', 'beautiful-ui', 'shiki', 'scrollbar', 'focus'].map(name => readFile(path.join(base, 'theme/styles', name + '.css'), 'utf8')),
  )
).join('\n')
const terminal = await readFile(path.join(base, 'primitives/TerminalBlock.module.css'), 'utf8')
const bundle = await build({
  absWorkingDir: repo,
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {Toast} from './packages/modern-ui/src/vendor/primitives/Toast.tsx';
import {ToolRow} from './packages/modern-ui/src/vendor/tool/client/tool/components/ToolRow.tsx';
import {TurnNavigator} from './packages/modern-ui/src/vendor/chat/client/chat/TurnNavigator.tsx';
import {parseAnsiLines} from './packages/modern-ui/src/vendor/primitives/ansi.ts';
const app=createRoot(document.getElementById('app'));window.done=0;window.clicked=0;window.toggles=0;window.opened=0;window.navigated=[];window.parseAnsiLines=parseAnsiLines;
const t=(key,data)=>data?.turn===undefined?key:'Turn '+data.turn;
function useDisclosure(){const [expanded,set]=useState(false);return {expanded,toggle:()=>{window.toggles++;set(value=>!value)}}}
const items=Array.from({length:3},(_,i)=>({turn:i+1,prompt:'Prompt '+(i+1),response:'Response '+(i+1),anchor:{kind:'loaded',key:'turn-'+i}}));
window.show=(mode,holdMs=3000,version=1)=>flushSync(()=>app.render(<React.Fragment key={mode}>
{mode==='toast'&&<Toast text="Archived" holdMs={holdMs} actions={[{label:'Undo',onClick:()=>window.clicked++},{label:'Details',onClick:()=>window.clicked++}]} onDone={()=>{window.done+=version}}/>}
{mode==='tool'&&<><ToolRow useDisclosure={useDisclosure} t={t} variant="read" icon={null} title="Read file" summary="file.ts" filePath="/work/file.ts" onOpenFile={()=>window.opened++} bodyRaw="{}" state="ok"/><ToolRow useDisclosure={useDisclosure} t={t} variant="read" icon={null} title="Open URL" summary="example.test" href="https://example.test/" bodyRaw="{}" state="ok"/></>}
{mode==='turns'&&<div style={{position:'relative',height:300}}><TurnNavigator items={items} activeTurn={1} busyTurn={null} onNavigate={item=>window.navigated.push(item.turn)} t={t}/></div>}
</React.Fragment>));`,
  },
  alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(base, 'primitives/index.ts') },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
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
async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...options })
  const page = await context.newPage()
  await page.setContent('<div id="app"></div><button id="outside">Outside</button>')
  await page.addStyleTag({ content: theme + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
  return { context, page }
}

test('theme text, code tokens and basic ANSI colors meet 4.5 contrast on their actual surfaces', async () => {
  const { context, page } = await fixture()
  try {
    const rows = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')
      const rgba = color => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      }
      const blend = (top, bottom) => top.slice(0, 3).map((v, i) => (v * top[3]) / 255 + bottom[i] * (1 - top[3] / 255))
      const luminance = color =>
        color
          .slice(0, 3)
          .map(value => {
            value /= 255
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
          })
          .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0)
      const rows = []
      for (const dark of [false, true]) {
        document.body.toggleAttribute('data-ds-dark-theme', dark)
        const sample = (name, color, background, opacity = 1) => {
          const area = document.createElement('div')
          area.style.background = 'var(--bui-surface)'
          const node = document.createElement('span')
          Object.assign(node.style, { color, background, opacity })
          node.textContent = 'Text'
          area.append(node)
          document.body.append(area)
          const style = getComputedStyle(node),
            bg = blend(rgba(style.backgroundColor), rgba(getComputedStyle(area).backgroundColor))
          const fg = blend([...rgba(style.color).slice(0, 3), 255 * Number(style.opacity)], bg)
          const a = luminance(fg),
            b = luminance(bg)
          rows.push({ dark, name, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })
          area.remove()
        }
        for (const surface of ['surface', 'hover', 'hover-2', 'field']) sample('bui-ink-3/' + surface, 'var(--bui-ink-3)', 'var(--bui-' + surface + ')')
        sample('todo-completed', 'var(--bui-green)', 'color-mix(in srgb,var(--bui-green) 10%,transparent)')
        sample('orange', 'var(--bui-orange)', 'var(--bui-surface)')
        sample('ink-3', 'var(--ink-3)', 'var(--surface)')
        sample('tooltip', 'var(--dsw-static-neutral-bluish-00)', 'var(--dsw-alias-tooltip-bg)')
        for (const token of ['constant', 'string', 'comment', 'keyword', 'parameter', 'function', 'string-expression', 'punctuation', 'link'])
          sample('shiki-' + token, 'var(--shiki-token-' + token + ')', 'var(--dsw-alias-markdown-code-block)')
        for (const code of [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97, 2]) {
          const span = window.parseAnsiLines('\x1b[' + code + 'mtext')[0][0]
          sample('ansi-' + code, span.style?.color ?? 'var(--dsw-alias-label-primary)', 'var(--dsw-alias-markdown-code-block)', span.style?.opacity ?? 1)
        }
      }
      return rows
    })
    assert.equal(rows.length, 68)
    for (const row of rows) assert.ok(row.ratio >= 4.5, JSON.stringify(row))
  } finally {
    await context.close()
  }
})

test('terminal output retains a visible three-pixel scrollbar thumb at the default five-pixel track', async () => {
  const { context, page } = await fixture()
  try {
    await page.addStyleTag({ content: terminal })
    await page.locator('#app').evaluate(node => {
      node.innerHTML =
        '<div class="output" style="height:60px;width:180px">' + Array.from({ length: 50 }, () => '<div>long terminal output</div>').join('') + '</div>'
    })
    const band = await page.locator('.output').evaluate(node => {
      const track = getComputedStyle(node, '::-webkit-scrollbar'),
        thumb = getComputedStyle(node, '::-webkit-scrollbar-thumb')
      return parseFloat(track.width) - parseFloat(thumb.borderLeftWidth) - parseFloat(thumb.borderRightWidth)
    })
    assert.ok(band >= 3, String(band))
  } finally {
    await context.close()
  }
})

test('toast hover and nested action focus pause the remaining lifetime, then resume once', async () => {
  const { context, page } = await fixture()
  try {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
    await page.evaluate(() => window.show('toast'))
    await page.clock.runFor(3500)
    await page.getByRole('button', { name: 'Undo', exact: true }).dispatchEvent('pointerover', { pointerType: 'mouse' })
    assert.equal(await page.getByRole('alert').getAttribute('data-paused'), 'true')
    assert.equal(await page.getByRole('alert').evaluate(node => getComputedStyle(node).opacity), '1')
    await page.clock.runFor(20000)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.getByRole('button', { name: 'Undo', exact: true }).focus()
    await page.getByRole('button', { name: 'Undo', exact: true }).dispatchEvent('pointerout', { pointerType: 'mouse', relatedTarget: null })
    await page.getByRole('button', { name: 'Details', exact: true }).focus()
    await page.evaluate(() => window.show('toast', 3000, 2))
    await page.clock.runFor(10000)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.locator('#outside').focus()
    await page.clock.runFor(499)
    assert.equal(await page.evaluate(() => window.done), 0)
    await page.clock.runFor(1)
    assert.equal(await page.evaluate(() => window.done), 2)
    await page.clock.runFor(5000)
    assert.equal(await page.evaluate(() => window.done), 2)
    assert.ok(await page.getByRole('button', { name: 'Undo', exact: true }).evaluate(node => getComputedStyle(node).textDecorationLine.includes('underline')))
  } finally {
    await context.close()
  }
})

test('the real tool row exposes nested file and URL controls in Chromium AX and isolates their activation', async () => {
  const { context, page } = await fixture()
  try {
    await page.evaluate(() => window.show('tool'))
    const session = await context.newCDPSession(page)
    const { nodes } = await session.send('Accessibility.getFullAXTree')
    assert.ok(nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === 'file.ts'))
    assert.ok(nodes.some(node => !node.ignored && node.role?.value === 'link' && node.name?.value === 'example.test'))
    await page.getByRole('button', { name: 'file.ts', exact: true }).press('Enter')
    assert.deepEqual(await page.evaluate(() => ({ opened: window.opened, toggles: window.toggles })), { opened: 1, toggles: 0 })
    await page.locator('[data-disclosure-row]').first().press('Enter')
    assert.equal(await page.evaluate(() => window.toggles), 1)
  } finally {
    await context.close()
  }
})

test('the wide turn rail exposes previews on keyboard focus and activates with touch', async () => {
  const { context, page } = await fixture({ hasTouch: true, viewport: { width: 1200, height: 700 } })
  try {
    await page.evaluate(() => window.show('turns'))
    const mark = page.getByRole('button', { name: 'Turn 2', exact: true })
    await mark.focus()
    await page.waitForFunction(() => document.activeElement?.hasAttribute('aria-describedby'))
    const description = await mark.evaluate(node => document.getElementById(node.getAttribute('aria-describedby'))?.textContent)
    assert.match(description, /Prompt 2/)
    await mark.tap()
    assert.deepEqual(await page.evaluate(() => window.navigated), [2])
  } finally {
    await context.close()
  }
})
