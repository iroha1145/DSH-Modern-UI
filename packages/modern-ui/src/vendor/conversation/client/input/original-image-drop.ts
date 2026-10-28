/** Application image tokens enter the same validation callback as ordinary picked or dropped files. */
import { useEffect, type RefObject } from 'react'
import { FILE_DRAG_TOKEN_TYPE } from '../../../file-drag/transfers.ts'

export function installOriginalImageDrop(
  card: HTMLElement,
  canAcceptDrop: boolean,
  onAddFiles: (files: readonly File[]) => void,
  readFileDrag: (transfer: DataTransfer) => File | undefined,
): () => void {
  const originalTransfer = (event: DragEvent): DataTransfer | undefined => {
    const transfer = event.dataTransfer
    return transfer?.types.includes(FILE_DRAG_TOKEN_TYPE) ? transfer : undefined
  }
  const dragover = (event: DragEvent): void => {
    const transfer = originalTransfer(event)
    if (transfer === undefined) return
    event.preventDefault()
    transfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
  }
  const drop = (event: DragEvent): void => {
    const transfer = originalTransfer(event)
    if (transfer === undefined) return
    const file = readFileDrag(transfer)
    if (file === undefined) return
    event.preventDefault()
    event.stopPropagation()
    if (canAcceptDrop) onAddFiles([file])
  }
  card.addEventListener('dragover', dragover, true)
  card.addEventListener('drop', drop, true)
  return () => {
    card.removeEventListener('dragover', dragover, true)
    card.removeEventListener('drop', drop, true)
  }
}

export function useOriginalImageDrop(
  card: RefObject<HTMLElement>,
  canAcceptDrop: boolean,
  onAddFiles: (files: readonly File[]) => void,
  readFileDrag: ((transfer: DataTransfer) => File | undefined) | undefined,
): void {
  useEffect(() => {
    if (card.current === null || readFileDrag === undefined) return
    return installOriginalImageDrop(card.current, canAcceptDrop, onAddFiles, readFileDrag)
  }, [card, canAcceptDrop, onAddFiles, readFileDrag])
}
