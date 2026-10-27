import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageImagesOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
type Props = MessageImagesOwnerProps & PropsRenderFactories
export function MessageImages({ images, loadImage, align, compact, thumbnail, renderFactorySlot }: Props) {
  return renderFactorySlot('conversation.images.content', { images, loadImage, align,
    ...compact === undefined ? {} : { compact }, ...thumbnail === undefined ? {} : { thumbnail } })
}
