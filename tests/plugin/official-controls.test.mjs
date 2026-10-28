import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { Context } from '@deepseek-ai/cordis'
import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver'
import { apply as bootStyles, BOOT_PAGE_CSS } from '../../packages/modern-ui/src/host-compat/official-style/index.ts'
import { browserExecutable, fixtureEnvironment } from './fixtures/e2e-environment.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const assets = path.join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
const assetFiles = await readdir(assets)
const shellCss = await readFile(path.join(assets, assetFiles.find(name => /^index-.*\.css$/.test(name))), 'utf8')
const ownCss = await readFile(path.join(root, 'packages/modern-ui/src/official-controls.css'), 'utf8')
const themeCss = (await Promise.all(['base', 'feel', 'design-platform', 'beautiful-ui'].map(name => readFile(path.join(root, `packages/modern-ui/src/vendor/theme/styles/${name}.css`), 'utf8')))).join('\n')
const pageCss = (await Promise.all([
  ['dsh-client-ui-settings-account', 'AccountMenu'], ['dsh-client-ui-settings-account', 'AccountNotice'],
  ['dsh-client-ui-trajectory', 'TrajectoryTable'], ['dsh-client-ui-sidebar-documentpreview', 'FontNotice'],
].map(async ([name, module]) => {
  const source = await readFile(path.join(root, `node_modules/@deepseek-ai/${name}/lib/client.js`), 'utf8')
  const region = source.slice(source.indexOf(`/${module}.module.css`))
  const text = region.match(/const css = ("(?:[^"\\]|\\.)*");/)
  assert.ok(text, `Published ${module} style module is missing`)
  return JSON.parse(text[1])
}))).join('\n')

// Vite's default CSS-module name, verified against the actual shipped shell.
// This loader supplies actual official React components their actual rc.4 classes.
function moduleNames(css) {
  let hash = 5381, index = css.length
  while (index) hash = hash * 33 ^ css.charCodeAt(--index)
  const suffix = (hash >>> 0).toString(36).slice(0, 5)
  return Object.fromEntries([...new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1]))]
    .map(name => [name, `_${name}_${suffix}_${css.slice(0, css.indexOf('.' + name)).split('\n').length}`]))
}

test('every scoped class is present in the pinned official render assets', async () => {
  const others = await Promise.all(['dsh-client-ui-settings-account', 'dsh-client-ui-trajectory', 'dsh-client-ui-sidebar-documentpreview']
    .map(name => readFile(path.join(root, `node_modules/@deepseek-ai/${name}/lib/client.js`), 'utf8')))
  const official = [shellCss, ...others].join('\n')
  for (const name of new Set([...(ownCss + BOOT_PAGE_CSS).matchAll(/\.([A-Za-z_][\w-]+)/g)].map(match => match[1]))) {
    if (name === 'css' || name === 'mjs') continue // source names in the introductory comment
    assert.ok(official.includes(name), `Missing official class: ${name}`)
  }
  for (const name of ['Button', 'Input', 'Switch', 'HoverCard', 'DisclosureRow', 'SegmentedTabs', 'Modal', 'MenuSurface']) {
    const css = await readFile(path.join(root, `node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/${name}.module.css`), 'utf8')
    for (const value of Object.values(moduleNames(css))) assert.ok(shellCss.includes(value), `Official ${name} compiled mapping changed: ${value}`)
  }
})

test('boot typography is a reversible structured Host injection before client loading', async () => {
  const ctx = new Context()
  const fork = ctx.plugin({ apply: bootStyles })
  await fork.await()
  const rows = []
  ctx.emit('webserver/index-inject', rows)
  assert.deepEqual(rows, [{ kind: 'style', text: BOOT_PAGE_CSS }])
  const html = '<html><head><script src="official.js"></script></head><body><div id="app"></div></body></html>'
  const result = renderIndexInjections(html, rows)
  assert.ok(result.indexOf(BOOT_PAGE_CSS) < result.indexOf('official.js'))
  assert.ok(result.includes('<script src="official.js"></script>'))
  await fork.dispose()
  const after = []
  ctx.emit('webserver/index-inject', after)
  assert.deepEqual(after, [])
})

