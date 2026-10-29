import { LABELS, PING, toolName } from './protocol.mjs'

/** One real Cordis contribution whose effects the lifecycle test can observe. */
export function registerContribution(ctx, config) {
  const label = config.label
  if (!LABELS.includes(label)) throw new Error(`Unknown lifecycle fixture label: ${label}`)
  ctx.effect(() => ctx.compatLifecycle.mount(label))
  ctx.on(PING, () => { ctx.compatLifecycle.ping(label) })
  ctx.tools.register({
    name: toolName(label), description: `Isolated lifecycle fixture ${label}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.label }],
    },
    execute: async () => ({ label }),
  })
}
