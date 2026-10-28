import type { DiscoverFace as OfficialDiscoverFace, DiscoverState } from '@deepseek-ai/dsh-client-ui-plugin-market/client'
import type { DocumentTranslate } from '../../plugin-documents/PluginDocument.tsx'
export type { DiscoverState }
export type ListingState = NonNullable<DiscoverState['listing']>
export type ListingFailure = NonNullable<ListingState['failure']>
export type SourceFailure = NonNullable<DiscoverState['sourceFailure']>
export interface DiscoverFace extends OfficialDiscoverFace { readonly translateDocument: DocumentTranslate }
