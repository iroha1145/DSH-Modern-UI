// Experiment: does the OFFICIAL rc.4 Models row editor keep `reasoningEfforts` on catalog-route
// model rows it shows no control for, when it saves the whole `models` list?
// Runs against an installed generation (MODERN_UI_INSTALLED_STATE) exactly like owners.e2e.
import assert from 'node:assert/strict'
import { fixtureEnvironment as makeFixtureEnvironment, openSettings, browserExecutable } from '/Users/admin/Downloads/Claude/DSH-UI/tests/plugin/fixtures/e2e-environment.mjs'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = '/Users/admin/Downloads/Claude/DSH-UI'
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('playwright-core')
const artifacts = path.join(root, '.artifacts/reasoning-probe')
await mkdir(artifacts, { recursive: true })
const run = await mkdtemp(path.join(artifacts, 'run-'))
const workspace = path.join(run, 'm1-fixture-workspace')
await mkdir(workspace)
const sourceInstalled = JSON.parse(await readFile(process.env.MODERN_UI_INSTALLED_STATE, 'utf8'))
// Own isolation: fresh official web profile + the generation's plugin archive, no community bundles
// (the shared fixture insists on file: community archives, which this machine's live profile lacks).
const home = path.join(run, 'home')
const profile = 'modern-ui-probe'
await mkdir(home, { recursive: true })
const { runtimeEnvironment } = await import(pathToFileURL(sourceInstalled.manager).href)
const fixtureEnvironment = makeFixtureEnvironment(home, { ...runtimeEnvironment(sourceInstalled),
  npm_config_store_dir: path.join(run, 'store'), npm_config_cache: path.join(run, 'npm-cache') })
