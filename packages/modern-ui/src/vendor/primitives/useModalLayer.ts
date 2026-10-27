/** Share modal ownership with official dialogs and menus. */
export { useModalLayer, isBehindModal, closeTopModal } from '@deepseek-ai/dsh-client-ui-primitives'
export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'
