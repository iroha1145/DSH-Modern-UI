import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserExecutable } from './fixtures/e2e-environment.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('playwright-core')
const executable = browserExecutable() ?? chromium.executablePath()
if (process.env.MODERN_UI_BROWSER) assert.ok(existsSync(executable), `Configured keyboard-test browser does not exist: ${executable}`)
const skip = !existsSync(executable) ? 'Set MODERN_UI_BROWSER to run native question keyboard activation' : false
let browser, server, origin, artifactDirectory

before(async () => {
  if (skip) return
  const artifacts = path.join(process.env.MODERN_UI_E2E_ARTIFACTS ?? path.join(root, '.artifacts'), 'question-flow-keyboard-tests')
  await mkdir(artifacts, { recursive: true })
  artifactDirectory = await mkdtemp(path.join(artifacts, 'run-'))
  const source = require('esbuild').buildSync({
    absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import * as React from 'react'
      import * as ReactDOM from 'react-dom'
      import * as ReactDOMClient from 'react-dom/client'
      import * as JSX from 'react/jsx-runtime'
      import * as Cordis from '@deepseek-ai/cordis'
      import * as Stores from '@deepseek-ai/dsh-client-store'
      import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
      import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
      import { installPresentationParity } from './packages/modern-ui/src/presentation-parity.ts'
      async function start() {
        const runtime = new Map([
          ['react', React], ['react-dom', ReactDOM], ['react-dom/client', ReactDOMClient], ['react/jsx-runtime', JSX],
          ['@deepseek-ai/cordis', Cordis], ['@deepseek-ai/dsh-client-store', Stores],
          ['@deepseek-ai/dsh-client-ui-slots', Slots], ['@deepseek-ai/dsh-client-ui-primitives', Primitives],
        ])
        const load = id => {
          const descriptor = window.fixtureDescriptors.get(id)
          if (!descriptor) throw new Error('Missing official descriptor: ' + id)
          return descriptor.factory(name => {
            if (!runtime.has(name)) throw new Error('Undeclared runtime: ' + name)
            return runtime.get(name)
          })
        }
        const ctx = new Cordis.Context()
        await ctx.plugin(load('@deepseek-ai/dsh-client-ui-renderer')).await()
        const sessionId = 'keyboard-session'
        let sessionContext
        await ctx.plugin({ apply(scope) { sessionContext = scope.extend({ fixtureSession: sessionId }) } }).await()
        const pending = Stores.createSnapshotStore(undefined)
        const userQuestions = Stores.createSnapshotStore({ active: [] })
        const inbox = Stores.createSnapshotStore({})
        const session = { projections: { faceOf: key => key === 'userQuestions' ? userQuestions : inbox }, getSnapshot: () => ({ blank: false }) }
        const binding = { sessionId, session, ctx: sessionContext }
        const sessions = {
          list: Stores.createSnapshotStore({ byId: { [sessionId]: { id: sessionId, blank: false, retainedBy: {} } } }),
          binding: id => id === sessionId ? binding : undefined,
          scopeOf: scope => scope.fixtureSession, retainInfo: () => Stores.createSnapshotStore({ retainedBy: {} }),
        }
        const dictionaries = new Map(), localeRevision = Stores.createSnapshotStore({ revision: 0 })
        const common = { submit: 'Submit', submitting: 'Submitting…', copy: 'Copy', copied: 'Copied',
          'codeBlock.title': 'Code', 'codeBlock.wrap': 'Wrap', 'codeBlock.unwrap': 'Unwrap' }
        const locale = {
          register(ns, words) { dictionaries.set(ns, words); localeRevision.set({ revision: localeRevision.getSnapshot().revision + 1 }); return () => dictionaries.delete(ns) },
          bind: ns => (key, parameters) => Object.entries(parameters ?? {}).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)),
            dictionaries.get(ns)?.en?.[key] ?? common[key] ?? key),
        }
        const answers = []
        const remote = { $on: () => () => {}, userQuestions: { answer: async (id, callId, answer) => {
          answers.push(structuredClone({ sessionId: id, callId, answer })); return { ok: true, value: true }
        } } }
        const standard = Stores.createSnapshotStore({ key: sessionId, ctx: sessionContext, hooks: {}, keyedHooks: {}, props: { sessionId, locked: false } })
        await ctx.plugin({ inject: ['slots'], apply(scope) {
          scope.provide('sessions', sessions); scope.provide('locale', locale)
          scope.provide('remote', remote); scope.provide('remote.userQuestions', remote.userQuestions)
          scope.provide('uiSession', { registerPendingInteraction: () => carrier => {
            pending.set(carrier); return () => { if (pending.getSnapshot() === carrier) pending.set(undefined) }
          } })
          scope.provide('uiConversation', { events: { register: () => () => {} } })
          scope.slots.installLocale({ ...localeRevision, bind: locale.bind })
          scope.slots.installScope('session', { current: standard, bindingSource: () => standard, renderArea: (_binding, { children }) => children })
          scope.slots.provideRoot({ hooks: { fixturePending: pending } })
          scope.slots.register({ name: 'root', children: {
            'conversation.composer': { kind: 'chain', scope: 'session' }, 'conversation.chat.node': { kind: 'keyed', scope: 'session' },
          } }, ({ renderSlotChain, useFixturePending }) => {
            const interaction = useFixturePending(value => value)
            return interaction === undefined ? null : renderSlotChain('conversation.composer', { pendingInteraction: interaction })
          })
        } }).await()
        await ctx.plugin(load('@deepseek-ai/dsh-client-ui-user-questions')).await()
        await ctx.plugin({ name: 'question-keyboard-presentation', inject: ['slots', 'locale'], apply: installPresentationParity }).await()
        const original = ctx.slots.entries('conversation.composer').find(entry => (entry.options.priority ?? 0) === 0)
        const modern = ctx.slots.entries('conversation.composer').find(entry => entry.options.priority === -100)
        const stop = ctx.uiRenderer.mount(document.getElementById('app'))
        window.questionFixture = {
          sharedOfficialStore: modern.store === original.store,
          sharedOfficialCard() {
            const key = pending.getSnapshot()?.key
            const source = key === undefined ? undefined : original.inject().keyedHooks.questionCard(key)
            return source !== undefined && modern.inject().keyedHooks.questionCard(key) === source
          },
          open(questions) { userQuestions.set({ active: [{ callId: 'keyboard-call', state: 'continued', questions }] }) },
          answers: () => structuredClone(answers),
          async dispose() { stop(); await ctx.fiber.dispose() },
        }
      }
      start().catch(error => { window.questionFixtureError = error.stack; console.error(error) })
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@iroha1145/dsh-modern-ui/primitives': path.join(root, 'packages/modern-ui/src/vendor/primitives/index.ts') },
    loader: { '.module.css': 'empty', '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text
  const files = new Map([
    ['/harness.js', source],
    ['/renderer.js', readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8')],
    ['/questions.js', readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-user-questions/client'), 'utf8')],
  ])
  server = createServer((request, response) => {
    const script = files.get(request.url)
    response.writeHead(200, { 'content-type': script === undefined ? 'text/html' : 'text/javascript' })
    response.end(script ?? '<!doctype html><html><body><div id="app"></div><script>window.fixtureDescriptors=new Map();window.__ModuleLoader__={load:d=>window.fixtureDescriptors.set(d.id,d)}</script><script src="/renderer.js"></script><script src="/questions.js"></script><script src="/harness.js"></script></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  browser = await chromium.launch({ executablePath: executable, headless: true })
})

after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
})

const single = recommended => [{ id: 'choice', question: 'Choose a mode', options: [
  { label: recommended ? 'Keep (Recommended)' : 'Keep' }, { label: 'Change' },
] }]
const expected = answers => [{ sessionId: 'keyboard-session', callId: 'keyboard-call', answer: { answers } }]

async function answerFlow(t, name, questions, steps, activation) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  try {
    await page.goto(origin)
    await page.waitForFunction(() => window.questionFixture || window.questionFixtureError)
    assert.equal(await page.evaluate(() => window.questionFixtureError), undefined)
    await page.evaluate(questions => window.questionFixture.open(questions), questions)
    await page.getByRole(steps[0][0], { name: steps[0][1], exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => ({ store: window.questionFixture.sharedOfficialStore, card: window.questionFixture.sharedOfficialCard() })), { store: true, card: true })
    for (const [role, label, input = activation] of steps) {
      const option = page.getByRole(role, { name: label, exact: true })
      if (input === 'click') await option.click()
      else { await option.focus(); await option.press(input) }
    }
    const submit = page.getByRole('button', { name: 'Submit', exact: true })
    const beforeSubmit = await page.evaluate(() => window.questionFixture.answers())
    if (await submit.count() && await submit.isEnabled()) {
      await submit.click()
      await page.waitForFunction(() => window.questionFixture.answers().length > 0)
    }
    const result = { activation, beforeSubmit, answers: await page.evaluate(() => window.questionFixture.answers()), errors,
      feedback: await page.locator('[role="status"]').allTextContents() }
    await writeFile(path.join(artifactDirectory, name + '-' + activation + '.json'), JSON.stringify(result, null, 2))
    assert.deepEqual(errors, [])
    t.diagnostic(name + ' ' + activation + ': ' + JSON.stringify(result))
    return result
  } finally {
    await page.evaluate(() => window.questionFixture?.dispose()).catch(() => {})
    await page.close()
  }
}

for (const recommended of [true, false]) {
  test('focused option Enter matches click payload ' + (recommended ? 'with recommended default' : 'without preselection'), { skip }, async t => {
    const label = recommended ? 'recommended' : 'unselected'
    const clicked = await answerFlow(t, label, single(recommended), [['radio', 'Change']], 'click')
    const keyed = await answerFlow(t, label, single(recommended), [['radio', 'Change']], 'Enter')
    const payload = expected([{ id: 'choice', selected: ['Change'] }])
    assert.deepEqual(clicked.answers, payload)
    assert.deepEqual(keyed.answers, payload)
    assert.deepEqual(keyed.beforeSubmit, clicked.beforeSubmit, 'option activation selects a draft; Submit owns submission')
  })
}

test('multi-select Enter toggles the focused option and submits all current choices like click', { skip }, async t => {
  const questions = [{ ...single(false)[0], multiSelect: true }]
  const steps = [['checkbox', 'Keep', 'click'], ['checkbox', 'Change']]
  const clicked = await answerFlow(t, 'multi-select', questions, steps, 'click')
  const keyed = await answerFlow(t, 'multi-select', questions, steps, 'Enter')
  const payload = expected([{ id: 'choice', selected: ['Keep', 'Change'] }])
  assert.deepEqual(clicked.answers, payload)
  assert.deepEqual(keyed.answers, payload)
  assert.deepEqual(keyed.beforeSubmit, [], 'checkbox Enter does not prematurely submit the batch')
})

test('Enter on a checked multi-select option removes it from the eventual answer like click', { skip }, async t => {
  const questions = [{ ...single(false)[0], multiSelect: true }]
  const steps = [['checkbox', 'Keep', 'click'], ['checkbox', 'Change', 'click'], ['checkbox', 'Keep']]
  const clicked = await answerFlow(t, 'multi-select-remove', questions, steps, 'click')
  const keyed = await answerFlow(t, 'multi-select-remove', questions, steps, 'Enter')
  const payload = expected([{ id: 'choice', selected: ['Change'] }])
  assert.deepEqual(clicked.answers, payload)
  assert.deepEqual(keyed.answers, payload)
  assert.deepEqual(keyed.beforeSubmit, [], 'removing a choice does not submit the previous selection')
})

test('option Enter across question navigation retains the newly chosen labels in the final answer', { skip }, async t => {
  const questions = [...single(true), { id: 'finish', question: 'Choose the final action', options: [{ label: 'Run' }, { label: 'Stop' }] }]
  const steps = [['radio', 'Change'], ['radio', 'Run', 'click']]
  const clicked = await answerFlow(t, 'question-navigation', questions, steps, 'click')
  const keyed = await answerFlow(t, 'question-navigation', questions, steps, 'Enter')
  const payload = expected([{ id: 'choice', selected: ['Change'] }, { id: 'finish', selected: ['Run'] }])
  assert.deepEqual(clicked.answers, payload)
  assert.deepEqual(keyed.answers, payload)
})