const nodeExecutable = sourceInstalled.node
const official = sourceInstalled.cli
const dsh = args => {
  const result = spawnSync(nodeExecutable, [official, ...args], { cwd: run, env: fixtureEnvironment, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, `dsh ${args.join(' ')} failed: ${result.stderr}\n${result.stdout.slice(-3000)}`)
  return result.stdout
}
dsh([profile, '--from-default-profile', 'web', '--dump-config'])
dsh(['plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts', path.join(sourceInstalled.generation, 'modern-ui.tgz')])
const directory = path.join(home, 'profiles', profile)
const plugin = path.join(directory, 'node_modules', sourceInstalled.plugin.name, 'lib/index.js')
const isolation = { verifySource: async () => {} }
const hostRequire = createRequire(official)
const yaml = createRequire(hostRequire.resolve('@deepseek-ai/dsh-app-boot'))('js-yaml')
const schema = yaml.JSON_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expression: value }) })])
const dumpConfig = (extra = []) => {
  const dump = spawnSync(nodeExecutable, [official, '--profile', profile, ...extra, '--dump-config'], { cwd: run, env: fixtureEnvironment, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(dump.status, 0, dump.stderr)
  return yaml.load(dump.stdout, { schema })
}
const { bindHostCompatibility } = await import(pathToFileURL(path.join(path.dirname(sourceInstalled.manager), 'profile-settings.mjs')).href)
await bindHostCompatibility(directory, dsh([profile, '--dump-config']), yaml)
const entries = dumpConfig()
const piAi = entries.find(entry => entry.name === '@deepseek-ai/dsh-llm-pi-ai')
assert.ok(piAi, 'pi-ai entry present')
console.log('pi-ai entry id', piAi.id, 'config', JSON.stringify(piAi.config ?? null))
const translatorNames = ['@iroha1145/dsh-modern-ui/translator', '@deepseek-ai/dsh-experimental-translator']
const existingTranslator = entries.find(entry => translatorNames.includes(entry.name) && entry.disabled !== true)?.id

// Seed the USER layer (the profile's own cordis.patch.yml, which the official config editor edits).
const patchPath = path.join(home, 'profiles', profile, 'cordis.patch.yml')
let patchText = ''
try { patchText = await readFile(patchPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
const existing = yaml.load(patchText, { schema })
const row = `- id: ${JSON.stringify(piAi.id)}
  config:
    providers:
      openai:
        apiKeyEnv: OPENAI_API_KEY
        models:
          - id: probe-newer-model
            reasoningEfforts:
              'off': null
              low: low
              high: high
          - id: gpt-4.1
            reasoningEfforts: false
`
if (Array.isArray(existing) && existing.length > 0 && /^\s*- /m.test(patchText)) await writeFile(patchPath, patchText.replace(/\s*$/, '\n') + row)
else await writeFile(patchPath, row)
const seededDump = dumpConfig().find(entry => entry.id === piAi.id)
console.log('seeded pi-ai providers', JSON.stringify(seededDump.config.providers))
assert.ok(seededDump.config.providers?.openai?.models?.length === 2, 'seed reached the composed config')

const overlay = path.join(run, 'fixture.patch.yml')
const quote = value => JSON.stringify(value.replaceAll('\\', '/'))
await writeFile(overlay, `- id: workspace-controller
  config:
    documentsDirectory: ${quote(path.join(run, 'documents'))}
- id: agent-default-model
  config:
    provider: modern-ui-fixture
    model: mock-balanced
- insert:
    - id: modern-ui-fixture
      name: ${JSON.stringify(pathToFileURL(path.join(root, 'tests/plugin/fixtures/mock-host.mjs')).href)}
${existingTranslator ? '' : `    - id: translator\n      name: ${JSON.stringify(pathToFileURL(path.join(path.dirname(plugin), 'translator.js')).href)}\n`}`)

let child, serverErrors = ''
async function bootHost() {
  child = spawn(nodeExecutable, [official, '--profile', profile, '--patch', overlay, '--port', '0', '--no-open'], {
    cwd: run, env: { ...fixtureEnvironment, MODERN_UI_OFFICIAL_CLI: official, MODERN_UI_BROWSER_WORKSPACE: workspace, MODERN_UI_INSTALLED_PLUGIN: plugin }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
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
async function stopHost() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGINT')
  await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000) })
}
const url = await bootHost()
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().split('\n')[0]) })
let step = 0
async function snap(name) {
  step += 1
  const file = `${String(step).padStart(2, '0')}-${name}`
  await page.screenshot({ path: path.join(run, `${file}.png`), fullPage: true })
  const dialog = page.getByRole('dialog').last()
  const info = {
    text: (await dialog.count()) ? await dialog.innerText() : await page.locator('body').innerText(),
    buttons: await page.locator('button').evaluateAll(list => list.map(b => ({ label: b.getAttribute('aria-label') ?? b.textContent?.trim(), disabled: b.disabled }))),
    inputs: await page.locator('input, select').evaluateAll(list => list.map(i => ({ tag: i.tagName, type: i.type, label: i.getAttribute('aria-label'), placeholder: i.placeholder, value: i.value }))),
  }
  await writeFile(path.join(run, `${file}.json`), JSON.stringify(info, null, 2))
  return info
}
try {
  await page.goto(url)
  const accept = page.getByRole('button', { name: '继续', exact: true })
  await page.waitForTimeout(800)
  if (await accept.isVisible()) { try { await accept.click({ timeout: 10000 }) } catch (error) { if (await accept.count()) throw error } }
  await page.getByRole('button', { name: /mock-balanced/ }).waitFor()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForTimeout(800)
  await openSettings(page)
  const settings = page.getByRole('dialog')
  await snap('settings-open')
  const modelsNav = settings.getByRole('button', { name: /^模型$|^Models$/ }).first()
  await modelsNav.click()
  await page.waitForTimeout(800)
  await snap('models-section')
  const editButton = settings.getByRole('button', { name: '编辑 openai', exact: true })
  await editButton.waitFor()
  const addModel = settings.getByRole('button', { name: '添加模型', exact: true })
  const advanced = settings.getByText('自定义设置', { exact: true }).last()
  for (let attempt = 0; attempt < 3 && !(await advanced.isVisible()); attempt++) {
    await editButton.click()
    await page.waitForTimeout(1000)
  }
  await advanced.click()
  await page.waitForTimeout(500)
  await addModel.waitFor()
  const before = await snap('editor-open')
  const inputsBefore = new Set(before.inputs.map(input => JSON.stringify(input)))
  // Make a real change: add one model row, so pathOps emits a `set models` op.
  await addModel.click()
  await page.waitForTimeout(400)
  const added = await snap('row-added')
  const fresh = added.inputs.filter(input => !inputsBefore.has(JSON.stringify(input)) && input.type === 'text')
  console.log('new inputs after add', JSON.stringify(fresh))
  const idLabel = fresh[0]?.label
  const idInput = idLabel ? settings.locator(`input[aria-label="${idLabel}"]`).last() : settings.locator('input[type="text"]').last()
  await idInput.fill('probe-added-model')
  await page.waitForTimeout(200)
  await snap('row-filled')
  const apply = settings.getByRole('button', { name: /^保存$|^应用$|^Save$|^Apply$/ }).last()
  await apply.click()
  await page.waitForTimeout(2000)
  await snap('after-apply')
  const keyInput = settings.locator('input[type="password"]').last()
  if (await settings.getByText('自定义设置', { exact: true }).count() && await keyInput.count()) {
    // The editor is still open: the write needed a key; type a local test key and save again.
    await keyInput.fill('sk-probe-local-test-key')
    await apply.click()
    await page.waitForTimeout(2000)
    await snap('after-apply-with-key')
  }
} catch (error) {
  await snap('failure')
  console.error('PROBE FAILURE', error.stack)
} finally {
  await browser.close()
  await stopHost()
}
const afterText = await readFile(patchPath, 'utf8')
const after = dumpConfig().find(entry => entry.id === piAi.id)
const result = { run, errors, patchYaml: afterText, openai: after.config.providers?.openai }
await writeFile(path.join(run, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await isolation.verifySource()
