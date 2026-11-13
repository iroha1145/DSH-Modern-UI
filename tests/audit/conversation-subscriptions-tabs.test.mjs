import { test } from 'vitest'
import assert from 'node:assert/strict'
import { harness, projectStreamingText, realSession, source, stable, t } from './helpers/conversation-harness.mjs'

test.each(['root', 'continuable-child'])('real %s Session streams text through Chat projections and preserves full extension snapshots', async kind => {
  const h = await harness()
  const session = await realSession()
  if (kind === 'continuable-child') session.configureSubagent({ mode: 'continuable', parentSessionId: 'parent', childSessionId: 'session' }, true)
  session.handleRunning(true)
  await Promise.resolve()
  const useSession = h.bind(session)
  const conversation = source({ activeTargets: new Set(['chat']) })
  const views = source([{ id: 'chat', label: 'Chat' }])
  const store = source({ view: 'chat' })
  const full = { dock: [], chain: [], view: [] }
  let assemblies = 0,
    viewMounts = 0,
    draftBindings = 0
  function ThirdPartyView() {
    const snapshot = useSession(s => s)
    full.view.push(snapshot)
    h.React.useEffect(() => {
      viewMounts++
    }, [])
    return h.React.createElement('div', { 'data-view': '' }, projectStreamingText(h, session).text)
  }
  const bodyProps = {
    sessionId: 'session',
    useSession,
    useConversation: h.bind(conversation),
    useConversationViews: h.bind(views),
    useInspectCall: stable(undefined),
    useStore: h.bind(store),
    inputActions: { persistDraft() {} },
    actions: { setDraft() {}, completeViewRequest() {} },
    bindDraftPersistence: () => {
      draftBindings++
      return () => {}
    },
    openView() {},
    renderSlot: () => {
      assemblies++
      return h.React.createElement(ThirdPartyView)
    },
  }
  function Views() {
    return h.React.createElement(h.DefaultConversationViews, bodyProps)
  }
  const contentProps = {
    sessionId: 'session',
    phase: 'active',
    hero: false,
    variant: 'main',
    useSession,
    useSessions: stable({ byId: { session: { cwd: '/work' } } }),
    useSessionStatus: stable(new Map()),
    useWorkspaces: stable({ phase: 'ready', items: [] }),
    useInput: stable({ draft: 'draft retained' }),
    useComposerBlock: stable(undefined),
    selectWorkspace() {},
    t,
    useFactorySlot: name => (name === 'views' ? Views : () => null),
    renderSlot: (name, zone) => {
      if (name === 'conversation.input.dock') full.dock.push(zone.session)
      return null
    },
    renderSlotChain: (_name, owner, options) => {
      full.chain.push(owner.session)
      return options.fallback
    },
  }
  const reactRoot = h.createRoot(h.document.getElementById('root'))
  try {
    const mainProps = {
      sessionId: 'session',
      useSession,
      useConversation: h.bind(conversation),
      useSessions: contentProps.useSessions,
      renderSlot: () =>
        h.React.createElement(h.ConversationHeader, { sessionId: 'session', useSession, useConversation: h.bind(conversation), renderSlot: () => null }),
      renderFactorySlot: (_name, owner) => h.React.createElement(h.ConversationContent, { ...contentProps, ...owner }),
    }
    await h.act(async () => {
      reactRoot.render(h.React.createElement(h.ConversationMainPanel, mainProps))
    })
    const initialAssemblies = assemblies
    const initialLengths = Object.fromEntries(Object.entries(full).map(([key, entries]) => [key, entries.length]))
    const initialRenders = { ...h.renderCounts }
    const viewNode = h.document.querySelector('[data-view]')
    h.document.querySelector('[data-conversation-scroll]').scrollTop = 117
    session.acceptEventChange({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'attempt', startedAfterSeq: 0, turn: 1, step: 1 } })
    session.acceptEventChange({
      type: 'assistant-stream',
      frame: { type: 'chunk', attemptId: 'attempt', index: 0, time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    })
    for (let index = 1; index <= 20; index++) {
      await h.act(async () => {
        session.acceptEventChange({
          type: 'assistant-stream',
          frame: { type: 'chunk', attemptId: 'attempt', index, time: index, chunk: { type: 'text-delta', index: 0, text: 'token' } },
        })
        await Promise.resolve()
      })
      for (const target of Object.values(full)) assert.equal(target.at(-1), session.getSnapshot())
      assert.equal(viewNode.textContent, 'token'.repeat(index))
    }
    assert.equal(viewNode.textContent, 'token'.repeat(20))
    assert.equal(projectStreamingText(h, session).process.turn, 1)
    assert.equal(assemblies, initialAssemblies, 'streaming must not reassemble the default view slot')
    for (const name of ['ConversationMainPanel', 'ConversationHeader', 'ConversationContent', 'DefaultConversationViews']) {
      assert.equal(h.renderCounts[name], initialRenders[name], name + ' must not re-render for text-only deltas')
    }
    for (const [key, target] of Object.entries(full)) assert.equal(target.length, initialLengths[key] + 20)
    assert.equal(viewMounts, 1)
    assert.equal(draftBindings, 1)
    assert.equal(h.document.querySelector('[data-view]'), viewNode)
    assert.equal(h.document.querySelector('[data-conversation-scroll]').scrollTop, 117)
    // Exercise fields that do not change the shell phase but must still reach extension consumers.
    for (const patch of [
      { removed: true },
      { openState: 'error', openError: { code: 'test/open', message: 'failure' } },
      { loadingOlder: true, hasMore: true },
      { promptError: { op: 'send', error: { code: 'test/send' } } },
    ]) {
      await h.act(async () => {
        Object.assign(session, patch)
        session.notifier.markDirty()
        await Promise.resolve()
      })
      for (const target of Object.values(full)) assert.equal(target.at(-1), session.getSnapshot())
    }
    await h.act(async () => {
      session.address = { mode: 'continuable', parentSessionId: 'parent', childSessionId: 'session' }
      session.notifier.markDirty()
      await Promise.resolve()
    })
    await h.act(async () => {
      session.handleSubagentParentAvailable(false)
      await Promise.resolve()
    })
    assert.equal(full.chain.at(-1).subagent.parentAvailable, false)
    assert.equal(full.view.at(-1).subagent.parentAvailable, false)
  } finally {
    await h.act(async () => reactRoot.unmount())
    await h.close()
  }
})

