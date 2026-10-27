import { scopeOf } from '@deepseek-ai/dsh-scope';
import { appendPluginRecord } from '@deepseek-ai/dsh-session';
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands';
import { projection, RECORD, selection } from './state.mjs';

export const name = 'modern-ui-web-policy-scoped';
export const inject = ['sessionProjections', 'commands', 'agents', 'tools'];
export function apply(ctx, config) {
  ctx.sessionProjections.register(projection);
  const held = new Map();
  const state = session => {
    const value = ctx.sessionProjections.stateOf(session, 'webSearch');
    if (!value) throw new Error('Modern UI web policy projection unavailable');
    return value;
  };
  const selected = session => { const value = state(session); return value.wanted ?? value.enabled; };
  function update(agent) {
    if (selected(agent.session)) {
      for (const release of held.get(agent)?.releases ?? []) release();
      held.delete(agent);
      return;
    }
    const denied = held.get(agent) ?? { names: new Set(), releases: [] };
    const names = ctx.tools.schemas(scopeOf(ctx)).map(tool => tool.name)
      .filter(name => (name === 'web_search' || name === 'web_fetch' || config.toolPrefixes.some(prefix => name.startsWith(prefix))) && !denied.names.has(name));
    if (names.length) {
      denied.releases.push(agent.ctx.tools.restrict({ deny: names }));
      names.forEach(name => denied.names.add(name));
      held.set(agent, denied);
    }
  }
  ctx.on('agent/created', ({ agent }) => update(agent));
  ctx.on('agent/disposed', ({ agent }) => held.delete(agent));
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject' || signal.aborted) return decision;
    update(agent);
    const value = state(agent.session);
    if (value.wanted !== null) appendPluginRecord(agent.session, RECORD, { enabled: value.wanted });
    return decision;
  });
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'command/done' && event.type !== RECORD) return;
    const agent = ctx.agents.get(session.id);
    if (agent?.session === session) update(agent);
  });
  ctx.commands.register({ definitionId: CommandDefinitionId('@iroha1145/dsh-modern-ui-web-policy'), name: 'web',
    description: 'Turn web search on or off for this session', input: { hint: 'on|off' },
    handler({ agent, rawInput }) {
      const target = selection(rawInput);
      if (target === undefined) return { kind: 'error', text: 'Use /web on or /web off.' };
      const current = state(agent.session);
      const text = target ? 'on' : 'off';
      const effective = current.wanted ?? current.enabled;
      const message = target === effective ? current.enabled === target ? `Web search is already ${text}.` : `Turning web search ${text} (applies from the next step).`
        : target === current.enabled ? `Web search stays ${text}.`
          : ctx.sessionProjections.stateOf(agent.session, 'turnBoundary')?.openTurnStartSeq != null ? `Turning web search ${text} (applies from the next step).` : `Web search ${text}.`;
      return { kind: 'success', text: message };
    } });
}
