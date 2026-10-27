/** Activate only in the Modern bundle replacing its original UI owner. */
import { apply, inject } from './vendor/sidebar/client/index.ts'
export const sidebarOwner = { name: 'modern-sidebar-owner', inject, apply }
export { apply, inject }
