import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

const repo = fileURLToPath(new URL('../../', import.meta.url))
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
  'HTMLTextAreaElement',
  'MutationObserver',
  'Event',
  'KeyboardEvent',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = id => clearTimeout(id)
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
const storeModule = require('@deepseek-ai/dsh-client-store')
const { createSnapshotStore } = storeModule
const primitives = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
const compositionAt = primitives.indexOf('function observeComposition(')
const composition = primitives.slice(compositionAt, primitives.indexOf('//#endregion', compositionAt))
const officialSettings = readFileSync(new URL('../../node_modules/@deepseek-ai/dsh-client-ui-settings/lib/client.js', import.meta.url), 'utf8')
const formAt = officialSettings.indexOf('var ConfigFormController = class')
const formEnd = officialSettings.indexOf('/**\n\t\t* The settings domain', formAt)
// Exercise the installed form's actual serialized-write and recovery behavior.
const ConfigFormController = new Function('_deepseek_ai_dsh_client_store', `${officialSettings.slice(formAt, formEnd)}; return ConfigFormController`)(
  storeModule,
)
const officialQuestions = readFileSync(new URL('../../node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js', import.meta.url), 'utf8')
const questionAt = officialQuestions.indexOf('function settlePendingComposer(')
const questionSource = officialQuestions.slice(questionAt, officialQuestions.indexOf('//#endregion', questionAt))
const { PendingQuestion, createWaterfallRequest } = new Function('brandString', `${questionSource}; return {PendingQuestion, createWaterfallRequest}`)(
  value => value,
)

