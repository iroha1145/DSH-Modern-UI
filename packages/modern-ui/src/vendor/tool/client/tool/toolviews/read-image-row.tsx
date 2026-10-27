// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
import type { Context } from '@deepseek-ai/cordis'
import { imageCardModel } from '../models/image-card-model.ts'
import { readFamilyRow, type ReadImageRowProps } from './read-family-row.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Use the public gallery factory, retaining the official attachment service and loader. */
export function ReadImageRow(props: ReadImageRowProps) {
  return readFamilyRow(props, {
    image: imageCardModel(props.block),
    loadImage: props.loadImage,
    renderImage: image => props.renderFactorySlot('conversation.images.content', {
      images: image.images, loadImage: props.loadImage, align: 'start',
    }),
  })
}
export const readImageToolview = {
  name: 'modern-read-image-toolview', inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'read_image', priority: -100, locale: NS,
    }, ReadImageRow))
  },
}
