// Real input/registry/navigation wiring with a controlled reference allocator and prompt transport.
// The Hero callback is compiled from apply.ts itself; unrelated visual seats are isolated.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'Node',
  'Text',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'MutationObserver',
  'Event',
  'File',
  'FileReader',
  'Blob',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0)
globalThis.cancelAnimationFrame = id => clearTimeout(id)
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
Object.defineProperty(document, 'fonts', { value: { addEventListener() {}, removeEventListener() {} } })
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
const sourceRoot = new URL('../../packages/modern-ui/src/vendor/', import.meta.url)
const applySource = ts.createSourceFile('apply.ts', readFileSync(new URL('conversation/client/apply.ts', sourceRoot), 'utf8'), ts.ScriptTarget.Latest, true)
const selectWorkspaceFunctions = []
function findWorkspaceCallback(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(applySource) === 'selectWorkspace')
    selectWorkspaceFunctions.push(node.initializer.getText(applySource))
  ts.forEachChild(node, findWorkspaceCallback)
}
findWorkspaceCallback(applySource)
assert.equal(selectWorkspaceFunctions.length, 1, 'exercise the one registered Hero workspace action')
const callbackCode = ts.transpileModule(`const selectWorkspace = ${selectWorkspaceFunctions[0]}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const workspaceAction = new Function(
  'workspaceNavigation',
  'inputHub',
  'sessions',
  'concreteConversation',
  'ctx',
  'sessionId',
  `${callbackCode}; return selectWorkspace`,
)

const result = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  stdin: {
    loader: 'tsx',
    resolveDir: root,
    contents: `
    export {SessionInputShell} from './packages/modern-ui/src/vendor/conversation/client/input/facade.ts';
    export {InputHub} from './packages/modern-ui/src/vendor/conversation/client/input/hub.ts';
    export {ConversationController} from './packages/modern-ui/src/vendor/conversation/client/service.ts';
    export {ComposerBlockRegistry} from './packages/modern-ui/src/vendor/conversation/client/input/blocks.ts';
    export {InputBar} from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.tsx';
    export {UiWorkspaceService} from './packages/modern-ui/src/vendor/workspace/client/navigation.ts';
    export {LayoutController} from './packages/modern-ui/src/vendor/layout/service.ts';
    export {readFailedInputSends} from './packages/modern-ui/src/vendor/conversation/client/stores.ts';
  `,
  },
  plugins: [
    {
      name: 'scope-and-visual-surroundings',
      setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/cordis$/ }, () => ({ path: 'scope-service', namespace: 'fixture' }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onResolve({ filter: /(?:ContextMeter\.tsx|original-image-drop\.ts|DraftEditor\.tsx)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
          contents:
            args.path === 'scope-service'
              ? `export class Service {constructor(ctx,name){this.ctx=ctx;ctx.services.set(name,this)}}`
              : args.path === 'primitives'
                ? `export const Tooltip=({children})=>children,Toast=()=>null,IconPlusOutlineMedium=()=>null,IconWarningOutlineRegular=()=>null,ReferenceIconRegular=()=>null,QuotePreview=()=>null;
        export {formatQuoteText} from './packages/modern-ui/src/vendor/primitives/markdown/quote-text.ts';
        export const isMobileDevice=()=>false,focusWithoutRing=(element,options)=>element.focus(options);`
                : args.path.endsWith('ContextMeter.tsx')
                  ? 'export const ContextMeter=()=>null'
                  : args.path.endsWith('DraftEditor.tsx')
                    ? 'export const DraftEditor=()=>null'
                    : 'export const useOriginalImageDrop=()=>{}',
          loader: 'tsx',
          resolveDir: root,
        }))
        builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
        builder.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}' }))
        builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
      },
    },
  ],
  logLevel: 'silent',
})
const compiled = new Module(`${root}/.artifacts/workspace-attachment-ownership.cjs`)
compiled.filename = `${root}/.artifacts/workspace-attachment-ownership.cjs`
compiled.paths = Module._nodeModulePaths(root)
compiled._compile(result.outputFiles[0].text, compiled.filename)
const { SessionInputShell, InputHub, ConversationController, ComposerBlockRegistry, InputBar, UiWorkspaceService, LayoutController, readFailedInputSends } =
  compiled.exports
const observe = store => select => select(React.useSyncExternalStore(store.subscribe, () => store.getSnapshot()))
const staticHook = value => select => select(value)
async function until(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  assert.fail('the controlled operation did not settle')
}

function fixture() {
  localStorage.clear()
  const nativeCreate = URL.createObjectURL,
    nativeRevoke = URL.revokeObjectURL
  const created = [],
    revoked = [],
    uploads = [],
    prompts = [],
    lifetimes = [],
    drops = new Set(),
    rootServices = new Map()
  URL.createObjectURL = file => {
    const url = `blob:fixture-${created.length}`
    created.push({ url, name: file.name })
    return url
  }
  URL.revokeObjectURL = url => revoked.push(url)
  function context(id) {
    const effects = []
    const ctx = {
      id,
      services: rootServices,
      get: name => rootServices.get(name),
      on: () => () => {},
      effect(callback) {
        const cleanup = callback()
        let disposed = false
        const dispose = async () => {
          if (disposed) return
          disposed = true
          await cleanup?.()
        }
        effects.push(dispose)
        return dispose
      },
      inject: () => ({ dispose: async () => {} }),
      async dispose() {
        for (const dispose of [...effects].reverse()) await dispose()
      },
    }
    return ctx
  }
  const ctx = context('root')
  const states = new Map(
    ['A', 'B', 'C'].map(id => [
      id,
      createSnapshotStore({ sessionId: id, blank: true, running: false, subagent: null, removed: false, pendingSubmissions: [] }),
    ]),
  )
  const list = createSnapshotStore({
    phase: 'pending',
    ids: ['A', 'B', 'C'],
    byId: Object.fromEntries(['A', 'B', 'C'].map(id => [id, { id, blank: true, cwd: `/${id}`, retainedBy: {}, updatedAt: 1 }])),
    projectionsBySession: {},
  })
  const live = new Map(),
    replies = new Map(),
    projectionStores = new Map()
  const snapshots = id => ({
    sessionId: id,
    getSnapshot: states.get(id).getSnapshot,
    projections: {
      faceOf(name) {
        const key = `${id}:${name}`
        if (!projectionStores.has(key)) projectionStores.set(key, createSnapshotStore(name === 'inbox' ? { 'next-turn': [] } : undefined))
        return projectionStores.get(key)
      },
    },
    beginSubmission(options) {
      const requestId = `${id}:${lifetimes.length}`
      lifetimes.push({ requestId, options })
      return {
        requestId,
        abandon() {
          options.onRetire?.({ reason: 'failed', attachments: [] })
        },
      }
    },
    async prompt(content, mode, signal, requestId) {
      prompts.push({ sessionId: id, content, mode, signal, requestId })
      const response = replies.get(id)?.shift() ?? { ok: true }
      const submission = lifetimes.find(item => item.requestId === requestId)
      const attachments = content
        .filter(block => block.type === 'image' || block.type === 'file')
        .map((block, index) =>
          block.type === 'image'
            ? { attachmentId: `${id}:durable:${index}`, mediaType: block.mediaType, width: 1, height: 1 }
            : { attachmentId: `${id}:durable:${index}`, name: 'notes.txt', bytes: 5 },
        )
      submission?.options.onRetire?.({ reason: response.ok ? 'observed' : 'failed', attachments })
      return response
    },
  })
  function projectRetention(id, record) {
    list.update(draft => {
      draft.byId[id].retainedBy = { ...record.retainedBy }
    })
  }
  const sessions = {
    list,
    sessionOf: scope => live.get(scope.id)?.binding.session,
    binding: id => live.get(id)?.binding,
    subagentAddress: () => undefined,
    create: async request => request.sessionId ?? request.workspaceId,
    refreshProjections: async () => {},
    retain(id, { source }) {
      let record = live.get(id)
      if (record === undefined) {
        const scope = context(id)
        record = { count: 0, retainedBy: {}, binding: { sessionId: id, session: snapshots(id), ctx: scope } }
        live.set(id, record)
      }
      record.count++
      record.retainedBy[source] = (record.retainedBy[source] ?? 0) + 1
      projectRetention(id, record)
      let released = false
      return {
        sessionId: id,
        binding: record.binding,
        ready: Promise.resolve(record.binding),
        release() {
          if (released) return
          released = true
          record.count--
          record.retainedBy[source]--
          if (record.retainedBy[source] === 0) delete record.retainedBy[source]
          if (record.count === 0) {
            // Matches ClientSessions.retireScope: binding disappears before asynchronous fiber disposal.
            live.delete(id)
            const dropping = record.binding.ctx.dispose().finally(() => drops.delete(dropping))
            drops.add(dropping)
          }
          projectRetention(id, record)
        },
      }
    },
  }
  rootServices.set('sessions', sessions)
  const panel = createSnapshotStore({ activePanelId: null })
  ctx.layout = new LayoutController({ selectPanel: id => panel.set({ activePanelId: id }) }, () => true, panel)
  ctx.locale = { bind: () => key => key }
  ctx.fileUpload = {
    async upload(id, file) {
      const receiptId = `${id}:receipt:${uploads.length}`
      uploads.push({ sessionId: id, name: file.name, receiptId })
      return { ok: true, value: { receiptId, file: { attachmentId: receiptId, name: file.name, bytes: file.size } } }
    },
  }
  const hub = new InputHub(ctx, key => key)
  const blocks = new ComposerBlockRegistry()
  const conversation = new ConversationController(ctx, { input: hub, blocks, maxConcurrentFileUploads: 2 })
  const workspaces = createSnapshotStore({
    phase: 'pending',
    items: ['A', 'B', 'C'].map(id => ({ workspaceId: id, title: id, path: `/${id}`, createdAt: new Date(0).toISOString(), sessionIds: [id] })),
    archivedSessionIds: [],
    pinnedSessionIds: [],
  })
  const navigation = new UiWorkspaceService(ctx, {}, { list: workspaces }, sessions, { pinSessionOrder() {} }, () => {})
  navigation.openSession('A')
  list.update(draft => {
    draft.phase = 'ready'
  })
  workspaces.update(draft => {
    draft.phase = 'ready'
  })
  const shell = id => hub.shell(id)
  async function drain() {
    while (drops.size > 0) await Promise.all([...drops])
  }
  function image(id, name = 'original.png') {
    const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxkAAAAASUVORK5CYII=', 'base64'))
    return conversation.createDrafts(id, [new File([bytes], name, { type: 'image/png' })])[0]
  }
  function reply(id, response) {
    const queue = replies.get(id) ?? []
    queue.push(response)
    replies.set(id, queue)
  }
  async function fail(id, text, attachments, newerText) {
    const input = shell(id)
    input.setDraft(text)
    input.addAttachments(attachments.map(item => item.id))
    reply(id, { ok: false, error: { code: 'fixture/rejected', message: 'not admitted' } })
    input.submit()
    if (newerText !== undefined) input.setDraft(newerText)
    await until(() => input.snapshot.failedSends.some(record => record.draft.text === text) && input.snapshot.draft === (newerText ?? text))
    return input
  }
  return {
    ctx,
    sessions,
    hub,
    conversation,
    navigation,
    states,
    created,
    revoked,
    uploads,
    prompts,
    image,
    fail,
    shell,
    drain,
    selectWorkspace: id => workspaceAction(navigation, hub, sessions, () => conversation, ctx, id),
    async close() {
      await ctx.dispose()
      for (const record of [...live.values()]) await record.binding.ctx.dispose()
      live.clear()
      await drain()
      ctx.layout.dispose()
      URL.createObjectURL = nativeCreate
      URL.revokeObjectURL = nativeRevoke
      localStorage.clear()
    },
  }
}

async function mountInput(f, id) {
  const shell = f.shell(id),
    container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let renderedAttachments = []
  await act(async () =>
    root.render(
      React.createElement(InputBar, {
        sessionId: id,
        variant: 'composer',
        useSession: observe(f.states.get(id)),
        useInput: observe(shell.state),
        inputActions: shell.actions,
        keyboard: shell,
        useBusyEnter: staticHook('queue'),
        useFileUploads: observe(f.conversation.fileUploads),
        useNotices: observe(shell.notices),
        useLexicon: staticHook(undefined),
        useMenuLauncher: staticHook(null),
        useStopShortcut: staticHook([]),
        useAccess: () => true,
        useProjection: (_name, select) => select?.(undefined),
        resolveDraftAttachments: ids => f.conversation.resolveDraftAttachments(ids),
        addFiles: () => null,
        renderSlot: (name, props) => {
          if (name === 'conversation.input.attachments') {
            renderedAttachments = props.attachments
            return React.createElement('span', { 'data-attachment-count': props.attachments.length }, props.attachments.map(item => item.file.name).join(','))
          }
          return null
        },
        t: key => key,
      }),
    ),
  )
  return {
    container,
    attachments: () => renderedAttachments,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

for (const delayed of [false, true])
  test(`restored image survives Hero workspace handoff and ${delayed ? 'delayed' : 'immediate'} source scope destruction through the next real prompt`, async () => {
    const f = fixture()
    let view, hold
    try {
      const attachment = f.image('A')
      const source = await f.fail('A', 'send with image', [attachment])
      assert.ok(source instanceof SessionInputShell)
      assert.equal(source.snapshot.failedSends[0].restored, true)
      if (delayed) hold = f.sessions.retain('A', { source: 'sidePanel' })
      await f.selectWorkspace('A')('B')
      await f.drain()
      const target = f.shell('B')
      assert.deepEqual(target.snapshot.attachmentIds, [attachment.id])
      const oldBackup = delayed ? source.snapshot.failedSends[0] : undefined
      if (delayed) {
        hold.release()
        hold = undefined
        await f.drain()
      }
      assert.equal(f.sessions.binding('A'), undefined, 'the old scope actually lost its last reference')
      view = await mountInput(f, 'B')
      const displayed = view.attachments().map(item => item.id)
      const retained = target.snapshot.attachmentIds
      const revokedBeforeSend = [...f.revoked]
      const serialized = await f.conversation.serializeDraftAttachments(target.snapshot.attachmentIds)
      await act(async () => target.submit())
      await until(() => f.prompts.length === 2 && target.snapshot.failedSends.length === 0)
      const sent = f.prompts[1]
      assert.equal(sent.sessionId, 'B')
      assert.equal(sent.content.filter(block => block.type === 'image').length, 1)
      assert.equal(sent.content.find(block => block.type === 'text').text, 'send with image')
      assert.deepEqual(displayed, [attachment.id])
      assert.deepEqual(retained, [attachment.id], 'the real InputBar prune effect preserves transferred attachments')
      assert.deepEqual(revokedBeforeSend, [])
      assert.equal(serialized.attachments[0].type, 'image')
      if (delayed) {
        assert.equal(oldBackup.missingAttachments, 1)
        assert.equal(oldBackup.restored, false)
      }
      assert.equal(f.conversation.resolveDraftAttachments([attachment.id]).length, 0)
      assert.deepEqual(f.revoked, [attachment.previewUrl])
    } finally {
      if (view) await view.close()
      hold?.release()
      await f.close()
    }
  })

test('discarding the retained source text backup cannot release attachments already owned by the target', async () => {
  const f = fixture(),
    hold = f.sessions.retain('A', { source: 'sidePanel' })
  try {
    const attachment = f.image('A'),
      source = await f.fail('A', 'source recovery', [attachment])
    await f.selectWorkspace('A')('B')
    await f.drain()
    const failure = source.snapshot.failedSends[0]
    source.actions.discardFailedSend(failure.id)
    assert.equal(f.conversation.resolveDraftAttachments([attachment.id]).length, 1)
    assert.deepEqual(f.shell('B').snapshot.attachmentIds, [attachment.id])
    assert.equal(f.revoked.length, 0)
  } finally {
    hold.release()
    await f.close()
  }
})

test('ordinary draft handoff retains attachment ownership until the target scope is finally released', async () => {
  const f = fixture()
  let view
  try {
    const attachment = f.image('A'),
      source = f.shell('A')
    source.setDraft('ordinary draft')
    source.addAttachments([attachment.id])
    await f.selectWorkspace('A')('B')
    await f.drain()
    view = await mountInput(f, 'B')
    assert.equal(view.attachments().length, 1)
    assert.equal(f.revoked.length, 0)
    await view.close()
    view = undefined
    f.navigation.openSession('C')
    await f.drain()
    assert.equal(f.conversation.resolveDraftAttachments([attachment.id]).length, 0)
    assert.deepEqual(f.revoked, [attachment.previewUrl])
  } finally {
    if (view) await view.close()
    await f.close()
  }
})

test('source teardown still frees a different failed message that the target never accepted', async () => {
  const f = fixture()
  let view
  try {
    const old = f.image('A', 'unmoved.png')
    await f.fail('A', 'unmoved failure', [old], 'working')
    const moved = f.image('A', 'moved.png')
    await f.fail('A', 'moved failure', [moved])
    await f.selectWorkspace('A')('B')
    await f.drain()
    assert.equal(f.conversation.resolveDraftAttachments([old.id]).length, 0)
    assert.equal(f.conversation.resolveDraftAttachments([moved.id]).length, 1)
    assert.deepEqual(f.revoked, [old.previewUrl])
    assert.deepEqual(
      readFailedInputSends('A').map(record => record.draft.text),
      ['unmoved failure', 'moved failure'],
    )
    view = await mountInput(f, 'B')
    assert.deepEqual(
      view.attachments().map(item => item.id),
      [moved.id],
    )
  } finally {
    if (view) await view.close()
    await f.close()
  }
})

test('a busy transfer target rejects navigation without releasing the source restored attachments', async () => {
  const f = fixture()
  const hold = f.sessions.retain('B', { source: 'sidePanel' })
  let settle
  try {
    const attachment = f.image('A'),
      source = await f.fail('A', 'source draft', [attachment]),
      target = f.shell('B')
    target.setDraft('/busy args')
    target.beginCommand(
      {
        name: 'busy',
        token: '/busy ',
        submit: () =>
          new Promise(resolve => {
            settle = resolve
          }),
      },
      { start: 0, end: 5, draftRev: target.snapshot.draftRev },
    )
    target.submit()
    await until(() => target.snapshot.phase === 'submitting')
    await assert.rejects(f.selectWorkspace('A')('B'), /cannot accept a transferred draft/)
    await f.drain()
    assert.equal(f.sessions.binding('A')?.session.sessionId, 'A')
    assert.deepEqual(source.snapshot.attachmentIds, [attachment.id])
    assert.equal(source.snapshot.failedSends[0].missingAttachments, 0)
    assert.equal(f.conversation.resolveDraftAttachments([attachment.id]).length, 1)
    assert.equal(f.revoked.length, 0)
    assert.deepEqual(target.snapshot.attachmentIds, [])
  } finally {
    settle?.({ kind: 'success' })
    hold.release()
    await f.close()
  }
})

test('target rebind failure rolls back its active draft and recovery identity while preserving source image and file ownership', async () => {
  const f = fixture()
  const hold = f.sessions.retain('B', { source: 'sidePanel' })
  try {
    const existing = f.image('B', 'target.png'),
      target = await f.fail('B', 'target recovery', [existing])
    const image = f.image('A', 'source.png')
    const file = f.conversation.createDrafts('A', [new File(['notes'], 'notes.txt', { type: 'text/plain' })])[0]
    await until(() => f.conversation.fileUploads.getSnapshot()[file.id]?.status === 'ready')
    const source = await f.fail('A', 'source recovery', [image, file])
    const rebind = f.conversation.rebindDraftFiles.bind(f.conversation)
    f.conversation.rebindDraftFiles = (id, ids) => {
      rebind(id, ids)
      if (id === 'B') throw new Error('controlled rebind failure')
    }
    await assert.rejects(f.selectWorkspace('A')('B'), /controlled rebind failure/)
    await until(() => f.conversation.fileUploads.getSnapshot()[file.id]?.status === 'ready')
    assert.equal(target.snapshot.draft, 'target recovery')
    assert.deepEqual(target.snapshot.attachmentIds, [existing.id])
    assert.equal(target.snapshot.failedSends[0].restored, true)
    assert.equal(source.snapshot.draft, 'source recovery')
    assert.deepEqual(source.snapshot.attachmentIds, [image.id, file.id])
    assert.equal(source.snapshot.failedSends[0].missingAttachments, 0)
    assert.equal(f.conversation.resolveDraftAttachments([image.id, file.id, existing.id]).length, 3)
    assert.ok(f.conversation.fileUploads.getSnapshot()[file.id].receiptId.startsWith('A:receipt:'))
    assert.equal(f.revoked.length, 0)
  } finally {
    hold.release()
    await f.close()
  }
})

test('accepted transfer detaches an existing target recovery identity from the incoming document', async () => {
  const f = fixture()
  const hold = f.sessions.retain('B', { source: 'sidePanel' })
  try {
    const old = f.image('B', 'target.png'),
      target = await f.fail('B', 'target older failure', [old])
    const oldId = target.snapshot.failedSends[0].id
    const moved = f.image('A', 'source.png')
    await f.fail('A', 'incoming source failure', [moved])
    await f.selectWorkspace('A')('B')
    await f.drain()
    assert.equal(target.snapshot.draft, 'incoming source failure')
    assert.equal(target.snapshot.failedSends.find(record => record.id === oldId).restored, false)
    const count = f.prompts.length
    target.submit()
    await until(() => f.prompts.length === count + 1)
    assert.equal(target.snapshot.failedSends.find(record => record.id === oldId).draft.text, 'target older failure')
    assert.equal(target.snapshot.failedSends.find(record => record.id === oldId).retrying, undefined)
  } finally {
    hold.release()
    await f.close()
  }
})
