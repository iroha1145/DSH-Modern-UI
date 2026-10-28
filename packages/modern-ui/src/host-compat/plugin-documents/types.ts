import type { Branded } from '@deepseek-ai/dsh-brand'

export type PluginDetailDocumentId = Branded<'ModernPluginDocumentId'>
export type PluginDetailOrigin = 'locale' | 'readme' | 'repository'
export type PluginDetail =
  | { readonly status: 'found'; readonly origin: PluginDetailOrigin; readonly markdown: string; readonly document: PluginDetailDocumentId }
  | { readonly status: 'none' }
