import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { harness } from '../tests/audit/helpers/conversation-harness.mjs'

// Usage: node scripts/probe-conversation-tabs.mjs [output-directory]
// Isolated components and simplified primitives/hooks; this does not test a screen reader.
const root = path.resolve(import.meta.dirname, '..')
const outputDirectory = path.resolve(root, process.argv[2] ?? '.artifacts/audit-20261110')
await mkdir(outputDirectory, { recursive: true })
const h = await harness()
const fixture = `<!doctype html><button id="before">Before</button><div id="app"></div><button id="after">After</button><script type="module">
import {React,createRoot,ConversationSessionHeader,DefaultConversationViews,bind} from '/fixture.mjs';
const source=value=>{const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set(next){value=next;for(const fn of listeners)fn()}}};
const stable=value=>selector=>selector(value);
const views=source([{id:'chat',label:'Chat'},{id:'files',label:'Files'},{id:'tools',label:'Tools'}]);const store=source({view:'chat'});const pins=source([]);
const header={sessionId:'browser',hideChrome:false,useSessions:stable({byId:{}}),useConversationViews:bind(views),useStore:bind(store),useEntryPins:bind(pins),useEntryActions:stable(false),usePinSaveFailed:stable(false),t:key=>key,open(){},selectView:id=>store.set({view:id}),setPinned:(id,pinned)=>pins.set(pinned?pins.getSnapshot().filter(v=>v!==id):[...pins.getSnapshot(),id]),renderSlot:()=>null,renderFactorySlot:()=>null};
const body={sessionId:'browser',useSession:stable({blank:false}),useConversation:stable({activeTargets:new Set(['chat'])}),useConversationViews:bind(views),useInspectCall:stable(undefined),useStore:bind(store),actions:{setDraft(){},completeViewRequest(){}},inputActions:{persistDraft(){}},bindDraftPersistence:()=>()=>{},openView(){},renderSlot:()=>React.createElement('input',{id:'draft',defaultValue:'draft'})};
Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>600});
createRoot(document.getElementById('app')).render(React.createElement(React.Fragment,null,React.createElement(ConversationSessionHeader,header),React.createElement(DefaultConversationViews,body)));
window.fixture={store,pins,views};
</script>`
const server = createServer(async (request, response) => {
  response.setHeader('content-type', request.url === '/fixture.mjs' ? 'text/javascript' : 'text/html')
  response.end(request.url === '/fixture.mjs' ? await readFile(h.outfile) : fixture)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const executablePath = process.env.MODERN_UI_BROWSER
const browser = await chromium.launch(
  executablePath ? { executablePath, headless: true } : existsSync(chromium.executablePath()) ? { headless: true } : { channel: 'msedge', headless: true },
)
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor()
  const focusedTab = () => page.evaluate(() => document.activeElement.textContent)
  await page.locator('#before').focus()
  await page.keyboard.press('Tab')
  assert.equal(await focusedTab(), 'Chat')
  await page.keyboard.press('ArrowRight')
  assert.equal(await focusedTab(), 'Files')
  await page.keyboard.press('End')
  assert.equal(await focusedTab(), 'Tools')
  await page.keyboard.press('Home')
  assert.equal(await focusedTab(), 'Chat')
  // Focus alone does not activate. Native Enter and Space activate a nonselected button.
  await page.getByRole('tab', { name: 'Files', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => fixture.store.getSnapshot().view), 'files')
  await page.getByRole('tab', { name: 'Tools', exact: true }).focus()
  await page.keyboard.press('Space')
  assert.equal(await page.evaluate(() => fixture.store.getSnapshot().view), 'tools')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'before')
  await page.keyboard.press('Tab')
  assert.equal(await focusedTab(), 'Tools')
  const dynamicFocus = []
  const twoViews = [
    { id: 'chat', label: 'Chat' },
    { id: 'files', label: 'Files' },
  ]
  const setViews = async views => {
    await page.evaluate(views => fixture.views.set(views), views)
    await page.waitForFunction(count => document.querySelectorAll('[role=tab]').length === count, views.length > 1 ? views.length : 0)
  }
  await setViews(twoViews)
  assert.equal(await focusedTab(), 'Chat')
  dynamicFocus.push('3-to-2 removed active tab returns focus to Chat tab')
  await setViews(twoViews.slice(0, 1))
  const chatPanel = page.getByRole('tabpanel', { name: 'Chat', exact: true })
  assert.equal(await chatPanel.evaluate(el => el === document.activeElement), true)
  dynamicFocus.push('2-to-1 surviving focused Chat tab returns focus to Chat panel')
  await setViews(twoViews)
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
  await setViews(twoViews.slice(0, 1))
  assert.equal(await chatPanel.evaluate(el => el === document.activeElement), true)
  assert.equal(await chatPanel.getAttribute('aria-labelledby'), null)
  dynamicFocus.push('2-to-1 removed active Files tab returns focus to named Chat panel')
  for (const count of [2, 3]) {
    await setViews(count === 3 ? [...twoViews, { id: 'tools', label: 'Tools' }] : twoViews)
    await page.getByRole('tab', { name: 'Files', exact: true }).focus()
    await page.locator('#after').focus()
    await setViews(count === 3 ? twoViews : twoViews.slice(0, 1))
    assert.equal(await page.evaluate(() => document.activeElement.id), 'after')
    dynamicFocus.push(`${count}-to-${count - 1} preserves external focus`)
  }
  const evidence = {
    browser: await browser.version(),
    nativeKeyboard: ['Tab', 'Shift+Tab', 'ArrowRight', 'Home', 'End', 'Enter', 'Space'],
    dynamicFocus,
    errors,
    result: 'pass',
    limitation: 'isolated conversation components with simplified primitives and hooks; no real screen reader',
  }
  assert.deepEqual(errors, [])
  await writeFile(path.join(outputDirectory, 'conversation-tabs-browser.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  await h.close()
}
process.exit(0)
