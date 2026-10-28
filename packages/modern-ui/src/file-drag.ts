/** Original-image browser transfers, independent of official attachment and upload ownership. */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageImageLabels, MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FactoryComponentPropsOf, PropsRenderFactories, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileDragActions } from './vendor/primitives/file-drag-actions.ts'
import { FileTransfers } from './vendor/file-drag/transfers.ts'
import { ImageGallery } from './vendor/file-drag/MessageImage.tsx'
import { FileDragFeedback, type FileDragFailure, type FileDragFeedbackInjected } from './vendor/file-drag/feedback.tsx'
import { zh, en, ja, es, fr, de, ru, pt } from './vendor/file-drag/locales.ts'

export interface FileDragService {
  readonly actions: FileDragActions
  readonly read: (transfer: DataTransfer) => File | undefined
}

declare module '@deepseek-ai/cordis' { interface Context { fileDrag: FileDragService } }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'modern.images.content': {
      scope: 'root'; props: MessageImagesOwnerProps & { labels?: MessageImageLabels }; locale: 'conversation'
      inject: { fileDrag: FileDragActions }
    }
  }
}

function imageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return { image: t('image.label'), open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }), loading: t('image.loading'), loadFailed: t('image.loadFailed'),
    lightbox: { dialog: t('image.preview'), close: t('image.closePreview') } }
}

function ImageContent({ images, loadImage, align, compact = false, thumbnail = false, labels, t, fileDrag }:
  FactoryComponentPropsOf<'modern.images.content'>) {
  return createElement(ImageGallery, { images, load: loadImage, align, compact, thumbnail, labels: labels ?? imageLabels(t), fileDrag })
}

function MessageImages({ images, loadImage, align, compact, thumbnail, renderFactorySlot }: MessageImagesOwnerProps & PropsRenderFactories) {
  return renderFactorySlot('modern.images.content', { images, loadImage, align,
    ...compact === undefined ? {} : { compact }, ...thumbnail === undefined ? {} : { thumbnail } })
}

export function installFileDrag(ctx: Context): void {
  ctx.inject(['slots', 'locale'], scope => {
    const failure = createSnapshotStore<FileDragFailure | null>(null)
    const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
    scope.effect(() => scope.locale.register('fileDrag', dictionaries))
    const t = scope.locale.bind('fileDrag')
    const transfers = new FileTransfers()
    let sequence = 0
    const dismiss = (): void => { failure.set(null) }
    const service: FileDragService = {
      actions: { prepare: (source, signal) => transfers.prepare(source, signal),
        reportFailure: () => { failure.set({ text: t('failed'), sequence: ++sequence }) } },
      read: transfer => transfers.read(transfer),
    }
    scope.provide('fileDrag', service)
    scope.effect(() => () => { transfers.dispose(); dismiss() })
    scope.slots.registerFactory({ name: 'modern.images.content', scope: 'root', locale: 'conversation',
      inject: () => ({ fileDrag: service.actions }),
    }, ImageContent)
    for (const name of ['conversation.chat.message.images', 'conversation.chat.user.images', 'conversation.trajectory.images'] as const) {
      scope.slots.inject(name, () => scope.slots.register({ name, priority: -200 }, MessageImages))
    }
    // The complete Modern Tool owner exposes the standard child seat. Keep its base renderer
    // at priority 0 so a third-party renderer can replace it with the ordinary -10 override.
    scope.slots.inject('tool.call.images', () => scope.slots.register({ name: 'tool.call.images' }, MessageImages))
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay', id: 'file-drag.feedback',
      inject: (): FileDragFeedbackInjected => ({ hooks: { failure }, dismiss }),
    }, FileDragFeedback))
  })
}
