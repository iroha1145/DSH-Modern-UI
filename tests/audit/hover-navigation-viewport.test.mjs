import { test } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const repo = path.resolve(import.meta.dirname, '../..')
const base = 'packages/modern-ui/src/vendor/'
const baselineFiles = [
  'primitives/HoverCard.tsx',
  'primitives/HoverCard.module.css',
  'chat/client/chat/TurnNavigator.tsx',
  'chat/client/chat/TurnNavigator.module.css',
]
const bundle = await build({
  absWorkingDir: repo,
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {HoverCard} from './${base}primitives/HoverCard.tsx';
import {TurnNavigator} from './${base}chat/client/chat/TurnNavigator.tsx';
const root=createRoot(document.getElementById('app'));window.navigated=[];
window.hover=(options={})=>flushSync(()=>root.render(<div style={{position:'absolute',left:options.left??300,top:options.top??100,width:80}}><HoverCard anchor={<button>Anchor</button>} openDelayMs={50} {...options} content={<div data-content style={{lineHeight:'20px'}}>{Array.from({length:options.lines??2},(_,i)=><div key={i}>{'long_path_or_title_'.repeat(6)} {i}</div>)}</div>}/></div>));
window.turns=(count,band=500,top=20)=>flushSync(()=>root.render(<div key={count+'-'+band+'-'+top} style={{position:'absolute',top,left:0,width:'100%',height:band,'--dsh-conversation-viewport-height':band+'px','--dsh-composer-height':'0px','--dsh-scrollport-top-inset':'0px','--dsh-composer-side-clearance':'0px'}}><TurnNavigator items={Array.from({length:count},(_,i)=>({turn:i+1,prompt:'Prompt '+(i+1),response:'Readable response '+(i+1)+' '+('summary '.repeat(20)),anchor:{kind:'loaded',key:'t'+i}}))} activeTurn={1} busyTurn={null} onNavigate={item=>window.navigated.push(item.turn)} t={(_,data)=>data?.turn?'Turn '+data.turn:'Turns'}/></div>));`,
  },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: process.env.HOVER_NAV_BASELINE
    ? [
        {
          name: 'baseline',
          setup(builder) {
            builder.onLoad({ filter: /(?:HoverCard|TurnNavigator)\.(?:tsx|module\.css)$/ }, args => {
              const file = path.relative(repo, args.path).replaceAll(path.sep, '/')
              if (!baselineFiles.includes(file.slice(base.length))) return
              return {
                contents: execFileSync('git', ['show', '178188bfbdf3f53c6d5fa3435e64f938c009a62a:' + file], { cwd: repo, encoding: 'utf8' }),
                loader: file.endsWith('.css') ? 'local-css' : 'tsx',
                resolveDir: path.dirname(args.path),
              }
            })
          },
        },
      ]
    : [],
})
const theme = (
  await Promise.all(
    ['base', 'design-platform', 'beautiful-ui', 'scrollbar', 'focus'].map(name => readFile(path.join(repo, base, 'theme/styles', name + '.css'), 'utf8')),
  )
).join('\n')
const cardSelector = '[class*="HoverCard_card"]'
const settle = page => page.waitForTimeout(200)
const geometry = locator =>
  locator.evaluate(node => {
    const rect = node.getBoundingClientRect(),
      style = getComputedStyle(node)
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: style.overflowY,
      topStyle: style.top,
      translate: style.translate,
      transition: style.transitionProperty,
    }
  })

for (const engine of [chromium, firefox, webkit]) {
  test(`${engine.name()}: compact hover cards stay readable inside narrow/short viewports and track resizes`, async () => {
    const browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 480, height: 200 } })
    page.setDefaultTimeout(5000)
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ content: theme + bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--dsh-frame-top-clearance', '36px')
        window.hover({ lines: 30 })
      })
      await page.getByRole('button', { name: 'Anchor' }).hover()
      await page.locator(cardSelector).waitFor()
      await settle(page)
      const card = page.locator(cardSelector)
      const before = await geometry(card)
      if (process.env.HOVER_NAV_BASELINE) console.log(engine.name(), 'compact geometry', before)
      assert.ok(before.left >= 8 && before.right <= 472, JSON.stringify(before))
      assert.ok(before.top >= 56 && before.bottom <= 192, JSON.stringify(before))
      assert.equal(before.overflowY, 'auto')
      assert.ok(before.scrollHeight > before.clientHeight)
      await card.hover()
      await card.evaluate(node => {
        node.scrollTop = node.scrollHeight
      })
      assert.ok(await card.evaluate(node => node.scrollTop > 0))
      await page.mouse.move(0, 0)
      await page.waitForFunction(selector => !document.querySelector(selector), cardSelector)
      await page.evaluate(() => window.hover({ lines: 1, top: 100 }))
      await page.getByRole('button', { name: 'Anchor' }).hover()
      await card.waitFor()
      await page.locator('[data-content]').evaluate(node => {
        node.textContent = 'Dynamic content\n'.repeat(50)
        node.style.whiteSpace = 'pre-wrap'
      })
      await settle(page)
      const grown = await geometry(card)
      assert.ok(grown.top >= 56 && grown.bottom <= 192, JSON.stringify(grown))
      await card.hover()
      await page.setViewportSize({ width: 220, height: 260 })
      await settle(page)
      const resized = await geometry(card)
      assert.ok(resized.left >= 8 && resized.right <= 212 && resized.bottom <= 252, JSON.stringify(resized))
    } finally {
      await browser.close()
    }
  })

  test(`${engine.name()}: compact copy feedback respects a viewport shortened during its lifetime`, async () => {
    const browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 480, height: 600 } })
    page.setDefaultTimeout(5000)
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ content: theme + bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--dsh-frame-top-clearance', '36px')
        window.hover({ lines: 30, copyText: '/work/full-path.txt', copyLabel: 'Copy', copiedLabel: 'Copied' })
      })
      await page.getByRole('button', { name: 'Anchor' }).hover()
      const card = page.getByRole('button', { name: 'Copy: /work/full-path.txt', exact: true })
      await card.waitFor()
      await settle(page)
      const original = await geometry(card)
      // Use the browser's real clipboard implementation, without replacing the helper or clipboard API.
      await card.click()
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === 'Copied')
      assert.equal((await geometry(card)).height, original.height)
      await page.mouse.move(170, 90)
      await page.setViewportSize({ width: 480, height: 200 })
      await settle(page)
      assert.equal(await page.getByRole('status').textContent(), 'Copied')
      const shortened = await geometry(card)
      console.log(engine.name(), 'copy feedback resize', { original: original.height, shortened })
      assert.ok(shortened.top >= 56 && shortened.bottom <= 192, JSON.stringify(shortened))
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === '')
      assert.match(await card.textContent(), /long_path_or_title/)
      const restored = await geometry(card)
      assert.ok(restored.top >= 56 && restored.bottom <= 192, JSON.stringify(restored))
    } finally {
      await browser.close()
    }
  })

  test(`${engine.name()}: short and long turn rails follow marks within the usable band with keyboard and reduced motion`, async () => {
    const browser = await engine.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
    page.setDefaultTimeout(5000)
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ content: theme + bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
      for (const count of [2, 3, 4, 5, 6, 7, 80]) {
        for (const [band, top] of [
          [500, 20],
          [160, 8],
          [160, 530],
        ]) {
          await page.evaluate(([count, band, top]) => window.turns(count, band, top), [count, band, top])
          const first = page.getByRole('button', { name: 'Turn 1', exact: true })
          await first.hover()
          await settle(page)
          const initial = await geometry(page.getByRole('tooltip'))
          const last = page.getByRole('button', { name: 'Turn ' + Math.min(count, 5), exact: true })
          await last.hover()
          await settle(page)
          const following = await geometry(page.getByRole('tooltip'))
          if (process.env.HOVER_NAV_BASELINE) console.log(engine.name(), 'rail', { count, band, top, initial: initial.top, following: following.top })
          assert.ok(following.top > initial.top, JSON.stringify({ count, band, initial, following }))
          assert.ok(initial.top >= top + 7 && following.bottom <= top + band - 7, JSON.stringify({ initial, following }))
          assert.ok(following.height >= 60)
          assert.match(await page.getByRole('tooltip').textContent(), /Readable response/)
          assert.equal(following.transition, 'translate')
          await last.focus()
          const describedBy = await last.getAttribute('aria-describedby')
          assert.equal(describedBy, await page.getByRole('tooltip').getAttribute('id'))
          await last.press('Enter')
          assert.equal(await page.evaluate(() => window.navigated.at(-1)), Math.min(count, 5))
          if (count === 80) {
            await first.locator('../..').evaluate(node => {
              node.scrollTop = node.scrollHeight
            })
            const end = page.getByRole('button', { name: 'Turn 80', exact: true })
            await end.hover()
            await settle(page)
            const ending = await geometry(page.getByRole('tooltip'))
            assert.ok(ending.top >= top + 7 && ending.bottom <= top + band - 7, JSON.stringify(ending))
            assert.match(await page.getByRole('tooltip').textContent(), /Prompt 80/)
          }
          await page.mouse.move(10, 10)
          await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'))
        }
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 1200, height: 200 })
      await page.evaluate(() => window.turns(7, 160, 8))
      await page.getByRole('button', { name: 'Turn 7', exact: true }).focus()
      const short = await geometry(page.getByRole('tooltip'))
      assert.ok(short.top >= 15 && short.bottom <= 161, JSON.stringify(short))
      await page.evaluate(() => window.turns(3))
      await page.getByRole('button', { name: 'Turn 2', exact: true }).focus()
      assert.equal(await page.getByRole('tooltip').evaluate(node => getComputedStyle(node).transitionDuration), '0s')
    } finally {
      await browser.close()
    }
  })
}

test('chromium: sample actual layout work across turn preview movements', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } })
  page.setDefaultTimeout(5000)
  try {
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: theme + bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
    await page.evaluate(() => window.turns(40))
    await page.getByRole('button', { name: 'Turn 10', exact: true }).hover()
    await settle(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]))
    const samples = []
    for (let repeat = 0; repeat < 3; repeat++) {
      const before = await metric()
      for (const turn of [20, 12, 24, 14, 28, 10]) {
        await page.getByRole('button', { name: 'Turn ' + turn, exact: true }).hover()
        await settle(page)
        assert.match(await page.getByRole('tooltip').textContent(), new RegExp('Prompt ' + turn))
      }
      const after = await metric()
      samples.push({ layouts: after.LayoutCount - before.LayoutCount, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000 })
    }
    console.log('Turn preview layout sample', { baseline: Boolean(process.env.HOVER_NAV_BASELINE), samples })
  } finally {
    await browser.close()
  }
})
