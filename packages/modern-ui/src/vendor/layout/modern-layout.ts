/** Private Modern UI cooperation over the one frame-owned geometry store. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
export interface ModernLayout {
  readonly viewport: HostObservable<{ readonly mobile: boolean }>
  /** Close only an open phone drawer; desktop and already-closed navigation stay untouched. */
  closeMobileSidebar(): void
}
declare module '@deepseek-ai/cordis' {
  interface Context { modernLayout: ModernLayout }
}
