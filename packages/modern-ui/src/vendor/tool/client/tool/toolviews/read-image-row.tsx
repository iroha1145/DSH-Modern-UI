// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE and provenance.
import type { Context } from '@deepseek-ai/cordis'
import { imageCardModel } from '../models/image-card-model.ts'
import { readFamilyRow, type ReadImageRowProps } from './read-family-row.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Render authorized original images through the standard, independently replaceable Tool gallery. */
export function ReadImageRow(props: ReadImageRowProps) {
  return readFamilyRow(props, {
    image: imageCardModel(props.block),
    loadImage: props.loadImage,
    renderImage: image => props.renderSlot('tool.call.images', {
      images: image.images, loadImage: props.loadImage, align: 'start',
    }),
  })
}
export const readImageToolview = {
  name: 'modern-read-image-toolview', inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'read_image', locale: NS,
      children: { 'tool.call.images': { kind: 'single', scope: 'session' } },
    }, ReadImageRow))
  },
}