const executablePath = browserExecutable() ?? chromium.executablePath()
test('official React controls keep semantics and acquire reversible Modern geometry and Feel motion', { skip: !existsSync(executablePath) }, async t => {
  const fixture = await build({
    absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
    stdin: { resolveDir: root, loader: 'jsx', contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {Button, Input, Switch, SegmentedTabs, DisclosureRow, HoverCard, SettingsValueField} from '@deepseek-ai/dsh-client-ui-primitives';
      import {installOfficialControls} from './packages/modern-ui/src/official-controls.ts';
      const disposers=[]; window.installModern=()=>installOfficialControls({effect: fn=>{disposers.push(fn())}});
      window.withdrawModern=()=>disposers.pop()?.(); window.switchChanges=0;
      function App(){const [checked,setChecked]=useState(false),[tab,setTab]=useState('a'),[open,setOpen]=useState(false),[text,setText]=useState('');
        window.setChecked=setChecked;
        return <><Button id="primary" variant="primary">Save</Button><Button id="disabled" disabled>Disabled</Button>
          <button id="unrelated" className="another_button">Unrelated</button><Input aria-label="Text" value={text} onChange={e=>setText(e.target.value)}/>
          <Switch label="Official switch" checked={checked} onChange={next=>{window.switchChanges++;setChecked(next)}}/>
          <SegmentedTabs label="Official tabs" value={tab} onChange={setTab} items={[{value:'a',label:'A',id:'a',panelId:'pa'},{value:'b',label:'B',id:'b',panelId:'pb'}]}/>
          <DisclosureRow title="Details" icon={null} open={open} expandable expandOnRowClick onToggle={()=>setOpen(!open)}><span>Official detail</span></DisclosureRow>
          <HoverCard anchor={<button>Hover preview</button>} content="Official hover content" openDelayMs={0}/>
          <SettingsValueField id="setting" label="Setting" text="x" overridden={false} invalid={false} disabled={false} overriddenLabel="Overridden" resetLabel="Reset" invalidLabel="Invalid" onEdit={()=>{}} onReset={()=>{}}/>
        </>}
      createRoot(document.getElementById('fixture')).render(<App/>);
    ` },
    loader: { '.css': 'empty', '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'official-css-mapping', setup(builder) {
      builder.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -7)), namespace: 'inline' }))
      builder.onLoad({ filter: /.*/, namespace: 'inline' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }))
      builder.onLoad({ filter: /\.module\.css$/ }, async args => ({ contents: `export default ${JSON.stringify(moduleNames(await readFile(args.path, 'utf8')))}`, loader: 'js' }))
    } }],
  })
  const browser = await chromium.launch({ executablePath, headless: true, env: fixtureEnvironment(tmpdir()) })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  await page.setContent(`<style>${shellCss}\n${themeCss}\n${pageCss}</style><div id="fixture" style="display:grid;gap:20px;padding:24px"></div>
    <div class="yHnPSG_signedOutMenu" role="menu"><button role="menuitem">Account action</button></div>
    <div class="zwW4-W_card" data-front="true">Notice</div>
    <div class="JqwYuG_panelHeader"><h3>Font notice</h3></div>
    <div class="Y0dWHa_details"><span class="Y0dWHa_kindTag">Trajectory</span></div>`)
  await page.addScriptTag({ content: fixture.outputFiles[0].text })
  await page.getByRole('switch', { name: 'Official switch' }).waitFor()
  const read = (selector, property) => page.locator(selector).evaluate((node, property) => getComputedStyle(node).getPropertyValue(property), property)
  assert.equal(await read('#primary', 'column-gap'), '4px')
  const unrelated = await read('#unrelated', 'font-size')
  await page.evaluate(() => window.installModern())
  assert.equal(await read('#primary', 'column-gap'), '6px')
  assert.equal(await read('#primary', 'font-size'), '13px')
  await page.waitForFunction(() => getComputedStyle(document.getElementById('disabled')).opacity === '0.45')
  assert.equal(await read('#disabled', 'opacity'), '0.45')
  assert.equal(await read('#unrelated', 'font-size'), unrelated)
  assert.equal(await read('._wrap_14sgc_1', 'height'), '36px')
  assert.equal(await read('._field_bjqpo_3', 'gap'), '8px')
  assert.equal(await read('#a', 'font-weight'), '500')
  assert.equal(await read('.yHnPSG_signedOutMenu', 'min-width'), '148px')
  assert.equal(await read('.yHnPSG_signedOutMenu [role="menuitem"]', 'min-height'), '36px')
  assert.equal(await read('.JqwYuG_panelHeader h3', 'font-weight'), '500')
  assert.equal(await read('.Y0dWHa_kindTag', 'font-weight'), '500')
  assert.equal(await read('.Y0dWHa_details', 'border-left-width'), '0px')
  assert.match(await read('.Y0dWHa_details', 'box-shadow'), /inset/)
  await page.setViewportSize({ width: 720, height: 800 })
  const floatingShadow = await page.evaluate(() => {
    const marker = document.createElement('div')
    marker.style.boxShadow = 'var(--shadow-float, var(--dsw-elevation-prominent))'
    document.body.appendChild(marker)
    const value = getComputedStyle(marker).boxShadow
    marker.remove()
    return value
  })
  assert.equal(await read('.Y0dWHa_details', 'box-shadow'), floatingShadow)
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.getByRole('textbox', { name: 'Text' }).fill('unchanged official input')
  assert.equal(await page.getByRole('textbox', { name: 'Text' }).inputValue(), 'unchanged official input')
  const control = page.getByRole('switch', { name: 'Official switch' })
  await control.click()
  assert.equal(await control.getAttribute('aria-checked'), 'true')
  await page.waitForFunction(() => document.querySelector('[role="switch"]').style.getPropertyValue('--dsh-switch-x') === '16px')
  assert.equal(await page.evaluate(() => window.switchChanges), 1)
  await page.getByRole('tab', { name: 'A', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: 'B', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await page.getByText('Official detail', { exact: true }).waitFor({ state: 'visible' })
  assert.ok(await page.getByText('Official detail', { exact: true }).isVisible())
  await page.getByRole('button', { name: 'Hover preview' }).hover()
  await page.getByText('Official hover content').waitFor()
  const light = await read('._card_38jqx_9', 'background-color')
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  assert.notEqual(await read('._card_38jqx_9', 'background-color'), light)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.setChecked(false))
  await page.waitForFunction(() => document.querySelector('[role="switch"]').style.getPropertyValue('--dsh-switch-x') === '0px')
  assert.equal(await read('#primary', 'transition-duration'), '0s')
  await page.evaluate(() => window.installModern())
  await page.evaluate(() => window.withdrawModern())
  assert.equal(await read('#primary', 'column-gap'), '6px')
  await page.evaluate(() => window.withdrawModern())
  assert.equal(await read('#primary', 'column-gap'), '4px')
  assert.equal(await control.evaluate(node => node.style.getPropertyValue('--dsh-switch-x')), '')
  assert.deepEqual(errors, [])
  const inputMarkup = await page.locator('._wrap_14sgc_1').evaluate(node => node.outerHTML)
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const mobile = await touch.newPage()
  await mobile.setContent(`<style>${shellCss}\n${themeCss}\n${ownCss}</style><body data-modern-official-controls>${inputMarkup}</body>`)
  assert.equal(await mobile.locator('input').evaluate(node => getComputedStyle(node).fontSize), '16px')
  await touch.close()
  // No client plugin or theme script runs on this page: only the public Host injection does.
  await page.setContent(renderIndexInjections(`<html><head><style>${shellCss}</style></head><body><div class="_boot_u7vgf_3"><div class="_wordmark_u7vgf_31">DSH</div><div class="_failedTitle_u7vgf_79">Startup failed</div></div></body></html>`, [{ kind: 'style', text: BOOT_PAGE_CSS }]))
  assert.equal(await read('._wordmark_u7vgf_31', 'font-weight'), '500')
  assert.equal(await read('._failedTitle_u7vgf_79', 'font-weight'), '500')
})
