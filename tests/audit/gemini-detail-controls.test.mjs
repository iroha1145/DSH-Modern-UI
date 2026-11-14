import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, firefox, webkit } from 'playwright-core'
import { build } from './helpers/client-build.mjs'

const repo = path.resolve(import.meta.dirname, '../..')
const directory = await mkdtemp(path.join(tmpdir(), 'gemini-detail-controls-'))
await build({
  stdin: {
    resolveDir: repo,
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import lineage from './packages/modern-ui/src/vendor/subagent/client/SubagentHeaderLineage.module.css';
import reasoning from './packages/modern-ui/src/vendor/settings-models/client/ReasoningDeclarationCard.module.css';
import question from './packages/modern-ui/src/vendor/questions/QuestionComposer.module.css';
import lightbox from './packages/modern-ui/src/vendor/primitives/ImageLightbox.module.css';
import {TodoPanel} from './packages/modern-ui/src/vendor/conversation/client/skeleton/TodoPanel.tsx';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/focus.css';
createRoot(document.getElementById('app')).render(<>
<button id="before">Before</button><button id="lineage" className={lineage.row}><span className={lineage.clickarea}>Subagent</span></button>
<button id="add" className={reasoning.addModelButton}>Add model</button><button id="icon" className={reasoning.iconButton} aria-label="Remove model">×</button>
<div id="plan" style={{width:160}}><TodoPanel todos={[{content:'A long task title that wraps over multiple lines',status:'in_progress'}]} t={key=>key==='todo.status.inProgress'?'In progress':key}/></div>
<div className={question.field}><span id="mirror" className={question.fieldMirror}>{'Sample'+String.fromCharCode(10)+'Sample'}</span><textarea id="answer" aria-label="Answer" className={question.fieldInput} defaultValue={'Sample'+String.fromCharCode(10)+'Sample'}/></div>
<div className={lightbox.controls}><button id="percent">125%</button></div></>);
`,
  },
  outdir: directory,
  entryNames: 'client',
  bundle: true,
  jsx: 'automatic',
  format: 'esm',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'todo-surroundings',
      setup(builder) {
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'icon', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const IconChecklistOutlineRegular=()=>null' }))
      },
    },
  ],
})
const server = createServer(async (request, response) => {
  const file = request.url === '/client.js' ? 'client.js' : request.url === '/client.css' ? 'client.css' : null
  response.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html')
  response.end(
    file
      ? await readFile(path.join(directory, file))
      : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><style>:root{--ink:#171717;--ink-2:#555;--ink-3:#888;--dsw-alias-label-primary:#171717;--dsw-alias-label-tertiary:#666;--dsw-alias-interactive-bg-hover:#eee;--dsw-focus-ring-color:#171717}body{margin:20px;font:14px Arial}</style><div id="app"></div><script type="module" src="/client.js"></script>',
  )
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
afterAll(async () => {
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
})

for (const engine of [chromium, firefox, webkit]) {
  test(`detail controls preserve system focus and touch typography in ${engine.name()}`, async () => {
    const browser = await engine.launch({ headless: true })
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 700 } })
    const page = await context.newPage()
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`)
      await page.locator('#answer').waitFor()
      const typography = await page.evaluate(() =>
        Object.fromEntries(
          ['answer', 'mirror', 'percent', 'progress'].map(id => {
            const style = getComputedStyle(id === 'progress' ? document.querySelector('#plan .shimmer-text') : document.getElementById(id))
            return [id, { font: style.fontSize, variant: style.fontVariantNumeric, shrink: style.flexShrink, wrap: style.whiteSpace }]
          }),
        ),
      )
      console.info(engine.name(), 'detail typography', JSON.stringify(typography))
      assert.ok(parseFloat(typography.answer.font) >= 16)
      assert.equal(typography.answer.font, typography.mirror.font)
      assert.match(typography.percent.variant, /tabular-nums/)
      assert.equal(typography.progress.shrink, '0')
      assert.equal(typography.progress.wrap, 'nowrap')
      const field = await page.evaluate(() =>
        ['answer', 'mirror'].map(id => {
          const element = document.getElementById(id),
            style = getComputedStyle(element)
          return { font: style.font, padding: style.padding, wrap: style.whiteSpace, break: style.overflowWrap, height: element.getBoundingClientRect().height }
        }),
      )
      assert.deepEqual(field[0], field[1], 'textarea and height mirror retain the same font and layout metrics')
      for (const id of ['lineage', 'add', 'icon']) {
        await page.locator('#' + id).focus()
        assert.equal(await page.locator('#' + id).evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'normal component focus styling stays intact')
      }
      await page.emulateMedia({ forcedColors: 'active' })
      if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
        for (const dark of [false, true]) {
          await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
          for (const id of ['lineage', 'add', 'icon']) {
            await page.keyboard.press('Tab')
            await page.locator('#' + id).focus()
            const outline = await page.locator('#' + id).evaluate(el => ({
              style: getComputedStyle(el).outlineStyle,
              color: getComputedStyle(el).outlineColor,
              width: getComputedStyle(el).outlineWidth,
            }))
            console.info(engine.name(), dark, id, JSON.stringify(outline))
            assert.equal(outline.style, 'solid', `${id} ${JSON.stringify(outline)}`)
            assert.ok(parseFloat(outline.width) >= 1)
            assert.notEqual(outline.color, 'rgba(0, 0, 0, 0)')
          }
          const shimmer = await page.locator('#plan .shimmer-text').evaluate(el => ({
            color: getComputedStyle(el).color,
            fill: getComputedStyle(el).webkitTextFillColor,
            animation: getComputedStyle(el).animationName,
          }))
          console.info(engine.name(), dark, 'shimmer', JSON.stringify(shimmer))
          assert.notEqual(shimmer.color, 'rgba(0, 0, 0, 0)')
          assert.notEqual(shimmer.fill, 'rgba(0, 0, 0, 0)')
          assert.equal(shimmer.animation, 'none')
        }
      }
    } finally {
      await context.close()
      await browser.close()
    }
  }, 45_000)
}
