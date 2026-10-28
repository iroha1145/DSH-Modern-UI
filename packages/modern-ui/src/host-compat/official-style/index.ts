import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

// The only boot-page delta in the old source patch. This must arrive in the
// HTML head: a client plugin cannot style the failure to load that very plugin.
export const BOOT_PAGE_CSS = `
body ._boot_u7vgf_3 ._wordmark_u7vgf_31,
body ._boot_u7vgf_3 ._failedTitle_u7vgf_79 { font-weight: 500; }
`

/** Contribute structured CSS; retain the official boot HTML, scripts and loader. */
export function apply(ctx: Context): void {
  ctx.on('webserver/index-inject', rows => {
    rows.push({ kind: 'style', text: BOOT_PAGE_CSS })
  })
}
