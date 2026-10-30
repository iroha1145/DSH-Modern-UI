/** Browser acceptance of an already installed, independent official consumer. */
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { crc32, deflateSync } from 'node:zlib'
import { providerId, firstAnswer, laterAnswer } from './fixtures/scenario.mjs'
import { packFixture } from './pack-fixture.mjs'

const execute = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const tooling = createRequire(
  process.env.COMPAT_TEST_DRIVER ? path.join(path.resolve(process.env.COMPAT_TEST_DRIVER), 'package.json') : path.resolve(here, '../../package.json'),
)
export const browserFixtureName = 'modern-compat-browser-fixture'
const pngChunk = (name, bytes) => {
  const payload = Buffer.concat([Buffer.from(name), bytes])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(payload))
  return Buffer.concat([length, payload, checksum])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(16, 0)
header.writeUInt32BE(16, 4)
header[8] = 8
header[9] = 6
const pixels = Buffer.alloc(16 * (1 + 16 * 4), 0)
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pixels.set([40, 110, 190, 255], y * 65 + 1 + x * 4)
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(pixels)),
  pngChunk('IEND', Buffer.alloc(0)),
])

export async function runBrowserChecks({ state, output, executablePath, checkHost }) {
  assert.ok(state?.cli && state?.node && state?.home && state?.profile, 'Pass an actually installed state')
  output = path.resolve(output)
  await mkdir(output, { recursive: true })
  executablePath ??=
    process.env.MODERN_UI_BROWSER ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
  const report = {
    host: state.officialSource?.version,
    platform: `${process.platform}-${process.arch}`,
    node: state.node,
    cli: state.cli,
    profile: state.profile,
    plugin: state.plugin?.path,
    checks: [],
    errors: [],
    console: [],
    failedRequests: [],
    requests: [],
    promptResponses: [],
    screenshots: [],
  }
  if (
    !executablePath ||
    !(await access(executablePath).then(
      () => true,
      () => false,
    ))
  ) {
    report.passed = false
    report.checks.push({ name: 'real-browser', state: 'unverified', reason: 'No browser executable is available' })
    await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
    return report
  }
  const workspace = path.join(output, 'workspace')
  const fixtures = path.join(output, 'fixture', 'package')
  const events = path.join(output, 'model-events.jsonl')
  const bin = path.join(output, 'bin')
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(fixtures, { recursive: true }), mkdir(bin, { recursive: true })])
  await execute('git', ['-c', 'init.defaultBranch=fixture', 'init', '--quiet', output], { windowsHide: true })
  await writeFile(events, '')
  await writeFile(path.join(workspace, 'compat-note.txt'), 'First compatibility line\nSecond compatibility line\n')
  await writeFile(
    path.join(workspace, 'compat-guide.md'),
    '# Compatibility guide\n\nOriginal Sidebar file.\n\n```typescript\n' +
      Array.from({ length: 28 }, (_, i) => `const line${i} = ${i};`).join('\n') +
      '\n```\n',
  )
  await writeFile(path.join(workspace, 'compat-image.png'), png)
  await Promise.all(['model-provider.mjs', 'scenario.mjs'].map(name => copyFile(path.join(here, 'fixtures', name), path.join(fixtures, name))))
  await copyFile(path.join(here, 'fixtures/browser-probe.js'), path.join(fixtures, 'client.js'))
  await writeFile(
    path.join(fixtures, 'package.json'),
    JSON.stringify(
      {
        name: browserFixtureName,
        version: '1.0.0',
        type: 'module',
        exports: { '.': './model-provider.mjs', './client': './client.js', './package.json': './package.json' },
        dsh: {
          manifestVersion: 1,
          bundle: { patch: './cordis.patch.yml' },
          client: {
            platform: 'web',
            inject: ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-api-session-controller'],
          },
        },
      },
      null,
      2,
    ),
  )
  await writeFile(path.join(fixtures, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: browserFixtureName, name: browserFixtureName }] }]))
  const tarball = path.join(output, 'fixture.tgz')
  await packFixture(fixtures, tarball)
  const environment = {
    ...process.env,
    DSH_HOME: state.home,
    DSH_TELEMETRY_DISABLED: '1',
    COMPAT_OFFICIAL_CLI: state.cli,
    COMPAT_BROWSER_WORKSPACE: workspace,
    COMPAT_BROWSER_REPORT: events,
    PATH: [bin, path.dirname(state.node), process.env.PATH ?? ''].join(path.delimiter),
    npm_config_update_notifier: 'false',
  }
  for (const key of Object.keys(environment)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|NODE_PATH|NODE_OPTIONS/i.test(key)) delete environment[key]
  if (state.pnpm) {
    if (process.platform === 'win32') await writeFile(path.join(bin, 'pnpm.cmd'), `@echo off\r\n"${state.node}" "${state.pnpm}" %*\r\n`)
    else {
      const q = value => `'${value.replaceAll("'", "'\\''")}'`
      await writeFile(path.join(bin, 'pnpm'), `#!/bin/sh\nexec ${q(state.node)} ${q(state.pnpm)} "$@"\n`, { mode: 0o755 })
    }
  }
  let identicalInstalledFixture = false
  try {
    const installed = path.dirname(
      createRequire(path.join(state.home, 'profiles', state.profile, 'package.json')).resolve(browserFixtureName + '/package.json'),
    )
    identicalInstalledFixture = (
      await Promise.all(
        ['package.json', 'model-provider.mjs', 'scenario.mjs', 'client.js', 'cordis.patch.yml'].map(async name =>
          (await readFile(path.join(installed, name))).equals(await readFile(path.join(fixtures, name))),
        ),
      )
    ).every(Boolean)
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error
  }
  if (identicalInstalledFixture)
    await writeFile(path.join(output, 'fixture-install.log'), 'Reused byte-identical fixture previously installed through the official plugin CLI.\n')
  else {
    try {
      const install = await execute(state.node, [state.cli, 'plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', tarball], {
        cwd: output,
        env: environment,
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      await writeFile(path.join(output, 'fixture-install.log'), install.stdout + install.stderr)
    } catch (error) {
      await writeFile(path.join(output, 'fixture-install.log'), (error.stdout ?? '') + (error.stderr ?? '') + '\n' + error.stack)
      report.passed = false
      report.checks.push({ name: 'official-fixture-install', state: 'failed', reason: error.stack })
      await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
      return report
    }
  }
  const overlay = path.join(output, 'fixture.patch.yml')
  await writeFile(
    overlay,
    JSON.stringify([
      { id: 'agent-default-model', config: { provider: providerId, model: 'compat-balanced' } },
      { id: 'workspace-controller', config: { documentsDirectory: path.join(output, 'documents') } },
      { id: 'modern-ui', config: { foldedReplies: 'final' } },
    ]),
  )
  let child,
    browser,
    page,
    origin,
    childOutput = '',
    hostRestarted = false,
    restartInProgress = false
  const retiredOrigins = new Set()
  const responseReads = []
  const sockets = []
  const stopHost = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGKILL')
      await exited
    }
  }
  const startHost = async () => {
    child = spawn(state.node, [state.cli, '--profile', state.profile, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: output,
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return new Promise((resolve, reject) => {
      let started = ''
      const timer = setTimeout(() => reject(new Error('Installed Host startup timed out')), 60_000)
      child.once('error', reject)
      child.once('exit', code => {
        clearTimeout(timer)
        reject(new Error(`Installed Host exited ${code}: ${started.slice(-5000)}`))
      })
      const collect = bytes => {
        childOutput += bytes
        started += bytes
        const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/.exec(started)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
    })
  }
  const screen = async name => {
    const filename = path.join(output, `${name}.png`)
    await page.screenshot({ path: filename, fullPage: true })
    report.screenshots.push(filename)
  }
  const check = async (name, action) => {
    try {
      const detail = await action()
      report.checks.push({ name, state: 'passed', ...(detail === undefined ? {} : { detail }) })
      console.log(`${report.host}: passed ${name}`)
      return true
    } catch (error) {
      report.checks.push({ name, state: 'failed', reason: error.stack })
      await screen(`failure-${report.checks.length}`).catch(() => {})
      await writeFile(
        path.join(output, `failure-${report.checks.length}.txt`),
        await page
          .locator('body')
          .innerText()
          .catch(() => ''),
      )
      await page.keyboard.press('Escape').catch(() => {})
      await page.keyboard.press('Escape').catch(() => {})
      console.error(`${report.host}: failed ${name}: ${error.message}`)
      return false
    }
  }
  const evidence = async () =>
    page.evaluate(async () => {
      const response = await fetch('/api/compat-browser/evidence')
      if (!response.ok) throw new Error(`evidence ${response.status}`)
      return response.json()
    })
  const sessionReport = async () => JSON.parse(await page.locator('[data-compat-session-report]').textContent())
  const input = () => page.locator('[data-composer-input="true"]')
  const send = async text => {
    await input().fill(text)
    await input().press('Enter')
  }
  const acceptWelcome = async () => {
    const button = page.getByRole('button', { name: /^(继续|Continue)$/ })
    if (await button.count()) await button.click({ timeout: 15000 })
  }
  const settings = async () => {
    if (process.platform === 'linux') {
      await page.locator('[data-modern-settings-seat]').getByRole('button').press('Enter')
      await page.getByRole('menuitem', { name: /^(设置|Settings)$/ }).press('Enter')
    } else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+Comma' : 'Control+Alt+Comma')
    await page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: /^(通用设置|General)$/ }) })
      .waitFor()
  }
  try {
    const url = await startHost()
    origin = new URL(url).origin
    const { chromium } = tooling('playwright-core')
    browser = await chromium.launch({ executablePath, headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] })
    page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(error.message))
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()))
        report.console.push({ type: message.type(), text: message.text(), location: message.location(), duringRestart: restartInProgress })
    })
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.includes('/sidebar/') || url.pathname.includes('/session/'))
        report.requests.push({ path: url.pathname, method: request.method(), body: request.postData() })
    })
    page.on('requestfailed', request => {
      const target = new URL(request.url())
      const failure = request.failure()
      const restart = retiredOrigins.has(target.origin)
      const unusedResource = failure?.errorText === 'net::ERR_ABORTED' && ['/sidebar/bundle/editor.js', '/sidebar/api/changes.ops'].includes(target.pathname)
      report.failedRequests.push({
        url: request.url(),
        failure,
        expected: restart || unusedResource,
        reason: restart
          ? 'The browser was connected to the deliberately stopped Host'
          : unusedResource
            ? 'The browser cancelled an unused community resource after navigation'
            : 'Unexpected request failure',
      })
    })
    page.on('response', response => {
      const target = new URL(response.url())
      if (response.status() >= 400) {
        const item = { url: response.url(), status: response.status(), expected: false }
        report.failedRequests.push(item)
        responseReads.push(
          response
            .text()
            .then(body => {
              item.body = body
              // Official deliverables summaries live only as long as the Host Session. Its public
              // ChangesSummaryStore renders "missing" after restart; other 4xx are not accepted.
              item.expected = hostRestarted && target.pathname === '/api/changes.summary' && response.status() === 404 && body === 'Change summary unavailable.'
              item.reason = item.expected
                ? 'The restarted official Host released its in-memory change summary; the official client handles the missing state'
                : 'Unexpected HTTP response'
            })
            .catch(error => {
              item.bodyReadError = error.message
            }),
        )
      }
      if (target.pathname === '/api/session/prompt')
        responseReads.push(
          response
            .text()
            .then(body => report.promptResponses.push({ status: response.status(), body }))
            .catch(() => {}),
        )
    })
    page.on('websocket', socket => {
      const item = { path: new URL(socket.url()).pathname, sent: 0, received: 0 }
      sockets.push(item)
      socket.on('framesent', () => item.sent++)
      socket.on('framereceived', () => item.received++)
    })
    await page.goto(url)
    await page.waitForTimeout(1200)
    await acceptWelcome()
    await page.locator('[data-compat-client-report]').waitFor({ state: 'attached' })
    await page.getByRole('button', { name: /compat-balanced/ }).waitFor()
    if (checkHost) {
      const cookie = (await context.cookies(origin)).map(row => `${row.name}=${row.value}`).join('; ')
      await check('host-callback', () => checkHost({ baseUrl: origin, cookie }))
    }
    await check('installed-loader-shared-instances', async () => {
      const runtime = JSON.parse(await page.locator('[data-compat-client-report]').textContent())
      const host = await evidence()
      assert.ok(
        Object.values(runtime.shared).every(row => row.sameExports),
        JSON.stringify(runtime.shared),
      )
      assert.deepEqual(runtime.entries.failures, [])
      for (const name of [state.plugin.name, 'dsh-context', 'dsh-better-sidebar', browserFixtureName]) {
        assert.ok(
          host.plugins.some(row => row.moduleName === name && row.enabled && row.fiberPhase === 'active'),
          `${name} actually active: ${JSON.stringify(host.plugins)}`,
        )
      }
      assert.ok(runtime.modules.some(row => row.id === state.plugin.name))
      report.shared = runtime
      report.hostEvidence = host
      return { shared: runtime.shared, active: host.plugins.map(row => ({ name: row.moduleName, enabled: row.enabled, fiberPhase: row.fiberPhase })) }
    })
    await page.locator('button').filter({ hasText: '新会话' }).first().click()
    const defaultWorkspace = page.getByRole('button', { name: /^(默认工作区|Default workspace)$/ }).last()
    if (await defaultWorkspace.count()) {
      await defaultWorkspace.click()
      await page.getByRole('menuitem', { name: /workspace/ }).click()
    }
    await check('model-selection-reasoning-and-public-label', async () => {
      const picker = page.getByRole('button', { name: /compat-balanced/ })
      await picker.click()
      await page.getByRole('option', { name: /compat-fast/ }).click()
      await page.getByRole('button', { name: /compat-fast/ }).click()
      await page.getByRole('radio', { name: /^(高|High)$/ }).click()
      await page.keyboard.press('Escape')
      await page.locator('[data-compat-toggle-label]').click()
      await page.locator('[data-compat-model-label]').waitFor()
      assert.match(await page.locator('[data-compat-model-label]').textContent(), /compat-fast/)
      await page.locator('[data-compat-toggle-label]').click()
      await page.locator('[data-compat-model-label]').waitFor({ state: 'detached' })
      const runtime = JSON.parse(await page.locator('[data-compat-client-report]').textContent())
      assert.ok(
        runtime.slots['conversation.input.model.label'].some(row => row.locale === 'deepseek-model-label-1017'),
        JSON.stringify(runtime.slots['conversation.input.model.label']),
      )
      return runtime.slots['conversation.input.model.label']
    })
    await check('official-plan-action', async () => {
      await send('/plan on')
      const chip = page.getByRole('button', { name: /计划模式已开启|Plan mode on/ })
      await chip.waitFor()
      await chip.click()
      await chip.waitFor({ state: 'hidden' })
    })
    const flowPassed = await check('real-send-stream-tools-and-answer-region', async () => {
      await send('COMPAT_FLOW')
      await page.getByText('COMPAT_LATER_ANSWER', { exact: true }).waitFor({ timeout: 30000 })
      const process = page.locator('[data-turn-process][data-process-outcome="completed"]').last()
      await process.waitFor()
      await page.waitForTimeout(800)
      if ((await process.getAttribute('aria-expanded')) === 'false') await process.click()
      assert.equal(await process.getAttribute('aria-expanded'), 'true')
      await page.waitForTimeout(300)
      for (const item of await page.locator('[data-process-activity][aria-expanded="false"]:visible').all()) await item.click()
      await page.locator('[data-compat-specific-tool="result"]').waitFor()
      await page.getByText('COMPAT_TOOL_PROGRESS', { exact: true }).waitFor({ state: 'visible' })
      assert.equal(await page.locator('[data-compat-specific-tool="result"]').innerText(), 'Actual tool result')
      assert.match(await page.locator('body').innerText(), /COMPAT_DETERMINISTIC_TOOL_ERROR/)
      if ((await process.getAttribute('aria-expanded')) === 'true') await process.click()
      await page.getByText('COMPAT_FIRST_ANSWER', { exact: true }).waitFor({ state: 'visible' })
      await page.getByText('COMPAT_LATER_ANSWER', { exact: true }).waitFor({ state: 'visible' })
      assert.equal(await page.locator('[data-compat-specific-tool="result"]').isVisible(), false)
      assert.equal(await page.getByText('COMPAT_TOOL_PROGRESS', { exact: true }).isVisible(), false)
      const host = await evidence()
      assert.deepEqual(
        host.events
          .filter(row => row.kind === 'tool-executed')
          .map(row => row.name)
          .sort(),
        ['compat_echo', 'compat_failure'],
      )
      assert.ok(host.events.some(row => row.kind === 'request' && row.model === 'compat-fast' && row.reasoningEffort === 'high'))
      assert.ok(sockets.some(row => row.sent > 0 && row.received > 0))
      report.flow = { session: await sessionReport(), modelEvents: host.events, sockets }
      return report.flow
    })
    if (flowPassed) {
      await check('raw-whitespace-copy-and-answer-navigation', async () => {
        await page
          .locator('[data-turn-tail]')
          .last()
          .getByRole('button', { name: /^(复制|Copy)$/ })
          .click()
        // Windows' native clipboard translates LF to CRLF; preserve every other byte, including spaces.
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), firstAnswer + '\n\n' + laterAnswer)
        const session = await sessionReport()
        const answerTurn = session.navigation.find(row => row.prompt === 'COMPAT_FLOW')
        assert.ok(answerTurn)
        const navigation = page.getByRole('button', { name: new RegExp(`跳转到第 ${answerTurn.turn} 轮|Jump to turn ${answerTurn.turn}`) })
        await navigation.hover()
        await page.waitForTimeout(300)
        assert.match(await page.locator('body').innerText(), /COMPAT_FIRST_ANSWER/)
        await navigation.click()
        assert.ok(
          session.navigation.some(row => JSON.stringify(row).includes('COMPAT_FIRST_ANSWER')),
          JSON.stringify(session.navigation),
        )
      })
      await check('official-feedback-action', async () => {
        await page
          .getByRole('button', { name: /^(好的回答|Good response)$/ })
          .first()
          .click()
        const dialog = page.getByRole('dialog', { name: /提交反馈|Submit feedback/ })
        await dialog.locator('textarea').fill('Compatibility local fixture feedback')
        await dialog.getByRole('button', { name: /^(提交|Submit)$/ }).click()
        await dialog.waitFor({ state: 'hidden' })
        for (let at = 0; at < 30; at++) {
          const host = await evidence()
          if (host.events.some(row => row.kind === 'session-event' && row.event.type === 'feedback/message-put')) return { recorded: true }
          await delay(100)
        }
        throw new Error('Feedback did not reach the real session journal')
      })
      await check('sidebar-read-edit-save-and-markdown-fold', async () => {
        await page.getByRole('button', { name: 'Open compatibility file', exact: true }).click()
        const community = page.locator(':is([data-dsh-native-tab-host], [data-dsh-better-sidebar]):visible').last()
        await community.getByText('Second compatibility line', { exact: false }).waitFor()
        assert.ok(
          report.requests.some(
            row =>
              row.path === '/sidebar/api/fs.read' &&
              JSON.parse(row.body).path.replaceAll('\\', '/') === path.join(workspace, 'compat-note.txt').replaceAll('\\', '/'),
          ),
        )
        const edit = community.getByRole('button', { name: /^(编辑|Edit)$/ })
        if (await edit.count()) await edit.click()
        const editor = community.locator('.cm-editor [contenteditable="true"]')
        await editor.fill('COMPAT_SIDEBAR_SAVED\n')
        await community.getByRole('button', { name: /^(保存|Save)$/ }).click()
        await page.waitForTimeout(700)
        assert.equal(await readFile(path.join(workspace, 'compat-note.txt'), 'utf8'), 'COMPAT_SIDEBAR_SAVED\n')
        await page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ }).click()
        await page.getByRole('button', { name: 'Open compatibility guide', exact: true }).click()
        const markdown = page.locator('.nArs4W_editorMd:visible')
        await markdown.getByRole('heading', { name: 'Compatibility guide' }).waitFor()
        const fold = markdown.locator('[data-modern-community-fold]').first()
        await fold.click()
        assert.equal(await fold.getAttribute('aria-expanded'), 'false')
        await fold.click()
        assert.equal(await fold.getAttribute('aria-expanded'), 'true')
        await screen('sidebar')
        await page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ }).click()
      })
      const closeSidebar = page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ })
      if (await closeSidebar.count()) await closeSidebar.click()
      await check('context-real-statistics', async () => {
        await page.getByRole('tab', { name: /^(上下文|Context)$/ }).click()
        await page
          .getByText(/当前上下文|Current context/)
          .first()
          .waitFor()
        const body = await page.locator('body').innerText()
        assert.match(body, /Token|tokens/)
        assert.doesNotMatch(body, /上下文数据读取失败|请更新 DeepSeek Harness/)
        assert.match(body, /COMPAT_FLOW|用户消息|User messages/)
        await screen('context')
        await page.getByRole('tab', { name: /^(对话|Chat)$/ }).click()
        return { text: body }
      })
    } else
      for (const name of [
        'raw-whitespace-copy-and-answer-navigation',
        'official-feedback-action',
        'sidebar-read-edit-save-and-markdown-fold',
        'context-real-statistics',
      ])
        report.checks.push({ name, state: 'unverified', reason: 'The real flow prerequisite failed' })
    await check('file-and-image-attachments', async () => {
      await input().click()
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles([path.join(workspace, 'compat-note.txt'), path.join(workspace, 'compat-image.png')])
      await page.waitForTimeout(700)
      await send('COMPAT_ATTACHMENT')
      await page.getByText('COMPAT_ATTACHMENTS_ACCEPTED', { exact: true }).waitFor({ timeout: 30000 })
      const host = await evidence()
      const request = host.events.filter(row => row.kind === 'request').at(-1)
      assert.match(JSON.stringify(request.user), /compat-note\.txt/)
      assert.ok(
        request.user.some(row => row.content.some(block => block.type === 'image')),
        JSON.stringify(request.user),
      )
      return request
    })
    await check('real-stream-stop-cancellation', async () => {
      await send('COMPAT_STOP')
      await page
        .getByText(/COMPAT_STOP_STREAMING/)
        .first()
        .waitFor()
      await page.getByRole('button', { name: /^(停止生成|Stop generating)$/ }).click()
      for (let at = 0; at < 40; at++) {
        const host = await evidence()
        if (host.events.some(row => row.kind === 'model-cancelled' && row.aborted)) return { cancelled: true }
        await delay(100)
      }
      throw new Error('Stop did not abort the actual model stream')
    })
    await check('settings-and-history-survive-host-restart', async () => {
      const previous = await sessionReport()
      await settings()
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^(通用设置|General)$/ }) })
      await dialog.getByRole('button', { name: /^(通用设置|General)$/ }).click()
      await dialog.getByRole('button', { name: /^(深色|Dark)$/ }).click()
      await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      restartInProgress = true
      retiredOrigins.add(new URL(page.url()).origin)
      await stopHost()
      hostRestarted = true
      const next = await startHost()
      await page.goto(next)
      await page.locator('[data-compat-client-report]').waitFor({ state: 'attached' })
      restartInProgress = false
      await page.locator(`[data-row-key="session:${previous.sessionId}"]`).click()
      await page.locator('[data-compat-session-report]').waitFor({ state: 'attached' })
      await page
        .getByText(/COMPAT_STOP_STREAMING/)
        .first()
        .waitFor()
      assert.equal((await sessionReport()).sessionId, previous.sessionId)
      assert.equal(await page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')), true)
      await page.getByRole('button', { name: /compat-fast/ }).waitFor()
      return { sessionId: previous.sessionId, restarted: true, dark: true }
    })
    await screen('final')
    await Promise.allSettled(responseReads)
    await check('browser-runtime-and-request-outcomes', async () => {
      assert.deepEqual(report.errors, [])
      assert.deepEqual(
        report.failedRequests.filter(row => !row.expected),
        [],
      )
      const unexpectedConsole = report.console.filter(row => {
        if (row.type !== 'error') return false
        if (row.text.startsWith('Failed to load resource:') && report.failedRequests.some(request => request.expected)) return false
        const socket = /^WebSocket connection to '(ws:\/\/[^/]+)\//.exec(row.text)
        if (socket && retiredOrigins.has(socket[1].replace(/^ws:/, 'http:'))) return false
        return !(row.duringRestart && row.text.startsWith('[dsh-better-sidebar] agent-opens connection failed; stopping reconnect loop '))
      })
      assert.deepEqual(unexpectedConsole, [], 'Unexpected console errors must not be hidden by an error boundary')
      assert.ok(
        report.promptResponses.every(row => row.status === 200 && JSON.parse(row.body).result?.ok === true),
        JSON.stringify(report.promptResponses),
      )
      return { pageErrors: report.errors, expectedRequestOutcomes: report.failedRequests, promptResponses: report.promptResponses }
    })
  } catch (error) {
    console.error(error.stack)
    report.checks.push({ name: 'browser-startup-or-prerequisite', state: 'failed', reason: error.stack })
    if (page) {
      await screen('startup-failure').catch(() => {})
      await writeFile(
        path.join(output, 'startup-failure.txt'),
        await page
          .locator('body')
          .innerText()
          .catch(() => ''),
      )
      report.buttons = await page
        .locator('button')
        .evaluateAll(rows => rows.map(row => ({ label: row.getAttribute('aria-label'), text: row.innerText })))
        .catch(() => [])
    }
  } finally {
    await browser?.close()
    await stopHost()
    await writeFile(path.join(output, 'host.log'), childOutput.replace(/\?token=[^\s]+/g, '?token=[redacted]'))
    report.passed = report.checks.every(row => row.state === 'passed')
    await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((rows, value, at, all) => {
      if (at % 2 === 0) rows.push([value.replace(/^--/, ''), all[at + 1]])
      return rows
    }, []),
  )
  const result = await runBrowserChecks({ state: JSON.parse(await readFile(args.state, 'utf8')), output: args.output, executablePath: args.browser })
  console.log(
    JSON.stringify({ host: result.host, passed: result.passed, checks: result.checks.map(({ name, state }) => ({ name, state })), output: args.output }),
  )
  if (!result.passed) process.exitCode = 1
}
