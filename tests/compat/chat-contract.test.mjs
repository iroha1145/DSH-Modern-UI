import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const development = createRequire(path.join(root, 'package.json'))
const ts = development('typescript')
const { buildSync } = development('esbuild')
assert.ok(process.env.COMPAT_BACKEND_PACKAGE, 'Set COMPAT_BACKEND_PACKAGE to an independently installed official DSH package.json')
const backendPackage = realpathSync(process.env.COMPAT_BACKEND_PACKAGE)
const consumer = createRequire(backendPackage)
const version = JSON.parse(readFileSync(backendPackage)).version
const chatPackage = realpathSync(consumer.resolve('@deepseek-ai/dsh-client-ui-chat/package.json'))
assert.equal(JSON.parse(readFileSync(chatPackage)).version, version)
const chatRoot = path.dirname(chatPackage)
const official = readFileSync(consumer.resolve('@deepseek-ai/dsh-client-ui-chat/client'), 'utf8')

function declarations(file, name) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === name)
  assert.ok(declaration, `${name} must be published by ${version}`)
  return declaration.members.map(member => member.name.getText(source))
}

function region(name) {
  const marker = '//#region lib/types/client/' + name + '.js'
  const start = official.indexOf(marker)
  assert.ok(start >= 0, `Missing published runtime region ${name}`)
  const end = official.indexOf('//#endregion', start)
  assert.ok(end > start)
  return official.slice(start, end)
}
// Execute the exact published pure projector and its helpers, with no replacement Host API or rc4 dependency fallback.
const OfficialProjector = new Function([
  region('contract/group-tree'), region('contract/chat-visibility'), region('conversation-nodes/turn-process-presentation'),
  'return ChatTurnProcessProjector',
].join('\n'))()

