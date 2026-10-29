export const API = '/api/compat-lifecycle'
export const PROBE = 'compat-lifecycle-probe'
export const TARGET = 'compat-lifecycle-target'
export const MODERN = '@iroha1145/dsh-modern-ui'
export const NULLABLE = 'compat-lifecycle-nullable'
export const DISABLED = 'compat-lifecycle-disabled'
export const PING = 'compat-lifecycle/ping'
export const LABELS = ['target', 'nullable', 'disabled']
export const toolName = label => `compat_lifecycle_${label}`
export const OWNERS = ['layout', 'sidebar', 'conversation', 'workspace', 'chat', 'model-selection', 'tool']
  .map(name => ({ id: `ui-${name}`, moduleName: `@deepseek-ai/dsh-client-ui-${name}` }))
