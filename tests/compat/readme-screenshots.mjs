/**
 * README screenshots from a real isolated consumer: the preview package on an official Host, a scripted model
 * (fixtures/demo-provider.mjs) and the official read/grep tools on a small demo workspace.
 *
 *   npm run build && node scripts/create-preview.mjs
 *   node tests/compat/readme-screenshots.mjs --root <empty dir outside the repo> [--host <version>] [--out docs/assets] [--browser <chromium>] [--keep]
 *   node tests/compat/readme-screenshots.mjs --state <consumer>/program/current.json   (reuse a kept consumer)
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { packFixture } from './pack-fixture.mjs'

const execute = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const options = { '--preview': path.join(repo, '.artifacts/plugin-preview'), '--out': path.join(repo, 'docs/assets') }
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index]
  if (key === '--keep') options[key] = true
  else if (['--root', '--state', '--host', '--out', '--browser', '--preview'].includes(key) && process.argv[index + 1]) options[key] = process.argv[++index]
  else throw new Error(`Invalid option: ${key}`)
}
assert.ok(options['--root'] || options['--state'], '--root names the directory for a new isolated consumer, --state a kept one')
const owned = { owner: 'modern-ui-compatibility-tests' }
const reused = Boolean(options['--state'])
const consumer = reused
  ? path.dirname(path.dirname(path.resolve(options['--state'])))
  : path.join(path.resolve(options['--root']), `screenshots-${randomUUID()}`)
const program = path.join(consumer, 'program')
await mkdir(consumer, { recursive: true })
const relative = path.relative(await realpath(repo), await realpath(consumer))
assert.ok(relative.startsWith('..') || path.isAbsolute(relative), 'The consumer must be outside the development repository')
const marker = { ...owned, program, home: path.join(consumer, 'home') }
if (reused)
  assert.deepEqual(JSON.parse(await readFile(path.join(consumer, '.compat-consumer.json'), 'utf8')), marker, '--state must name an owned test consumer')
else await installConsumer()
async function installConsumer() {
  const preview = path.resolve(options['--preview'])
  const catalog = JSON.parse(await readFile(path.join(preview, 'preview.json'), 'utf8'))
  const { defaultHostVersion } = await import(pathToFileURL(path.join(preview, 'installer/compatibility.mjs')).href)
  const { main } = await import(pathToFileURL(path.join(preview, 'installer/manager.mjs')).href)
  await writeFile(path.join(consumer, '.compat-consumer.json'), JSON.stringify(marker))
  await main([
    'install',
    '--root',
    program,
    '--home',
    path.join(consumer, 'home'),
    '--backend-version',
    options['--host'] ?? defaultHostVersion,
    '--node',
    process.execPath,
    '--plugin',
    path.join(preview, catalog.plugin.filename),
    '--plugin-integrity',
    catalog.plugin.integrity,
  ])
}
const state = JSON.parse(await readFile(path.join(program, 'current.json'), 'utf8'))

const demo = path.join(consumer, 'demo')
const workspace = path.join(demo, 'fetch-kit')
const fixture = path.join(demo, 'fixture', 'package')
const bin = path.join(demo, 'bin')
await rm(demo, { recursive: true, force: true })
await Promise.all([mkdir(path.join(workspace, 'src'), { recursive: true }), mkdir(fixture, { recursive: true }), mkdir(bin, { recursive: true })])
await writeFile(
  path.join(workspace, 'package.json'),
  `${JSON.stringify({ name: 'fetch-kit', version: '0.3.0', type: 'module', scripts: { test: 'vitest run' } }, null, 2)}\n`,
)
await writeFile(
  path.join(workspace, 'src/fetch-json.ts'),
  `export interface FetchJsonOptions {
  retries?: number
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
      return (await response.json()) as T
    } catch (error) {
      if (++attempt > (options.retries ?? 2)) throw error
      await new Promise(resolve => setTimeout(resolve, 200 * attempt))
    }
  }
}
`,
)
await writeFile(
  path.join(workspace, 'src/client.ts'),
  `import { fetchJson } from './fetch-json'

export const getUser = (id: string) => fetchJson<{ id: string; name: string }>(\`/api/users/\${id}\`)
export const getRepos = (user: string) => fetchJson<{ name: string }[]>(\`/api/users/\${user}/repos\`, { retries: 3 })
`,
)

const fixtureName = 'modern-readme-demo'
const provider = await readFile(path.join(here, 'fixtures/demo-provider.mjs'))
await writeFile(path.join(fixture, 'index.mjs'), provider)
// pnpm reuses a stored name@version, so an edited provider needs its own version to reach a kept consumer.
const fixtureVersion = `1.0.0-${createHash('sha256').update(provider).digest('hex').slice(0, 12)}`
await writeFile(
  path.join(fixture, 'package.json'),
  JSON.stringify({ name: fixtureName, version: fixtureVersion, type: 'module', main: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
)
await writeFile(path.join(fixture, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: fixtureName, name: fixtureName }] }]))
const tarball = path.join(demo, 'fixture.tgz')
await packFixture(fixture, tarball)

const environment = {
  ...process.env,
  DSH_HOME: state.home,
  DSH_TELEMETRY_DISABLED: '1',
  COMPAT_OFFICIAL_CLI: state.cli,
  DEMO_WORKSPACE: workspace,
  PATH: [bin, path.dirname(state.node), process.env.PATH ?? ''].join(path.delimiter),
  npm_config_update_notifier: 'false',
}
for (const key of Object.keys(environment)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|NODE_PATH|NODE_OPTIONS/i.test(key)) delete environment[key]
if (state.pnpm) {
  if (process.platform === 'win32') await writeFile(path.join(bin, 'pnpm.cmd'), `@echo off\r\n"${state.node}" "${state.pnpm}" %*\r\n`)
  else await writeFile(path.join(bin, 'pnpm'), `#!/bin/sh\nexec '${state.node}' '${state.pnpm}' "$@"\n`, { mode: 0o755 })
}
await execute(state.node, [state.cli, 'plugin', '--profile', state.profile, 'add', '--save-exact', '--ignore-scripts', tarball], {
  cwd: demo,
  env: environment,
  windowsHide: true,
  timeout: 180_000,
  maxBuffer: 8 * 1024 * 1024,
})
const overlay = path.join(demo, 'demo.patch.yml')
await writeFile(
  overlay,
  JSON.stringify([
    { id: 'schedule', disabled: true },
    { id: 'agent-default-model', config: { provider: 'demo-local-model', model: 'demo-reasoner' } },
    { id: 'workspace-controller', config: { documentsDirectory: path.join(demo, 'documents') } },
  ]),
)

const child = spawn(state.node, [state.cli, '--profile', state.profile, '--patch', overlay, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
  cwd: demo,
  env: environment,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Host startup timed out:\n${log.slice(-3000)}`)), 60_000)
  child.once('exit', code => reject(new Error(`Host exited ${code}:\n${log.slice(-3000)}`)))
  const collect = bytes => {
    log += bytes
    const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(log)
    if (match) {
      clearTimeout(timer)
      resolve(match[1])
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
})

const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright-core')
const executablePath =
  options['--browser'] ??
  process.env.MODERN_UI_BROWSER ??
  (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined)
const browser = await chromium.launch({ executablePath, headless: true })
const out = path.resolve(options['--out'])
let page
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: 'zh-CN', colorScheme: 'light' })
  page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(url)
  await page.waitForTimeout(1200)
  const welcome = page.getByRole('button', { name: /^(继续|Continue)$/ })
  if (await welcome.count()) await welcome.click()
  await page.getByRole('button', { name: /demo-reasoner/ }).waitFor()
  const input = page.locator('[data-composer-input="true"]')
  const conversation = async prompt => {
    await page.locator('button').filter({ hasText: '新会话' }).first().click()
    const workspaces = page.getByRole('button', { name: /^(默认工作区|Default workspace)$/ }).last()
    if (await workspaces.count()) {
      await workspaces.click()
      await page.getByRole('menuitem', { name: /fetch-kit/ }).click()
    }
    await input.waitFor()
    await page.waitForTimeout(500)
    // The landing view can remount right after a new session opens and drop what was typed; send until it clears.
    for (let at = 0; at < 5; at++) {
      if (!(await input.innerText()).trim()) await input.fill(prompt)
      await input.press('Enter')
      await page.waitForTimeout(1500)
      if (!(await input.innerText()).trim() && (await page.getByText(prompt).count())) return
    }
    throw new Error(`The prompt was not sent: ${prompt}`)
  }
  await conversation('介绍一下这个项目的结构')
  await page.getByText(/没有运行时依赖/).waitFor()
  await conversation('让 fetchJson 支持 AbortSignal 取消，重试等待时也要能立刻中断')
  await page.getByText(/行为不变/).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await mkdir(out, { recursive: true })
  // Light: the start of the Turn with its process open (reasoning and the official tool cards).
  const process = page.locator('[data-turn-process]').last()
  for (let at = 0; at < 10 && (await process.getAttribute('aria-expanded')) !== 'true'; at++) {
    if ((await process.getAttribute('aria-expanded')) === 'false') await process.click()
    await page.waitForTimeout(500)
  }
  const folded = page.locator('[data-process-activity][aria-expanded="false"]:visible')
  for (let at = 0; at < 6 && (await folded.count()); at++) {
    await folded.first().click()
    await page.waitForTimeout(300)
  }
  // Open the first thinking row so the reasoning text shows.
  await page
    .getByText(/^(思考|Thinking)$/)
    .first()
    .click()
  await page.waitForTimeout(300)
  await page.getByText('让 fetchJson 支持 AbortSignal', { exact: false }).last().scrollIntoViewIfNeeded()
  await page
    .getByText('让 fetchJson 支持 AbortSignal', { exact: false })
    .last()
    .evaluate(element => {
      element.scrollIntoView({ block: 'start' })
      let scroller = element.parentElement
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && getComputedStyle(scroller).overflowY !== 'visible'))
        scroller = scroller.parentElement
      if (scroller) scroller.scrollTop -= 72
    })
  await page.waitForTimeout(600)
  await page.mouse.move(0, 799)
  await page.screenshot({ path: path.join(out, 'screenshot-light.png') })
  // Dark: the end of the answer, with the table and the follow-up suggestions.
  await process.click()
  await page.waitForTimeout(400)
  await page.getByText(/行为不变/).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.emulateMedia({ colorScheme: 'dark' })
  const dark = () => page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme'))
  if (!(await dark())) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+Comma' : 'Control+Alt+Comma')
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^(通用设置|General)$/ }) })
    await dialog.getByRole('button', { name: /^(通用设置|General)$/ }).click()
    await dialog.getByRole('button', { name: /^(深色|Dark)$/ }).click()
    await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
    await page.keyboard.press('Escape')
  }
  await page.waitForTimeout(800)
  await page.getByText(/行为不变/).evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(400)
  await page.mouse.move(0, 799)
  await page.screenshot({ path: path.join(out, 'screenshot-dark.png') })
  console.log(JSON.stringify({ host: state.officialSource.version, plugin: state.plugin.version, out }))
} catch (error) {
  await page?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
  child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)])
  await writeFile(path.join(demo, 'host.log'), log.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'))
  if (!options['--keep'] && !reused) await rm(consumer, { recursive: true, force: true, maxRetries: 5 })
}