test('tabs link panels and support roving Left/Right/Home/End focus across overflow and view removal', async () => {
  const h = await harness()
  const views = source([
    { id: 'chat', label: 'Chat' },
    { id: 'files', label: 'Files' },
    { id: 'tools', label: 'Tools' },
  ])
  const store = source({ view: 'chat' })
  const pins = source([])
  const factoryCalls = []
  const headerProps = {
    sessionId: 'session',
    hideChrome: false,
    useSessions: stable({ byId: {} }),
    useConversationViews: h.bind(views),
    useStore: h.bind(store),
    useEntryPins: h.bind(pins),
    useEntryActions: stable(false),
    usePinSaveFailed: stable(false),
    t,
    open() {},
    selectView: id => store.set({ view: id }),
    setPinned: (id, pinned) => pins.set(pinned ? pins.getSnapshot().filter(value => value !== id) : [...pins.getSnapshot(), id]),
    renderSlot: () => null,
    // The header asks the Host for its context-menu button; a Host without that Factory renders nothing.
    renderFactorySlot: (name, props) => {
      factoryCalls.push([name, props])
      return null
    },
  }
  const bodyProps = {
    sessionId: 'session',
    useSession: stable({ blank: false }),
    useConversation: stable({ activeTargets: new Set(['chat']) }),
    useConversationViews: h.bind(views),
    useInspectCall: stable(undefined),
    useStore: h.bind(store),
    actions: { setDraft() {}, completeViewRequest() {} },
    inputActions: { persistDraft() {} },
    bindDraftPersistence: () => () => {},
    openView() {},
    renderSlot: () => h.React.createElement('input', { defaultValue: 'draft' }),
  }
  const reactRoot = h.createRoot(h.document.getElementById('root'))
  const render = () =>
    h.React.createElement(
      h.React.Fragment,
      null,
      h.React.createElement(h.ConversationSessionHeader, headerProps),
      h.React.createElement(h.DefaultConversationViews, bodyProps),
    )
  const key = async value => h.act(async () => h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: value, bubbles: true })))
  try {
    Object.defineProperty(h.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 })
    await h.act(async () => reactRoot.render(render()))
    // Official 0.2.2-rc.2 keeps the session's "more" actions in its context-menu service under this target.
    assert.equal(factoryCalls.at(-1)[0], 'contextMenu.button')
    assert.deepEqual(factoryCalls.at(-1)[1].target, { kind: 'sessionHeader', value: { sessionId: 'session' } })
    assert.equal(factoryCalls.at(-1)[1].label, t('header.more'))
    assert.equal(factoryCalls.at(-1)[1].size, 'sm')
    assert.ok(h.document.querySelector('[role=tablist]').getAttribute('aria-label'))
    const tabs = () => [...h.document.querySelectorAll('[role=tab]')]
    const selected = () => h.document.querySelector('[role=tab][aria-selected=true]')
    const checkLinks = () => {
      for (const tab of tabs()) assert.ok(h.document.getElementById(tab.getAttribute('aria-controls')))
      const panel = h.document.querySelector('[role=tabpanel]:not([hidden])')
      assert.equal(panel.getAttribute('aria-labelledby'), selected().id)
    }
    assert.equal(tabs().filter(tab => tab.tabIndex === 0).length, 1)
    checkLinks()
    selected().focus()
    await key('ArrowRight')
    assert.equal(store.getSnapshot().view, 'files')
    assert.equal(h.document.activeElement, selected())
    await key('End')
    assert.equal(store.getSnapshot().view, 'tools')
    await key('ArrowRight')
    assert.equal(store.getSnapshot().view, 'chat')
    await key('ArrowLeft')
    assert.equal(store.getSnapshot().view, 'tools')
    await key('Home')
    assert.equal(store.getSnapshot().view, 'chat')
    const input = h.document.querySelector('input')
    input.value = 'kept draft'
    await h.act(async () => pins.set(['files']))
    assert.equal(tabs().length, 2)
    await h.act(async () => h.document.querySelector('[data-conversation-views-menu]').click())
    await h.act(async () => h.document.querySelector('[data-view-open-action=files]').click())
    assert.equal(selected().textContent, 'Files')
    assert.equal(h.document.activeElement, selected())
    assert.equal(h.document.querySelector('input'), input)
    assert.equal(input.value, 'kept draft')
    checkLinks()
    await h.act(async () => views.set(views.getSnapshot().filter(view => view.id !== 'files')))
    assert.equal(selected().textContent, 'Chat')
    assert.equal(h.document.activeElement, selected())
    checkLinks()
    await h.act(async () => views.set([{ id: 'chat', label: 'Chat' }]))
    const panel = h.document.querySelector('[role=tabpanel]:not([hidden])')
    assert.equal(h.document.querySelector('[role=tablist]'), null)
    assert.ok(h.document.activeElement === panel, 'removed tab row must focus the surviving Chat panel')
    assert.equal(panel.getAttribute('aria-label'), 'Chat')
    assert.equal(panel.getAttribute('aria-labelledby'), null)
    // Removing the active Files tab at 2 -> 1 also falls back to the remaining panel.
    const twoViews = [
      { id: 'chat', label: 'Chat' },
      { id: 'files', label: 'Files' },
    ]
    await h.act(async () => {
      pins.set([])
      views.set(twoViews)
      store.set({ view: 'files' })
    })
    selected().focus()
    await h.act(async () => views.set(twoViews.slice(0, 1)))
    assert.ok(h.document.activeElement === h.document.querySelector('[role=tabpanel]:not([hidden])'), 'removed active Files tab must focus Chat panel')
    // Panel recovery clears tab ownership: later registration must preserve an external focus.
    await h.act(async () => views.set(twoViews))
    const external = h.document.createElement('button')
    h.document.body.append(external)
    selected().focus()
    external.focus()
    await h.act(async () => views.set(twoViews.slice(0, 1)))
    assert.ok(h.document.activeElement === external, '2 -> 1 must preserve focus outside the tablist')
    await h.act(async () => views.set([...twoViews, { id: 'tools', label: 'Tools' }]))
    selected().focus()
    external.focus()
    await h.act(async () => views.set(twoViews))
    assert.ok(h.document.activeElement === external, '3 -> 2 must preserve focus outside the tablist')
    external.remove()
  } finally {
    await h.act(async () => reactRoot.unmount())
    await h.close()
  }
})
