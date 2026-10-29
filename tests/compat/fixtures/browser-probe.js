/** Actual client plugin: observes published registries and contributes through standard slots. */
window.__ModuleLoader__.load({ id: 'modern-compat-browser-fixture', factory: require => {
  const React = require('react')
  const store = require('@deepseek-ai/dsh-client-store')
  const shared = Object.fromEntries(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots'].map(name => [name, require(name)]))
  return { inject: ['slots', 'locale', 'modules'], async apply(ctx) {
    const report = store.createSnapshotStore({ pending: true })
    let removeLabel
    const toggleLabel = () => {
      if (removeLabel) { removeLabel(); removeLabel = undefined; return }
      removeLabel = ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register({ name: 'conversation.input.model.label', priority: -10 },
        ({ model }) => React.createElement('span', { 'data-compat-model-label': '' }, model.name + ' · Compatible label')))
    }
    ctx.effect(() => () => removeLabel?.())
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'compat-runtime-evidence' }, function RuntimeEvidence() {
      const value = React.useSyncExternalStore(report.subscribe, report.getSnapshot)
      return React.createElement(React.Fragment, null,
        React.createElement('output', { hidden: true, 'data-compat-client-report': '' }, JSON.stringify(value)),
        React.createElement('button', { type: 'button', 'data-compat-toggle-label': '', style: { position: 'fixed', top: 0, right: 0, zIndex: 10000 }, onClick: toggleLabel }, 'Compatibility label'))
    }))
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'compat_echo', priority: -10 },
      props => React.createElement('div', { 'data-compat-specific-tool': props.phase }, props.phase === 'result'
        ? props.block.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : 'Compatibility tool running')))
    const identities = {}
    for (const [name, value] of Object.entries(shared)) identities[name] = { sameExports: value === await ctx.modules.import(name, '', {}) }
    const snapshot = () => ({ pending: false, shared: identities,
      modules: [...ctx.modules.loadCache.values()].map(row => ({ id: row.id, edges: [...row.edges] })),
      manifest: ctx.modules.manifest, entries: ctx.modules.entries.state.getSnapshot(),
      slots: Object.fromEntries(['conversation.chat.assistant-actions', 'conversation.chat.turnTail', 'conversation.input.model.label', 'tool.call.toolview', 'conversation.input.plan'].map(name =>
        [name, ctx.slots.entries(name).map(entry => ({ ...entry.options, locale: entry.locale, registrant: entry.registrant }))])) })
    report.set(snapshot())
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'compat-session-evidence', order: 100 },
      function SessionEvidence({ useChat, sessionId }) {
        const chat = useChat(value => value)
        const processes = [...new Map(chat.order.map(key => chat.nodes.processSource(key).getSnapshot()).filter(Boolean).map(row => [row.turn, row])).values()]
        return React.createElement('output', { hidden: true, 'data-compat-session-report': '' }, JSON.stringify({ sessionId,
          navigation: chat.navigation.items(), processes, order: chat.order, nodes: chat.order.map(key => {
            const node = chat.nodes.get(key)
            return { key, kind: node?.kind, anchorSeq: node?.anchorSeq }
          }) }))
      }))
    ctx.on('slots/changed', () => report.set(snapshot()))
  } }
} })