const iconNames = [
  'IconCheckOutlineRegular',
  'IconChevronDownOutlineRegular',
  'IconChevronRightOutlineRegular',
  'IconChevronUpOutlineRegular',
  'IconCloseOutlineRegular',
  'IconEditOutlineRegular',
  'IconChevronLeftOutlineRegular',
  'IconArchiveCheckOutlineRegular',
  'IconArchiveOffOutlineRegular',
  'IconArchiveOutlineRegular',
  'IconChevronsUpDownOutlineRegular',
  'IconClockOutlineRegular',
  'IconCloseFillRegular',
  'IconFlatListOutlineRegular',
  'IconFolderCloseRegular',
  'IconProjectAddOutlineRegular',
  'IconQueueOutlineRegular',
  'IconSearchOutlineRegular',
  'IconSlidersTwoOutlineRegular',
  'IconWorkspaceTreeOutlineRegular',
  'IconLoadingOutlineRegular',
  'IconRefreshOutlineRegular',
  'IconPlusOutlineRegular',
  'IconTrashOutlineRegular',
]
const compiledResult = await build({
  absWorkingDir: repo,
  tsconfigRaw: {},
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  stdin: {
    loader: 'tsx',
    resolveDir: repo,
    contents: `
    export {QuestionPresentation} from './packages/modern-ui/src/vendor/questions/QuestionFlow.tsx';
    export {WorkspaceBrowser, FlatList, SessionTree} from './packages/modern-ui/src/vendor/workspace/client/rows/WorkspaceBrowser.tsx';
    export {SessionRenameDialog} from './packages/modern-ui/src/vendor/workspace/client/session-actions/RenameSession.tsx';
    export {UiWorkspaceService} from './packages/modern-ui/src/vendor/workspace/client/navigation.ts';
    export {LayoutController} from './packages/modern-ui/src/vendor/layout/service.ts';
    export {ModelPickerSettingsController} from './packages/modern-ui/src/vendor/model/client/settings/controller.ts';
    export {ModelPickerSettingsCard} from './packages/modern-ui/src/vendor/model/client/settings/ModelPickerSettingsCard.tsx';
    export {ReasoningDeclarationCard} from './packages/modern-ui/src/vendor/settings-models/client/ReasoningDeclarationCard.tsx';
    export {ReasoningDeclarationController} from './packages/modern-ui/src/vendor/settings-models/client/controller.ts';
    export {FileTransfers, FILE_DRAG_TOKEN_TYPE} from './packages/modern-ui/src/vendor/file-drag/transfers.ts';
    export {MessageImage} from './packages/modern-ui/src/vendor/file-drag/MessageImage.tsx';
  `,
  },
  plugins: [
    {
      name: 'isolated-surroundings',
      setup(builder) {
        builder.onLoad({ filter: /WorkspaceBrowser\.tsx$/ }, args => ({
          contents: `${readFileSync(args.path, 'utf8')}\nexport {FlatList, SessionTree}`,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'composition', namespace: 'composition' }))
        builder.onLoad({ filter: /.*/, namespace: 'composition' }, () => ({
          contents: `export ${composition}; export const IconChevronLeftOutlineRegular=()=>null`,
        }))
        builder.onResolve({ filter: /^@deepseek-ai\/cordis$/ }, () => ({ path: 'cordis', namespace: 'cordis' }))
        builder.onLoad({ filter: /.*/, namespace: 'cordis' }, () => ({ contents: 'export class Service { constructor(ctx){this.ctx=ctx} }' }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'primitives' }))
        builder.onLoad({ filter: /.*/, namespace: 'primitives' }, () => ({
          contents: `
      import React from 'react';
      export const Button=({children,onClick,disabled,...props})=><button disabled={disabled} onClick={onClick}>{children}</button>;
      export const Tooltip=({children})=>children, HoverCardGroup=({children,className})=><div className={className}>{children}</div>;
      export const AnimatedRows=({children})=><div role="tree">{children}</div>;
      export const Menu=({anchor})=>anchor, MenuItemButton=({children,onSelect})=><button onClick={onSelect}>{children}</button>;
      export const Modal=({open,children,footer})=>open?<div role="dialog">{children}{footer}</div>:null;
      export const MarkdownText=({text})=><div>{text}</div>,Tag=({children})=><span>{children}</span>,Input=props=><input {...props}/>;
      export const Checkbox=({checked,onChange,disabled})=><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>;
      export const Switch=({checked,onChange,disabled,label})=><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/>;
      ${iconNames.map(name => `export const ${name}=()=>null;`).join('\n')}
    `,
          resolveDir: repo,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /\/Rows\.tsx$/ }, () => ({ path: 'rows', namespace: 'rows' }))
        builder.onLoad({ filter: /.*/, namespace: 'rows' }, () => ({
          contents: `
      export const ProjectRowItem=({group,drag,actions})=><div data-workspace={group.key}><button data-start onClick={drag?.start}>start</button><button data-end onClick={drag?.end}>end</button><button data-rename onClick={actions?.rename}>rename</button></div>;
      export const SessionNodeItem=({node,drag})=><div data-session={node.id}><button data-start onClick={drag?.start}>start</button><button data-hover onClick={()=>drag?.hover('after')}>hover</button><button data-drop onClick={()=>drag?.drop('after')}>drop</button><button data-end onClick={drag?.end}>end</button></div>;
      export const SearchResultItem=()=>null;
    `,
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /(?:WorkspacePicker\.tsx|ImageLightbox\.tsx|DraggableImage\.tsx)$/ }, args => ({ path: args.path, namespace: 'other-ui' }))
        builder.onLoad({ filter: /.*/, namespace: 'other-ui' }, () => ({
          contents: 'export const WorkspacePickFlow=()=>null,ImageLightbox=()=>null,DraggableImage=props=><img src={props.src}/>;',
          loader: 'tsx',
        }))
        builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
        builder.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}' }))
        builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
      },
    },
  ],
  logLevel: 'silent',
})
const compiled = new Module(`${repo}/.artifacts/workspace-async.cjs`)
compiled.filename = `${repo}/.artifacts/workspace-async.cjs`
compiled.paths = Module._nodeModulePaths(repo)
compiled._compile(compiledResult.outputFiles[0].text, compiled.filename)
const {
  QuestionPresentation,
  WorkspaceBrowser,
  FlatList,
  SessionTree,
  SessionRenameDialog,
  UiWorkspaceService,
  LayoutController,
  ModelPickerSettingsController,
  ModelPickerSettingsCard,
  ReasoningDeclarationCard,
  ReasoningDeclarationController,
  FileTransfers,
  FILE_DRAG_TOKEN_TYPE,
  MessageImage,
} = compiled.exports
const observe = store => select => select(React.useSyncExternalStore(store.subscribe, () => store.getSnapshot()))
const staticHook = value => select => select(value)
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function mount(node) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(node))
  return {
    container,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
function key(node, name, options = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
  node.dispatchEvent(event)
  return event
}

function questionProps(pending) {
  const store = createSnapshotStore({ progressByRequest: {} })
  return {
    matched: pending,
    t: key => key,
    foldLabels: () => ({}),
    textLabels: () => ({ expand: 'expand', collapse: 'collapse' }),
    useStore: observe(store),
    useQuestionCard: (_key, select) => select(React.useSyncExternalStore(pending.subscribe, pending.snapshot)),
    actions: {
      replace: (id, progress) =>
        store.update(d => {
          d.progressByRequest[id] = progress
        }),
      clear: id =>
        store.update(d => {
          delete d.progressByRequest[id]
        }),
      prune() {},
    },
  }
}

test('QuestionFlow protects synchronous API reentry and preserves RPC failures for retry', async () => {
  const pending = new PendingQuestion('session', [{ id: 'q', question: 'Pick', options: [{ label: 'Yes (Recommended)' }] }], 'call')
  pending.setState('continued')
  const replies = []
  pending.attachRpc({
    answer: () => {
      const reply = deferred()
      replies.push(reply)
      return reply.promise
    },
  })
  pending.attachSeat({ hide() {} })
  const view = await mount(React.createElement(QuestionPresentation, questionProps(pending)))
  try {
    const submit = [...view.container.querySelectorAll('button')].find(node => node.textContent === 'submit')
    assert.ok(submit)
    // Same-act reentry is an API stress case, not evidence that normal user clicks bypass React's event flush.
    await act(async () => {
      submit.click()
      submit.click()
    })
    assert.equal(replies.length, 1)
    await act(async () => replies[0].reject(new Error('offline')))
    assert.ok(view.container.textContent.includes('offline'))
    await act(async () => submit.click())
    assert.equal(replies.length, 2)
    await act(async () => replies[1].resolve(true))
  } finally {
    await view.close()
  }
})

test('QuestionFlow surfaces a failed hide operation instead of leaving an unhandled rejection', async () => {
  const pending = new PendingQuestion('session', [{ id: 'q', question: 'Pick' }], 'call')
  pending.attachSeat({
    hide: () => {
      throw new Error('cannot hide')
    },
  })
  const view = await mount(React.createElement(QuestionPresentation, questionProps(pending)))
  try {
    await act(async () => view.container.querySelector('[aria-label="nav.close"]').click())
    assert.ok(view.container.textContent.includes('cannot hide'))
  } finally {
    await view.close()
  }
})

test('the installed Host projection rejects an empty question batch before the normal QuestionFlow entry', async () => {
  const { questionsOf } = await import(new URL('../../node_modules/@deepseek-ai/dsh-user-questions/lib/types/projection.js', import.meta.url))
  assert.equal(questionsOf(JSON.stringify({ questions: [] })), null)
  assert.equal(questionsOf(JSON.stringify({ questions: [{ id: 'q', question: 'Valid question' }] })).length, 1)
})

test('a superseded waterfall result cannot unlock a newer continued RPC submission', async () => {
  const pending = new PendingQuestion('session', [{ id: 'q', question: 'Pick', options: [{ label: 'Yes (Recommended)' }] }], 'call')
  const old = deferred(),
    remote = deferred()
  // Promise delay is an injected contract stress case; the installed waterfall adapter itself settles synchronously.
  pending.answer = () => (pending.snapshot().channel === 'waterfall' ? old.promise : remote.promise)
  const waterfall = createWaterfallRequest(undefined, undefined, channel => pending.detachWaterfall(channel))
  pending.attachWaterfall(waterfall.channel)
  pending.attachRpc({ answer: () => remote.promise })
  const view = await mount(React.createElement(QuestionPresentation, questionProps(pending)))
  try {
    const submit = [...view.container.querySelectorAll('button')].find(node => node.textContent === 'submit')
    await act(async () => submit.click())
    await act(async () => {
      pending.detachWaterfall(waterfall.channel)
      pending.setState('continued')
    })
    await act(async () => submit.click())
    assert.equal(submit.disabled, true)
    await act(async () => old.reject(new Error('old failure')))
    assert.equal(submit.disabled, true)
    assert.ok(!view.container.textContent.includes('old failure'))
    await act(async () => remote.reject(new Error('current failure')))
    assert.equal(submit.disabled, false)
    assert.ok(view.container.textContent.includes('current failure'))
  } finally {
    await view.close()
  }
})

function sessionList(count = 3) {
  const ids = Array.from({ length: count }, (_, index) => `s${index}`)
  return {
    phase: 'ready',
    ids,
    byId: Object.fromEntries(
      ids.map((id, index) => [id, { id, title: id, blank: false, running: false, retainedBy: {}, updatedAt: count - index, cwd: '/workspace' }]),
    ),
    projectionsBySession: {},
  }
}
function treeProps(list, writes) {
  return {
    list,
    rowState: { pinnedSessionIds: [], archivedSessionIds: [], archivedFilter: 'default' },
    useSessionStatus: staticHook(new Map()),
    useSessionAccess: () => true,
    usePanelInfo: staticHook({ activePanelId: null }),
    useRemoteAccess: () => true,
    useWorkspaceAccess: () => true,
    workspaceReady: true,
    animationResetKey: '',
    setSessionOrder: (...args) => writes.push(args),
    open() {},
    onSessionRenameRequest() {},
    onSessionRevealed() {},
    onLeaveArchivedOnly() {},
    renderSlot: () => null,
    t: key => key,
  }
}

test('flat and grouped session drags commit only a valid drop, never dragend after the last hover', async () => {
  for (const grouped of [false, true]) {
    const writes = [],
      list = sessionList()
    const props = treeProps(list, writes)
    const view = await mount(
      grouped
        ? React.createElement(SessionTree, {
            ...props,
            workspaces: [{ workspaceId: 'w', path: '/workspace', title: 'w', createdAt: new Date(0).toISOString(), sessionIds: list.ids }],
            ungroupedSessionIds: [],
            nestWorkspaces: false,
            groupExpansion: { w: true },
            setGroupExpanded() {},
            startSession() {},
            insertWorkspaceBefore: async () => {},
            onRenameRequest() {},
            onDeleteRequest() {},
            shortcuts: [],
          })
        : React.createElement(FlatList, { ...props, sessionIds: list.ids }),
    )
    try {
      const source = () => view.container.querySelector('[data-session="s0"]')
      const target = () => view.container.querySelector('[data-session="s2"]')
      await act(async () => source().querySelector('[data-start]').click())
      await act(async () => target().querySelector('[data-hover]').click())
      const outside = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(outside, 'dataTransfer', { value: { dropEffect: 'none' } })
      document.body.dispatchEvent(outside)
      assert.equal(outside.defaultPrevented, false, 'the document does not accept an invalid outside drop')
      await act(async () => source().querySelector('[data-end]').click())
      assert.deepEqual(writes, [])
      await act(async () => source().querySelector('[data-start]').click())
      await act(async () => target().querySelector('[data-hover]').click())
      await act(async () => target().querySelector('[data-drop]').click())
      await act(async () => source().querySelector('[data-end]').click())
      assert.equal(writes.length, 1)
      assert.deepEqual(writes[0][1], ['s1', 's2', 's0'])
    } finally {
      await view.close()
    }
  }
})

test('archiving the old selected session preserves the in-flight navigation to a newly created session', async () => {
  localStorage.clear()
  const creation = deferred(),
    released = [],
    retained = [],
    effects = []
  const list = createSnapshotStore({ ...sessionList(1), phase: 'loading' })
  const workspaces = createSnapshotStore({
    phase: 'loading',
    items: [{ workspaceId: 'w', path: '/workspace', title: 'w', sessionIds: ['s0'], createdAt: new Date(0).toISOString() }],
    archivedSessionIds: [],
    pinnedSessionIds: [],
  })
  const panel = createSnapshotStore({ activePanelId: null })
  const layout = new LayoutController({ selectPanel: id => panel.set({ activePanelId: id }) }, () => true, panel)
  const ctx = {
    layout,
    effect: callback => {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
  }
  const sessions = {
    list,
    create: () => creation.promise,
    retain: id => {
      retained.push(id)
      return { sessionId: id, release: () => released.push(id) }
    },
    subagentAddress: () => undefined,
  }
  const service = new UiWorkspaceService(ctx, {}, { list: workspaces }, sessions, { pinSessionOrder() {} }, () => {})
  try {
    service.openSession('s0')
    service.startSession('w')
    workspaces.update(d => {
      d.archivedSessionIds = ['s0']
    })
    assert.deepEqual(released, ['s0'])
    creation.resolve('new')
    await tick()
    await tick()
    assert.deepEqual(retained, ['s0', 'new'])
  } finally {
    for (const dispose of effects) dispose?.()
    layout.dispose()
    localStorage.clear()
  }
})

test('session rename guards legacy 229 and the closing composition key while normal Enter still submits', async () => {
  const writes = [],
    request = createSnapshotStore({ sessionId: 's', currentTitle: 'old' })
  const view = await mount(
    React.createElement(SessionRenameDialog, {
      useRenameRequest: observe(request),
      settleSessionRename() {},
      renameSession: async (...args) => {
        writes.push(args)
      },
      t: key => key,
    }),
  )
  try {
    const input = view.container.querySelector('input')
    await act(async () => {
      key(input, 'Enter', { keyCode: 229 })
      input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
      input.dispatchEvent(new Event('compositionend', { bubbles: true }))
      key(input, 'Enter')
    })
    assert.deepEqual(writes, [])
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await act(async () => key(input, 'Enter'))
    assert.deepEqual(writes, [['s', 'old']])
  } finally {
    await view.close()
  }
})

function browserProps(overrides = {}) {
  const noop = () => {}
  return {
    wide: true,
    usePanelInfo: staticHook({ activePanelId: null }),
    expandSidebar: noop,
    useSessions: staticHook(sessionList(0)),
    useSessionStatus: staticHook(new Map()),
    useRemoteAccess: () => true,
    useSessionAccess: () => true,
    useWorkspaceAccess: () => true,
    useWorkspaces: staticHook({
      phase: 'ready',
      state: 'ready',
      items: [{ workspaceId: 'w', title: 'Workspace', path: '/workspace', createdAt: new Date(0).toISOString(), sessionIds: [] }],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    }),
    useStore: staticHook({ groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'default', groupExpansion: {}, sessionOrderByAccount: {} }),
    actions: {
      retainAccountKeys: noop,
      syncSessionOrders: noop,
      setArchivedFilter: noop,
      setGroupBy: noop,
      setOrderBy: noop,
      setGroupExpanded: noop,
      setSessionOrder: noop,
    },
    startSession: noop,
    open: noop,
    requestSessionRename: noop,
    notifyArchivedNotOpenable: noop,
    renameWorkspace: async () => {},
    deleteWorkspace: async () => {},
    insertWorkspaceBefore: async () => {},
    unarchiveSession: async () => {},
    createWorkspace: async () => {},
    searchSessions: async () => ({ items: [], hasMore: false }),
    searchResultLimit: 50,
    useDirectoryFlow: staticHook(false),
    useHostInfo: staticHook({}),
    useShortcuts: staticHook([]),
    useWorkspaceShortcuts: staticHook({ searchRequest: 1, addRequested: false }),
    requestSearch: noop,
    requestAddWorkspace: noop,
    closeAddWorkspace: noop,
    setDirectoryBusy: noop,
    renderSlot: () => null,
    t: key => key,
    ...overrides,
  }
}
function changeInput(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

test('workspace search preserves composing Escape; the first ordinary Escape clears locally and the next may close its parent', async () => {
  let bubbled = 0
  const view = await mount(
    React.createElement(
      'div',
      {
        onKeyDown: event => {
          if (event.key === 'Escape') bubbled++
        },
      },
      React.createElement(WorkspaceBrowser, browserProps()),
    ),
  )
  try {
    const input = view.container.querySelector('input[type="text"]')
    await act(async () => changeInput(input, 'keep query'))
    await act(async () => {
      key(input, 'Escape', { keyCode: 229 })
      input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
      key(input, 'Escape')
      input.dispatchEvent(new Event('compositionend', { bubbles: true }))
      key(input, 'Escape')
    })
    assert.equal(input.value, 'keep query')
    assert.equal(bubbled, 0)
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    await act(async () => assert.equal(key(input, 'Escape').defaultPrevented, true))
    assert.equal(input.value, '')
    assert.equal(bubbled, 0)
    await act(async () => key(input, 'Escape'))
    assert.equal(bubbled, 1)
  } finally {
    await view.close()
  }
})

test('workspace rename keeps legacy 229 and the closing IME Enter from submitting', async () => {
  const writes = []
  const view = await mount(React.createElement(WorkspaceBrowser, browserProps({ renameWorkspace: async (...args) => writes.push(args) })))
  try {
    await act(async () => view.container.querySelector('[data-workspace="w"] [data-rename]').click())
    const input = view.container.querySelector('input[aria-label="field.workspaceName"]')
    await act(async () => changeInput(input, 'New workspace'))
    await act(async () => {
      key(input, 'Enter', { keyCode: 229 })
      input.dispatchEvent(new Event('compositionstart', { bubbles: true }))
      input.dispatchEvent(new Event('compositionend', { bubbles: true }))
      key(input, 'Enter')
    })
    assert.deepEqual(writes, [])
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    await act(async () => key(input, 'Enter'))
    assert.deepEqual(writes, [['w', 'New workspace']])
  } finally {
    await view.close()
  }
})

function formFixture(initial) {
  let revision = 1,
    user = structuredClone(initial)
  let writable = true
  const mirrorStore = createSnapshotStore({
    view: { writable: true, namespaces: [{ ns: 'ns', value: structuredClone(user), base: {}, user: structuredClone(user), revision, schema: {} }] },
  })
  const mirror = {
    getSnapshot: mirrorStore.getSnapshot,
    subscribe: mirrorStore.subscribe,
    acceptView: view => mirrorStore.set({ view: { writable, namespaces: [view] } }),
    load: async () => mirror.acceptView(snapshot()),
  }
  const snapshot = () => ({ ns: 'ns', value: structuredClone(user), base: {}, user: structuredClone(user), revision, schema: {} })
  const calls = []
  let held
  const mutate = async (_ns, ops, expected) => {
    calls.push({ ops, expected })
    if (held !== undefined) {
      const pending = held
      held = undefined
      await pending.promise
    }
    if (expected !== revision) return { ok: false, error: { code: 'conflict' } }
    for (const op of ops) {
      let parent = user
      for (const key of op.path.slice(0, -1)) parent = parent[key] ??= {}
      if (op.op === 'unset') delete parent[op.path.at(-1)]
      else parent[op.path.at(-1)] = structuredClone(op.value)
    }
    revision++
    return { ok: true, value: snapshot() }
  }
  const form = new ConfigFormController({ remote: { settings: { mutate } } }, { namespace: 'ns', decode: value => value }, mirror, {})
  return {
    form,
    mirror,
    calls,
    value: () => user,
    holdNext() {
      held = deferred()
      return held
    },
    external(change) {
      change(user)
      revision++
      mirror.acceptView(snapshot())
    },
    setWritable(value) {
      writable = value
      mirror.acceptView(snapshot())
    },
  }
}

test('a manual price cache write settles before the model edit takes its revision fence', async () => {
  const fixture = formFixture({ models: {}, prices: {} })
  const held = fixture.holdNext()
  const catalog = createSnapshotStore({ status: 'ready', value: { groups: [{ id: 'vendor', models: [{ id: 'model-a', name: 'Model A' }] }] }, error: null })
  const controller = new ModelPickerSettingsController({
    form: fixture.form,
    catalog,
    loadCatalog() {},
    blurb: () => '',
    effortName: id => id,
    fetcher: async () => ({ ok: true, json: async () => ({ vendor: { models: { 'model-a': { cost: { input: 1, output: 2 } } } } }) }),
  })
  try {
    controller.face.refreshPrices()
    await tick()
    assert.equal(fixture.calls.length, 1)
    controller.face.toggleModel('model-a')
    controller.face.editField('description', 'edited')
    controller.face.saveModel()
    held.resolve()
    await tick()
    await tick()
    assert.equal(fixture.value().models['model-a']?.description, 'edited', JSON.stringify({ calls: fixture.calls }))
    assert.deepEqual(
      fixture.calls.map(call => call.expected),
      [1, 2],
    )
    assert.equal(controller.face.hooks.modelSettings.getSnapshot().editor, undefined)
  } finally {
    controller.dispose()
    await fixture.form.dispose()
  }
})

test('reasoning row B rebases after unrelated row A saves; a same-row external edit remains fenced and cancel clears feedback', async () => {
  const fixture = formFixture({
    providers: {
      route: {
        models: [
          { id: 'a', name: 'A', keep: 1 },
          { id: 'b', name: 'B', keep: 2 },
        ],
      },
    },
  })
  const controller = new ReasoningDeclarationController({
    namespace: 'ns',
    form: fixture.form,
    describe: fixture.mirror,
    schema: {},
    discoverCatalog: async () => [],
  })
  const view = await mount(
    React.createElement(ReasoningDeclarationCard, {
      provider: { provider: 'route', settingsNs: 'ns', settingsPath: ['providers', 'route'] },
      useForm: observe(controller.face.hooks.form),
      useMirror: observe(controller.face.hooks.mirror),
      useDeclaration: observe(controller.store),
      levels: () => ['off', 'low', 'medium', 'high'],
      loadCatalog: controller.face.loadCatalog,
      saveModel: controller.face.saveModel,
      t: key => key,
    }),
  )
  try {
    const row = id => view.container.querySelector(`[data-model-id="${id}"]`)
    await act(async () => {
      row('a').querySelector('input[type="checkbox"]').click()
      row('b').querySelector('input[type="checkbox"]').click()
    })
    await act(async () => [...row('a').querySelectorAll('button')].find(node => node.textContent === 'apply').click())
    await act(async () => [...row('b').querySelectorAll('button')].find(node => node.textContent === 'apply').click())
    assert.equal(fixture.calls.length, 2)
    assert.ok(fixture.value().providers.route.models[0].reasoningEfforts)
    assert.ok(fixture.value().providers.route.models[1].reasoningEfforts)
    assert.deepEqual(
      fixture.value().providers.route.models.map(model => model.keep),
      [1, 2],
    )
    await act(async () => row('b').querySelector('input[type="checkbox"]').click())
    await act(async () =>
      fixture.external(value => {
        value.providers.route.models[1].name = 'External name'
      }),
    )
    await act(async () => [...row('b').querySelectorAll('button')].find(node => node.textContent === 'apply').click())
    assert.equal(fixture.calls.length, 2, 'a stale whole-row replacement never crosses the wire')
    assert.equal(row('b').querySelector('[role="alert"]').textContent, 'writeRefused')
    await act(async () => [...row('b').querySelectorAll('button')].find(node => node.textContent === 'cancel').click())
    assert.equal(view.container.querySelector('[role="alert"]'), null)
    assert.equal(fixture.value().providers.route.models[1].name, 'External name')
    await act(async () => row('b').querySelector('input[type="checkbox"]').click())
    await act(async () => [...row('b').querySelectorAll('button')].find(node => node.textContent === 'apply').click())
    assert.equal(fixture.calls.length, 3, 'cancel and re-edit start with the latest protected revision')
    assert.equal(fixture.value().providers.route.models[1].name, 'External name')
    await act(async () => row('a').querySelector('input[type="checkbox"]').click())
    await act(async () =>
      fixture.external(value => {
        value.providers.route.models.reverse()
      }),
    )
    assert.equal(
      [...row('a').querySelectorAll('button')].some(node => node.textContent === 'apply'),
      false,
      'moving a row resets its position-owned edit',
    )
    assert.equal(
      await controller.face.saveModel(
        { provider: 'route', settingsPath: ['providers', 'route'], index: 0, modelId: 'a' },
        { id: 'a', reasoningEfforts: false },
        fixture.form.getSnapshot().revision,
      ),
      false,
    )
    assert.equal(fixture.calls.length, 3, 'a mismatched target identity never overwrites the replacement row')
  } finally {
    await view.close()
    controller.dispose()
    await fixture.form.dispose()
  }
})

test('flat-list paging keeps the complete account for ordering and always reveals the current or searched row', async () => {
  const writes = [],
    listStore = createSnapshotStore(sessionList(120))
  const props = treeProps(listStore.getSnapshot(), writes)
  const reveal = createSnapshotStore(undefined)
  function Host() {
    const list = React.useSyncExternalStore(listStore.subscribe, listStore.getSnapshot)
    const id = React.useSyncExternalStore(reveal.subscribe, reveal.getSnapshot)
    return React.createElement(FlatList, { ...props, list, sessionIds: list.ids, revealSessionId: id })
  }
  const view = await mount(React.createElement(Host))
  try {
    const rows = () => view.container.querySelectorAll('[data-session]')
    const overflow = () => view.container.querySelector('[data-row-key="overflow:flat"]')
    assert.equal(rows().length, 50)
    const first = rows()[0]
    await act(async () => overflow().click())
    assert.equal(rows().length, 100)
    assert.equal(rows()[0], first, 'expansion preserves mounted row identity')
    await act(async () => overflow().click())
    assert.equal(rows().length, 120)
    await act(async () => overflow().click())
    assert.equal(rows().length, 50)
    await act(async () => view.container.querySelector('[data-session="s0"] [data-start]').click())
    await act(async () => view.container.querySelector('[data-session="s49"] [data-drop]').click())
    assert.equal(writes[0][1].length, 120)
    assert.deepEqual(writes[0][1].slice(48, 52), ['s49', 's0', 's50', 's51'])
    await act(async () => reveal.set('s119'))
    assert.ok(view.container.querySelector('[data-session="s119"]'))
    await act(async () => {
      reveal.set(undefined)
      listStore.update(d => {
        d.byId.s119.retainedBy.mainView = 1
      })
    })
    assert.ok(view.container.querySelector('[data-session="s119"]'))
  } finally {
    await view.close()
  }
})

test('model projection caching invalidates on settings/catalog changes and memoized summaries still follow a stable translation thunk', async () => {
  const fixture = formFixture({ models: {}, prices: {} })
  const catalog = createSnapshotStore({ status: 'ready', value: { groups: [{ id: 'vendor', models: [{ id: 'a', name: 'Model A' }] }] }, error: null })
  const controller = new ModelPickerSettingsController({ form: fixture.form, catalog, loadCatalog() {}, blurb: () => '', effortName: id => id })
  const initial = controller.face.hooks.modelSettings.getSnapshot().rows
  controller.face.toggleModel('a')
  controller.face.editField('description', 'draft')
  assert.equal(controller.face.hooks.modelSettings.getSnapshot().rows, initial)
  fixture.external(value => {
    value.models.a = { quality: 5 }
  })
  assert.notEqual(controller.face.hooks.modelSettings.getSnapshot().rows, initial)
  assert.equal(controller.face.hooks.modelSettings.getSnapshot().rows[0].quality, 5)
  catalog.update(d => {
    d.value.groups[0].models.push({ id: 'b', name: 'Model B' })
  })
  assert.equal(controller.face.hooks.modelSettings.getSnapshot().rows.length, 2)
  controller.face.cancelEdit()
  const language = createSnapshotStore('en')
  const t = key => (key === 'time.locale' ? language.getSnapshot() : `${language.getSnapshot()}:${key}`)
  function Host() {
    React.useSyncExternalStore(language.subscribe, language.getSnapshot)
    return React.createElement(ModelPickerSettingsCard, { ...controller.face, useModelSettings: observe(controller.face.hooks.modelSettings), t })
  }
  const view = await mount(React.createElement(Host))
  try {
    assert.ok(view.container.textContent.includes('en:price.none'))
    await act(async () => language.set('ja'))
    assert.ok(view.container.textContent.includes('ja:price.none'))
    assert.ok(!view.container.textContent.includes('en:'))
  } finally {
    await view.close()
    controller.dispose()
    await fixture.form.dispose()
  }
})

test('waiting for local prices preserves same-field external conflicts and unrelated user fields', async () => {
  for (const sameField of [false, true]) {
    const fixture = formFixture({ models: {}, prices: {} }),
      held = fixture.holdNext()
    const catalog = createSnapshotStore({ status: 'ready', value: { groups: [{ id: 'vendor', models: [{ id: 'a', name: 'Model A' }] }] }, error: null })
    const controller = new ModelPickerSettingsController({
      form: fixture.form,
      catalog,
      loadCatalog() {},
      blurb: () => '',
      effortName: id => id,
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
    })
    try {
      controller.face.refreshPrices()
      await tick()
      controller.face.toggleModel('a')
      controller.face.editField('description', 'mine')
      controller.face.saveModel()
      fixture.external(value => {
        value.models.a = sameField ? { description: 'external' } : { quality: 4 }
      })
      held.resolve()
      await tick()
      await tick()
      if (sameField) {
        assert.equal(fixture.value().models.a.description, 'external')
        assert.equal(fixture.calls.length, 1)
        assert.equal(controller.face.hooks.modelSettings.getSnapshot().editor.conflicted, true)
      } else {
        assert.deepEqual(fixture.value().models.a, { quality: 4, description: 'mine' })
        assert.deepEqual(
          fixture.calls.map(call => call.expected),
          [1, 2],
        )
      }
    } finally {
      controller.dispose()
      await fixture.form.dispose()
    }
  }
})

test('save and restore recheck permission and target existence after waiting for a price write', async () => {
  for (const operation of ['saveModel', 'restoreModel'])
    for (const change of ['readonly', 'removed']) {
      const fixture = formFixture({ models: { a: { quality: 4 } }, prices: {} }),
        held = fixture.holdNext()
      const catalog = createSnapshotStore({ status: 'ready', value: { groups: [{ id: 'vendor', models: [{ id: 'a', name: 'Model A' }] }] }, error: null })
      const controller = new ModelPickerSettingsController({
        form: fixture.form,
        catalog,
        loadCatalog() {},
        blurb: () => '',
        effortName: id => id,
        fetcher: async () => ({ ok: true, json: async () => ({}) }),
      })
      try {
        controller.face.refreshPrices()
        await tick()
        controller.face.toggleModel('a')
        controller.face.editField('description', 'mine')
        controller.face[operation]()
        if (change === 'readonly') fixture.setWritable(false)
        else
          catalog.update(d => {
            d.value.groups[0].models = [{ id: 'b', name: 'Replacement' }]
          })
        held.resolve()
        await tick()
        await tick()
        assert.equal(fixture.calls.length, 1, `${operation} must not write after ${change}`)
        assert.deepEqual(fixture.value().models.a, { quality: 4 })
      } finally {
        controller.dispose()
        await fixture.form.dispose()
      }
    }
})

test('file transfer dragend and service disposal clean their listeners under the existing URL ownership policy', async () => {
  const create = URL.createObjectURL,
    revoke = URL.revokeObjectURL
  const revoked = [],
    activeDropListeners = new Set()
  URL.createObjectURL = () => 'blob:owned'
  URL.revokeObjectURL = url => revoked.push(url)
  const add = window.addEventListener,
    remove = window.removeEventListener
  window.addEventListener = function (type, listener, options) {
    if (type === 'drop') activeDropListeners.add(listener)
    return add.call(this, type, listener, options)
  }
  window.removeEventListener = function (type, listener, options) {
    if (type === 'drop') activeDropListeners.delete(listener)
    return remove.call(this, type, listener, options)
  }
  const transfers = new FileTransfers()
  try {
    const source = document.createElement('img'),
      values = new Map()
    const transfer = { items: { clear() {} }, setData: (key, value) => values.set(key, value), getData: key => values.get(key) }
    const prepare = () =>
      transfers.prepare({ kind: 'blob', blob: new Blob(['bytes']), name: 'image.png', mediaType: 'image/png' }, new AbortController().signal)
    const prepared = await prepare()
    assert.equal(prepared.start(transfer, source), true)
    assert.ok(transfers.read(transfer))
    assert.equal(activeDropListeners.size, 1)
    source.dispatchEvent(new Event('dragend'))
    assert.equal(activeDropListeners.size, 0)
    assert.equal(transfers.read(transfer), undefined)
    assert.deepEqual(revoked, [], 'dragend alone does not unconditionally revoke an owner-retained preparation')
    prepared.release()
    assert.deepEqual(revoked, ['blob:owned'])
    assert.equal(prepared.start(transfer, source), false)
    assert.ok(values.has(FILE_DRAG_TOKEN_TYPE))
    const active = await prepare()
    active.start(transfer, source)
    active.release()
    transfers.dispose()
    assert.equal(activeDropListeners.size, 0)
    assert.equal(revoked.length, 2)
  } finally {
    transfers.dispose()
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    window.addEventListener = add
    window.removeEventListener = remove
  }
})
test('MessageImage failures do not retry automatically; one click requests one fresh attempt', async () => {
  let calls = 0
  const load = async () => {
    calls++
    throw new Error('offline')
  }
  const labels = { image: 'image', loading: 'loading', loadFailed: 'retry image', open: 'open', openNamed: name => name, lightbox: {} }
  const image = { attachment: { attachmentId: 'image', name: 'image.png', width: 20, height: 20 } }
  const view = await mount(React.createElement(MessageImage, { image, load, variant: 'single', fileDrag: {}, labels }))
  try {
    assert.equal(calls, 1)
    await act(async () => {
      await tick()
      await tick()
    })
    assert.equal(calls, 1)
    await act(async () => view.container.querySelector('button').click())
    assert.equal(calls, 2)
    await act(async () => {
      await tick()
      await tick()
    })
    assert.equal(calls, 2)
  } finally {
    await view.close()
  }
})
