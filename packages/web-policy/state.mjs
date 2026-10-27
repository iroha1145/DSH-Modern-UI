import { z } from 'zod';
export const PRESET = 'iroha-modern-ui-web-policy-v1';
export const RECORD = 'plugin:iroha-modern-ui/web-search-v1';
export const PREFIXES = ['mcp__exa__', 'mcp__tavily', 'mcp__brave', 'mcp__perplexity', 'mcp__firecrawl', 'mcp__fetch__', 'mcp__jina'];
export const selection = input => input?.trim() === 'on' ? true : input?.trim() === 'off' ? false : undefined;
export const projection = {
  key: 'webSearch', stateVersion: 3,
  stateSchema: z.object({ enabled: z.boolean(), wanted: z.boolean().nullable(), running: z.record(z.string(), z.boolean()) }).strict(),
  init: () => ({ enabled: true, wanted: null, running: {} }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data.name === 'web') {
      const value = selection(event.data.args);
      return value === undefined ? state : { ...state, running: { ...state.running, [event.data.commandId]: value } };
    }
    if (event.type === 'command/done' && Object.hasOwn(state.running, event.data.commandId)) {
      const target = state.running[event.data.commandId];
      const { [event.data.commandId]: settled, ...running } = state.running;
      return { ...state, running, wanted: event.data.kind === 'success' ? target === state.enabled ? null : target : state.wanted };
    }
    if (event.type === RECORD) {
      if (event.ignorable !== true || typeof event.data.enabled !== 'boolean') throw new Error('Invalid Modern UI web policy record');
      return { ...state, enabled: event.data.enabled, wanted: null };
    }
    return state;
  },
  wire: { viewSchema: z.object({ enabled: z.boolean(), pending: z.boolean() }),
    view: state => ({ enabled: state.enabled, pending: state.wanted !== null && state.wanted !== state.enabled }) },
};
