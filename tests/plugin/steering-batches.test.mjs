import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const { JSDOM } = require('jsdom')
const ts = require('typescript')
const { Context } = require('@deepseek-ai/cordis')
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
const modules = new Map()
function browserRequire(id) {
  // The assembler does not render primitives; the Web Shell owns that static module.
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
  if (!id.startsWith('@deepseek-ai/dsh-client-ui-') || id === '@deepseek-ai/dsh-client-ui-slots') return require(id)
  if (modules.has(id)) return modules.get(id)
  let descriptor
  const window = dom.window
  window.__ModuleLoader__ = { load: value => { descriptor = value } }
  vm.runInNewContext(readFileSync(require.resolve(id + '/client'), 'utf8'),
    { window, document: window.document, navigator: window.navigator, console, setTimeout, clearTimeout, URL, URLSearchParams,
      TextEncoder, TextDecoder, AbortController, fetch })
  const value = descriptor.factory(browserRequire)
  modules.set(id, value)
  return value
}
const { ConversationNodeAssembler } = browserRequire('@deepseek-ai/dsh-client-ui-conversation')
const localModule = { exports: {} }
const code = ts.transpileModule(readFileSync(path.join(root, 'packages/modern-ui/src/steering-batches.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
vm.runInNewContext(code, { exports: localModule.exports, module: localModule,
  require: id => { assert.ok(id.endsWith('.css')); return {} } })
const { inboxDefinition, processDefinition, markerDefinition, steeringViewDefinition, installSteeringBatches } = localModule.exports
const ours = [inboxDefinition, processDefinition, markerDefinition]

function entry(seq, type, data, extra = {}) {
  return { type: type === 'assistant/live-chunk' ? 'transient' : 'event',
    event: { seq, type, time: 1700000000000 + seq, data, ...extra } }
}
const identity = (id, kind = 'user') => ({ id, source: { kind }, content: [{ type: 'text', text: id }] })
const enqueue = (seq, messages) => entry(seq, 'agent/inbox/spliced',
  { target: 'next-step', start: 0, inserted: messages })
const claim = (seq, count, extra = {}) => entry(seq, 'agent/inbox/spliced',
  { target: 'next-step', start: 0, removedCount: count, inserted: [], ...extra })
const human = (seq, id) => entry(seq, 'user/message', identity(id), { surfaceOp: 'append' })
const evidence = (seq, turn = 1, step = 1) => entry(seq, 'tool/call',
  { turn, step, call: { id: 'call-' + seq, name: 'read', arguments: '{}' } })
const start = (seq = 0, turn = 1, step = 1) => [
  entry(seq, 'turn/start', { turn }), entry(seq + 1, 'step/start', { turn, step }),
]
function fixture() {
  let latest
  const observer = {
    kind: 'fixture-message', target: 'fixture',
    match: event => event.type === 'user/message'
      ? { id: event.data.id, role: 'start', exclusive: true } : null,
    start: (_context, match) => match.event.data,
    update: context => context.state,
    buildViewNode: context => ({ key: context.key, id: context.id, kind: 'user', target: 'fixture', data: context.state }),
  }
  let definitions = [...ours, observer]
  const view = { target: 'fixture', create: () => ({
    empty: null,
    replace: input => { latest = input; return input },
    apply: input => { latest = input; return input },
  }) }
  const assembler = new ConversationNodeAssembler(
    { entries: () => definitions, fallbackEntry: () => undefined }, { entries: () => [view, steeringViewDefinition] })
  assembler.activateTarget('fixture')
  assembler.activateTarget('modern-steering')
  const snapshot = () => assembler.snapshot('modern-steering')
  const marker = id => snapshot()?.has(id) ? true : undefined
  return { assembler, marker, snapshot, latest: () => latest,
    remove: () => { definitions = [observer]; assembler.rebuildRegistry(); assembler.flush() } }
}
const sample = () => [...start(), evidence(2),
  enqueue(3, [identity('notice', 'notice'), identity('a'), identity('b')]), claim(4, 3),
  human(5, 'a'), human(6, 'b'),
  enqueue(7, [identity('c')]), claim(8, 1), human(9, 'c')]

test('official assembler publishes only the first human in each admitted batch without extra view nodes', () => {
  const f = fixture()
  f.assembler.replaceWindow(sample(), false)
  f.assembler.flush()
  assert.equal(f.marker('a'), true)
  assert.equal(f.marker('b'), undefined)
  assert.equal(f.marker('c'), true)
  assert.equal(f.latest().nodes.length, 3)
  assert.ok(ours.every(definition => definition.target === undefined || definition.target === 'modern-steering'))
  const stable = f.snapshot()
  f.assembler.append(entry(10, 'step/end', { turn: 1, step: 1 }))
  f.assembler.flush()
  assert.equal(f.snapshot(), stable)
})

test('history prepend reconstructs a missing claim; registry unload removes only our metadata', () => {
  const rows = sample()
  const f = fixture()
  f.assembler.replaceWindow(rows.slice(5), true)
  f.assembler.flush()
  assert.equal(f.marker('a'), undefined)
  f.assembler.prepend(rows.slice(0, 5), false)
  f.assembler.flush()
  assert.equal(f.marker('a'), true)
  f.remove()
  assert.equal(f.marker('a'), undefined)
  assert.equal(f.latest().nodes.length, 3)
})

test('reloading and historical prefixes derive their own batch boundaries', () => {
  for (const rows of [sample(), sample().slice(0, 7)]) {
    const f = fixture()
    f.assembler.replaceWindow(rows, false); f.assembler.flush()
    assert.equal(f.marker('a'), true)
    assert.equal(f.marker('b'), undefined)
    assert.equal(f.marker('c'), rows.length > 7 ? true : undefined)
  }
})

test('cancellation, reinserted messages and first-step input do not invent a separator', () => {
  const cases = [
    [...start(), evidence(2), enqueue(3, [identity('a')]), claim(4, 1, { outcome: 'canceled' }), human(5, 'a')],
    [...start(), evidence(2), enqueue(3, [identity('a')]), claim(4, 1), enqueue(5, [identity('a')]), human(6, 'a')],
    [...start(), enqueue(2, [identity('a')]), claim(3, 1), human(4, 'a')],
  ]
  for (const rows of cases) {
    const f = fixture(); f.assembler.replaceWindow(rows, false); f.assembler.flush()
    assert.equal(f.marker('a'), undefined)
  }
})

test('process evidence does not leak into another turn or come from transient/invisible content', () => {
  const invisible = [
    entry(2, 'assistant/live-chunk', { turn: 1, step: 1, attemptId: 'transient', chunk: { type: 'text-delta', index: 0, text: 'not durable' } }),
    entry(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '  ' }] } }, { surfaceOp: 'append' }),
    entry(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'tool-call', id: 'x', name: 'read', arguments: '{}' }] } }, { surfaceOp: 'append' }),
    entry(2, 'tool/result', { turn: 1, step: 1 }, { surfaceOp: 'replace' }),
  ]
  for (const row of invisible) {
    const f = fixture()
    f.assembler.replaceWindow([...start(), row, enqueue(3, [identity('a')]), claim(4, 1), human(5, 'a')], false)
    f.assembler.flush(); assert.equal(f.marker('a'), undefined)
  }
  const f = fixture()
  f.assembler.replaceWindow([...start(), evidence(2), entry(3, 'turn/end', { turn: 1 }),
    ...start(4, 2), enqueue(6, [identity('a')]), claim(7, 1), human(8, 'a')], false)
  f.assembler.flush(); assert.equal(f.marker('a', 2), undefined)
})

test('public registration is owned by the plugin lifecycle', async () => {
  const ctx = new Context()
  const registered = new Map()
  const register = (key, definition) => { registered.set(key, definition); return () => registered.delete(key) }
  ctx.provide('uiConversation', { events: { register: definition => register(definition.kind, definition) },
    views: { register: definition => register(definition.target, definition) } })
  const fiber = ctx.plugin({ apply: installSteeringBatches })
  await fiber.await()
  assert.equal(registered.size, 4)
  await fiber.dispose()
  assert.equal(registered.size, 0)
  await ctx.fiber.dispose()
})

