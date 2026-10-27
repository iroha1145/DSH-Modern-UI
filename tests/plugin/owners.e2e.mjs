import assert from 'node:assert/strict'
import { isolatedInstalledFixture, fixtureEnvironment as makeFixtureEnvironment, openSettings, browserExecutable } from './fixtures/e2e-environment.mjs'
import { hasOwnerSteeringBatch } from './fixtures/owner-stream-barrier.mjs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(process.env.MODERN_UI_BUILD_DEPS
  ? path.join(path.resolve(process.env.MODERN_UI_BUILD_DEPS), 'package.json') : path.join(root, 'package.json'))
const { chromium } = require('playwright-core')
const artifacts = path.join(process.env.MODERN_UI_E2E_ARTIFACTS ?? path.join(root, '.artifacts'), 'plugin-owners')
await mkdir(artifacts, { recursive: true })
const run = await mkdtemp(path.join(artifacts, 'run-'))
const workspace = path.join(run, 'm1-fixture-workspace')
const runMarker = `M1 fixture ${path.basename(run)}`
await mkdir(workspace)
await writeFile(path.join(workspace, 'm1-note.txt'), 'First fixture line\nSecond fixture line\n')
await writeFile(path.join(workspace, 'm1-image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fV8AAAAASUVORK5CYII=', 'base64'))
const sourceInstalled = process.env.MODERN_UI_INSTALLED_STATE ? JSON.parse(await readFile(process.env.MODERN_UI_INSTALLED_STATE, 'utf8')) : undefined
const isolation = sourceInstalled ? await isolatedInstalledFixture(sourceInstalled, run) : undefined
const installed = isolation?.state
const official = installed?.cli ?? process.env.MODERN_UI_OFFICIAL_CLI ?? path.join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const nodeExecutable = installed?.node ?? process.execPath
const plugin = installed ? path.join(installed.plugin.path, 'lib/index.js') : process.env.MODERN_UI_INSTALLED_PLUGIN ?? path.join(root, 'packages/modern-ui/lib/index.js')
const home = installed?.home ?? path.join(run, 'home')
const profile = installed?.profile ?? 'modern-ui-browser-fixture'
const fixtureEnvironment = isolation?.environment ?? makeFixtureEnvironment(home)
let translations = 0
const translationServer = createServer(async (request, response) => {
  if (request.url.startsWith('/external')) {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>M1 local external fixture</title><p>M1 local external fixture</p>')
    return
  }
  for await (const _chunk of request) { /* Drain only; fixture does not retain submitted reasoning. */ }
  translations += 1
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify([{ translations: [{ text: 'Local translated reasoning.' }] }]))
})
await new Promise(resolve => translationServer.listen(0, '127.0.0.1', resolve))
const translationEndpoint = `http://127.0.0.1:${translationServer.address().port}/translate`
const externalUrl = `http://127.0.0.1:${translationServer.address().port}/external`
let existingTranslator, existingTranslationController
if (installed) {
  const hostRequire = createRequire(official)
  const yaml = createRequire(hostRequire.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
  const dump = spawnSync(installed.node ?? process.execPath, [official, '--profile', profile, '--dump-config'], {
    cwd: run, env: fixtureEnvironment, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(dump.status, 0, 'Installed official profile must compose before browser acceptance')
  const schema = yaml.JSON_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expression: value }) })])
  const entries = yaml.load(dump.stdout, { schema })
  const translatorNames = ['@iroha1145/dsh-modern-ui/translator', '@deepseek-ai/dsh-experimental-translator']
  const translators = entries.filter(entry => translatorNames.includes(entry.name) && entry.disabled !== true)
  assert.ok(translators.length <= 1, 'Fixture must not compose duplicate translator services')
  existingTranslator = translators[0]?.id
  existingTranslationController = entries.find(entry => entry.name === '@deepseek-ai/dsh-experimental-client-ui-cot-translation' && entry.disabled !== true)?.id
}
if (!installed) {
const setup = spawnSync(process.execPath, [official, profile, '--from-default-profile', 'web', '--dump-config'], {
  cwd: run, env: fixtureEnvironment, windowsHide: true, encoding: 'utf8',
})
if (setup.status !== 0) throw new Error(`Official profile setup failed: ${setup.stderr}`)
}
const overlay = installed ? path.join(run, 'fixture.patch.yml') : path.join(home, 'profiles', profile, 'cordis.patch.yml')
const quote = value => JSON.stringify(value.replaceAll('\\', '/'))
const translatorInsert = existingTranslator ? '' : `    - id: translator\n      name: ${JSON.stringify(pathToFileURL(path.join(path.dirname(plugin), 'translator.js')).href)}\n      config:\n        bingEndpoint: ${JSON.stringify(translationEndpoint)}\n`
const controllerInsert = existingTranslationController ? '' : "    - id: cot-translation\n      name: '@deepseek-ai/dsh-experimental-client-ui-cot-translation'\n      config:\n        provider: bing\n        targetLanguage: en\n"
const translatorOverride = existingTranslator ? `- id: ${JSON.stringify(existingTranslator)}\n  config:\n    bingEndpoint: ${JSON.stringify(translationEndpoint)}\n` : ''
const controllerOverride = existingTranslationController ? `- id: ${JSON.stringify(existingTranslationController)}\n  config:\n    provider: bing\n    targetLanguage: en\n` : ''
const ownerSelection = installed ? '' : ['ui-layout', 'ui-sidebar', 'ui-conversation', 'ui-workspace'].map(id => `- id: ${id}\n  disabled: true\n`).join('')
await writeFile(overlay, `${ownerSelection}- id: workspace-controller\n  config:\n    documentsDirectory: ${quote(path.join(run, 'documents'))}\n- id: agent-default-model\n  config:\n    provider: modern-ui-fixture\n    model: mock-balanced\n${translatorOverride}${controllerOverride}- insert:\n${installed ? '' : `    - id: modern-ui\n      name: ${JSON.stringify(pathToFileURL(plugin).href)}\n      config:\n        enabled: true\n        models: {}\n        prices: {}\n`}    - id: modern-ui-fixture\n      name: ${JSON.stringify(pathToFileURL(path.join(root, 'tests/plugin/fixtures/mock-host.mjs')).href)}\n${translatorInsert}${controllerInsert}`)

