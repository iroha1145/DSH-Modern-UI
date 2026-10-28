import type { Context } from '@deepseek-ai/cordis'
import * as toolOwner from './tool-owner.ts'

/** Select one owner for the complete Tool subtree, including generic and denial fallback cards. */
export function installToolCards(ctx: Context): void {
  ctx.plugin(toolOwner)
}
