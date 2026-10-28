import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')
const packageDir = path.join(root, 'packages/modern-ui')
const npm = path.resolve(path.dirname(process.execPath), process.platform === 'win32'
  ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js')

const consumerSource = `
import type {
  TextInteractionDefinition, TextInteractionGesture, TextInteractionRequest,
  TextInteractionSurface, TextInteractionTrigger, ConversationInteractionRegistry,
} from '@iroha1145/dsh-modern-ui/quotes'
import type { Context } from '@deepseek-ai/cordis'
import type { UiConversation, InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

type Assert<T extends true> = T
type IsAny<T> = 0 extends (1 & T) ? true : false
type RegistryIsTyped = Assert<IsAny<ConversationInteractionRegistry> extends false ? true : false>
type PropsAreTyped = Assert<IsAny<PropsRuntime<'conversation.chat.text-interaction'>> extends false ? true : false>
declare const ctx: Context
declare const ui: UiConversation
declare const actions: InputActions
declare const sessionId: SessionId
declare const props: PropsRuntime<'conversation.chat.text-interaction'>
const registry: ConversationInteractionRegistry = ctx.uiConversation.interactions
const sameRegistry: ConversationInteractionRegistry = ui.interactions
ui.binding(sessionId)
const definition: TextInteractionDefinition = {
  id: 'consumer', onInteraction(request: TextInteractionRequest) {
    const trigger: TextInteractionTrigger = request.trigger
    const text: string | null = request.readText()
    const id: SessionId = request.sessionId
    if (trigger === 'contextmenu' && text !== null) { request.preventDefault(); request.open() }
    void id
  },
}
const unregister: () => void = registry.register(definition)
const gesture: TextInteractionGesture = {
  trigger: 'selection', hasSelection: true, readText: () => 'selected', preventDefault() {},
}
const selected: string | null = registry.dispatch(sessionId, gesture)
const ids: readonly string[] = registry.getSnapshot()
const unsubscribe: () => void = registry.subscribe(() => {})
const inserted: boolean = actions.insertQuote('selected')
const normalInserted: boolean = actions.insertText('draft', actions.captureInsertion())
const fromStandardSeat: boolean = props.inputActions.insertQuote(props.readText() ?? '')
const surface: TextInteractionSurface = props
const slotOwner: SlotMap['conversation.chat.text-interaction']['owner'] = surface
const slotKind: 'keyed' = null as unknown as SlotMap['conversation.chat.text-interaction']['kind']
const slotScope: 'session' = null as unknown as SlotMap['conversation.chat.text-interaction']['scope']
props.dismiss(); props.clearSelection()
// @ts-expect-error quote insertion accepts text, never a position or number.
actions.insertQuote(12)
// @ts-expect-error gesture triggers retain the published closed union.
const invalidTrigger: TextInteractionTrigger = 'click'
// @ts-expect-error the package exports no quote registration runtime.
import { installQuotes } from '@iroha1145/dsh-modern-ui/quotes'
// @ts-expect-error the registry is available as a type, not a constructor export.
new ConversationInteractionRegistry(ctx)
void [sameRegistry, unregister, selected, ids, unsubscribe, inserted, normalInserted, fromStandardSeat, slotOwner, slotKind, slotScope, invalidTrigger]
`

function compile(consumer, module, moduleResolution) {
  const file = path.join(consumer, 'consumer.ts')
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2023, module, moduleResolution,
    strict: true, skipLibCheck: true, types: [], noEmit: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => consumer, getNewLine: () => '\n',
  }))
}

test('the packed quotes type entry resolves and augments official consumer contracts', { timeout: 120_000 }, t => {
  // Outside the repository so resolution cannot fall through to its node_modules or source.
  const consumer = mkdtempSync(path.join(os.tmpdir(), 'modern-quotes-package-'))
  t.after(() => {
    assert.equal(path.dirname(consumer), path.resolve(os.tmpdir()))
    assert.ok(path.basename(consumer).startsWith('modern-quotes-package-'))
    rmSync(consumer, { recursive: true, force: true })
  })
  // Pack the actual build output; the test must not repair missing declarations before packaging.
  const packed = JSON.parse(execFileSync(process.execPath, [npm, 'pack', packageDir, '--ignore-scripts', '--json',
    '--cache', path.join(consumer, 'npm-cache'), '--pack-destination', consumer], { cwd: consumer, encoding: 'utf8' }))[0]
  const declarations = packed.files.map(file => file.path).filter(file => file.startsWith('lib/types/'))
  assert.equal(declarations.length, 4)
  assert.ok(declarations.every(file => file.endsWith('.d.ts')))
  assert.ok(declarations.includes('lib/types/quotes-contract.d.ts'))
  assert.ok(declarations.every(file => !/QuoteSelection|QuotedUserText|locales|quotes\.d\.ts$/.test(file)))

  execFileSync('tar', ['-xzf', path.join(consumer, packed.filename), '-C', consumer], { encoding: 'utf8' })
  const installed = path.join(consumer, 'node_modules/@iroha1145/dsh-modern-ui')
  mkdirSync(path.dirname(installed), { recursive: true })
  renameSync(path.join(consumer, 'package'), installed)
  // Use the host's installed public artifacts, copied without links or workspace aliases.
  for (const name of ['@deepseek-ai', '@types', 'csstype']) {
    cpSync(path.join(root, 'node_modules', name), path.join(consumer, 'node_modules', name), { recursive: true, dereference: true })
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8')).exports['./quotes'], {
    types: './lib/types/quotes-contract.d.ts',
  })
  const declaration = readFileSync(path.join(installed, 'lib/types/quotes-contract.d.ts'), 'utf8')
  assert.ok(!declaration.includes('installQuotes'))
  assert.ok(!readdirSync(path.join(installed, 'lib')).includes('quotes.js'))
  writeFileSync(path.join(consumer, 'package.json'), '{"name":"quotes-consumer","private":true,"type":"module"}\n')
  writeFileSync(path.join(consumer, 'consumer.ts'), consumerSource)
  compile(consumer, ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext)
  compile(consumer, ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler)

  // A runtime import has no export condition: it cannot execute a .d.ts or register quotes twice.
  const runtime = execFileSync(process.execPath, ['--input-type=module', '-e', `
    try { await import('@iroha1145/dsh-modern-ui/quotes'); process.exit(1) }
    catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error }
  `], { cwd: consumer, encoding: 'utf8' })
  assert.equal(runtime, '')
})
