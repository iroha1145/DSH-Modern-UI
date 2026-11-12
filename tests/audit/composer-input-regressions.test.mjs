import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { build } from './helpers/client-build.mjs'
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
  'HTMLTextAreaElement',
  'MutationObserver',
  'Event',
  'KeyboardEvent',
  'WheelEvent',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key],
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
Object.defineProperty(document, 'fonts', { value: { addEventListener() {}, removeEventListener() {} } })
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React
// Execute the installed helper itself without initializing unrelated syntax highlighters in its barrel.
const primitivesSource = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
const compositionSource = primitivesSource.slice(
  primitivesSource.indexOf('function observeComposition('),
  primitivesSource.indexOf('//#endregion', primitivesSource.indexOf('function observeComposition(')),
)
const bundle = await build({
  absWorkingDir: root,
  tsconfigRaw: {},
  stdin: {
    contents: `export { InlineEditor } from './packages/modern-ui/src/vendor/primitives/InlineEditor.tsx';
    export { QueueDock } from './packages/modern-ui/src/vendor/conversation/client/queue/QueueDock.tsx';
    export { SessionInputShell } from './packages/modern-ui/src/vendor/conversation/client/input/facade.ts';
    export { InputBar } from './packages/modern-ui/src/vendor/conversation/client/skeleton/InputBar.tsx';
    export { installDraftWheel, installDraftKeymap } from './packages/modern-ui/src/vendor/conversation/client/input/editor/view-binding.ts';
    export { readFailedInputSends, writeFailedInputSends, readConversationDraft, readConversationViewPreference, writeRecoveredConversationDraft } from './packages/modern-ui/src/vendor/conversation/client/stores.ts';`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  plugins: [
    {
      name: 'surroundings',
      setup(builder) {
        builder.onResolve({ filter: /(?:ContextMeter\.tsx|original-image-drop\.ts|DraftEditor\.tsx)$/ }, args => ({
          path: args.path,
          namespace: 'surrounding-ui',
        }))
        builder.onLoad({ filter: /.*/, namespace: 'surrounding-ui' }, args => ({
          contents: args.path.endsWith('ContextMeter.tsx')
            ? 'export const ContextMeter=()=>null'
            : args.path.endsWith('DraftEditor.tsx')
              ? 'export const DraftEditor=()=>null'
              : 'export const useOriginalImageDrop=()=>{}',
        }))
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'composition', namespace: 'composition' }))
        builder.onLoad({ filter: /.*/, namespace: 'composition' }, () => ({ contents: `export ${compositionSource}` }))
        builder.onResolve({ filter: /^@iroha1145\/dsh-modern-ui\/primitives$/ }, () => ({ path: 'primitives', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export { InlineEditor } from './packages/modern-ui/src/vendor/primitives/InlineEditor.tsx';
      export const Tooltip=({children})=>children, Toast=()=>null, IconPlusOutlineMedium=()=>null, IconWarningOutlineRegular=()=>null;
      export const ReferenceIconRegular=()=>null, QuotePreview=()=>null;
      export { formatQuoteText } from './packages/modern-ui/src/vendor/primitives/markdown/quote-text.ts';
      export const IconCheckOutlineRegular=()=>null,IconChevronDownOutlineRegular=()=>null,IconChevronUpOutlineRegular=()=>null,IconCloseOutlineRegular=()=>null,FileTypeIcon=()=>null,fileSizeText=()=>'',IconEditOutlineRegular=()=>null,IconQueueOutlineRegular=()=>null,IconSendOutlineRegular=()=>null,IconTrashOutlineRegular=()=>null;
      export const focusWithoutRing=(el,options)=>el.focus(options),isMobileDevice=()=>false;`,
          loader: 'tsx',
          resolveDir: root,
        }))
        builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'css' }))
        builder.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}' }))
        builder.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }))
      },
    },
  ],
})
const compiled = new Module(`${root}/.artifacts/composer-regressions.cjs`)
compiled.filename = `${root}/.artifacts/composer-regressions.cjs`
compiled.paths = Module._nodeModulePaths(root)
compiled._compile(bundle.outputFiles[0].text, compiled.filename)
const {
  InlineEditor,
  QueueDock,
  SessionInputShell,
  InputBar,
  installDraftWheel,
  installDraftKeymap,
  readFailedInputSends,
  writeFailedInputSends,
  readConversationDraft,
  writeRecoveredConversationDraft,
  readConversationViewPreference,
} = compiled.exports

async function mount(component) {
  const container = document.createElement('div')
  document.body.append(container)
  const reactRoot = createRoot(container)
  await act(async () => reactRoot.render(component))
  return {
    container,
    async close() {
      await act(async () => reactRoot.unmount())
      container.remove()
    },
  }
}
function key(node, name, options = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })
  node.dispatchEvent(event)
  return event
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('InlineEditor keeps composing Escape and legacy 229 inside the editor; normal Escape cancels once', async () => {
  let saved = 0,
    cancelled = 0,
    bubbled = 0
  const view = await mount(
    React.createElement(
      'div',
      {
        onKeyDown: () => {
          bubbled++
        },
      },
      React.createElement(InlineEditor, {
        value: 'retain',
        label: 'draft',
        onChange() {},
        onSave: () => {
          saved++
        },
        onCancel: () => {
          cancelled++
        },
      }),
    ),
  )
  try {
    const textarea = view.container.querySelector('textarea')
    await act(async () => {
      key(textarea, 'Escape', { isComposing: true })
      key(textarea, 'Escape', { keyCode: 229 })
      key(textarea, 'Enter', { keyCode: 229 })
      textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }))
      key(textarea, 'Escape')
      textarea.dispatchEvent(new Event('compositionend', { bubbles: true }))
      key(textarea, 'Escape')
      textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
    })
    assert.equal(saved, 0)
    assert.equal(cancelled, 0)
    assert.equal(bubbled, 1, 'only guarded Enter may bubble to an IME-aware parent')
    await act(async () => {
      assert.equal(key(textarea, 'Escape').defaultPrevented, true)
    })
    assert.equal(cancelled, 1)
    assert.equal(bubbled, 1)
  } finally {
    await view.close()
  }
})

test('draft edge wheel preserves browser zoom and converts line/page deltas', () => {
  const host = document.createElement('div')
  host.dataset.conversationScroll = ''
  const editor = document.createElement('div')
  host.append(editor)
  document.body.append(host)
  editor.style.lineHeight = '24px'
  Object.defineProperties(editor, { clientHeight: { value: 100 }, scrollHeight: { value: 100 } })
  const dispose = installDraftWheel({ current: editor })
  try {
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const event = new WheelEvent('wheel', { deltaY: 5, [modifier]: true, bubbles: true, cancelable: true })
      editor.dispatchEvent(event)
      assert.equal(event.defaultPrevented, false)
      assert.equal(host.scrollTop, 0)
    }
    for (const [deltaMode, deltaY, expected] of [
      [0, 10, 10],
      [1, 2, 58],
      [2, 1, 158],
    ]) {
      const event = new WheelEvent('wheel', { deltaMode, deltaY, cancelable: true })
      editor.dispatchEvent(event)
      assert.equal(event.defaultPrevented, true)
      assert.equal(host.scrollTop, expected)
    }
  } finally {
    dispose()
    host.remove()
  }
})

test('QueueDock admits one edit during synchronous reentry and retains the value for retry after failure', async () => {
  const requests = [],
    notices = []
  let pending = deferred()
  const queue = [{ id: 'row', content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } }]
  const view = await mount(
    React.createElement(QueueDock, {
      useProjection: () => ({ 'next-turn': queue }),
      useSession: select => select({ pendingSubmissions: [], running: false, subagent: null }),
      updateQueue: (id, action) => {
        requests.push({ id, action })
        return pending.promise
      },
      notify: (...args) => notices.push(args),
      loadImage: async () => '',
      renderFactorySlot: (_name, props) => props.text,
      t: key => key,
    }),
  )
  try {
    await act(async () => view.container.querySelector('[aria-label="queue.edit"]').click())
    const textarea = view.container.querySelector('textarea')
    await act(async () => {
      key(textarea, 'Enter')
      key(textarea, 'Enter')
    })
    assert.equal(requests.length, 1)
    await act(async () => pending.reject(new Error('offline')))
    assert.equal(view.container.querySelector('textarea').value, 'original')
    assert.equal(notices.length, 1)
    pending = deferred()
    await act(async () => {
      key(textarea, 'Enter')
      key(textarea, 'Enter')
    })
    assert.equal(requests.length, 2)
    await act(async () => pending.resolve())
    assert.equal(view.container.querySelector('textarea'), null)
  } finally {
    await view.close()
  }
})

function shellFixture(deps = {}) {
  const sends = [],
    writes = [],
    released = []
  const shell = new SessionInputShell({
    actx: {},
    defaultSink: (text, attachmentIds) => {
      const result = deferred()
      sends.push({ text, attachmentIds, ...result })
      return result.promise
    },
    commandAttachments: { serialize: async () => [], release: ids => released.push(...ids), unsupportedNotice: () => '' },
    ...deps,
  })
  shell.bindDraftPersistence(value => writes.push(value))
  return { shell, sends, writes, released }
}

test('input persistence counts semantic edits, not selection or attachment publication', async () => {
  const { shell, writes } = shellFixture()
  try {
    for (let i = 1; i <= 10; i++) shell.setDraft('x'.repeat(i))
    assert.equal(writes.length, 10)
    shell.editor.update(() => {}, { discrete: true })
    shell.addAttachments(['A'])
    shell.removeAttachment('A')
    assert.equal(writes.length, 10)
    shell.persistCurrentDraft()
    assert.equal(writes.length, 11)
  } finally {
    shell.dispose()
  }
  await tick()
})

test('a failed detached message never contributes attachments or text to a newer draft, including after the newer draft was sent', async () => {
  const { shell, sends } = shellFixture()
  try {
    shell.setDraft('old message')
    shell.addAttachments(['A'])
    shell.submit()
    shell.setDraft('new message')
    shell.addAttachments(['B'])
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, 'new message')
    assert.deepEqual(shell.snapshot.attachmentIds, ['B'])
    const failure = shell.snapshot.failedSends[0]
    assert.equal(failure.draft.text, 'old message')
    assert.equal(shell.actions.restoreFailedSend(failure.id), false)
    shell.submit()
    assert.deepEqual(sends[1].attachmentIds, ['B'])
    sends[1].resolve({ kind: 'success' })
    await tick()
    assert.equal(shell.snapshot.draft, '')
    assert.deepEqual(shell.snapshot.attachmentIds, [])
    assert.equal(shell.snapshot.failedSends.length, 1, 'an unrelated settlement does not revive an older failure')
    assert.equal(shell.actions.restoreFailedSend(failure.id), true)
    assert.equal(shell.snapshot.draft, 'old message')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    assert.equal(shell.snapshot.failedSends.length, 1, 'attachment recovery metadata remains until explicit handling or successful admission')
    assert.equal(shell.snapshot.failedSends[0].restored, true)
  } finally {
    shell.dispose()
  }
})

test('untouched automatic recovery is atomic; an attachment-only newer draft blocks recovery too', async () => {
  const { shell, sends } = shellFixture()
  try {
    shell.setDraft('first')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].resolve({ kind: 'error', text: 'offline' })
    await tick()
    assert.equal(shell.snapshot.draft, 'first')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    shell.submit()
    shell.addAttachments(['B'])
    sends[1].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, '')
    assert.deepEqual(shell.snapshot.attachmentIds, ['B'])
    assert.equal(shell.snapshot.failedSends[0].draft.text, 'first')
  } finally {
    shell.dispose()
  }
})

// The real Enter gesture: a DOM keydown on the mounted root reaches the composer keymap as a Lexical command,
// so submit() runs inside an editor update and the post-send clear is a nested, deferred update.
function enterFixture() {
  const fixture = shellFixture()
  const host = document.createElement('div')
  host.contentEditable = 'true'
  document.body.append(host)
  fixture.shell.editor.setRootElement(host)
  const gate = {
    current: {
      locked: false,
      machineBusy: false,
      canSteerQueue: false,
      running: false,
      steeringAvailable: false,
      busyEnter: 'queue',
      intakeFiles() {},
      uploadsPending: false,
      uploadsHeldText: '',
      showToast() {},
      canAcceptDrop: true,
    },
  }
  const offKeymap = installDraftKeymap(fixture.shell.editor, fixture.shell, gate)
  return {
    ...fixture,
    enter: () => key(host, 'Enter', { code: 'Enter', keyCode: 13 }),
    close() {
      offKeymap()
      fixture.shell.dispose()
      host.remove()
    },
  }
}

test('an Enter-key send recovers into its own untouched empty draft like a clicked send; an empty Enter is not an edit', async () => {
  const { shell, sends, enter, close } = enterFixture()
  try {
    shell.setDraft('typed then Enter')
    shell.addAttachments(['A'])
    enter()
    assert.equal(sends.length, 1)
    assert.equal(sends[0].text, 'typed then Enter')
    assert.equal(shell.snapshot.draft, '')
    enter()
    assert.equal(sends.length, 1)
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, 'typed then Enter')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    assert.deepEqual(
      shell.snapshot.failedSends.filter(record => record.restored !== true),
      [],
    )
  } finally {
    close()
  }
})

test('an edit after an Enter-key send still keeps the failed message out of the newer draft', async () => {
  const { shell, sends, enter, close } = enterFixture()
  try {
    shell.setDraft('first')
    enter()
    shell.setDraft('x')
    shell.setDraft('')
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, '')
    assert.equal(shell.snapshot.failedSends.length, 1)
    assert.equal(shell.snapshot.failedSends[0].draft.text, 'first')
    assert.notEqual(shell.snapshot.failedSends[0].restored, true)
  } finally {
    close()
  }
})

// The browser registry behind availableAttachmentIds: apply.ts releases an attachment right after the shell
// accepts its removal, and a reload drops every runtime image.
function registryFixture(ids, deps = {}) {
  const live = new Set(ids)
  return { live, ...shellFixture({ availableAttachmentIds: list => list.filter(id => live.has(id)), ...deps }) }
}

test('a visible recovery backup survives clearing the composer and a later unrelated message', async () => {
  let stored = []
  const { shell, sends, live } = registryFixture(['A'], {
    persistFailedSends: records => {
      stored = records
    },
  })
  try {
    shell.setDraft('a long prompt worth keeping')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, 'a long prompt worth keeping')
    live.delete('A')
    shell.pruneAttachments([])
    // The text is still in the composer, so the card (shown for its missing file) still backs this draft.
    assert.equal(shell.snapshot.failedSends[0].restored, true)
    assert.equal(shell.snapshot.failedSends[0].missingAttachments, 1)
    shell.setDraft('')
    assert.notEqual(shell.snapshot.failedSends[0].restored, true)
    shell.setDraft('ping')
    shell.submit()
    sends[1].resolve({ kind: 'success' })
    await tick()
    assert.equal(shell.snapshot.failedSends.length, 1)
    assert.equal(shell.snapshot.failedSends[0].draft.text, 'a long prompt worth keeping')
    assert.equal(stored.length, 1)
    assert.equal(stored[0].draft.text, 'a long prompt worth keeping')
    assert.equal(shell.actions.restoreFailedSend(shell.snapshot.failedSends[0].id), true)
    assert.equal(shell.snapshot.draft, 'a long prompt worth keeping')
  } finally {
    shell.dispose()
  }
})

test('removing an attachment from a restored draft updates its backup, so no file is reported missing and a second failure recovers again', async () => {
  const { shell, sends, live } = registryFixture(['A', 'B'])
  try {
    shell.setDraft('text with two images')
    shell.addAttachments(['A', 'B'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    assert.deepEqual(shell.snapshot.attachmentIds, ['A', 'B'])
    assert.equal(shell.removeAttachment('B'), true)
    live.delete('B')
    shell.setDraft('text with one image')
    const [record] = shell.snapshot.failedSends
    assert.equal(record.attachmentCount, 1)
    assert.equal(record.missingAttachments, 0)
    assert.equal(record.restored, true)
    shell.submit()
    sends[1].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, 'text with one image')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    assert.deepEqual(
      shell.snapshot.failedSends.filter(item => item.restored !== true),
      [],
    )
  } finally {
    shell.dispose()
  }
})

test('emptying an automatically restored draft keeps its text as an explicit backup; an attachment-only message removed by hand leaves none', async () => {
  const text = registryFixture(['A'])
  try {
    text.shell.setDraft('first')
    text.shell.addAttachments(['A'])
    text.shell.submit()
    text.sends[0].reject(new Error('offline'))
    await tick()
    text.shell.setDraft('')
    // The image is still in the composer: the draft is edited, not abandoned.
    assert.equal(text.shell.snapshot.failedSends[0].restored, true)
    assert.equal(text.shell.removeAttachment('A'), true)
    text.live.delete('A')
    text.shell.setDraft('second')
    text.shell.submit()
    text.sends[1].resolve({ kind: 'success' })
    await tick()
    assert.equal(text.shell.snapshot.failedSends.length, 1)
    const [backup] = text.shell.snapshot.failedSends
    assert.equal(backup.draft.text, 'first')
    assert.equal(backup.attachmentCount, 0)
    assert.equal(backup.missingAttachments, 0)
    assert.notEqual(backup.restored, true)
  } finally {
    text.shell.dispose()
  }
  const image = registryFixture(['A'])
  try {
    image.shell.addAttachments(['A'])
    image.shell.submit()
    image.sends[0].resolve({ kind: 'error', text: 'offline' })
    await tick()
    assert.deepEqual(image.shell.snapshot.attachmentIds, ['A'])
    assert.equal(image.shell.snapshot.failedSends.length, 1)
    assert.equal(image.shell.removeAttachment('A'), true)
    assert.deepEqual(image.shell.snapshot.failedSends, [])
  } finally {
    image.shell.dispose()
  }
})

test('reverse failures stay distinct in send order; discard releases only that message and teardown ignores stale settlements', async () => {
  const { shell, sends, released } = shellFixture()
  shell.setDraft('first')
  shell.addAttachments(['A'])
  shell.submit()
  shell.setDraft('second')
  shell.addAttachments(['B'])
  shell.submit()
  shell.setDraft('working')
  sends[1].reject(new Error('second failed'))
  await tick()
  sends[0].reject(new Error('first failed'))
  await tick()
  assert.deepEqual(
    shell.snapshot.failedSends.map(row => row.draft.text),
    ['first', 'second'],
  )
  shell.actions.discardFailedSend(shell.snapshot.failedSends[0].id)
  assert.deepEqual(released, ['A'])
  assert.equal(shell.snapshot.draft, 'working')
  shell.submit()
  assert.deepEqual(shell.dispose(), ['B'])
  sends[2].reject(new Error('late'))
  await tick()
  assert.equal(shell.snapshot.failedSends.length, 1, 'disposed shell never publishes a late failure')
})

test('attachment-only failures keep their own message and cannot leak into a later message', async () => {
  const { shell, sends } = shellFixture()
  try {
    shell.addAttachments(['A'])
    shell.submit()
    shell.setDraft('working')
    shell.addAttachments(['B'])
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, 'working')
    assert.deepEqual(shell.snapshot.attachmentIds, ['B'])
    assert.equal(shell.snapshot.failedSends[0].attachmentCount, 1)
    shell.submit()
    sends[1].resolve({ kind: 'success' })
    await tick()
    shell.actions.restoreFailedSend(shell.snapshot.failedSends[0].id)
    assert.equal(shell.snapshot.draft, '')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
  } finally {
    shell.dispose()
  }
})

test('a failed message restores the semantic quote document with its own attachments', async () => {
  const { shell, sends } = shellFixture()
  try {
    shell.setDraft('message')
    shell.insertQuote('selected\nquoted text')
    shell.addAttachments(['A'])
    const semantic = shell.draftSnapshot
    assert.equal(semantic.quotes.length, 1)
    shell.submit()
    shell.setDraft('working')
    sends[0].reject(new Error('offline'))
    await tick()
    const failure = shell.snapshot.failedSends[0]
    assert.deepEqual(failure.draft, semantic)
    shell.setDraft('')
    assert.equal(shell.actions.restoreFailedSend(failure.id), true)
    assert.deepEqual(shell.draftSnapshot, semantic)
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
  } finally {
    shell.dispose()
  }
})

test('unmounted automatic recovery saves only its session draft', async () => {
  localStorage.clear()
  localStorage.setItem('dsh.conversation.one', JSON.stringify({ draft: '', view: 'kept-view' }))
  localStorage.setItem('dsh.conversation.two', JSON.stringify({ draft: 'other session', view: 'other-view' }))
  const { shell, sends } = shellFixture({
    persistRecoveredDraft: draft => writeRecoveredConversationDraft('one', draft),
  })
  try {
    shell.setDraft('recover while unmounted')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(readConversationDraft('one').text, 'recover while unmounted')
    assert.equal(JSON.parse(localStorage.getItem('dsh.conversation.one')).view, 'kept-view')
    assert.equal(readConversationDraft('two').text, 'other session')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    assert.equal(shell.notices.getSnapshot().text, 'offline')
  } finally {
    shell.dispose()
    localStorage.clear()
  }
})

test('runtime attachments lost before failure require explicit recovery and a missing-file notice', async () => {
  const { shell, sends } = shellFixture({ availableAttachmentIds: () => [], missingAttachmentsNotice: () => 'reattach files' })
  try {
    shell.setDraft('old message')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.draft, '')
    assert.equal(shell.snapshot.failedSends[0].missingAttachments, 1)
    shell.actions.restoreFailedSend(shell.snapshot.failedSends[0].id)
    assert.equal(shell.snapshot.draft, 'old message')
    assert.deepEqual(shell.snapshot.attachmentIds, [])
    assert.equal(shell.notices.getSnapshot().text, 'reattach files')
  } finally {
    shell.dispose()
  }
})

test('failed semantic messages survive reload per session and warn about unavailable runtime attachments on explicit restore', async () => {
  localStorage.clear()
  const { shell, sends } = shellFixture({ persistFailedSends: rows => writeFailedInputSends('one', rows) })
  shell.setDraft({ text: 'old @file', references: [{ source: 'reference', ref: 'f', offset: 4, length: 5, label: 'file', clipboardText: '@file' }] })
  // A serializer rejects before admission; its semantic reference remains recoverable.
  shell.addAttachments(['A'])
  shell.submit()
  shell.setDraft('working')
  await tick()
  assert.equal(sends.length, 0)
  const stored = readFailedInputSends('one')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].draft.references[0].ref, 'f')
  assert.equal(stored[0].missingAttachments, 1)
  assert.deepEqual(readFailedInputSends('two'), [])
  shell.dispose()
  const reload = shellFixture({
    failedSends: stored,
    persistRecoveredDraft: draft => writeRecoveredConversationDraft('one', draft),
    persistFailedSends: rows => writeFailedInputSends('one', rows),
    missingAttachmentsNotice: () => 'reattach files',
  }).shell
  try {
    assert.equal(reload.actions.restoreFailedSend(stored[0].id), true)
    assert.equal(reload.snapshot.draft, 'old @file')
    assert.equal(reload.snapshot.occurrences[0].ref, 'f')
    assert.deepEqual(reload.snapshot.attachmentIds, [])
    assert.equal(reload.notices.getSnapshot().text, 'reattach files')
    assert.equal(readConversationDraft('one').text, 'old @file')
    assert.equal(readFailedInputSends('one')[0].missingAttachments, 1, 'restoring text does not acknowledge lost attachments')
  } finally {
    reload.dispose()
    localStorage.clear()
  }
})

const selectValue = value => select => select(value)
function inputBarProps(shell, overrides = {}) {
  const observe = store => select => select(React.useSyncExternalStore(store.subscribe, store.getSnapshot))
  return {
    sessionId: 'fixture',
    variant: 'composer',
    useSession: selectValue({ removed: false, running: false, subagent: null }),
    useInput: observe(shell.state),
    inputActions: shell.actions,
    keyboard: shell,
    useBusyEnter: selectValue('queue'),
    useFileUploads: selectValue({}),
    useNotices: observe(shell.notices),
    useLexicon: selectValue(undefined),
    useMenuLauncher: selectValue(null),
    useStopShortcut: selectValue([]),
    useAccess: () => true,
    useProjection: (_name, select) => select?.(undefined),
    resolveDraftAttachments: ids => ids.map(id => ({ id, kind: 'image', file: new dom.window.File([], `${id}.png`, { type: 'image/png' }) })),
    t: key => key,
    renderSlot: () => null,
    addFiles: () => null,
    ...overrides,
  }
}

test('InputBar file picker shares the live intake gate for continuable, read-only, blocked, and offline sessions', async () => {
  for (const [mode, parentAvailable, blocked, allowed] of [
    ['continuable', true, undefined, true],
    ['readonly', true, undefined, false],
    ['continuable', false, undefined, false],
    ['continuable', true, { reason: 'blocked' }, false],
  ]) {
    const { shell } = shellFixture()
    const accepted = []
    let intake
    const view = await mount(
      React.createElement(
        InputBar,
        inputBarProps(shell, {
          blocked,
          useSession: selectValue({ subagent: { address: { mode }, parentAvailable } }),
          addFiles: files => {
            accepted.push(...files)
            return null
          },
          renderSlot: (name, props) => {
            if (name === 'conversation.input.attachments') intake = props
            return null
          },
        }),
      ),
    )
    try {
      const picker = view.container.querySelector('input[type="file"]')
      assert.equal(picker.disabled, !allowed)
      assert.equal(shell.canPickFiles(), allowed)
      assert.equal(intake.canAcceptDrop, allowed)
      await act(async () => intake.onAddFiles([new dom.window.File([], 'img.png', { type: 'image/png' })]))
      assert.equal(accepted.length, allowed ? 1 : 0)
      if (allowed) {
        Object.defineProperty(picker, 'files', { configurable: true, value: [new dom.window.File([], 'picked.png', { type: 'image/png' })] })
        await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })))
        assert.equal(accepted.length, 2)
        await act(async () => intake.onAddFiles([new dom.window.File([], 'text.txt', { type: 'text/plain' })]))
        assert.equal(accepted.length, 2, 'continuable intake keeps the image-only contract')
      }
    } finally {
      await view.close()
      shell.dispose()
    }
  }
})

test('InputBar shows failed messages, refuses restore over a current draft, and supports explicit restore and discard', async () => {
  const { shell, sends, released } = shellFixture()
  const view = await mount(React.createElement(InputBar, inputBarProps(shell)))
  try {
    await act(async () => {
      shell.setDraft('failed message')
      shell.addAttachments(['A'])
      shell.submit()
      shell.setDraft('new draft')
      sends[0].reject(new Error('offline'))
      await tick()
    })
    const row = view.container.querySelector('[data-failed-send]')
    assert.ok(row.textContent.includes('failed message'))
    assert.equal(row.querySelector('button').disabled, true)
    await act(async () => shell.setDraft(''))
    await act(async () => view.container.querySelector('[data-failed-send] button').click())
    assert.equal(shell.snapshot.draft, 'failed message')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    assert.equal(view.container.querySelector('[data-failed-send]'), null)
    await act(async () => {
      shell.submit()
      shell.setDraft('new draft')
      sends[1].reject(new Error('offline'))
      await tick()
    })
    await act(async () => view.container.querySelector('[data-failed-send] button:last-child').click())
    assert.equal(view.container.querySelector('[data-failed-send]'), null)
    assert.equal(shell.snapshot.draft, 'new draft')
    assert.deepEqual(released, ['A'])
  } finally {
    await view.close()
    shell.dispose()
  }
})

test('InputBar render count tracks live semantic drafts; selection-only editor updates publish nothing', async () => {
  const { shell } = shellFixture()
  let renders = 0
  const view = await mount(
    React.createElement(
      React.Profiler,
      {
        id: 'bar',
        onRender: () => {
          renders++
        },
      },
      React.createElement(InputBar, inputBarProps(shell)),
    ),
  )
  try {
    // Warm the empty-to-nonempty transition before counting steady typing commits.
    await act(async () => shell.setDraft('seed'))
    const initial = renders
    for (let i = 1; i <= 10; i++) await act(async () => shell.setDraft('x'.repeat(i)))
    assert.equal(renders - initial, 10)
    await act(async () => shell.editor.update(() => {}, { discrete: true }))
    assert.equal(renders - initial, 10)
  } finally {
    await view.close()
    shell.dispose()
  }
})

test('automatic attachment recovery retains a reload warning until files are reattached or the corresponding message succeeds', async () => {
  localStorage.clear()
  const persisted = {
    persistFailedSends: records => writeFailedInputSends('recovery', records),
    persistRecoveredDraft: draft => writeRecoveredConversationDraft('recovery', draft),
  }
  const { shell, sends } = shellFixture(persisted)
  shell.setDraft('recover me')
  shell.addAttachments(['A'])
  shell.submit()
  sends[0].reject(new Error('offline'))
  await tick()
  assert.equal(shell.snapshot.draft, 'recover me')
  assert.equal(readConversationDraft('recovery').text, 'recover me')
  assert.equal(readFailedInputSends('recovery')[0].missingAttachments, 1)
  shell.submit()
  assert.equal(shell.snapshot.failedSends[0].retrying, true)
  assert.equal(shell.actions.restoreFailedSend(shell.snapshot.failedSends[0].id), false)
  sends[1].reject(new Error('offline again'))
  await tick()
  assert.equal(shell.snapshot.failedSends.length, 1, 'retry failure reuses its existing recovery record')
  assert.equal(shell.snapshot.draft, 'recover me')
  shell.dispose()
  const reload = shellFixture({ ...persisted, failedSends: readFailedInputSends('recovery') })
  reload.shell.setDraft(readConversationDraft('recovery'))
  const view = await mount(React.createElement(InputBar, inputBarProps(reload.shell)))
  try {
    assert.ok(view.container.querySelector('[data-failed-send]').textContent.includes('input.failedSend.missingAttachments'))
    assert.equal(reload.shell.snapshot.draft, 'recover me')
    await act(async () => reload.shell.addAttachments(['B']))
    assert.equal(reload.shell.snapshot.failedSends.length, 0)
    assert.deepEqual(readFailedInputSends('recovery'), [])
    await act(async () => reload.shell.submit())
    await act(async () => reload.sends[0].resolve({ kind: 'success' }))
    assert.equal(reload.shell.snapshot.draft, '')
    assert.deepEqual(readFailedInputSends('recovery'), [])
  } finally {
    await view.close()
    reload.shell.dispose()
    localStorage.clear()
  }
})

test('success clears only the admitted recovery backup and discarding a restored backup keeps live draft attachments owned', async () => {
  const { shell, sends, released } = shellFixture()
  try {
    shell.setDraft('old')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    const id = shell.snapshot.failedSends[0].id
    shell.actions.discardFailedSend(id)
    assert.deepEqual(released, [], 'the restored draft still owns A')
    assert.deepEqual(shell.snapshot.attachmentIds, ['A'])
    shell.submit()
    sends[1].reject(new Error('offline'))
    await tick()
    assert.equal(shell.snapshot.failedSends.length, 1)
    shell.submit()
    sends[2].resolve({ kind: 'success' })
    await tick()
    assert.deepEqual(shell.snapshot.failedSends, [])
  } finally {
    shell.dispose()
  }
})

test('a restored message deliberately changed into an attachment-accepting command clears its recovery backup on success', async () => {
  const { shell, sends, released } = shellFixture()
  try {
    shell.setDraft('old message')
    shell.addAttachments(['A'])
    shell.submit()
    sends[0].reject(new Error('offline'))
    await tick()
    shell.setDraft('/ok args')
    assert.equal(
      shell.beginCommand(
        { name: 'ok', token: '/ok ', attachments: true, submit: async () => ({ kind: 'success' }) },
        { start: 0, end: 3, draftRev: shell.snapshot.draftRev },
      ),
      true,
    )
    shell.submit()
    await tick()
    assert.deepEqual(shell.snapshot.failedSends, [])
    assert.deepEqual(released, ['A'])
  } finally {
    shell.dispose()
  }
})

test('recovering over corrupt stored JSON recreates the active draft before removing its only text backup', async () => {
  localStorage.clear()
  localStorage.setItem('dsh.conversation.corrupt', '{invalid')
  const initial = [{ id: 1, draft: { text: 'only backup', references: [] }, attachmentCount: 0, missingAttachments: 0 }]
  writeFailedInputSends('corrupt', initial)
  const { shell } = shellFixture({
    failedSends: readFailedInputSends('corrupt'),
    persistFailedSends: records => writeFailedInputSends('corrupt', records),
    persistRecoveredDraft: draft => writeRecoveredConversationDraft('corrupt', draft),
  })
  try {
    assert.equal(shell.actions.restoreFailedSend(1), true)
    assert.equal(readConversationDraft('corrupt').text, 'only backup')
    assert.deepEqual(readFailedInputSends('corrupt'), [])
  } finally {
    shell.dispose()
    localStorage.clear()
  }
})

test('a rejected active-draft storage write leaves its backup visible and restorable after reload', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = dom.window.localStorage
  storage.clear()
  const initial = [{ id: 1, draft: { text: 'keep backup', references: [] }, attachmentCount: 0, missingAttachments: 0 }]
  writeFailedInputSends('blocked', initial)
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => storage.getItem(key),
      removeItem: key => storage.removeItem(key),
      setItem: (key, value) => {
        if (key === 'dsh.conversation.blocked') throw new dom.window.DOMException('storage denied', 'QuotaExceededError')
        storage.setItem(key, value)
      },
    },
  })
  const { shell } = shellFixture({
    failedSends: readFailedInputSends('blocked'),
    persistFailedSends: records => writeFailedInputSends('blocked', records),
    persistRecoveredDraft: draft => writeRecoveredConversationDraft('blocked', draft),
  })
  try {
    assert.equal(shell.actions.restoreFailedSend(1), true)
    assert.equal(shell.snapshot.draft, 'keep backup')
    assert.equal(readFailedInputSends('blocked')[0].draft.text, 'keep backup')
    assert.notEqual(readFailedInputSends('blocked')[0].restored, true)
    assert.equal(readConversationDraft('blocked').text, '')
    shell.dispose()
    Object.defineProperty(globalThis, 'localStorage', prior)
    const reload = shellFixture({
      failedSends: readFailedInputSends('blocked'),
      persistFailedSends: records => writeFailedInputSends('blocked', records),
      persistRecoveredDraft: draft => writeRecoveredConversationDraft('blocked', draft),
    })
    reload.shell.setDraft(readConversationDraft('blocked'))
    const view = await mount(React.createElement(InputBar, inputBarProps(reload.shell)))
    try {
      const row = view.container.querySelector('[data-failed-send]')
      assert.ok(row?.textContent.includes('keep backup'))
      assert.equal(row.querySelector('button').disabled, false)
      await act(async () => row.querySelector('button').click())
      assert.equal(reload.shell.snapshot.draft, 'keep backup')
      assert.equal(readConversationDraft('blocked').text, 'keep backup')
      assert.deepEqual(readFailedInputSends('blocked'), [])
    } finally {
      await view.close()
      reload.shell.dispose()
    }
  } finally {
    shell.dispose()
    Object.defineProperty(globalThis, 'localStorage', prior)
    storage.clear()
  }
})

test('a SecurityError from the localStorage getter is contained by every recovery read/write path', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new dom.window.DOMException('storage denied', 'SecurityError')
    },
  })
  try {
    assert.deepEqual(readFailedInputSends('blocked'), [])
    assert.doesNotThrow(() => writeFailedInputSends('blocked', []))
    assert.equal(writeRecoveredConversationDraft('blocked', { text: 'memory only', references: [] }), false)
    assert.equal(readConversationDraft('blocked').text, '')
    assert.equal(readConversationViewPreference('blocked'), null)
  } finally {
    Object.defineProperty(globalThis, 'localStorage', prior)
  }
})
