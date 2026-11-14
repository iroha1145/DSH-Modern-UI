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
import { hostComposesFileDrag } from './host-contract.ts'

export interface FileDragService {
  readonly actions: FileDragActions
  readonly read: (transfer: DataTransfer) => File | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileDrag: FileDragService
  }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    'modern.images.content': {
      scope: 'root'
      props: MessageImagesOwnerProps & { labels?: MessageImageLabels }
      locale: 'conversation'
      inject: { fileDrag: FileDragActions; imageZoomT: TranslateNS<'modern-chat'> }
    }
  }
}

function imageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: {
      dialog: t('image.preview'),
      close: t('image.closePreview'),
    },
  }
}

function ImageContent({
  images,
  loadImage,
  align,
  compact = false,
  thumbnail = false,
  labels,
  t,
  fileDrag,
  imageZoomT,
}: FactoryComponentPropsOf<'modern.images.content'>) {
  const baseLabels = labels ?? imageLabels(t)
  return createElement(ImageGallery, {
    images,
    load: loadImage,
    align,
    compact,
    thumbnail,
    labels: {
      ...baseLabels,
      lightbox: {
        ...baseLabels.lightbox,
        zoomIn: imageZoomT('image.zoomIn'),
        zoomOut: imageZoomT('image.zoomOut'),
        resetZoom: imageZoomT('image.resetZoom'),
        zoomHelp: imageZoomT('image.zoomHelp'),
      },
    },
    fileDrag,
  })
}

function MessageImages({ images, loadImage, align, compact, thumbnail, renderFactorySlot }: MessageImagesOwnerProps & PropsRenderFactories) {
  return renderFactorySlot('modern.images.content', {
    images,
    loadImage,
    align,
    ...(compact === undefined ? {} : { compact }),
    ...(thumbnail === undefined ? {} : { thumbnail }),
  })
}

/**
 * The fallback transfer owner for Hosts that ship no official file-drag plugin (0.2.1): the public
 * `fileDrag` service, its dictionaries and the failure overlay.
 * @param scope - the file-drag scope carrying slots and locale.
 */
function provideFileDrag(scope: Context): void {
  const failure = createSnapshotStore<FileDragFailure | null>(null)
  const dictionaries = { zh, en, ja, es, fr, de, ru, pt }
  scope.effect(() => scope.locale.register('fileDrag', dictionaries))
  const t = scope.locale.bind('fileDrag')
  const transfers = new FileTransfers()
  let sequence = 0
  const dismiss = (): void => {
    failure.set(null)
  }
  const service: FileDragService = {
    actions: {
      prepare: (source, signal) => transfers.prepare(source, signal),
      reportFailure: () => {
        failure.set({ text: t('failed'), sequence: ++sequence })
      },
    },
    read: transfer => transfers.read(transfer),
  }
  scope.provide('fileDrag', service)
  scope.effect(() => () => {
    transfers.dispose()
    dismiss()
  })
  scope.slots.inject('shell.overlay', () =>
    scope.slots.register(
      {
        name: 'shell.overlay',
        id: 'file-drag.feedback',
        inject: (): FileDragFeedbackInjected => ({ hooks: { failure }, dismiss }),
      },
      FileDragFeedback,
    ),
  )
}

export function installFileDrag(ctx: Context): void {
  ctx.inject(['slots', 'locale'], scope => {
    // From the 0.2.2 prereleases on the Host composes its own file-drag plugin, which owns the
    // public `fileDrag` service, the `fileDrag` dictionaries and the failure overlay. Declaring any
    // of them a second time throws and takes this whole scope down with it, image slots included,
    // so the fallback serves only a Host where nobody else owns them.
    if (!hostComposesFileDrag(scope) && scope.get('fileDrag') === undefined) provideFileDrag(scope)
    // Resolved per call: the official plugin may finish loading after this scope starts.
    const owner = (): FileDragService | undefined => scope.get('fileDrag')
    const actions: FileDragActions = {
      prepare: (source, signal) => owner()?.actions.prepare(source, signal) ?? Promise.reject(new Error('file drag is unavailable')),
      reportFailure: () => {
        owner()?.actions.reportFailure()
      },
    }
    scope.slots.registerFactory(
      {
        name: 'modern.images.content',
        scope: 'root',
        locale: 'conversation',
        inject: () => ({ fileDrag: actions, imageZoomT: scope.locale.bind('modern-chat') }),
      },
      ImageContent,
    )
    for (const name of ['conversation.chat.message.images', 'conversation.chat.user.images', 'conversation.trajectory.images'] as const) {
      scope.slots.inject(name, () => scope.slots.register({ name, priority: -200 }, MessageImages))
    }
    // The complete Modern Tool owner exposes the standard child seat. Keep its base renderer
    // at priority 0 so a third-party renderer can replace it with the ordinary -10 override.
    scope.slots.inject('tool.call.images', () => scope.slots.register({ name: 'tool.call.images' }, MessageImages))
  })
}
