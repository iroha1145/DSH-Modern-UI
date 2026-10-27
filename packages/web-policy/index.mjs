import { readFile } from 'node:fs/promises';
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import { load } from 'js-yaml';
import z from '@deepseek-ai/schemastery';
import { PREFIXES, PRESET } from './state.mjs';

export const name = 'modern-ui-web-policy';
export const inject = ['agentPresets'];
export const Config = z.object({ toolPrefixes: z.array(z.string()).default([...PREFIXES]) });

// The owning plugin creates the definition, including its non-optional policy row.
// Unloading the owner removes the identity; existing agents retain the registry's
// generation and its policy until they dispose, as required by the official API.
export async function* apply(ctx, config) {
  if (config.toolPrefixes.some(value => !value.trim())) throw new Error('toolPrefixes must contain non-empty strings');
  const source = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-web-app/presets/standard.patch.yml')), 'utf8');
  const official = load(source, { schema: entryListSchema })[0].insert[0].config;
  yield await ctx.agentPresets.register({ id: PRESET, name: 'Modern UI', order: 0,
    plugins: [...official.plugins, { name: import.meta.resolve('./scoped.mjs'), config: { toolPrefixes: config.toolPrefixes } }] });
}
