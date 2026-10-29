import { registerContribution } from './contribution.mjs'
export const inject = ['compatLifecycle', 'tools']
export function apply(ctx, config) { registerContribution(ctx, config) }
