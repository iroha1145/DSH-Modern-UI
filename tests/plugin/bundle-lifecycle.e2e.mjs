/** Standalone consumer check: node bundle-lifecycle.e2e.mjs /path/to/current.json */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { browserExecutable, isolatedInstalledFixture } from './fixtures/e2e-environment.mjs'

const script = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(script), '../..')
const bundle = '@iroha1145/dsh-modern-ui'
const ownerIds = ['ui-layout', 'ui-sidebar', 'ui-conversation', 'ui-workspace']
const json = async filename => JSON.parse(await readFile(filename, 'utf8'))
const save = (filename, value) => writeFile(filename, JSON.stringify(value, null, 2))

if (process.argv[2] !== '--worker') {
  const statePath = process.env.MODERN_UI_INSTALLED_STATE ?? process.argv[2]
  assert.ok(statePath, 'Pass an installed current.json path or MODERN_UI_INSTALLED_STATE')
  const artifacts = path.join(process.env.MODERN_UI_E2E_ARTIFACTS ?? path.join(root, '.artifacts'), 'bundle-lifecycle')
  await mkdir(artifacts, { recursive: true })
  const run = await mkdtemp(path.join(artifacts, 'run-'))
  const isolation = await isolatedInstalledFixture(await json(statePath), run)
  const { state, environment } = isolation
  const workspace = path.join(run, 'workspace')
  await mkdir(workspace)
  const overlay = path.join(run, 'fixture.patch.yml')
  await writeFile(overlay, `- id: agent-default-model\n  config:\n    provider: modern-ui-fixture\n    model: mock-balanced\n- insert:\n    - id: bundle-lifecycle-fixture\n      name: ${JSON.stringify(pathToFileURL(path.join(root, 'tests/plugin/fixtures/mock-host.mjs')).href)}\n`)
  environment.MODERN_UI_OFFICIAL_CLI = state.cli
  environment.MODERN_UI_BROWSER_WORKSPACE = workspace
  const workerState = path.join(run, 'fixture-state.json')
  await save(workerState, { node: state.node, cli: state.cli, pnpm: state.pnpm, profile: state.profile, home: state.home })
  const result = { run, sourceState: path.resolve(statePath), stages: [], passed: [], limitations: [
    'Root owner bundle changes require page reload; each transition checks the refreshed composer.',
    'During a root-owner transition rc.4 can emit the recorded root-registration gap error before reload; stable-page errors still fail.',
    'This standalone driver does not claim browser listener leak coverage; UIGateway unit tests cover disposal.',
  ] }
  try {
    for (const mode of ['cycle', 'remove', 'verify']) {
      const child = spawn(state.node, [script, '--worker', workerState, run, mode], {
        cwd: run, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let diagnostics = ''
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics += chunk })
      const timeout = setTimeout(() => child.kill(), 180000)
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
      clearTimeout(timeout)
      await writeFile(path.join(run, `${mode}-diagnostics.txt`), diagnostics.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
      assert.equal(code, 0, `${mode} worker failed; inspect ${path.join(run, `${mode}-result.json`)}`)
      const stage = await json(path.join(run, `${mode}-result.json`))
      assert.equal(stage.status, 'passed', stage.failure)
      result.stages.push(stage)
    }
    result.passed = ['bundle off restores four official owners', 'Modern CSS and inline theme tokens removed',
      'bundle on restores Modern owner and styles', 'composer works after reload at both transitions',
      'official removeBundle executes pnpm remove with exit 0', 'removed package stays absent after new Host process',
      'three fixed community bundles retained', 'source installation data and profile hashes unchanged']
    result.status = 'passed'
  } catch (error) { result.status = 'failed'; result.failure = error.stack; process.exitCode = 1 }
  finally {
    try { await isolation.verifySource() }
    catch (error) { result.status = 'failed'; result.failure = error.stack; process.exitCode = 1 }
    await save(path.join(run, 'result.json'), result)
    console.log(JSON.stringify({ run, status: result.status, passed: result.passed, failure: result.failure }, null, 2))
  }
} else {
  const state = await json(process.argv[3])
  const run = process.argv[4], mode = process.argv[5]
  const require = createRequire(state.cli)
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const [{ runProfile }, { createLaunchEnvironmentSnapshot }] = await Promise.all([
    load('@deepseek-ai/dsh/profile-boot'), load('@deepseek-ai/dsh-launch-environment'),
  ])
  const report = { mode, os: process.platform, node: process.version, captures: [], operations: [], errors: [] }
  let boot, browser, page, webUrl, output = '', rootTransition = false
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...args) => {
    output += chunk
    webUrl ??= output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)?.[1]
    return originalWrite(chunk, ...args)
  }
  const manifestFile = path.join(state.home, 'profiles', state.profile, 'package.json')
  async function operation(name, action) {
    rootTransition = name.startsWith('bundle-')
    const result = await action()
    report.operations.push({ name, result })
    assert.ok(!result?.error, `${name}: ${JSON.stringify(result)}`)
    return result
  }
  async function reload() {
    await page.reload()
    const accept = page.getByRole('button', { name: '继续', exact: true })
    await page.waitForTimeout(1000)
    if (await accept.isVisible()) await accept.click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    rootTransition = false
  }
  async function capture(name, modern, refreshed = false) {
    await page.waitForFunction(expected => (document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]').length > 0) === expected, modern)
    const rows = (await boot.ctx.pluginManager.listPlugins()).filter(row => ownerIds.includes(row.patchId) || row.patchId === 'modern-ui')
      .map(row => ({ id: row.patchId, enabled: row.enabled, phase: row.fiberPhase }))
    const originals = rows.filter(row => ownerIds.includes(row.id))
    assert.equal(originals.length, 4)
    assert.ok(originals.every(row => row.enabled === !modern), `Four original owner states: ${JSON.stringify(rows)}`)
    if (modern) assert.equal(rows.find(row => row.id === 'modern-ui')?.enabled, true)
    const browserState = await page.evaluate(() => ({
      styles: [...document.querySelectorAll('style[data-plugin="@iroha1145/dsh-modern-ui"]')].map(style => style.dataset.pluginCss).sort(),
      bodyInline: document.body.getAttribute('style'), hairline: document.documentElement.style.getPropertyValue('--dsh-hairline-width'),
      modernTokens: [...document.body.style].filter(name => name.startsWith('--bui-')).sort(),
      composer: !!document.querySelector('[data-composer-input]'),
    }))
    if (!modern) { assert.equal(browserState.styles.length, 0); assert.equal(browserState.modernTokens.length, 0) }
    if (refreshed) {
      const editor = page.locator('[data-composer-input]').last()
      await editor.waitFor()
      await editor.fill('Bundle lifecycle draft')
      assert.match(await editor.innerText(), /Bundle lifecycle draft/)
      await editor.fill('')
      assert.equal(browserState.composer, true)
    }
    const manifest = await json(manifestFile)
    report.captures.push({ name, rows, browser: browserState, bundles: manifest.dsh.profile.bundles })
    await page.screenshot({ path: path.join(run, `${name}.png`) })
    return browserState
  }
  try {
    boot = await runProfile({ profile: state.profile, args: ['--port', '0', '--no-open'], patchFiles: [path.join(run, 'fixture.patch.yml')],
      packageManager: { command: state.node, args: [state.pnpm], env: process.env },
      environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]) })
    assert.ok(webUrl, 'Official Host publishes an authenticated loopback URL')
    const driver = createRequire(process.env.MODERN_UI_BUILD_DEPS ? path.join(path.resolve(process.env.MODERN_UI_BUILD_DEPS), 'package.json') : path.join(root, 'package.json'))
    const { chromium } = driver('playwright-core')
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', locale: 'zh-CN' })
    page.on('pageerror', error => report.errors.push({ message: error.message,
      expectedReloadBoundary: rootTransition && error.message === "renderSlot('root') before any 'root' registration (boot order)" }))
    await page.goto(webUrl)
    await reload()
    if (mode === 'cycle') {
      const initial = await capture('startup-modern', true, true)
      await operation('bundle-off', () => boot.ctx.pluginManager.setBundleEnabled(bundle, false))
      const liveOff = await capture('bundle-off-live', false)
      report.liveOffComposer = liveOff.composer
      await reload()
      const official = await capture('bundle-off-refreshed', false, true)
      await save(path.join(run, 'official-baseline.json'), official)
      await operation('bundle-on', () => boot.ctx.pluginManager.setBundleEnabled(bundle, true))
      const liveOn = await capture('bundle-on-live', true)
      report.liveOnComposer = liveOn.composer
      await reload()
      const restored = await capture('bundle-on-refreshed', true, true)
      assert.deepEqual(restored.styles, initial.styles)
      assert.equal(restored.bodyInline, initial.bodyInline)
      await operation('bundle-off-before-new-host', () => boot.ctx.pluginManager.setBundleEnabled(bundle, false))
      await reload()
      await capture('disabled-before-removal', false, true)
    } else if (mode === 'remove') {
      await capture('new-host-official-before-remove', false, true)
      const removal = await operation('official-removeBundle', () => boot.ctx.pluginManager.removeBundle(bundle))
      assert.equal(removal.packageResult?.exitCode, 0, 'Actual pnpm remove must succeed')
      await reload()
      await capture('removed-official', false, true)
      assert.ok(!(await json(manifestFile)).dependencies?.[bundle])
    } else {
      assert.equal(mode, 'verify')
      const final = await capture('final-new-host-official', false, true)
      const baseline = await json(path.join(run, 'official-baseline.json'))
      assert.equal(final.bodyInline, baseline.bodyInline, 'Official shared inline theme restored after removal and restart')
      assert.equal(final.hairline, baseline.hairline)
      const manifest = await json(manifestFile)
      assert.ok(!manifest.dependencies?.[bundle])
      const isolation = await json(path.join(run, 'isolation.json'))
      for (const community of isolation.communities) {
        assert.ok(manifest.dependencies[community.name])
        assert.ok(manifest.dsh.profile.bundles.includes(community.name))
      }
    }
    assert.deepEqual(report.errors.filter(error => !error.expectedReloadBoundary), [])
    report.status = 'passed'
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack; process.exitCode = 1
    if (page) { await page.screenshot({ path: path.join(run, `${mode}-failure.png`) }); report.body = (await page.locator('body').innerText()).slice(0, 3000) }
  } finally {
    await save(path.join(run, `${mode}-result.json`), report)
    await browser?.close()
    if (boot) await boot.shutdown.shutdown(report.status === 'passed' ? 0 : 1)
  }
}
