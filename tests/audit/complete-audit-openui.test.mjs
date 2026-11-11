import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'modern-complete-audit-openui-'))
await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {Renderer} from '@openuidev/react-lang';
import {library} from './packages/modern-ui/src/vendor/openui/library.ts';
import {ModelSelect} from './packages/modern-ui/src/vendor/model/client/ModelSelect.tsx';
import modelCss from './packages/modern-ui/src/vendor/model/client/ModelSelect.module.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
import './packages/modern-ui/src/vendor/theme/styles/beautiful-ui.css';
const app=createRoot(document.getElementById('app')); window.actions=[];window.modelCss=modelCss;
window.show=(response,streaming=false,scheme='light')=>app.render(<div className="iui-root" data-theme={scheme}><Renderer library={library} response={response} isStreaming={streaming} onAction={event=>window.actions.push(event)}/></div>);
window.model=(labels)=>{
const state={groups:[{id:'provider',name:'Provider',models:[{id:'gpt-6.1-sol',name:'GPT-4o multilingual example'}]}],current:{provider:'provider',model:'gpt-6.1-sol'},pending:null,status:'ready',error:null,failures:[]};
const names={'column.speed':labels[0],'column.quality':labels[1],'column.cost':labels[2]};
app.render(<ModelSelect available locked={false} useModelDirectory={f=>f(state)} useModelPicker={f=>f(undefined)} t={(key,values)=>names[key]??key+(values?' '+Object.values(values).join(' '):'')} renderSlot={(name,props,options)=>options.fallback} load={()=>{}} select={async()=>({ok:true})}/>);
};`,
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
const server = createServer(async (request, response) => {
  const name = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', name?.endsWith('.js') ? 'text/javascript' : name ? 'text/css' : 'text/html')
  response.end(
    name
      ? await readFile(path.join(directory, name))
      : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>body{margin:12px;font:14px Arial}#app{width:100%}.iui-root{width:100%}</style><div id="app"></div><script type="module" src="/client.js"></script>',
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
async function open(width = 320) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.show === 'function')
  return page
}
const show = (page, response, streaming = false, scheme = 'light') => page.evaluate(args => window.show(...args), [response, streaming, scheme])

test('F01/F02: full long labels wrap inside Card, Row, Grid and Form with original action names', async () => {
  const page = await open()
  const labels = [
    'Supercalifragilisticexpialidocious'.repeat(4),
    'A complete translated action with several words and details',
    '这是需要完整展示且不能超出相邻内容的很长中文状态和操作名称'.repeat(3),
    'Ausführliche übersetzte Aktionsbeschreibung mit vollständigem Status',
  ]
  for (const label of labels) {
    const badge = `Badge(${JSON.stringify(label)}, "success", "check")`
    const buttons = ['sm', 'md', 'lg'].map(
      (size, index) => `Button(${JSON.stringify(label)}, null, "${['solid', 'outline', 'soft'][index]}", null, "${size}", "check", false, ${index === 0})`,
    )
    await show(
      page,
      `root = Card([${badge}, Row([${buttons[0]}, Badge("Adjacent")]), Grid([${buttons[1]}, ${badge}], 2), Form([${buttons[2]}, Button(${JSON.stringify(label)}, null, "ghost")])])`,
    )
    await page.waitForFunction(label => document.querySelector('.iui-button-label')?.textContent === label, label)
    const geometry = await page.locator('.iui-badge-label, .iui-button-label').evaluateAll(elements =>
      elements.map(el => {
        const label = el.getBoundingClientRect(),
          outer = el.parentElement.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(el)
        return {
          text: el.textContent,
          contained: Array.from(range.getClientRects()).every(r => r.left >= outer.left - 1 && r.right <= outer.right + 1),
          width: label.width,
          overflow: el.scrollWidth > el.clientWidth + 1,
        }
      }),
    )
    assert(geometry.length >= 6)
    assert(
      geometry.every(item => item.contained && !item.overflow),
      JSON.stringify(geometry),
    )
    assert(geometry.some(item => item.text === label))
    await page.locator('.iui-button').first().focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    assert.equal(await page.evaluate(() => window.actions.length), labels.indexOf(label) * 2 + 2)
    await page.keyboard.press('Tab')
    assert.equal(
      await page
        .locator('.iui-button')
        .nth(1)
        .evaluate(el => el === document.activeElement),
      true,
    )
    assert((await page.locator('.iui-button').first().getAttribute('aria-label')) === null)
    assert.equal(await page.locator('.iui-button').first().innerText(), label)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  }
  await show(page, 'root = Button("Streaming disabled", null, "ghost")', true)
  assert(await page.getByRole('button', { name: 'Streaming disabled' }).isDisabled())
  await show(page, 'root = Button("Explicitly disabled", null, "ghost", null, null, null, true)')
  assert(await page.getByRole('button', { name: 'Explicitly disabled' }).isDisabled())
  await page.close()
})

test('F05/F12: live motion preference, page boundaries and shadow/focus space survive carousel scrolling', async () => {
  const page = await open(390)
  for (const scheme of ['light', 'dark']) {
    await show(
      page,
      'root = Carousel([Card([Button("First")]), Card([Button("Second")]), Card([Button("Third")]), Card([Button("Last")])], 240)',
      false,
      scheme,
    )
    await page.getByRole('button', { name: 'Next', exact: true }).waitFor()
    const padding = await page.locator('.iui-carousel-track').evaluate(el => {
      const rect = el.getBoundingClientRect(),
        card = el.querySelector('.iui-card').getBoundingClientRect(),
        style = getComputedStyle(el)
      window.scrollCalls = []
      const original = el.scrollBy.bind(el)
      el.scrollBy = options => {
        window.scrollCalls.push(options)
        original(options)
      }
      return { top: card.top - rect.top, bottom: rect.bottom - card.bottom, start: card.left - rect.left, snap: style.scrollSnapType }
    })
    assert(padding.top >= 24 && padding.bottom >= 24 && padding.start >= 24, JSON.stringify(padding))
    assert.equal(padding.snap, 'x mandatory')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    assert.equal(await page.evaluate(() => window.scrollCalls.at(-1).behavior), 'instant')
    const frames = await page.locator('.iui-carousel-track').evaluate(async el => {
      const positions = [el.scrollLeft]
      for (let index = 0; index < 4; index++) {
        await new Promise(requestAnimationFrame)
        positions.push(el.scrollLeft)
      }
      return positions
    })
    assert(
      frames.every(position => position === frames[0]),
      JSON.stringify(frames),
    )
    await page.getByRole('button', { name: 'Previous', exact: true }).waitFor()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: 'Previous', exact: true }).click()
    assert.equal(await page.evaluate(() => window.scrollCalls.at(-1).behavior), 'smooth')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.iui-carousel-track').evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: 'instant' }))
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(el => el.getAttribute('aria-label') === 'Next'))
    assert(
      await page
        .locator('.iui-carousel-track')
        .evaluate(el => el.getBoundingClientRect().right - el.querySelector('.iui-carousel-item:last-child').getBoundingClientRect().right >= 23),
    )
    await page.locator('.iui-carousel-track').evaluate(el => el.scrollTo({ left: 0, behavior: 'instant' }))
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(el => el.getAttribute('aria-label') === 'Previous'))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  }
  await page.close()
})

test('F12: carousel shadow space cannot intercept neighboring Column controls', async () => {
  const page = await open(390)
  for (const gap of [0, 4, 6]) {
    await show(page, `root = Col([Button("Before"), Carousel([Card([Button("First")]), Card([Button("Last")])], 240), Button("After")], ${gap})`)
    await page.getByRole('button', { name: 'After', exact: true }).waitFor()
    const track = page.locator('.iui-carousel-track')
    for (const end of [false, true]) {
      await track.evaluate((el, end) => el.scrollTo({ left: end ? el.scrollWidth : 0, behavior: 'instant' }), end)
      for (const label of ['Before', 'After']) {
        const button = page.getByRole('button', { name: label, exact: true })
        const hit = await button.evaluate(el => {
          const rect = el.getBoundingClientRect()
          return [0.1, 0.5, 0.9].every(fraction => el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * fraction)))
        })
        assert(hit, `${label} control is hit-testable at gap=${gap}, end=${end}`)
        const count = await page.evaluate(() => window.actions.length)
        await button.click({ timeout: 1500 })
        assert.equal(await page.evaluate(() => window.actions.length), count + 1)
      }
      assert(
        await track.evaluate(el => {
          const own = el.getBoundingClientRect(),
            parent = el.parentElement.getBoundingClientRect()
          return own.top >= parent.top && own.bottom <= parent.bottom
        }),
      )
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    }
  }
  await page.close()
})

test('F12: first/last Pressable cards retain hover, selected and keyboard focus decoration in both themes', async () => {
  const page = await open(390)
  if (process.env.COMPLETE_AUDIT_CAROUSEL_SCREENSHOTS) await mkdir(process.env.COMPLETE_AUDIT_CAROUSEL_SCREENSHOTS, { recursive: true })
  for (const scheme of ['light', 'dark']) {
    for (const selected of [false, true]) {
      await show(
        page,
        `root = Col([Button("Before"), Carousel([Pressable([Card([Title("First card"), Text("Full visible card and focus ring")])], null, ${selected}), Pressable([Card([Title("Last card"), Text("Full visible card and focus ring")])], null, ${selected})], 240), Button("After")], 4)`,
        false,
        scheme,
      )
      await page.locator('.iui-pressable').first().waitFor()
      await page.evaluate(scheme => {
        const dark = scheme === 'dark',
          root = document.querySelector('.iui-root')
        document.body.style.background = dark ? '#171717' : '#fff'
        root.style.setProperty('--page', dark ? '#171717' : '#fff')
        root.style.setProperty('--ink', dark ? '#eee' : '#171717')
        root.style.setProperty('--ink-2', dark ? '#aaa' : '#5b5b5b')
      }, scheme)
      for (const end of [false, true]) {
        await page.locator('.iui-carousel-track').evaluate((el, end) => el.scrollTo({ left: end ? el.scrollWidth : 0, behavior: 'instant' }), end)
        const tile = page.locator('.iui-pressable').nth(end ? 1 : 0)
        assert.equal(await tile.getAttribute('aria-pressed'), String(selected))
        for (const state of ['hover', 'focus']) {
          if (state === 'hover') {
            await page.evaluate(() => document.activeElement?.blur())
            await tile.hover()
          } else {
            await page.mouse.move(385, 800)
            await page.getByRole('button', { name: 'Before', exact: true }).focus()
            await page.keyboard.press('Tab')
            if (end) await page.keyboard.press('Tab')
            assert(await tile.evaluate(el => el.matches(':focus-visible')))
          }
          await page.waitForTimeout(200)
          const decoration = await tile.evaluate(el => {
            const track = el.closest('.iui-carousel-track').getBoundingClientRect(),
              box = el.getBoundingClientRect(),
              style = getComputedStyle(el)
            return {
              left: box.left - track.left,
              right: track.right - box.right,
              top: box.top - track.top,
              bottom: track.bottom - box.bottom,
              shadow: style.boxShadow,
              cardShadow: getComputedStyle(el.firstElementChild).boxShadow,
              outline: style.outlineWidth,
            }
          })
          assert(decoration.left >= 23 && decoration.right >= 23 && decoration.top >= 21 && decoration.bottom >= 23, JSON.stringify(decoration))
          assert(decoration.cardShadow.includes('12px') || state === 'focus', JSON.stringify(decoration))
          if (state === 'focus') assert.equal(decoration.outline, '2px')
          if (process.env.COMPLETE_AUDIT_CAROUSEL_SCREENSHOTS)
            await page.screenshot({
              path: path.join(
                process.env.COMPLETE_AUDIT_CAROUSEL_SCREENSHOTS,
                `${scheme}-${end ? 'last' : 'first'}-${selected ? 'selected' : 'plain'}-${state}.png`,
              ),
            })
        }
      }
    }
  }
  await page.close()
})

test('F03: complete translated headers align with meters at mobile and desktop widths and fallback fonts', async () => {
  for (const width of [320, 380, 390, 1000]) {
    const page = await open(width)
    for (const labels of [
      ['Speed', 'Quality', 'Cost'],
      ['速度', '质量', '成本'],
      ['Geschwindigkeit', 'Qualität', 'Kosten'],
      ['Скорость', 'Качество', 'Стоимость'],
      ['Velocidade', 'Qualidade', 'Custo'],
    ]) {
      for (const font of ['Arial', 'Times New Roman', 'monospace']) {
        await page.evaluate(
          ({ labels, font }) => {
            document.body.style.fontFamily = font
            window.model(labels)
          },
          { labels, font },
        )
        await page.locator('[aria-haspopup="dialog"]').click()
        await page.locator('[role="option"]').waitFor()
        const geometry = await page.evaluate(() => {
          const css = window.modelCss,
            menu = document.querySelector('[role="dialog"]'),
            header = menu.querySelector('.' + css.columns),
            meters = menu.querySelector('.' + css.meters)
          return {
            font: getComputedStyle(header).fontFamily,
            menu: menu.getBoundingClientRect().toJSON(),
            name: menu.querySelector('.' + css.name).getBoundingClientRect().width,
            description: menu.querySelector('[role="option"]').getAttribute('aria-description'),
            labels: Array.from(header.children).map((el, index) => {
              const r = el.getBoundingClientRect(),
                meter = meters.children[index].getBoundingClientRect(),
                range = document.createRange()
              range.selectNodeContents(el)
              return {
                text: el.textContent,
                lines: range.getClientRects().length,
                aligned: Math.abs(r.left - meter.left) < 1 && Math.abs(r.width - meter.width) < 1,
                contained: Array.from(range.getClientRects()).every(line => line.left >= r.left - 1 && line.right <= r.right + 1),
                overflow: el.scrollWidth > el.clientWidth + 1,
              }
            }),
          }
        })
        assert(geometry.menu.left >= 0 && geometry.menu.right <= width, JSON.stringify({ width, font, geometry }))
        assert(geometry.font.includes(font), JSON.stringify({ font, actual: geometry.font }))
        assert(geometry.name >= 35, JSON.stringify({ width, font, geometry }))
        assert(
          geometry.labels.every(item => item.aligned && item.contained && !item.overflow && item.lines <= 4),
          JSON.stringify({ width, font, geometry }),
        )
        assert.deepEqual(
          geometry.labels.map(item => item.text),
          labels,
        )
        assert(geometry.description?.includes(labels[1]), geometry.description)
        if (process.env.COMPLETE_AUDIT_SCREENSHOT && width === 320 && labels[0] === 'Geschwindigkeit' && font === 'Arial')
          await page.screenshot({ path: process.env.COMPLETE_AUDIT_SCREENSHOT })
        await page.keyboard.press('Escape')
      }
    }
    await page.close()
  }
})
