/** Modern frame owner; activate only while the official ui-layout entry is disabled. */
import { apply, inject } from './vendor/layout/index.ts'
export const layoutOwner = { name: 'modern-layout-owner', inject, apply }
export { apply, inject }
