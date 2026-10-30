/**
 * The official Desktop app is an Electron shell around the same Web Client and its own embedded Host. This drives
 * an installed Desktop the way a user would, in isolation: its own DSH_HOME and Chromium user-data directory, the
 * profile initialized by opening the app once, plugins added with Desktop's own `dsh` carrier (the npm CLI refuses
 * the reserved `desktop` profile), and the browser checks over the app's remote-debugging endpoint. Desktop takes
 * no `--patch` and has no reload that switches bundles, so the fixture overlay is the isolated profile's user layer
 * and a Host restart is an application restart. Removing the plugin and restarting must bring back the official UI.
 *
 * node tests/compat/desktop.mjs --root <dir> --plugin <tgz> [--app <Desktop executable>]
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultHostVersion, getHostCompatibility } from '../../scripts/distribution/compatibility.mjs'
import { captureWindow, keepPainting, runBrowserChecks } from './browser.mjs'

const execute = promisify(execFile)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  if (!['--root', '--plugin', '--app'].includes(key) || !process.argv[index + 1] || Object.hasOwn(options, key)) throw new Error(`Invalid option: ${key}`)
  options[key] = process.argv[index + 1]
}
assert.ok(options['--root'] && options['--plugin'], '--root and --plugin are required')
const app = path.resolve(
  options['--app'] ??
    (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DeepSeek Harness/DeepSeek Harness.exe')
      : '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'),
)
assert.ok(existsSync(app), `Desktop executable not found: ${app}`)
const plugin = path.resolve(options['--plugin'])
const root = path.resolve(options['--root'])
await mkdir(root, { recursive: true })
const relative = path.relative(await realpath(repo), await realpath(root))
assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'The Desktop consumer must be outside the development repository')

const home = path.join(root, 'home')
const userData = path.join(root, 'user-data')
const profile = path.join(home, 'profiles', 'desktop')
const output = path.join(root, `results-${randomUUID()}`)
await Promise.all([mkdir(home, { recursive: true }), mkdir(userData, { recursive: true }), mkdir(output)])
assert.notEqual(path.resolve(home), path.join(homedir(), '.dsh'), "The run must not use the user's own DSH home")
const resources = process.platform === 'darwin' ? path.join(path.dirname(app), '../Resources') : path.join(path.dirname(app), 'resources')
// What `resources/runtime/cli/bin/dsh` runs: the carrier allowed to manage the reserved profile.
const carrier = path.join(resources, 'app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
const modern = JSON.parse(await readFile(path.join(repo, 'packages/modern-ui/package.json'), 'utf8')).name

const environment = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', npm_config_update_notifier: 'false' }
for (const key of Object.keys(environment))
  if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|NODE_PATH|NODE_OPTIONS|ELECTRON_RUN_AS_NODE/i.test(key)) delete environment[key]
const cliEnvironment = { ELECTRON_RUN_AS_NODE: '1' }
const redact = text => text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]')
const dsh = async (name, args) => {
  const result = await execute(app, [carrier, ...args], {
    cwd: root,
    env: { ...environment, ...cliEnvironment },
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  }).catch(error => error)
  await writeFile(path.join(output, `${name}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}\nexit ${result.code ?? 0}\n`)
  if (result instanceof Error) throw result
  return result.stdout
}

let launches = 0
const application = {
  async start({ environment: launch = environment, overlay } = {}) {
    // The overlay seeds the user layer once; a restart must keep what the checks saved there since.
    if (overlay && overlay !== application.overlay) {
      await copyFile(overlay, path.join(profile, 'cordis.patch.yml'))
      application.overlay = overlay
    }
    const env = { ...launch, DSH_HOME: home }
    delete env.ELECTRON_RUN_AS_NODE
    const name = `application-${++launches}`
    // Windows stops painting a covered window, and a screenshot of it never resolves; keep the test window painting.
    const flags = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows']
    const child = spawn(app, [`--user-data-dir=${userData}`, '--remote-debugging-port=0', ...flags], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    const exited = new Promise(resolve => child.once('exit', resolve))
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Desktop did not open its remote-debugging endpoint')), 90_000)
      child.once('error', reject)
      exited.then(code => {
        clearTimeout(timer)
        reject(new Error(`Desktop exited (${code}) before readiness: ${text.slice(-4000)}`))
      })
      const collect = chunk => {
        text += chunk
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(text)
        if (match) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
    })
    application.version ??= await fetch(`http://${new URL(endpoint).host}/json/version`).then(response => response.json())
    application.stop = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        // Browser.close quits the application with its Host child, as the app's own Quit does.
        const socket = new WebSocket(endpoint)
        // A window wedged mid-boot can keep the socket open; the forced stop below still ends it.
        await Promise.race([
          new Promise(resolve => {
            socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
            socket.onclose = resolve
            socket.onerror = resolve
          }),
          delay(10_000),
        ])
        await Promise.race([exited, delay(30_000)])
        if (child.exitCode === null && child.signalCode === null) {
          if (process.platform === 'win32') await execute('taskkill', ['/pid', String(child.pid), '/T', '/F']).catch(() => {})
          else child.kill('SIGKILL')
          await exited
        }
      }
      await writeFile(path.join(output, `${name}.log`), redact(text))
    }
    return endpoint
  },
  async stop() {},
}

const report = { app, root, platform: `${process.platform}-${process.arch}`, node: process.version, steps: [] }
const step = async (name, action) => {
  try {
    const detail = await action()
    report.steps.push({ name, state: 'passed', ...(detail === undefined ? {} : { detail }) })
    console.log(`passed ${name}`)
    return detail
  } catch (error) {
    report.steps.push({ name, state: 'failed', reason: error.stack })
    console.error(`failed ${name}: ${error.message}`)
    throw error
  }
}
const capture = (page, name) => captureWindow(page, path.join(output, `${name}.png`))
/** Start the app, wait for a composer, record it, and run `inspect` while the app is still open. */
const visit = async (name, inspect) => {
  const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright-core')
  const browser = await chromium.connectOverCDP(await application.start())
  try {
    for (let at = 0; at < 120; at++) {
      for (const page of browser.contexts().flatMap(row => row.pages()))
        if (await page.locator('[data-composer-input="true"]').count()) {
          await delay(1000)
          await capture(page, name)
          return {
            url: page.url(),
            modern: await page.locator('[data-modern-settings-seat]').count(),
            ...(inspect && { detail: await inspect(page) }),
          }
        }
      await delay(500)
    }
    throw new Error('No application window rendered the composer')
  } finally {
    await browser.close()
    await application.stop()
  }
}

