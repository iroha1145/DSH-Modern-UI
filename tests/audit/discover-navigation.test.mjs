import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { chromium } from 'playwright-core'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const repo = path.resolve(import.meta.dirname, '../..')
const official = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
function region(name) {
 const start = official.indexOf('//#region lib/types/' + name + '.js')
 const end = official.indexOf('//#endregion', start)
 assert.ok(start >= 0 && end > start)
 return official.slice(start, end)
}
const helper = ts.transpileModule(readFileSync(path.join(repo, 'packages/modern-ui/src/plugin-documents/discover-navigation.ts'), 'utf8'), {
 compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const officialCss = readFileSync(path.join(repo, 'packages/modern-ui/src/official-surfaces.css'), 'utf8')
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(executablePath ? { executablePath, headless: true }
 : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true })
test.after(() => browser.close())

async function fixture({ install = !process.env.AUDIT_BASELINE } = {}) {
 const page = await browser.newPage()
 await page.setContent('<div id="fixture"></div>')
 for (const pkg of ['react', 'react-dom']) {
  const filename = pkg === 'react' ? 'react.development.js' : 'react-dom.development.js'
  await page.addScriptTag({ path: path.join(path.dirname(require.resolve(pkg + '/package.json')), 'umd', filename) })
 }
 await page.addStyleTag({ content: officialCss })
 // Execute the published Pill and SegmentedTabs component bodies unchanged.
 // jsx/jsxs call the real React factory; CSS module properties only supply classes.
 await page.addScriptTag({ content: `
 const jsx = (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key });
 const jsxs = jsx;
 const clsx = (...parts) => parts.filter(Boolean).join(' ');
 const css$4 = new Proxy({}, {get: (_, key) => key});
 const css$5 = css$4;
 ${region('Pill')}
 ${region('SegmentedTabs')}
 const exports = {};
 ${helper}
 window.events = [];
 function App() {
  const [value, setValue] = React.useState('installed');
  const [plain, setPlain] = React.useState('one');
  const item = (prefix, value, label) => ({value, id: prefix + '-' + value, panelId: prefix + '-panel-' + value, label});
  return React.createElement(React.Fragment, null,
   React.createElement(SegmentedTabs, {label: 'Plugins', value, onChange: next => { window.events.push(next); setValue(next) },
    items: [item('plugins', 'installed', 'Installed'), item('plugins', 'discover', 'Discover'), item('plugins', 'discover', 'Duplicate Discover'), item('plugins', 'settings', 'Settings')]}),
   React.createElement(SegmentedTabs, {label: 'Plain', value: plain, onChange: next => {window.events.push('plain:' + next); setPlain(next)},
    items: [item('plain', 'one', 'One'), item('plain', 'two', 'Two'), item('plain', 'three', 'Three')]}));
 }
 ReactDOM.flushSync(() => ReactDOM.createRoot(document.querySelector('#fixture')).render(React.createElement(App)));
 window.disposeNavigation = ${install ? 'exports.installDiscoverTabNavigation(document)' : '() => {}'};
 ` })
 return page
}
async function active(page) { return page.evaluate(() => document.activeElement.id) }

// Without the helper, official ArrowRight indexes the hidden raw-ledger row.
test('L6 official tabs ArrowRight/Left and Home/End visit visible entries only', async () => {
 const page = await fixture()
 try {
 const tabs = page.getByRole('tablist', { name: 'Plugins' })
 assert.equal(await tabs.getByRole('tab').count(), 3)
 assert.equal(await tabs.locator('[role="tab"]').count(), 4)
 await tabs.getByRole('tab', { name: 'Installed', exact: true }).focus()
 await page.keyboard.press('ArrowRight')
 assert.equal(await active(page), 'plugins-discover')
 await page.keyboard.press('ArrowRight')
 assert.equal(await active(page), 'plugins-settings')
 await page.keyboard.press('ArrowRight')
 assert.equal(await active(page), 'plugins-installed')
 await page.keyboard.press('ArrowLeft')
 assert.equal(await active(page), 'plugins-settings')
 await page.keyboard.press('Home')
 assert.equal(await active(page), 'plugins-installed')
 await page.keyboard.press('End')
 assert.equal(await active(page), 'plugins-settings')
 assert.deepEqual(await page.evaluate(() => window.events), ['discover', 'settings', 'installed', 'settings', 'installed', 'settings'])
 } finally { await page.close() }
})

test('L6 ordinary official tablists preserve their native focus and selection behavior', async () => {
 const page = await fixture()
 try {
 const tabs = page.getByRole('tablist', { name: 'Plain' })
 await tabs.getByRole('tab', { name: 'One', exact: true }).focus()
 await page.keyboard.press('ArrowRight')
 assert.equal(await active(page), 'plain-two')
 await page.keyboard.press('End')
 assert.equal(await active(page), 'plain-three')
 await page.keyboard.press('Home')
 assert.equal(await active(page), 'plain-one')
 assert.deepEqual(await page.evaluate(() => window.events), ['plain:two', 'plain:three', 'plain:one'])
 } finally { await page.close() }
})

test('L6 cleanup restores the actual native hidden-row behavior and retains the raw ledger boundary', async () => {
 const page = await fixture({ install: true })
 try {
 const tabs = page.getByRole('tablist', { name: 'Plugins' })
 await page.evaluate(() => window.disposeNavigation())
 await tabs.getByRole('tab', { name: 'Discover', exact: true }).focus()
 await page.keyboard.press('ArrowRight')
 assert.equal(await active(page), 'plugins-discover')
 assert.equal(await tabs.locator('[id="plugins-discover"]').count(), 2, 'Compatibility shim does not rewrite official ids or keys')
 assert.deepEqual(await page.evaluate(() => window.events), ['discover'])
 } finally { await page.close() }
})
