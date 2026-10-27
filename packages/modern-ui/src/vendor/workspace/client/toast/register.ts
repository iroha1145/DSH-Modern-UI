// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE.
/** Business-owned mappings into the keyed Workspace Toast slot. */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RowToastActions, WorkspaceViewStoreHandle } from '../contract/slots.ts'
import type { ArchiveToastInjected, ToastDisplayInjected } from '../contract/toast.ts'
import { ArchiveToastEntry, ToastEntry, WorkspaceToast } from './Toast.tsx'

/** Register notice presentations with their business-owned display fields and actions.
 * @param ctx - Workspace plugin context.
 * @param viewStore - Viewing store, read only by archive notices.
 * @param actions - Archive and source-opening callbacks.
 */
export function registerToasts(
  ctx: Context,
  viewStore: WorkspaceViewStoreHandle,
  actions: Pick<RowToastActions, 'undoArchive' | 'showArchived' | 'openForkSource'>,
): void {
  const archiveFilterAction: ArchiveToastInjected['filterAction'] = (t, dismiss) => ({
    prefix: t('toast.archivedOr'), label: t('toast.archivedFilter'),
    onClick: () => { dismiss(); actions.showArchived() },
  })
  ctx.slots.registerFactory({ name: 'modern.workspace.toast.content', scope: 'root' }, WorkspaceToast)
  ctx.slots.inject('modern.workspace.toast', function* () {
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'sessionIdCopied', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'sessionIdCopied'> => ({
        display: (_notice, t) => ({ text: t('toast.sessionIdCopied'), tone: 'success' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'sessionIdCopied'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'sessionIdCopyFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'sessionIdCopyFailed'> => ({
        display: (_notice, t) => ({ text: t('toast.sessionIdCopyFailed'), tone: 'warning' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'sessionIdCopyFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'pinFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'pinFailed'> => ({
        display: (_notice, t) => ({ text: t('toast.pinFailed'), tone: 'warning' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'pinFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'unpinFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'unpinFailed'> => ({
        display: (_notice, t) => ({ text: t('toast.unpinFailed'), tone: 'warning' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'unpinFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'archivedNotOpenable', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'archivedNotOpenable'> => ({
        display: (_notice, t) => ({ text: t('toast.archivedNotOpenable'), tone: 'warning' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'archivedNotOpenable'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'defaultWorkspaceFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'defaultWorkspaceFailed'> => ({
        display: (_notice, t) => ({ text: t('defaultWorkspace.failed'), tone: 'warning' }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'defaultWorkspaceFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'shortcutForkFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'shortcutForkFailed'> => ({
        display: (notice, t) => ({
          text: t(notice.reason === 'unavailable' ? 'shortcut.noCompletedTurn' : 'shortcut.forkFailed'), tone: 'plain',
        }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'shortcutForkFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'createFailed', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'createFailed'> => ({
        display: (notice, t) => ({ text: t('toast.createFailed', { message: notice.message }), tone: 'warning', holdMs: 6000 }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'createFailed'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'forkRequiresOpen', locale: 'modern-workspace',
      inject: (): ToastDisplayInjected<'forkRequiresOpen'> => ({
        display: (notice, t, dismiss) => ({
          text: t('toast.forkRequiresOpen'), tone: 'warning', holdMs: 6000,
          actions: [{ label: t('toast.openForkSource'), onClick: () => { dismiss(); actions.openForkSource(notice.sessionId) } }],
        }),
      }),
    }, ToastEntry<PropsRuntime<'modern.workspace.toast', 'forkRequiresOpen'>>)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'archived', locale: 'modern-workspace', store: viewStore,
      inject: (): ArchiveToastInjected => ({
        display: (notice, t, dismiss) => ({
          text: t('toast.archived'), tone: 'success', holdMs: 6000,
          actions: [{ label: t('toast.archivedUndo'), onClick: () => { dismiss(); actions.undoArchive(notice.sessionId) } }],
        }),
        filterAction: archiveFilterAction,
      }),
    }, ArchiveToastEntry)
    yield ctx.slots.register({
      name: 'modern.workspace.toast', key: 'stoppedAndArchived', locale: 'modern-workspace', store: viewStore,
      inject: (): ArchiveToastInjected => ({
        display: (notice, t, dismiss) => ({
          text: t('toast.stoppedAndArchived'), tone: 'success', holdMs: 6000,
          actions: [{ label: t('toast.archivedUndo'), onClick: () => { dismiss(); actions.undoArchive(notice.sessionId) } }],
        }),
        filterAction: archiveFilterAction,
      }),
    }, ArchiveToastEntry)
  })
}
