/**
 * The documented one-line path, with no private runtime and no installer: an official DSH from npm,
 * `dsh plugin --profile web add <plugin>`, a real browser sees Modern UI, and removing the plugin
 * returns the official UI.
 *
 * node tests/compat/npm-install.e2e.mjs --plugin <npm spec | local tgz> [--host <version>] [--root <dir>] [--browser <exe>]
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultHostVersion, runtimeVersions } from '../../scripts/distribution/compatibility.mjs'

const execute = promisify(execFile)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  if (!['--plugin', '--host', '--root', '--browser'].includes(key) || !process.argv[index + 1] || Object.hasOwn(options, key))
    throw new Error(`Invalid option: ${key}`)
  options[key] = process.argv[index + 1]
}
assert.ok(options['--plugin'], '--plugin is required (an npm spec such as @iroha1145/dsh-modern-ui@0.1.0, or a local tgz)')
const host = options['--host'] ?? defaultHostVersion
const plugin = existsSync(options['--plugin']) ? path.resolve(options['--plugin']) : options['--plugin']
const root = options['--root'] ? path.resolve(options['--root']) : await mkdtemp(path.join(tmpdir(), 'modern-npm-install-'))
await mkdir(root, { recursive: true })
const relative = path.relative(await realpath(repo), await realpath(root))
assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'The consumer must be outside the development repository')

// npm's CLI script beside this Node (official archives, nvm), under libexec (Homebrew), or the one running `npm run`.
const npm = [
  path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js'),
  path.join(path.dirname(process.execPath), '../libexec/lib/node_modules/npm/bin/npm-cli.js'),
  process.env.npm_execpath,
].find(file => file && path.basename(file) === 'npm-cli.js' && existsSync(file))
assert.ok(npm, `Cannot find npm-cli.js for ${process.execPath}`)
const official = path.join(root, 'official')
const home = path.join(root, 'home')
const output = path.join(root, 'evidence')
await Promise.all([mkdir(official, { recursive: true }), mkdir(home, { recursive: true }), mkdir(output, { recursive: true })])
const log = (name, result) => writeFile(path.join(output, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''))
const report = { host, plugin, platform: `${process.platform}-${process.arch}`, node: process.version, steps: [] }
const step = async (name, action) => {
  try {
    const detail = await action()
    report.steps.push({ name, state: 'passed', ...(detail === undefined ? {} : { detail }) })
    console.log(`passed ${name}`)
  } catch (error) {
    report.steps.push({ name, state: 'failed', reason: error.stack })
    throw error
  }
}

// The official CLI and the pnpm it forwards plugin commands to, exactly as a user would have them.
await writeFile(
  path.join(official, 'package.json'),
  JSON.stringify(
    {
      private: true,
      dependencies: {
        '@deepseek-ai/dsh': host,
        pnpm: runtimeVersions.pnpm,
      },
    },
    null,
    2,
  ) + '\n',
)
const bin = path.join(official, 'node_modules/.bin')
const cli = path.join(official, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const environment = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: '1',
  npm_config_update_notifier: 'false',
  PATH: [bin, path.dirname(process.execPath), process.env.PATH ?? ''].join(path.delimiter),
}
for (const key of Object.keys(environment)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|NODE_PATH|NODE_OPTIONS/i.test(key)) delete environment[key]
const dsh = async (name, args) => {
  const result = await execute(process.execPath, [cli, ...args], {
    cwd: root,
    env: environment,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  await log(name, result)
  return result.stdout
}

const startHost = async name => {
  const child = spawn(process.execPath, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let text = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Official CLI did not announce its Web origin')), 90_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Official CLI exited (${code}) before readiness: ${text.slice(-4000)}`))
    })
    const collect = chunk => {
      text += chunk
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(text)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
  })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill('SIGTERM')
      await Promise.race([exited, delay(5000)])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await exited
      }
    }
    await writeFile(path.join(output, `${name}.log`), text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  }
  return { url, stop }
}

const tooling = createRequire(
  process.env.COMPAT_TEST_DRIVER ? path.join(path.resolve(process.env.COMPAT_TEST_DRIVER), 'package.json') : path.join(repo, 'package.json'),
)
const executablePath =
  options['--browser'] ??
  process.env.MODERN_UI_BROWSER ??
  (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const { chromium } = tooling('playwright-core')
const browser = await chromium.launch({ executablePath, headless: true })
// Modern UI owns the settings seat in its sidebar; both UIs render the composer.
const modernMarker = '[data-modern-settings-seat]'
const composer = '[data-composer-input="true"]'
const visit = async (name, url) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.locator(composer).first().waitFor({ state: 'attached', timeout: 60_000 })
  await delay(1000)
  const modern = await page.locator(modernMarker).count()
  await page.screenshot({ path: path.join(output, `${name}.png`) })
  await page.close()
  return { modern, errors }
}

let failed = false
try {
  await step('install official CLI from npm', async () => {
    const result = await execute(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: official,
      env: environment,
      windowsHide: true,
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    await log('official-install', result)
    return { version: (await dsh('version', ['--version'])).trim() }
  })
  // A bare `plugin add` on an unknown profile initializes only the base bundle; a user who has
  // started `dsh web` once already has the shipped web profile, which this materializes.
  await step('materialize the shipped web profile', () => dsh('web-profile', ['--profile', 'web', '--dump-config']))
  await step('dsh plugin add', () => dsh('plugin-add', ['plugin', '--profile', 'web', 'add', '--ignore-scripts', plugin]))
  await step('browser sees Modern UI', async () => {
    const running = await startHost('host-modern')
    try {
      const seen = await visit('modern', running.url)
      assert.ok(seen.modern > 0, 'Modern UI marker is missing after dsh plugin add')
      assert.deepEqual(seen.errors, [])
      return seen
    } finally {
      await running.stop()
    }
  })
  await step('dsh plugin remove', () => dsh('plugin-remove', ['plugin', '--profile', 'web', 'remove', '@iroha1145/dsh-modern-ui']))
  await step('browser sees the official UI again', async () => {
    const running = await startHost('host-official')
    try {
      const seen = await visit('official', running.url)
      assert.equal(seen.modern, 0, 'Modern UI is still active after removal')
      return seen
    } finally {
      await running.stop()
    }
  })
} catch (error) {
  failed = true
  console.error(error.stack ?? error)
} finally {
  await browser.close()
  report.state = failed ? 'failed' : 'passed'
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ state: report.state, evidence: output }))
  process.exitCode = failed ? 1 : 0
}