let failed = false
try {
  const embedded = await step('embedded host version', async () => {
    const version = (await dsh('version', ['--version'])).trim()
    const status = getHostCompatibility(version).status
    report.embeddedHost = { version, status }
    return report.embeddedHost
  })
  await step('the reserved profile boots only inside Desktop', async () => {
    // The reserved profile belongs to Desktop: its own boot path refuses --dump-config as the npm CLI does.
    const refused = await dsh('dump-config', ['--profile', 'desktop', '--dump-config']).then(
      () => false,
      error => /managed exclusively by the Electron application/.test(error.stderr ?? ''),
    )
    assert.ok(refused, 'Expected the carrier to refuse booting the desktop profile outside Desktop')
  })
  await step('open once and quit to initialize the profile', async () => {
    if (!existsSync(path.join(profile, 'package.json'))) {
      await application.start()
      for (let at = 0; at < 180 && !existsSync(path.join(profile, 'package.json')); at++) await delay(500)
      await application.stop()
    }
    assert.ok(existsSync(path.join(profile, 'package.json')), 'Desktop did not initialize its profile')
    return { profile }
  })
  await step('community plugins with integrity', async () => {
    // Like the canary: an unverified host gets the default host's community set as the candidate.
    const plugins = getHostCompatibility(embedded.status === 'verified' ? embedded.version : defaultHostVersion).communityPlugins
    const installed = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8')).dependencies ?? {}
    for (const row of plugins) {
      if (installed[row.name]) continue
      const bytes = Buffer.from(await (await fetch(row.url)).arrayBuffer())
      const [algorithm, digest] = row.integrity.split('-')
      assert.equal(createHash(algorithm).update(bytes).digest('base64'), digest, `${row.name} integrity`)
      const artifact = path.join(output, `${row.name}-${row.version}.tgz`)
      await writeFile(artifact, bytes)
      await dsh(`${row.name}-add`, ['plugin', '--profile', 'desktop', 'add', '--save-exact', '--ignore-scripts', artifact])
    }
    return plugins.map(({ name, version }) => ({ name, version }))
  })
  await step('dsh plugin --profile desktop add', () =>
    dsh('plugin-add', ['plugin', '--profile', 'desktop', 'add', '--save-exact', '--ignore-scripts', plugin]).then(log => log.trim().split('\n').slice(-4)),
  )
  await step('browser checks inside Desktop', async () => {
    const state = {
      officialSource: { version: embedded.version },
      cli: carrier,
      node: app,
      cliEnvironment,
      home,
      profile: 'desktop',
      plugin: { name: modern, path: path.join(profile, 'node_modules', modern) },
    }
    const browser = await runBrowserChecks({ state, output: path.join(output, 'browser'), application })
    report.browser = { passed: browser.passed, checks: browser.checks.map(({ name, state, reason }) => ({ name, state, ...(reason && { reason }) })) }
    assert.ok(browser.passed, 'Every browser check must pass inside Desktop')
    return report.browser.checks.map(({ name, state }) => `${state} ${name}`)
  })
  await step('Desktop shell surfaces', async () => {
    // What only the Electron shell drives: the caption row it marks on <html>, the OS color scheme, a narrow window.
    const seen = await visit('shell', async page => {
      const session = await page.context().newCDPSession(page)
      // The body itself is transparent; the theme presenter marks it dark and sets the root color-scheme.
      const scheme = () =>
        page.evaluate(() => ({ dark: document.body.hasAttribute('data-ds-dark-theme'), colorScheme: document.documentElement.style.colorScheme }))
      const shell = await page.evaluate(() => ({
        windowsTitlebar: document.documentElement.hasAttribute('data-windows-titlebar'),
        platform: document.documentElement.dataset.platform ?? null,
        titlebarHeight: getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-titlebar-height').trim(),
      }))
      // The restart check left an explicit dark theme; only "follow system" tracks the OS scheme.
      await page.locator('[data-modern-settings-seat]').getByRole('button').press('Enter')
      await page.getByRole('menuitem', { name: /^(设置|Settings)$/ }).press('Enter')
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^(通用设置|General)$/ }) })
      await dialog.getByRole('button', { name: /^(通用设置|General)$/ }).click()
      await dialog.getByRole('button', { name: /^(跟随系统|System)$/ }).click()
      await page.keyboard.press('Escape')
      const schemes = {}
      for (const value of ['dark', 'light']) {
        // A media-query change is delivered with the next frame, so keep frames coming while the theme follows.
        const stop = await keepPainting(page)
        await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
        await page
          .waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, value === 'dark', { polling: 100, timeout: 5000 })
          .catch(() => {})
        schemes[value] = await scheme()
        await stop()
        await capture(page, `shell-${value}`)
      }
      await session.send('Emulation.setEmulatedMedia', { features: [] })
      // Electron's CDP has no Browser window domain; a narrow viewport stands in for resizing the native window.
      await session.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 820, deviceScaleFactor: 0, mobile: false })
      await page.waitForTimeout(1200)
      const narrow = await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        composer: Boolean(document.querySelector('[data-composer-input="true"]')?.getClientRects().length),
      }))
      await capture(page, 'shell-narrow')
      await session.send('Emulation.clearDeviceMetricsOverride')
      return { shell, schemes, narrow }
    })
    const { shell, schemes, narrow } = seen.detail
    if (process.platform === 'win32') assert.ok(shell.windowsTitlebar && shell.titlebarHeight, 'Windows caption row is not marked')
    if (process.platform === 'darwin') assert.equal(shell.platform, 'darwin')
    assert.deepEqual(
      schemes,
      { dark: { dark: true, colorScheme: 'dark' }, light: { dark: false, colorScheme: 'light' } },
      'The page does not follow the OS color scheme',
    )
    assert.ok(narrow.composer && narrow.overflow <= 1, 'The narrow window overflows or hides the composer')
    return seen.detail
  })
  await step('removal and restart restore the official UI', async () => {
    await dsh('plugin-remove', ['plugin', '--profile', 'desktop', 'remove', modern])
    const seen = await visit('official')
    assert.equal(seen.modern, 0, 'Modern UI is still active after removal')
    return seen
  })
  await step('reinstall and restart bring Modern UI back', async () => {
    await dsh('plugin-readd', ['plugin', '--profile', 'desktop', 'add', '--save-exact', '--ignore-scripts', plugin])
    const seen = await visit('modern')
    assert.ok(seen.modern > 0, 'Modern UI marker is missing after reinstalling')
    return seen
  })
  await step('onboarding progress saved before Modern UI is re-inherited as skipped', async () => {
    // The official onboarding cannot finish while ui-chat is disabled; begun progress in the user layer would keep
    // its overlay open after sign-in. The Modern client re-inherits it from the bundle's skipped composition.
    const YAML = createRequire(path.join(repo, 'package.json'))('yaml')
    const filename = path.join(profile, 'cordis.patch.yml')
    const rows = (YAML.parse(await readFile(filename, 'utf8')) ?? []).filter(row => row?.id !== 'ui-settings-account')
    const begun = { version: 1, step: 'process', purpose: 'both', process: 'standard', completion: null, usage: 'compact', developerTools: false }
    await writeFile(filename, YAML.stringify([...rows, { id: 'ui-settings-account', config: begun }]))
    const seen = await visit('onboarding', async () => {
      for (let at = 0; at < 60; at++) {
        // Unsetting every field drops the emptied row, leaving the bundle's skipped composition in effect.
        const row = (YAML.parse(await readFile(filename, 'utf8')) ?? []).find(item => item?.id === 'ui-settings-account')
        if (!row || row.config?.step === 'done') return { userLayer: row?.config ?? null }
        await delay(500)
      }
      throw new Error('The begun onboarding progress was not re-inherited')
    })
    if (seen.detail.userLayer) assert.equal(seen.detail.userLayer.completion, 'skipped')
    return seen.detail
  })
} catch {
  failed = true
} finally {
  await application.stop()
}
report.desktop = application.version
report.state = failed ? 'failed' : 'passed'
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ state: report.state, report: path.join(output, 'report.json') }))
process.exitCode = failed ? 1 : 0
