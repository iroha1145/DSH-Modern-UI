import assert from 'node:assert/strict'
import { isolatedInstalledFixture, fixtureEnvironment as makeFixtureEnvironment, openSettings, browserExecutable } from './fixtures/e2e-environment.mjs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(process.env.MODERN_UI_BUILD_DEPS
  ? path.join(path.resolve(process.env.MODERN_UI_BUILD_DEPS), 'package.json') : path.join(root, 'package.json'))
const { chromium } = require('playwright-core')
const artifacts = path.join(process.env.MODERN_UI_E2E_ARTIFACTS ?? path.join(root, '.artifacts'), 'plugin-browser')
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
const child = spawn(nodeExecutable, [official, '--profile', profile, ...(installed ? ['--patch', overlay] : []), '--port', '0', '--no-open'], {
  cwd: run, env: { ...fixtureEnvironment, MODERN_UI_OFFICIAL_CLI: official,
    MODERN_UI_RUN_MARKER: runMarker, MODERN_UI_BROWSER_WORKSPACE: workspace,
    MODERN_UI_EXTERNAL_FIXTURE_URL: externalUrl,
    MODERN_UI_INSTALLED_PLUGIN: plugin, MODERN_UI_PEER_REPORT: path.join(run, 'peers.json') }, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
let serverErrors = ''
const url = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Official Web startup timed out')), 30000)
  child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Official Web exited (${code}): ${serverErrors}`)) })
  child.stdout.on('data', chunk => {
    output += chunk
    const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) { clearTimeout(timeout); resolve(match[1]) }
  })
  child.stderr.on('data', chunk => { serverErrors += chunk })
})
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const errors = []
const sockets = []
const remoteRequests = []
const promptResponses = []
const themeStates = []
page.on('request', request => {
  const target = new URL(request.url())
  if (target.pathname.startsWith('/api/remote') || target.pathname === '/api/session/prompt') remoteRequests.push({ path: target.pathname, method: request.method(), type: request.resourceType(), body: request.postData() })
})
page.on('response', response => {
  if (new URL(response.url()).pathname === '/api/session/prompt') promptResponses.push({ status: response.status(), body: response.request().postData() })
})
page.on('websocket', socket => {
  const path = new URL(socket.url()).pathname
  const record = { path, sent: 0, received: 0 }
  sockets.push(record)
  socket.on('framesent', () => { record.sent += 1 })
  socket.on('framereceived', () => { record.received += 1 })
})
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().split('\n')[0]) })
try {
  await page.goto(url)
  await page.waitForTimeout(1500)
  const accept = page.getByRole('button', { name: '继续', exact: true })
  if (await accept.count()) await accept.click()
  const picker = page.getByRole('button', { name: /mock-balanced/ })
  await picker.waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /mock-balanced/.test(button.textContent) && !button.disabled))
  await page.waitForTimeout(1000)
  if (await accept.isVisible()) await accept.click()
  await page.locator('button').filter({ hasText: '新会话' }).first().click()
  await page.waitForFunction(() => !document.querySelector('[data-followups]'))
  const defaultWorkspace = page.getByRole('button', { name: '默认工作区', exact: true }).last()
  if (await defaultWorkspace.count()) {
    await defaultWorkspace.click()
    await page.getByRole('menuitem', { name: /m1-fixture-workspace/ }).click()
  }
  await picker.waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /mock-balanced/.test(button.textContent) && !button.disabled))
  await picker.press('ArrowDown')
  assert.equal(await picker.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Escape')
  await picker.click()
  await page.getByRole('option', { name: /mock-fast/ }).click()
  const changed = page.getByRole('button', { name: /mock-fast/ })
  await changed.waitFor()
  await changed.click()
  await page.getByRole('radio', { name: '高', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /mock-fast/ }).filter({ hasText: '高' }).waitFor()
  assert.match(await page.getByRole('button', { name: /mock-fast/ }).innerText(), /高/)
  assert.equal(await page.locator('[data-followups]').count(), 0, 'Fixture starts in its own blank Session')
  const beforeStream = sockets.reduce((total, socket) => ({ sent: total.sent + socket.sent, received: total.received + socket.received }), { sent: 0, received: 0 })
  const beforePrompts = promptResponses.length
  await page.locator('[data-composer-input="true"]').fill('Render the local fixture')
  await page.keyboard.press('Enter')
  await page.getByText(runMarker, { exact: true }).waitFor()
  await page.locator('[data-followups]').waitFor()
  await page.waitForTimeout(500)
  const streamFrames = sockets.reduce((total, socket) => ({ sent: total.sent + socket.sent, received: total.received + socket.received }), { sent: -beforeStream.sent, received: -beforeStream.received })
  const httpPrompt = promptResponses.slice(beforePrompts).find(response => response.status >= 200 && response.status < 300 && response.body?.includes('Render the local fixture'))
  assert.ok((streamFrames.sent > 0 || httpPrompt) && streamFrames.received > 0, JSON.stringify({ beforeStream, streamFrames, promptResponses }))
  const localImage = page.getByRole('img', { name: 'M1 relative image', exact: true })
  await localImage.waitFor()
  await page.waitForFunction(() => { const img = document.querySelector('img[alt="M1 relative image"]'); return img?.complete && img.naturalWidth > 0 })
  const imagePath = new URL(await localImage.getAttribute('src')).searchParams.get('path')
  assert.equal(imagePath.replaceAll('\\', '/'), path.join(workspace, 'm1-image.png').replaceAll('\\', '/'))
  const imageOpener = page.getByRole('button', { name: '查看大图: M1 relative image', exact: true })
  await imageOpener.click()
  const imageDialog = page.getByRole('dialog', { name: '图片预览', exact: true })
  await imageDialog.waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await imageDialog.locator(':focus').count(), 1)
  await page.keyboard.press('Escape')
  await imageDialog.waitFor({ state: 'hidden' })
  assert.equal(await imageOpener.evaluate(button => document.activeElement === button), true)
  await page.getByRole('button', { name: 'Open fixture file', exact: true }).click()
  await page.getByText('Second fixture line', { exact: false }).first().waitFor()
  await page.screenshot({ path: path.join(run, 'file-navigation.png'), fullPage: true })
  await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
  const modernTrigger = page.getByRole('button', { name: /mock-fast/ })
  await modernTrigger.click()
  assert.equal(await modernTrigger.getAttribute('aria-expanded'), 'true')
  await openSettings(page)
  const officialSettings = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '通用设置', exact: true }) })
  await officialSettings.waitFor()
  await page.keyboard.press('Tab')
  assert.equal(await officialSettings.locator(':focus').count(), 1)
  await page.keyboard.press('Escape')
  await officialSettings.waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  const reasoningHeader = page.locator('[data-variant="think"] [data-disclosure-header]:visible').last()
  const completedProcess = page.locator('[data-turn-process][data-process-outcome="completed"]').last()
  await completedProcess.waitFor()
  if (await completedProcess.getAttribute('aria-expanded') === 'false') await completedProcess.click()
  for (const group of await page.locator('[data-process-activity][aria-expanded="false"]:visible').all()) await group.click()
  await reasoningHeader.click()
  await page.locator('[data-cot-translation][data-translation-state="ready"]').getByText('Local translated reasoning.', { exact: true }).waitFor()
  await page.locator('[data-cot-translation]').getByRole('button', { name: '查看原文', exact: true }).click()
  await page.locator('[data-cot-translation]').getByText(/Checking streaming reasoning/).waitFor()
  const requests = translations
  for (const group of await page.locator('[data-process-activity][aria-expanded="false"]:visible').all()) await group.click()
  await reasoningHeader.click()
  for (const group of await page.locator('[data-process-activity][aria-expanded="false"]:visible').all()) await group.click()
  await reasoningHeader.click()
  await page.locator('[data-cot-translation]').getByText('Local translated reasoning.', { exact: true }).waitFor()
  assert.equal(translations, requests, 'reopening uses the Host durable result')
  await page.locator('[data-citation-sources]').waitFor()
  assert.equal(await page.locator('[data-followups] button').count(), 2)
  assert.match(await page.locator('[data-citation-sources]').innerText(), /来源/)
  const interactive = page.frameLocator('[data-intelligent-frame] > iframe').frameLocator('iframe')
  await interactive.getByRole('button', { name: 'Count: 0', exact: true }).waitFor({ timeout: 10000 })
  await interactive.getByRole('button', { name: 'Count: 0', exact: true }).click()
  await interactive.getByRole('button', { name: 'Count: 1', exact: true }).waitFor()
  await page.screenshot({ path: path.join(run, 'desktop.png'), fullPage: true })
  // The official host ships no dsw-icon sprite; the plugin mounts its own. An unresolved
  // <use> renders as an empty box without any console error, so check the references directly.
  const unresolvedIcons = await page.evaluate(() => [...document.querySelectorAll('svg use')]
    .map(use => use.getAttribute('href') ?? use.getAttribute('xlink:href'))
    .filter(href => href?.startsWith('#') && !document.getElementById(href.slice(1))))
  assert.deepEqual(unresolvedIcons, [], 'every icon <use> must resolve to a symbol in the document')
  await page.getByRole('tab', { name: '编队', exact: true }).first().click()
  await page.waitForTimeout(300)
  assert.match(await page.locator('body').innerText(), /mock-fast/)
  await page.screenshot({ path: path.join(run, 'agents.png'), fullPage: true })
  await page.getByRole('tab', { name: '对话', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(run, 'mobile.png'), fullPage: true })
  await page.reload()
  await page.locator('[data-followups]').waitFor()
  await page.getByRole('button', { name: /mock-fast/ }).filter({ hasText: '高' }).waitFor()
  assert.match(await page.getByRole('button', { name: /mock-fast/ }).innerText(), /高/)
  assert.equal(await page.locator('[data-followups] button').count(), 2)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openSettings(page)
  const settings = page.getByRole('dialog')
  await settings.waitFor()
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  const details = settings.locator('section').filter({ has: page.getByRole('heading', { name: '选择器里的模型资料', exact: true }) })
  await details.getByRole('button', { name: /mock-fast/ }).click()
  await details.getByLabel('描述', { exact: true }).fill('Durable fixture card')
  await details.getByRole('button', { name: '保存', exact: true }).click()
  await details.getByLabel('描述', { exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: /mock-fast/ }).click()
  await page.getByText('Durable fixture card', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await openSettings(page)
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  const captureTheme = async label => {
    const state = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="theme-color"]')?.content
      const probe = document.createElement('span'); probe.style.color = meta; document.body.appendChild(probe)
      const normalizedMeta = getComputedStyle(probe).color; probe.remove()
      return { dark: document.body.hasAttribute('data-ds-dark-theme'), page: document.body.style.getPropertyValue('--page'),
        preference: document.documentElement.getAttribute('data-ds-theme-source'), meta, normalizedMeta, background: getComputedStyle(document.body).backgroundColor }
    })
    assert.ok(state.page, 'Palette is owned by the public theme override layer')
    assert.equal(state.normalizedMeta, state.background)
    themeStates.push({ label, ...state })
  }
  for (const [label, dark] of [['浅色', false], ['深色', true]]) {
    await settings.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction(wanted => document.body.hasAttribute('data-ds-dark-theme') === wanted, dark)
    await page.waitForTimeout(300)
    await captureTheme(label)
    await page.keyboard.press('Escape')
    await page.reload()
    await page.getByRole('button', { name: /mock-fast/ }).waitFor()
    assert.equal(await page.locator('body').evaluate(body => body.hasAttribute('data-ds-dark-theme')), dark)
    await openSettings(page)
    await settings.getByRole('button', { name: '通用设置', exact: true }).click()
    assert.equal(await settings.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true')
  }
  await settings.getByRole('button', { name: '跟随系统', exact: true }).click()
  for (const scheme of ['light', 'dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForFunction(wanted => document.body.hasAttribute('data-ds-dark-theme') === wanted, scheme === 'dark')
    await captureTheme(`system-${scheme}`)
  }
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: /mock-fast/ }).waitFor()
  await captureTheme('system-light-reloaded')
  assert.equal(themeStates.at(-1).preference, 'system')
  await openSettings(page)
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  assert.equal(await settings.getByRole('button', { name: '跟随系统', exact: true }).getAttribute('aria-pressed'), 'true')
  const sidebarPreference = settings.getByRole('button', { name: '应用内侧边栏', exact: true })
  if (await sidebarPreference.count()) {
    await sidebarPreference.click()
    await page.getByRole('menuitem', { name: '默认浏览器', exact: true }).click()
  }
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  const newTab = page.context().waitForEvent('page')
  await page.getByRole('link', { name: 'External fixture', exact: true }).click()
  const external = await newTab
  await external.waitForLoadState('domcontentloaded')
  assert.equal(external.url(), externalUrl)
  await external.close()
  await openSettings(page)
  await settings.getByRole('button', { name: '通用设置', exact: true }).click()
  await settings.getByRole('button', { name: '中文', exact: true }).click()
  await page.getByText('日本語', { exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: /新規セッション/ }).first().waitFor()
  await page.screenshot({ path: path.join(run, 'japanese.png'), fullPage: true })
  assert.deepEqual(errors, [])
  assert.ok(sockets.some(socket => socket.sent > 0 && socket.received > 0), 'official transport sends and receives WebSocket frames')
  assert.doesNotMatch(serverErrors, /entry did not activate|ValidationError|FAILED/)
  const result = { host: '0.2.1-rc.4', node: spawnSync(nodeExecutable, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim(),
    nodeExecutable, driverNode: process.version, os: process.platform, cpu: process.arch,
    plugin, official, run, sockets, streamFrames, promptResponses, remoteRequests, themeStates, translationRequests: translations, existingTranslator, installedProfile: installed !== undefined,
    passed: ['Host startup audit', 'authenticated dynamic client resources', 'shared model selector', 'reasoning selection + reload persistence',
      'streamed mock response', 'citation sources', 'interactive sandbox iframe', 'related questions', 'agents view', 'mobile no document overflow', 'session reload',
      'model card edit + reload persistence', 'language pack selection + reload persistence', 'keyboard model picker opening',
      'official cotTranslation Remote + local provider', 'translation original toggle + durable reopen cache', 'WebSocket frame exchange',
      'Markdown local file navigation', 'relative image + shared lightbox Tab/Escape/focus return', 'Modern model popover + official modal keyboard ownership',
      'public theme override light/dark save + reload', 'system color-scheme switching + metadata consistency', 'HTTP link official new-tab preference/fallback'],
    errors }
  await writeFile(path.join(run, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(run, 'failure.png'), fullPage: true })
  const frames = await Promise.all(page.frames().map(async frame => ({ url: frame.url(), buttons: await frame.locator('button').allTextContents() })))
  const visuals = await page.locator('[data-intelligent-ui]').evaluateAll(items => items.map(item => ({ html: item.outerHTML.slice(0, 1000), ancestors: Array.from((function* () { for (let parent = item; parent; parent = parent.parentElement) yield parent })()).map(parent => ({ tag: parent.tagName, hidden: parent.getAttribute('aria-hidden'), inert: parent.hasAttribute('inert') })) })))
  const boot = await page.evaluate(() => window.__DSH_BOOT__)
  const failure = { message: error.message, errors, sockets, remoteRequests, body: await page.locator('body').innerText(), serverErrors, frames, visuals, boot }
  await writeFile(path.join(run, 'failure.json'), JSON.stringify(failure, null, 2))
  console.error(JSON.stringify({ run, message: failure.message, errors, body: failure.body.slice(0, 2000), diagnostics: path.join(run, 'failure.json') }, null, 2))
  throw error
} finally {
  await browser.close()
  await new Promise(resolve => translationServer.close(resolve))
  child.kill('SIGINT')
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000) })
  await isolation?.verifySource()
}