const copyFile = path.join(root, 'packages/modern-ui/src/vendor/chat/client/chat/TurnTailNodeView.tsx')
const copySource = ts.createSourceFile(copyFile, readFileSync(copyFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const copyFunction = copySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'answerText')
assert.ok(copyFunction)
const compiled = buildSync({
  absWorkingDir: root,
  stdin: { loader: 'ts', resolveDir: root, contents: `
    export { ChatTurnProcessProjector } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process-presentation.ts';
    export { turnProcessDefinition } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process.ts';
    export { turnNavigationItem } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-navigation.ts';
    import { isAnswerStep } from './packages/modern-ui/src/vendor/chat/client/contract/turn-process.ts';
    import { assistantText } from './packages/modern-ui/src/vendor/chat/client/chat/turn-assistant.ts';
    ${copyFunction.getText(copySource)}
    export { answerText, isAnswerStep };
  ` },
  bundle: true, write: false, format: 'cjs', platform: 'node', metafile: true,
})
assert.deepEqual(Object.values(compiled.metafile.outputs).flatMap(output => output.imports), [], 'pure projections must not borrow any shared runtime from the repository')
const module = { exports: {} }
new Function('module', 'exports', compiled.outputFiles[0].text)(module, module.exports)
const { ChatTurnProcessProjector, turnProcessDefinition, turnNavigationItem, answerText, isAnswerStep } = module.exports

function fixture({ inputAt, answer = true } = {}) {
  const spec = { turn: 1, controlAnchorSeq: 3, processStartSeq: 0, answerAnchorSeq: answer ? 10 : null,
    answerStep: answer ? 1 : null, inlineReasoning: false, messageCount: 0, toolCallCount: 1, subagentCount: 0 }
  const turn = { turn: 1, status: 'closed', start: { seq: 0 }, steps: [], data: { get: () => spec } }
  const location = { kind: 'turn', turn }
  const values = [
    { key: 'input', kind: 'user', anchorSeq: 1, groupTree: 'input', data: { content: [{ type: 'text', text: 'Prompt' }] } },
    { key: 'control', kind: 'turn-process', anchorSeq: 3.5, groupTree: 'turn', data: spec },
    { key: 'first', kind: 'assistant-step', anchorSeq: 10, data: { step: 1, blocks: [{ kind: 'text', text: 'First answer' }] } },
    { key: 'tool', kind: 'tool-call', anchorSeq: 12, data: {} },
    { key: 'later', kind: 'assistant-step', anchorSeq: 20, data: { step: 3, blocks: [{ kind: 'text', text: 'Later answer' }] } },
    ...inputAt === undefined ? [] : [{ key: 'steering', kind: 'steering', anchorSeq: inputAt, groupTree: 'input', data: {} }],
  ].map(node => ({ target: 'chat', id: node.key, visibility: 'visible', location, ...node }))
  const byKey = new Map(values.map(node => [node.key, node]))
  const nodes = { get: key => byKey.get(key) }
  const locations = { getTurn: () => [...byKey.keys()] }
  return { spec, turn, byKey, nodes, locations, order: [...byKey.keys()], control: byKey.get('control') }
}

test('published compactAnswer contract is present and follows the actual selected Host projector', () => {
  const keys = declarations(path.join(chatRoot, 'lib/types/client/contract/snapshot.d.ts'), 'ChatTurnProcessPresentation')
  assert.ok(keys.includes('compactAnswer'))
  assert.ok(!keys.includes('hasNonReplyProcess'))
  console.info(JSON.stringify({ version, backendPackage, chatPackage, publishedClientSha256: createHash('sha256').update(official).digest('hex'), fields: keys }))
  for (const input of [{}, { inputAt: 5 }, { inputAt: 15 }, { inputAt: 5, answer: false }]) {
    const f = fixture(input)
    const modern = new ChatTurnProcessProjector(), host = new OfficialProjector()
    modern.replace(f.order, f.locations, f.nodes); host.replace(f.order, f.locations, f.nodes)
    const actual = modern.get(f.control), expected = host.get(f.control)
    for (const key of keys) assert.ok(Object.hasOwn(actual, key), 'Missing public process field ' + key)
    assert.equal(actual.compactAnswer, expected.compactAnswer)
    assert.equal(actual.hasInterleavedInput, expected.hasInterleavedInput)
    assert.equal(typeof actual.hasNonReplyProcess, 'boolean', 'Modern always publishes its optional extension')
  }
})

test('a compactAnswer-only change publishes a new presentation; unchanged updates retain identity', () => {
  const f = fixture({ inputAt: 5 })
  const projector = new ChatTurnProcessProjector()
  projector.replace(f.order, f.locations, f.nodes)
  const before = projector.get(f.control)
  assert.equal(before.compactAnswer, false)
  f.byKey.set('steering', { ...f.byKey.get('steering'), anchorSeq: 15 })
  assert.deepEqual([...projector.update(new Set([1]), f.locations, f.nodes)], [1])
  const after = projector.get(f.control)
  assert.notEqual(after, before)
  assert.equal(after.hasInterleavedInput, true)
  assert.equal(after.compactAnswer, true)
  assert.equal(after.spec, before.spec)
  assert.equal(projector.update(new Set([1]), f.locations, f.nodes).size, 0)
  assert.equal(projector.get(f.control), after)
  f.byKey.delete('control')
  assert.deepEqual([...projector.update(new Set([1]), f.locations, f.nodes)], [1])
  assert.equal(projector.get(f.control), undefined)
})

test('earliest closing reply remains the answer, later answers stay copyable/navigable and later tools remain process', () => {
  const f = fixture()
  const assistants = [
    { step: 1, blocks: [{ kind: 'text', text: 'First answer' }], finalNode: { seq: 10 } },
    { step: 2, blocks: [{ kind: 'text', text: 'Tool progress' }, { kind: 'tool-call', name: 'read_file' }], finalNode: { seq: 15 } },
    { step: 3, blocks: [{ kind: 'text', text: 'Later answer' }], finalNode: { seq: 20 } },
  ]
  f.turn.steps = assistants.map(data => ({ step: data.step, status: 'closed', data: { get: () => data } }))
  const context = { state: { turn: 1, controlAnchorSeq: 3, assistantStartByStep: new Map([[1, 4], [2, 11], [3, 16]]),
    messageCountByStep: new Map([[1, 1], [2, 1], [3, 1]]), messageCount: 3, toolCallCount: 1, subagentCount: 0 },
  start: { location: { kind: 'turn', turn: f.turn } }, matches: [], current: new Map() }
  const result = turnProcessDefinition.buildLocationData(context, 'turn', undefined)
  assert.equal(result.value.answerStep, 1)
  assert.equal(result.value.answerAnchorSeq, 10)
  assert.equal(result.value.messageCount, 1)
  assert.deepEqual(assistants.map(data => isAnswerStep(result.value, data)), [true, false, true])
  assert.equal(answerText(f.turn, assistants[2]), 'First answer\n\nLater answer')
  assert.equal(turnNavigationItem(1, f.locations, f.nodes).response, 'First answer')
  const projector = new ChatTurnProcessProjector()
  projector.replace(f.order, f.locations, f.nodes)
  assert.equal(projector.get(f.control).hasExternalProcess, true, 'tool work after the earliest answer remains foldable process')
})
