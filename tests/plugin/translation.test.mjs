import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('../../packages/modern-ui/src/vendor/translation/client/translation.ts', import.meta.url), 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText,
  { module, exports: module.exports, AbortController })
const { ReasoningTranslation } = module.exports
const tick = () => new Promise(resolve => setImmediate(resolve))

test('reasoning translates completed fragments once, retries failure and preserves streaming tail', async () => {
  const states = [], calls = []
  let fail = false
  const translation = new ReasoningTranslation({ provider: 'bing', targetLanguage: 'en' }, 1000,
    async request => { calls.push(request.text); if (fail) throw new Error('local fixture failure'); return `Translated ${request.text}` }, state => states.push(state))
  translation.update('First\n\nTail', true)
  await tick()
  assert.equal(states.at(-1).text, 'Translated First\n\nTail')
  assert.deepEqual(calls, ['First'])
  fail = true
  translation.update('First\n\nTail', false)
  await tick()
  assert.equal(states.at(-1).failed, true)
  assert.equal(states.at(-1).text, 'Translated First\n\nTail')
  fail = false
  translation.retry()
  await tick()
  assert.equal(states.at(-1).text, 'Translated First\n\nTranslated Tail')
  assert.equal(states.at(-1).failed, false)
  assert.deepEqual(calls, ['First', 'Tail', 'Tail'])
  translation.update('First\n\nTail', false)
  await tick()
  assert.equal(calls.length, 3)
  translation.dispose()
})

test('collapsed reasoning cancels in-flight translation and ignores stale settlement', async () => {
  const states = []
  let finish, signal
  const translation = new ReasoningTranslation({ provider: 'bing', targetLanguage: 'en' }, 1000,
    (_request, cancellation) => { signal = cancellation; return new Promise(resolve => { finish = resolve }) }, state => states.push(state))
  translation.update('Original', false)
  translation.dispose()
  assert.equal(signal.aborted, true)
  const count = states.length
  finish('Stale translated text')
  await tick()
  assert.equal(states.length, count)
  const reopened = []
  const next = new ReasoningTranslation({ provider: 'bing', targetLanguage: 'en' }, 1000,
    async () => 'Reopened translation', state => reopened.push(state))
  next.update('Original', false)
  await tick()
  assert.equal(reopened.at(-1).text, 'Reopened translation')
  next.dispose()
})
