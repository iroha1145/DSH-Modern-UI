import React, { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Menu } from '../../packages/modern-ui/src/vendor/primitives/Menu.tsx'
import { PreferenceRow } from '../../packages/modern-ui/src/vendor/chat/client/settings/PreferenceRow.tsx'
import { EnterBehaviorRow } from '../../packages/modern-ui/src/vendor/conversation/client/settings/EnterBehaviorRow.tsx'
import { AppFrame } from '../../packages/modern-ui/src/vendor/layout/AppFrame.tsx'
import { createLayoutStore } from '../../packages/modern-ui/src/vendor/layout/stores.ts'
import { ProjectRowItem, SessionNodeItem } from '../../packages/modern-ui/src/vendor/workspace/client/rows/Rows.tsx'
import { DiscoverSection } from '../../packages/modern-ui/src/vendor/plugin-market/DiscoverSection.tsx'
import { QuestionPresentation } from '../../packages/modern-ui/src/vendor/questions/QuestionFlow.tsx'
import '../../packages/modern-ui/src/vendor/theme/styles/focus.css'
const root = createRoot(document.getElementById('app'))
const noop = () => {},
  t = (key, values) => key + (values ? ' ' + Object.values(values).join(' ') : '')
function MenuFixture({ disabled = false }) {
  const [open, setOpen] = useState(false),
    [checked, setChecked] = useState(['one', 'sort-a'])
  return (
    <>
      <button id="before">Before</button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        portal
        selectedIds={checked}
        onSelect={id => {
          window.calls.push(id)
          if (id === 'check') setChecked(v => (v.includes(id) ? v.filter(x => x !== id) : [...v, id]))
          else setOpen(false)
        }}
        anchor={
          <button id="trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
            Menu
          </button>
        }
        items={[
          {
            id: 'parent',
            label: 'Parent',
            submenu: [
              { id: 'disabled-child', label: 'Disabled child', disabled: true },
              { id: 'child', label: 'Child', disabled },
            ],
          },
          {
            type: 'group',
            id: 'radio',
            label: 'Group by',
            items: [
              { id: 'one', label: 'One', choice: 'radio' },
              { id: 'two', label: 'Two', choice: 'radio', disabled: true },
            ],
          },
          {
            type: 'group',
            id: 'sort',
            label: 'Sort by',
            items: [
              { id: 'sort-a', label: 'Sort A', choice: 'radio' },
              { id: 'sort-b', label: 'Sort B', choice: 'radio' },
            ],
          },
          { id: 'check', label: 'Check', choice: 'checkbox' },
          { id: 'action', label: 'Action' },
        ]}
        footer={[{ id: 'footer', label: 'Footer' }]}
      />
      <button id="outside">Outside</button>
    </>
  )
}
function Preferences() {
  const [value, setValue] = useState('on')
  return (
    <>
      <PreferenceRow
        title="First setting"
        description="First description"
        value={value}
        selectedLabel={value === 'on' ? 'On' : 'Off'}
        options={[
          { id: 'on', label: 'On' },
          { id: 'off', label: 'Off' },
        ]}
        onSelect={setValue}
      />
      <PreferenceRow
        title="Second setting"
        description="Second description"
        value="on"
        selectedLabel="On"
        options={[{ id: 'on', label: 'On' }]}
        onSelect={noop}
      />
      <EnterBehaviorRow useBusyEnter={f => f('queue')} useSaveFailed={f => f(false)} setBusyEnter={noop} t={t} />
    </>
  )
}
const store = createLayoutStore().create(),
  useStore = select => useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()))
function Frame() {
  return (
    <AppFrame
      useStore={useStore}
      useSessions={f => f({ byId: {} })}
      usePanelInfo={f => f({ activePanelId: null })}
      actions={store.actions}
      renderSlot={name => (name === 'main' ? <button>Main</button> : null)}
      t={t}
    />
  )
}
function Copies() {
  return (
    <>
      <ProjectRowItem
        group={{ key: 'w', workspaceId: 'w', label: 'Workspace', cwd: '/home/user/full/path', createdAt: 1, expanded: true, containsCurrent: false }}
        onToggle={noop}
        onCreate={noop}
        useRemoteAccess={() => false}
        useWorkspaceAccess={() => false}
        t={t}
      />
      <SessionNodeItem
        node={{ id: 's', title: 'Full session title', runningSubagentCount: 0, blank: false, archived: false }}
        currentId="s"
        now={0}
        onOpen={noop}
        onRenameRequest={() => {
          throw Error('rename should not run')
        }}
        useSessionAccess={() => false}
        renderSlot={() => null}
        t={t}
      />
    </>
  )
}
function Questions() {
  const pending = {
    key: 'same-request',
    questions: [{ id: 'q', question: 'Choose a color', options: [{ label: 'Red' }, { label: 'Blue' }] }],
    liveKeys: () => ['same-request'],
    takeTime: noop,
    engage: noop,
    holdFocus: noop,
    releaseFocus: noop,
  }
  const props = {
    matched: pending,
    t,
    foldLabels: () => ({}),
    textLabels: () => ({ expand: 'Expand', collapse: 'Collapse' }),
    useStore: f => f({ progressByRequest: {} }),
    useQuestionCard: (_key, f) => f({ state: 'open', channel: 'rpc', closed: false }),
    actions: { prune: noop, clear: noop, replace: noop },
  }
  return (
    <>
      <QuestionPresentation {...props} />
      <QuestionPresentation {...props} />
    </>
  )
}

function Discover() {
  const query = { text: '', category: null, labels: ['alpha'], sort: { kind: 'index' } }
  const value = {
    url: 'https://example.com/market',
    title: 'Market',
    metadata: { categories: {}, labels: { alpha: { title: 'Alpha' }, beta: { title: 'Beta' } }, sortKeys: {} },
    entries: [],
    total: 0,
  }
  const [state, setState] = useState({
    status: 'ready',
    indexes: [{ url: value.url, title: value.title }],
    selected: value.url,
    listing: { url: value.url, query, status: 'ready', value, answered: query, failure: null },
    editing: false,
    draft: '',
    saving: false,
    sourceFailure: null,
  })
  return (
    <DiscoverSection
      useDiscover={f => f(state)}
      useLocale={f => f({ active: 'en' })}
      t={t}
      resolveText={v => (typeof v === 'string' ? v : v.en)}
      ensure={noop}
      reload={noop}
      select={noop}
      search={query => setState(s => ({ ...s, listing: { ...s.listing, query, answered: query, value: { ...value, query } } }))}
      more={noop}
      refresh={noop}
      retry={noop}
      toggleSources={noop}
      editDraft={noop}
      addSource={noop}
      removeSource={noop}
      install={noop}
      openPackage={noop}
      translateDocument={t}
    />
  )
}

window.calls = []
window.store = store
window.show = (mode, props = {}) =>
  root.render(
    <React.Fragment key={mode}>
      {mode === 'menu' ? (
        <MenuFixture {...props} />
      ) : mode === 'preferences' ? (
        <Preferences />
      ) : mode === 'discover' ? (
        <Discover />
      ) : mode === 'frame' ? (
        <Frame />
      ) : mode === 'copy' ? (
        <Copies />
      ) : (
        <Questions />
      )}
    </React.Fragment>,
  )
