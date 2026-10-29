import { registerContribution } from 'compat-lifecycle-probe/contribution'
export const inject = ['compatLifecycle', 'tools']
export function apply(ctx, config) { registerContribution(ctx, config) }
