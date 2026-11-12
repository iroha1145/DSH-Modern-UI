import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '../..')
const fixture = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {AnimatedRows} from './packages/modern-ui/src/vendor/primitives/AnimatedRows.tsx';
import lineage from './packages/modern-ui/src/vendor/subagent/client/SubagentHeaderLineage.module.css';
function Demo(){const [rows,setRows]=useState(['a','b','c']);window.setRows=next=>flushSync(()=>setRows(next));
return <div style={{position:'relative'}}><AnimatedRows className="rows" rowKeys={rows} ready resetKey="">
{rows.map(id=><button key={id} data-row-key={id}>{id}</button>)}
</AnimatedRows><button className={lineage.trigger} id="lineage"><svg width="16" height="16"><path d="M0 0H16V16"/></svg></button>
<button className={lineage.disclosure} id="disclosure">Disclosure</button></div>}
createRoot(document.getElementById('app')).render(<Demo/>);
window.openLineage=()=>{document.querySelector('#lineage svg').classList.add(lineage.triggerOpen);document.getElementById('disclosure').style.transform='rotate(90deg)'};
window.snapshotRows=()=>({animations:document.getAnimations().filter(animation=>animation.playState==='running').length,
rows:[...document.querySelectorAll('[data-row-key]')].map(row=>({key:row.dataset.rowKey,top:row.getBoundingClientRect().top,transform:getComputedStyle(row).transform})),
exits:document.querySelectorAll('[inert]').length});`,
  },
  outfile: 'rows.js',
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
})
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
afterAll(() => browser.close())

async function open() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.setContent(
    '<style>body{margin:0}.rows{position:relative;width:240px;height:160px;overflow:auto}.rows>button{display:block;width:100%;height:40px;box-sizing:border-box}</style><div id="app"></div>',
  )
  await page.addStyleTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.css')).text })
  await page.addScriptTag({ content: fixture.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.locator('[data-row-key="a"]').click()
  return { context, page }
}

for (const [name, next] of [
  ['reorder', ['c', 'a', 'b']],
  ['entry and exit', ['b', 'c', 'd']],
])
  test(`enabling reduced motion settles active row ${name} at the real final geometry`, async () => {
    const { context, page } = await open()
    try {
      const moving = await page.evaluate(rows => {
        window.setRows(rows)
        return window.snapshotRows()
      }, next)
      assert.ok(moving.animations > 0, 'The preference change must interrupt an active movement')
      if (name === 'entry and exit') assert.equal(moving.exits, 1)
      await page.evaluate(() => {
        window.preferenceChanged = new Promise(resolve => {
          const media = matchMedia('(prefers-reduced-motion: reduce)')
          media.addEventListener(
            'change',
            () => {
              requestAnimationFrame(() => {
                resolve(window.snapshotRows())
              })
            },
            { once: true },
          )
        })
      })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const settled = await page.evaluate(() => window.preferenceChanged)
      assert.equal(settled.animations, 0)
      assert.equal(settled.exits, 0)
      assert.deepEqual(
        settled.rows.map(row => row.key),
        next,
      )
      assert.deepEqual(
        settled.rows.map(row => row.top),
        [0, 40, 80],
      )
      assert.ok(settled.rows.every(row => row.transform === 'none'))
      await page.evaluate(() => window.setRows(['d', 'a', 'c']))
      assert.equal((await page.evaluate(() => window.snapshotRows())).animations, 0)
    } finally {
      await context.close()
    }
  })

test('lineage arrows keep their expanded geometry without a transition under reduced motion', async () => {
  const { context, page } = await open()
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const state = await page.evaluate(() => {
      window.openLineage()
      const arrow = document.querySelector('#lineage svg')
      const disclosure = document.getElementById('disclosure')
      return {
        arrowDuration: getComputedStyle(arrow).transitionDuration,
        disclosureDuration: getComputedStyle(disclosure).transitionDuration,
        arrowTransform: getComputedStyle(arrow).transform,
        disclosureTransform: getComputedStyle(disclosure).transform,
        animations: document.getAnimations().length,
      }
    })
    assert.equal(state.arrowDuration, '0s')
    assert.equal(state.disclosureDuration, '0s')
    assert.equal(state.arrowTransform, 'matrix(-1, 0, 0, -1, 0, 0)')
    assert.equal(state.disclosureTransform, 'matrix(0, 1, -1, 0, 0, 0)')
    assert.equal(state.animations, 0)
  } finally {
    await context.close()
  }
})