const ownerReport = path.join(run, 'model-requests.jsonl')
const ownerGate = path.join(run, 'release-stream')
const secondSteerRpcDelayMs = Number(process.env.MODERN_UI_OWNER_SECOND_STEER_RPC_DELAY_MS ?? 750)
assert.ok(Number.isFinite(secondSteerRpcDelayMs) && secondSteerRpcDelayMs >= 0 && secondSteerRpcDelayMs <= 10000)
let child, serverErrors = ''
async function bootHost() { child = spawn(nodeExecutable, [official, '--profile', profile, ...(installed ? ['--patch', overlay] : []), '--port', '0', '--no-open'], {
  cwd: run, env: { ...fixtureEnvironment, MODERN_UI_OFFICIAL_CLI: official,
    MODERN_UI_RUN_MARKER: runMarker, MODERN_UI_OWNER_REPORT: ownerReport, MODERN_UI_OWNER_GATE: ownerGate, MODERN_UI_BROWSER_WORKSPACE: workspace,
    MODERN_UI_EXTERNAL_FIXTURE_URL: externalUrl,
    MODERN_UI_INSTALLED_PLUGIN: plugin, MODERN_UI_PEER_REPORT: path.join(run, 'peers.json') }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
serverErrors = ''
return await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Official Web startup timed out')), 30000)
  child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Official Web exited (${code}): ${serverErrors}`)) })
  child.stdout.on('data', chunk => {
    output += chunk
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timeout); resolve(match[1]) }
  })
  child.stderr.on('data', chunk => { serverErrors += chunk })
})
 }
let url = await bootHost()
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const errors = [], passed = [], uploadResponses = [], submitEvidence = [], pinSettings = []
const rpcDelays = []
await page.route('**/api/**', async route => {
  const request = route.request()
  if (request.method() === 'POST' && request.postData()?.includes('OWNER_STEER_SECOND')) {
    const started = Date.now()
    // Deliberately expose optimistic UI text before the real second RPC reaches the Host.
    await new Promise(resolve => setTimeout(resolve, secondSteerRpcDelayMs))
    rpcDelays.push({ path: new URL(request.url()).pathname, requestedDelayMs: secondSteerRpcDelayMs, elapsedMs: Date.now() - started })
  }
  await route.continue()
})
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().split('\n')[0]) })
page.on('response', async response => {
  if (/\/api\/.*(?:file|upload)/.test(new URL(response.url()).pathname) && response.request().method() === 'POST') {
    uploadResponses.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.text().catch(() => '') })
  }
})
async function stopHost() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGINT')
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000) })
}
async function ready() {
  await page.goto(url)
  const accept = page.getByRole('button', { name: '继续', exact: true })
  await page.waitForTimeout(800)
  if (await accept.isVisible()) {
    try { await accept.click({ timeout: 10000 }) } catch (error) { if (await accept.count()) throw error }
  }
  await page.getByRole('button', { name: /mock-balanced/ }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /mock-balanced/.test(button.textContent) && !button.disabled))
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForTimeout(1000)
  if (await page.getByRole('button', { name: /新規セッション/ }).count()) {
    await openSettings(page)
    await page.getByRole('dialog').getByRole('button', { name: '日本語', exact: true }).click()
    await page.getByText('中文', { exact: true }).click()
    await page.keyboard.press('Escape')
  }
}
const editor = () => page.locator('[data-composer-input="true"]').last()
async function newSession() {
  await page.locator('button').filter({ hasText: '新会话' }).first().click()
  await page.waitForTimeout(300)
  const defaultWorkspace = page.getByRole('button', { name: '默认工作区', exact: true }).last()
  if (await defaultWorkspace.count()) {
    await defaultWorkspace.click()
    await page.getByRole('menuitem', { name: /m1-fixture-workspace/ }).click()
  }
  await editor().waitFor()
}
function readModernSettings() {
  const hostRequire = createRequire(official)
  const yaml = createRequire(hostRequire.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
  const dump = spawnSync(nodeExecutable, [official, '--profile', profile, ...(installed ? ['--patch', overlay] : []), '--dump-config'], {
    cwd: run, env: fixtureEnvironment, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(dump.status, 0)
  const schema = yaml.JSON_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expression: value }) })])
  const modern = yaml.load(dump.stdout, { schema }).find(entry => entry.id === 'modern-ui')
  assert.ok(modern)
  return { collapsedViews: modern.config.collapsedViews, busyEnter: modern.config.busyEnter }
}
async function ownerRecords() {
  let text
  try { text = await readFile(ownerReport, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
  return text.split('\n').slice(0, -1).map(line => JSON.parse(line))
}
async function waitForSteeringInbox(sessionId) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const records = await ownerRecords()
    const events = records.filter(row => row.kind === 'event' && row.sessionId === sessionId).map(row => row.event)
    const pending = []
    for (const event of events) if (event.type === 'agent/inbox/spliced' && event.data.target === 'next-step') {
      pending.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
    }
    assert.ok(!events.some(event => event.type === 'step/start' && event.data.step > 1), 'The model remains at step 1 until both real steering inputs are pending')
    assert.ok(!records.some(row => row.kind === 'adapter-abort' && row.sessionId === sessionId), 'Ordinary steering must not cancel the held model response')
    if (hasOwnerSteeringBatch(pending)) return { pendingIds: pending.map(message => message.id), lastSeq: events.at(-1)?.seq }
    await page.waitForTimeout(20)
  }
  assert.fail('Both real steering inputs did not reach the official next-step inbox')
}
try {
  await ready()
  await openSettings(page)
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  await settings.getByRole('button', { name: '排队发送', exact: true }).click()
  await page.getByRole('menuitem', { name: '插话发送', exact: true }).click()
  await page.keyboard.press('Escape')
  // The preference reaches the profile through the official config editor after the menu closes.
  // On a slow runner (macOS Intel CI) the file lags the UI by more than a fixed pause, so poll the
  // composed profile instead of asserting after one wait.
  let persisted
  for (let attempt = 0; attempt < 40 && persisted !== 'steer'; attempt++) {
    await page.waitForTimeout(250)
    persisted = readModernSettings().busyEnter
  }
  assert.equal(persisted, 'steer', 'UI persists the explicit steering prerequisite in the isolated profile')
  await newSession()
  await editor().fill('OWNER_BASELINE')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('OWNER_ATTACHMENTS_ACCEPTED', { exact: true }).last().waitFor()
  await newSession()
  const validPng = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 16; canvas.height = 16
    const drawing = canvas.getContext('2d')
    drawing.fillStyle = '#4179dd'; drawing.fillRect(0, 0, 16, 16)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await writeFile(path.join(workspace, 'm1-image.png'), Buffer.from(validPng, 'base64'))
  await page.locator('input[type="file"]').setInputFiles([path.join(workspace, 'm1-image.png'), path.join(workspace, 'm1-note.txt')])
  await page.waitForTimeout(1200)
  await editor().fill('OWNER_ATTACHMENTS_REQUEST')
  await page.waitForTimeout(200)
  submitEvidence.push({ stage: 'before', disabled: await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled() })
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  for (const delay of [100, 500]) {
    await page.waitForTimeout(delay)
    submitEvidence.push({ stage: `after-${delay}`, body: await page.locator('body').innerText() })
  }
  await page.getByText('OWNER_ATTACHMENTS_ACCEPTED', { exact: true }).last().waitFor({ timeout: 8000 })
  await page.screenshot({ path: path.join(run, 'attachments.png'), fullPage: true })
  const requests = (await readFile(ownerReport, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const attachmentRequest = requests.find(request => request.user && JSON.stringify(request.user).includes('OWNER_ATTACHMENTS_REQUEST'))
  assert.ok(attachmentRequest, 'actual adapter receives submitted attachments turn')
  const userContent = attachmentRequest.user.flatMap(message => message.content)
  assert.ok(userContent.some(block => block.type === 'image'), 'actual model request retains an inline image')
  assert.ok(JSON.stringify(userContent).includes('m1-note.txt'), 'actual model request retains uploaded file reference')
  assert.ok(uploadResponses.some(response => response.status === 200), 'ordinary file uses real official upload response')
  assert.ok(requests.some(request => request.kind === 'event' && request.event.type === 'user/message'
    && request.event.data.content?.some(block => block.type === 'image')
    && request.event.data.content?.some(block => block.type === 'file')), 'durable user message contains both image and uploaded file reference')
  passed.push('real image inline + ordinary file upload receipt reaches actual model request')

  const viewsMenu = () => page.locator('[data-conversation-views-menu]')
  if (readModernSettings().collapsedViews?.includes('agents')) {
    await viewsMenu().click()
    await page.locator('[data-view-pin-action="agents"]').click()
    await page.waitForTimeout(500)
  }
  const agentsBefore = await page.getByRole('tab', { name: '编队', exact: true }).count()
  await viewsMenu().click()
  assert.equal(await page.locator('[data-view-pin-action="chat"]').count(), 0, 'Chat is fixed')
  await page.locator('[data-view-pin-action="agents"]').click()
  await page.waitForFunction(expected => [...document.querySelectorAll('[role="tab"]')].filter(tab => tab.textContent === '编队').length === expected, agentsBefore - 1)
  await page.waitForTimeout(300)
  pinSettings.push({ stage: 'hidden', ...readModernSettings() })
  assert.ok(pinSettings.at(-1).collapsedViews.includes('agents'))
  await page.reload()
  await viewsMenu().waitFor()
  assert.equal(await page.getByRole('tab', { name: '编队', exact: true }).count(), agentsBefore - 1)
  await page.screenshot({ path: path.join(run, 'views-hidden-reloaded.png'), fullPage: true })
  await page.goto('about:blank')
  await stopHost()
  url = await bootHost()
  await ready()
  const attachmentSession = page.locator(`[data-row-key="session:${attachmentRequest.sessionId}"]`)
  if (!await attachmentSession.isVisible()) {
    await page.locator('[data-row-key^="workspace:"][aria-expanded="false"]').first().click()
  }
  await attachmentSession.click()
  await viewsMenu().waitFor()
  assert.equal(await page.getByRole('tab', { name: '编队', exact: true }).count(), agentsBefore - 1)
  pinSettings.push({ stage: 'new-host-process', ...readModernSettings() })
  assert.ok(pinSettings.at(-1).collapsedViews.includes('agents'))
  await viewsMenu().click()
  await page.getByRole('menuitem', { name: '编队', exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: '编队', exact: true }).count(), agentsBefore - 1, 'opening a hidden view does not pin it')
  await viewsMenu().click()
  await page.locator('[data-view-pin-action="agents"]').click()
  await page.waitForFunction(expected => [...document.querySelectorAll('[role="tab"]')].filter(tab => tab.textContent === '编队').length === expected, agentsBefore)
  assert.equal(await viewsMenu().evaluate(element => document.activeElement === element), true)
  await page.waitForTimeout(300)
  pinSettings.push({ stage: 'restored', ...readModernSettings() })
  assert.ok(!pinSettings.at(-1).collapsedViews.includes('agents'))
  await page.getByRole('tab', { name: '对话', exact: true }).click()
  passed.push('More hides/restores Agents; modern-ui.collapsedViews survives reload and a new Host process; hidden navigation does not pin; focus returns')

  await newSession()
  await editor().fill('OWNER_DELAY_START')
  await editor().press('Enter')
  await page.getByText('OWNER_STEP_1', { exact: true }).last().waitFor()
  // The held stream keeps the Turn open: the Modern tail shows the patched running status and
  // the official "deep diving" row stays out of the layout.
  await page.locator('[data-modern-running]').first().waitFor({ timeout: 10000 })
  assert.match(await page.locator('[data-modern-running]').first().getAttribute('data-modern-running'), /^(?:thinking|tools|responding|working)$/)
  const runningRows = await page.locator('[data-chat-running]').evaluateAll(rows => rows.map(row => ({
    modern: row.querySelector('[data-modern-running]')?.getAttribute('data-modern-running') ?? null,
    children: [...row.children].map(child => ({ tag: child.tagName, modern: child.hasAttribute('data-modern-running'), display: getComputedStyle(child).display, text: child.textContent.slice(0, 40) })),
  })))
  assert.ok(runningRows.length > 0 && runningRows.every(row => row.modern !== null && row.children.filter(child => !child.modern).every(child => child.display === 'none')),
    `the Modern status renders inside the official running row and the row's own children stay hidden: ${JSON.stringify(runningRows)}`)
  await page.screenshot({ path: path.join(run, 'running-status.png') })
  passed.push('Modern running status replaces the official deep-diving row while a Turn is held open')
  const steeringSession = (await ownerRecords()).find(row => row.user && !row.purpose && JSON.stringify(row.user).includes('OWNER_DELAY_START')).sessionId
  await editor().fill('OWNER_STEER_FIRST')
  await editor().press('Enter')
  await page.getByText('OWNER_STEER_FIRST', { exact: true }).last().waitFor()
  await editor().fill('OWNER_STEER_SECOND')
  await editor().press('Enter')
  await page.getByText('OWNER_STEER_SECOND', { exact: true }).last().waitFor()
  const steeringAdmission = await waitForSteeringInbox(steeringSession)
  assert.equal(rpcDelays.length, 1, 'The real second steering POST crossed the intentional slow-admission route')
  await writeFile(ownerGate, 'release')
  await page.getByText('OWNER_STEP_2', { exact: true }).last().waitFor()
  const batch = page.locator('[data-chat-steering-batch="start"]')
  await batch.waitFor()
  assert.equal(await batch.count(), 1)
  assert.match(await batch.innerText(), /OWNER_STEER_FIRST/)
  const steering = await batch.evaluate(element => {
    const flow = element.closest('[data-chat-flow-kind]')
    return { marker: element.outerHTML, flow: flow?.outerHTML.slice(0, 1000), gap: flow ? getComputedStyle(flow).getPropertyValue('--dsh-chat-flow-gap').trim() : null,
      marginTop: flow ? getComputedStyle(flow).marginTop : null }
  })
  assert.ok(steering.gap?.includes('44px'), 'real batch-start flow uses 44px gap rule')
  await page.screenshot({ path: path.join(run, 'steering.png'), fullPage: true })
  const allRequests = (await readFile(ownerReport, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const steeringEvents = allRequests.filter(row => row.kind === 'event' && row.sessionId === steeringSession).map(row => row.event)
  assert.ok(steeringEvents.some(event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
    && event.data.removedCount === 2 && event.data.inserted.length === 0), 'Official loop claims both pending messages at one next-step boundary')
  assert.ok(allRequests.some(request => request.user && !request.purpose && JSON.stringify(request.user).includes('OWNER_STEER_FIRST') && JSON.stringify(request.user).includes('OWNER_STEER_SECOND')), 'next real model step admits both steering messages')
  passed.push('delayed stream + two steering messages admitted into second step + only first batch marker + 44px gap')

  await unlink(ownerGate)
  await newSession()
  await editor().fill('OWNER_DELAY_START CANCEL')
  await editor().press('Enter')
  await page.getByText('OWNER_STEP_1', { exact: true }).last().waitFor()
  await editor().fill('OWNER_QUEUE_REMOVE')
  await editor().press('Control+Enter')
  const queue = page.locator('[data-queue-dock]')
  await queue.getByText('OWNER_QUEUE_REMOVE', { exact: true }).waitFor()
  await queue.getByRole('button', { name: '删除排队消息', exact: true }).click()
  await queue.getByText('OWNER_QUEUE_REMOVE', { exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor({ state: 'hidden' })
  const cancellation = (await ownerRecords()).find(row => row.kind === 'adapter-abort' && row.cancellationCase)
  assert.ok(cancellation, 'Independent Stop case really aborts the held adapter without releasing its gate')
  passed.push('complementary Queue submit + remove real queue occurrence + cancel delayed running turn')

  await page.setViewportSize({ width: 390, height: 844 })
  const navigation = page.locator('[data-mobile-navigation]')
  await navigation.getByRole('button', { name: '会话', exact: true }).click()
  const drawer = page.locator('[data-mobile-drawer]')
  await drawer.waitFor({ state: 'visible' })
  await drawer.locator('[data-row-key^="session:"]').first().click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(await navigation.getByRole('button', { name: '会话', exact: true }).getAttribute('aria-expanded'), 'false')
  await navigation.getByRole('button', { name: '会话', exact: true }).click()
  await drawer.waitFor({ state: 'visible' })
  await drawer.locator('[data-row-key^="workspace:"]').first().hover()
  await drawer.getByRole('button', { name: '在“m1-fixture-workspace”中新建会话', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  await page.screenshot({ path: path.join(run, 'mobile-drawer-closed.png'), fullPage: true })
  passed.push('real phone drawer closes after session selection and workspace new-session action')
  await page.setViewportSize({ width: 1440, height: 1000 })
  assert.deepEqual(errors, [])
  await writeFile(path.join(run, 'result.json'), JSON.stringify({ host: '0.2.1-rc.4', run, passed, steering, steeringAdmission,
    secondSteerRpcDelayMs, rpcDelays, cancellation, pinSettings, uploadResponses, requests: await ownerRecords(), errors }, null, 2))
  console.log(JSON.stringify({ run, passed, steering, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(run, 'failure.png'), fullPage: true })
  const failure = { message: error.stack, errors, body: await page.locator('body').innerText(), uploads: uploadResponses, serverErrors, submitEvidence,
    files: await page.locator('input[type="file"]').count(), buttons: await page.locator('button').allTextContents(),
    rpcDelays, modelRequests: await ownerRecords() }
  await writeFile(path.join(run, 'failure.json'), JSON.stringify(failure, null, 2))
  console.error(JSON.stringify({ run, ...failure }, null, 2))
  throw error
} finally {
  await browser.close()
  await new Promise(resolve => translationServer.close(resolve))
  await stopHost()
  await isolation?.verifySource()
}
