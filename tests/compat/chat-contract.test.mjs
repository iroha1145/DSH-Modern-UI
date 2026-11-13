import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatContract } from './chat-contract-versions.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const development = createRequire(path.join(root, 'package.json'))
const ts = development('typescript')
const { buildSync } = development('esbuild')
assert.ok(process.env.COMPAT_BACKEND_PACKAGE, 'Set COMPAT_BACKEND_PACKAGE to an independently installed official DSH package.json')
const backendPackage = realpathSync(process.env.COMPAT_BACKEND_PACKAGE)
const consumer = createRequire(backendPackage)
const version = JSON.parse(readFileSync(backendPackage)).version
const contract = chatContract(version)
if (process.env.COMPAT_EXPECTED_HOST) assert.equal(version, process.env.COMPAT_EXPECTED_HOST)
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
/**
 * The published pure projector and its helpers, with no replacement Host API or rc4 dependency fallback.
 * Releases up to 0.2.2-rc.1 ship a readable bundle with one region per module, which is executed as it is.
 * 0.2.2-rc.2 ships a minified bundle without regions and, beside it, a source map that carries the original
 * modules; those published sources are compiled here, and may import nothing outside the chat package.
 */
function publishedProjector() {
  if (official.includes('//#region lib/types/client/')) {
    return new Function(
      [
        region('contract/group-tree'),
        region('contract/chat-visibility'),
        region('conversation-nodes/turn-process-presentation'),
        'return ChatTurnProcessProjector',
      ].join('\n'),
    )()
  }
  const map = JSON.parse(readFileSync(consumer.resolve('@deepseek-ai/dsh-client-ui-chat/client') + '.map', 'utf8'))
  const base = 'packages/client/ui-chat/src/'
  const directory = mkdtempSync(path.join(tmpdir(), 'modern-chat-contract-'))
  try {
    let entry
    map.sources.forEach((source, index) => {
      const at = source.indexOf(base)
      const text = map.sourcesContent?.[index]
      if (at < 0 || typeof text !== 'string') return
      const file = path.resolve(directory, source.slice(at + base.length))
      assert.ok(file.startsWith(directory + path.sep), `Published source path leaves the chat package: ${source}`)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text)
      if (source.endsWith('/client/conversation-nodes/turn-process-presentation.ts')) entry = file
    })
    assert.ok(entry, 'Missing published source conversation-nodes/turn-process-presentation')
    const built = buildSync({
      absWorkingDir: directory,
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node',
      packages: 'external',
      metafile: true,
      logLevel: 'silent',
    })
    assert.deepEqual(
      Object.values(built.metafile.outputs).flatMap(output => output.imports),
      [],
      'the published projector must not need anything outside the chat package',
    )
    const published = { exports: {} }
    new Function('module', 'exports', built.outputFiles[0].text)(published, published.exports)
    assert.equal(typeof published.exports.ChatTurnProcessProjector, 'function', 'Missing published ChatTurnProcessProjector')
    return published.exports.ChatTurnProcessProjector
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
const OfficialProjector = publishedProjector()

const copyFile = path.join(root, 'packages/modern-ui/src/vendor/chat/client/chat/TurnTailNodeView.tsx')
const copySource = ts.createSourceFile(copyFile, readFileSync(copyFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const copyFunction = copySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'answerText')
assert.ok(copyFunction)
const compiled = buildSync({
  absWorkingDir: root,
  stdin: {
    loader: 'ts',
    resolveDir: root,
    contents: `
    export { ChatTurnProcessProjector } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process-presentation.ts';
    export { turnProcessDefinition } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-process.ts';
    export { turnNavigationItem } from './packages/modern-ui/src/vendor/chat/client/conversation-nodes/turn-navigation.ts';
    import { isAnswerStep } from './packages/modern-ui/src/vendor/chat/client/contract/turn-process.ts';
    import { assistantText } from './packages/modern-ui/src/vendor/chat/client/chat/turn-assistant.ts';
    ${copyFunction.getText(copySource)}
    export { answerText, isAnswerStep };
  `,
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  metafile: true,
})
assert.deepEqual(
  Object.values(compiled.metafile.outputs).flatMap(output => output.imports),
  [],
  'pure projections must not borrow any shared runtime from the repository',
)
const module = { exports: {} }
new Function('module', 'exports', compiled.outputFiles[0].text)(module, module.exports)
const { ChatTurnProcessProjector, turnProcessDefinition, turnNavigationItem, answerText, isAnswerStep } = module.exports

function fixture({ inputAt, answer = true } = {}) {
  const spec = {
    turn: 1,
    controlAnchorSeq: 3,
    processStartSeq: 0,
    answerAnchorSeq: answer ? 10 : null,
    answerStep: answer ? 1 : null,
    inlineReasoning: false,
    messageCount: 0,
    toolCallCount: 1,
    subagentCount: 0,
  }
  const turn = { turn: 1, status: 'closed', start: { seq: 0 }, steps: [], data: { get: () => spec } }
  const location = { kind: 'turn', turn }
  const values = [
    { key: 'input', kind: 'user', anchorSeq: 1, groupTree: 'input', data: { content: [{ type: 'text', text: 'Prompt' }] } },
    { key: 'control', kind: 'turn-process', anchorSeq: 3.5, groupTree: 'turn', data: spec },
    { key: 'first', kind: 'assistant-step', anchorSeq: 10, data: { step: 1, blocks: [{ kind: 'text', text: 'First answer' }] } },
    { key: 'tool', kind: 'tool-call', anchorSeq: 12, data: {} },
    { key: 'later', kind: 'assistant-step', anchorSeq: 20, data: { step: 3, blocks: [{ kind: 'text', text: 'Later answer' }] } },
    ...(inputAt === undefined ? [] : [{ key: 'steering', kind: 'steering', anchorSeq: inputAt, groupTree: 'input', data: {} }]),
  ].map(node => ({ target: 'chat', id: node.key, visibility: 'visible', location, ...node }))
  const byKey = new Map(values.map(node => [node.key, node]))
  const nodes = { get: key => byKey.get(key) }
  const locations = { getTurn: () => [...byKey.keys()] }
  return { spec, turn, byKey, nodes, locations, order: [...byKey.keys()], control: byKey.get('control') }
}

test('published fields match the explicitly supported Host version', () => {
  const keys = declarations(path.join(chatRoot, 'lib/types/client/contract/snapshot.d.ts'), 'ChatTurnProcessPresentation')
  assert.equal(keys.includes('compactAnswer'), contract === 'compact-answer')
  assert.equal(keys.includes('hasNonReplyProcess'), contract === 'non-reply')
  assert.deepEqual(
    keys.toSorted(),
    [
      'turn',
      'spec',
      'turnStarted',
      'turnClosed',
      'hasExternalProcess',
      'hasInterleavedInput',
      contract === 'compact-answer' ? 'compactAnswer' : 'hasNonReplyProcess',
    ].sort(),
  )
  const evidence = { version, backendPackage, chatPackage, publishedClientSha256: createHash('sha256').update(official).digest('hex'), fields: keys }
  console.info(JSON.stringify(evidence))
  if (process.env.COMPAT_CONTRACT_EVIDENCE) writeFileSync(process.env.COMPAT_CONTRACT_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n')
  const f = fixture()
  const modern = new ChatTurnProcessProjector()
  modern.replace(f.order, f.locations, f.nodes)
  for (const key of keys) assert.ok(Object.hasOwn(modern.get(f.control), key), 'Missing public process field ' + key)
})

test('published projection semantics follow the selected Host, including steering before and after the answer', () => {
  for (const input of [{}, { inputAt: 5 }, { inputAt: 15 }, { inputAt: 5, answer: false }]) {
    const f = fixture(input)
    // Shared Host semantics: tool work precedes the answer. Later process is tested as a Modern enhancement below.
    f.byKey.set('tool', { ...f.byKey.get('tool'), anchorSeq: 8 })
    f.byKey.delete('later')
    const modern = new ChatTurnProcessProjector(),
      host = new OfficialProjector()
    modern.replace(f.order, f.locations, f.nodes)
    host.replace(f.order, f.locations, f.nodes)
    const actual = modern.get(f.control),
      expected = host.get(f.control)
    for (const key of ['turn', 'spec', 'turnStarted', 'turnClosed', 'hasExternalProcess', 'hasInterleavedInput']) {
      assert.equal(actual[key], expected[key], key)
    }
    const versionField = contract === 'compact-answer' ? 'compactAnswer' : 'hasNonReplyProcess'
    assert.equal(actual[versionField], expected[versionField], versionField)
    assert.equal(actual.compactAnswer, input.inputAt === undefined || input.inputAt > 10)
    assert.equal(actual.hasInterleavedInput, input.inputAt !== undefined)
    assert.equal(actual.hasNonReplyProcess, true, 'visible tool work is non-reply process')
    assert.equal(typeof actual.hasNonReplyProcess, 'boolean', 'Modern always publishes its optional extension')
  }
})

test('unsupported versions fail explicitly instead of bypassing assertions', () => {
  assert.throws(() => chatContract('0.2.2-rc.99'), /Unsupported chat contract version/)
})

test('reply-only and hidden rows do not become non-reply process; visible reasoning does', () => {
  const f = fixture()
  f.byKey.delete('tool')
  f.byKey.delete('later')
  f.byKey.set('progress', {
    ...f.byKey.get('first'),
    key: 'progress',
    id: 'progress',
    anchorSeq: 8,
    data: { step: 0, blocks: [{ kind: 'text', text: 'Progress' }] },
  })
  const projectors = [new ChatTurnProcessProjector(), ...(contract === 'non-reply' ? [new OfficialProjector()] : [])]
  for (const projector of projectors) {
    projector.replace([...f.byKey.keys()], f.locations, f.nodes)
    const before = projector.get(f.control)
    assert.equal(before.hasExternalProcess, true)
    assert.equal(before.hasNonReplyProcess, false)
    assert.equal(projector.update(new Set([1]), f.locations, f.nodes).size, 0)
    assert.equal(projector.get(f.control), before)
    const progress = f.byKey.get('progress')
    f.byKey.set('progress', { ...progress, data: { ...progress.data, blocks: [...progress.data.blocks, { kind: 'reasoning', text: 'Thinking' }] } })
    assert.deepEqual([...projector.update(new Set([1]), f.locations, f.nodes)], [1])
    const after = projector.get(f.control)
    assert.notEqual(after, before)
    assert.equal(after.hasExternalProcess, before.hasExternalProcess)
    assert.equal(after.hasNonReplyProcess, true)
    f.byKey.set('progress', { ...progress, visibility: 'hidden' })
    projector.update(new Set([1]), f.locations, f.nodes)
    assert.equal(projector.get(f.control).hasNonReplyProcess, false)
    f.byKey.set('progress', progress)
  }
})

test('copy preserves raw Markdown including code and links across closing replies', () => {
  const f = fixture()
  const texts = ['**First**\n\n```js\nconst n = 1\n```', '[Later](https://example.test/source?q=1&x=2)']
  const assistants = texts.map((text, index) => ({ step: index + 1, blocks: [{ kind: 'text', text }], finalNode: { seq: 10 + index * 10 } }))
  f.turn.steps = assistants.map(data => ({ step: data.step, status: 'closed', data: { get: () => data } }))
  assert.equal(answerText(f.turn, assistants[1]), texts.join('\n\n'))
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
    {
      step: 2,
      blocks: [
        { kind: 'text', text: 'Tool progress' },
        { kind: 'tool-call', name: 'read_file' },
      ],
      finalNode: { seq: 15 },
    },
    { step: 3, blocks: [{ kind: 'text', text: 'Later answer' }], finalNode: { seq: 20 } },
  ]
  f.turn.steps = assistants.map(data => ({ step: data.step, status: 'closed', data: { get: () => data } }))
  const context = {
    state: {
      turn: 1,
      controlAnchorSeq: 3,
      assistantStartByStep: new Map([
        [1, 4],
        [2, 11],
        [3, 16],
      ]),
      messageCountByStep: new Map([
        [1, 1],
        [2, 1],
        [3, 1],
      ]),
      messageCount: 3,
      toolCallCount: 1,
      subagentCount: 0,
    },
    start: { location: { kind: 'turn', turn: f.turn } },
    matches: [],
    current: new Map(),
  }
  const result = turnProcessDefinition.buildLocationData(context, 'turn', undefined)
  assert.equal(result.value.answerStep, 1)
  assert.equal(result.value.answerAnchorSeq, 10)
  assert.equal(result.value.messageCount, 1)
  assert.deepEqual(
    assistants.map(data => isAnswerStep(result.value, data)),
    [true, false, true],
  )
  assert.equal(answerText(f.turn, assistants[2]), 'First answer\n\nLater answer')
  assert.equal(turnNavigationItem(1, f.locations, f.nodes).response, 'First answer')
  const projector = new ChatTurnProcessProjector()
  projector.replace(f.order, f.locations, f.nodes)
  assert.equal(projector.get(f.control).hasExternalProcess, true, 'tool work after the earliest answer remains foldable process')
  assert.equal(projector.get(f.control).hasNonReplyProcess, true)
  const host = new OfficialProjector()
  host.replace(f.order, f.locations, f.nodes)
  assert.equal(host.get(f.control).hasExternalProcess, false, 'these Host releases stop process classification at the first answer anchor')
  if (contract === 'non-reply') assert.equal(host.get(f.control).hasNonReplyProcess, false)
})
