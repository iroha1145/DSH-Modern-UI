/** Activate only in the Modern bundle replacing its original UI owner. */
import { apply, inject } from './vendor/workspace/client/index.ts'
export const workspaceOwner = { name: 'modern-workspace-owner', inject, apply }
export { apply, inject }
