import { afterAll, test } from 'vitest'
import assert from 'node:assert/strict'
import { build } from './helpers/client-build.mjs'
import { chromium, firefox, webkit } from 'playwright-core'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SegmentedControl} from '@deepseek-ai/dsh-client-ui-primitives';
import './packages/modern-ui/src/vendor/theme/styles/base.css';
import './packages/modern-ui/src/vendor/theme/styles/feel.css';
import './packages/modern-ui/src/vendor/theme/styles/design-platform.css';
import './packages/modern-ui/src/official-controls.css';
function Fixture(){const [value,setValue]=useState('light');const [disabled,setDisabled]=useState(false);window.disable=setDisabled;return <>
<SegmentedControl id="appearance" label="Appearance" value={value} options={[{value:'light',label:'Light'},{value:'dark',label:'Dark'},{value:'system',label:'System'}]} onChange={setValue} disabled={disabled}/>
<output id="chosen">{value}</output>{['light','dark','system'].map(mode=><div key={mode} id={'appearance-'+mode+'-panel'} hidden={mode!==value}>{mode}</div>)}</>}
createRoot(document.getElementById('app')).render(<Fixture/>);`,
  },
  bundle: true,
  write: false,
  outfile: 'client.js',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
})
const engine = { chromium, firefox, webkit }[process.env.MODERN_UI_TEST_ENGINE ?? 'chromium']
const browser = await engine.launch({ headless: true })
afterAll(() => browser.close())

for (const direction of ['ltr', 'rtl'])
  for (const dark of [false, true])
    for (const forcedColors of ['none', 'active'])
      test(`published official segments keep geometry, keyboard and disabled behavior (${direction}/${dark ? 'dark' : 'light'}/${forcedColors})`, async () => {
        const context = await browser.newContext({ viewport: { width: 500, height: 400 }, forcedColors })
        const page = await context.newPage()
        try {
          await page.setContent(
            `<html dir="${direction}"><body data-modern-official-controls ${dark ? 'data-ds-dark-theme' : ''}><div id="app"></div></body></html>`,
          )
          await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text })
          await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text })
          const group = page.getByRole('tablist', { name: 'Appearance' })
          await group.waitFor()
          await group.getByRole('tab', { name: 'Light' }).press('End')
          await page.waitForFunction(() => document.getElementById('chosen').textContent === 'system')
          await group.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)))
          assert.equal(await group.getByRole('tab', { name: 'System' }).getAttribute('aria-selected'), 'true')
          assert.equal(await group.getByRole('tab', { name: 'System' }).evaluate(el => el === document.activeElement), true)
          const geometry = await group.evaluate(el => {
            const marker = el.querySelector('span[aria-hidden="true"]')
            const selected = el.querySelector('[aria-selected="true"]')
            return {
              marker: marker.getBoundingClientRect().toJSON(),
              selected: selected.getBoundingClientRect().toJSON(),
              track: el.getBoundingClientRect().toJSON(),
              background: getComputedStyle(marker).backgroundColor,
              foreground: getComputedStyle(selected).color,
              trackColor: getComputedStyle(el).backgroundColor,
            }
          })
          // WebKit rounds fractional RTL absolute positioning by up to one CSS pixel.
          for (const key of ['x', 'y', 'width', 'height'])
            assert.ok(Math.abs(geometry.marker[key] - geometry.selected[key]) < (direction === 'rtl' ? 1.1 : 0.6), key + ': ' + JSON.stringify(geometry))
          assert.ok(Math.abs(geometry.marker.y - geometry.track.y - 1) < 0.6)
          assert.equal(geometry.track.height, 36, 'the official control keeps its original total height')
          if (forcedColors === 'active') {
            assert.notEqual(geometry.background, geometry.foreground, 'selected text is visible')
            assert.notEqual(geometry.background, geometry.trackColor, 'selected block is visible')
          }
          await page.evaluate(() => window.disable(true))
          await page.waitForFunction(() => document.querySelector('[role="tab"]').disabled)
          await group.getByRole('tab', { name: 'Light' }).evaluate(el => el.click())
          assert.equal(await page.locator('#chosen').textContent(), 'system')
        } finally {
          await context.close()
        }
      })
