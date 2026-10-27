/** The default composer body: the 'conversation.composer.bar' slot entry. */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import clsx from 'clsx'
import {
  IconPlusOutlineMedium, IconWarningOutlineRegular, isMobileDevice, Toast, Tooltip,
} from '@iroha1145/dsh-modern-ui/primitives'
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type {} from '@deepseek-ai/dsh-goal/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import { DraftEditor } from '../input/editor/DraftEditor.tsx'
import {
  focusDraftEditor, installDraftFilePicker, installDraftKeyboardDismissal, installDraftKeymap, installDraftWheel,
  keepDraftFocus, revealDraftSelection,
} from '../input/editor/view-binding.ts'
import { resolveSubmitMode } from '../input/submission-policy.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { isImageMediaType } from '../service.ts'
import { ContextMeter } from './ContextMeter.tsx'
import { observeControlRow } from './control-row-layout.ts'
import css from './InputBar.module.css'

const HERO_SUGGESTION_SETS = [
  [{ icon: 'code', key: 'refactor' }, { icon: 'sparkle', key: 'audit' }, { icon: 'doc', key: 'verify' }],
  [{ icon: 'code', key: 'ui' }, { icon: 'sparkle', key: 'debug' }, { icon: 'doc', key: 'spec' }],
] as const

export type InputBarProps = ComposerBarProps

export const InputBar = memo(function InputBar({
  useSession, useInput, inputActions, keyboard, addFiles, removeAttachment, resolveDraftAttachments,
  retryFileUpload,
  toggleCommandMenu, stop, t,
  renderSlot, useBusyEnter, useFileUploads, useNotices, useLexicon, useMenuLauncher, useStopShortcut,
  useAccess,
  useProjection, sessionId, variant, disabled: inert = false, blocked,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  const busyEnter = useBusyEnter(s => s)
  const stopKeys = useStopShortcut(keys => keys)
  const promptDenied = useAccess('session/prompt') === false
  const cancelDenied = useAccess('session/cancel') === false
  const uploadDenied = useAccess('fileUploads/upload') === false
  const stopAction = cancelDenied ? undefined : stop
  void useLexicon
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const [activity, setActivity] = useState(false)
  const [suggestionSetIndex, setSuggestionSetIndex] = useState(0)
  useEffect(() => { setActivity(false) }, [sessionId])
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  const hasGoal = useProjection('goal', goal => goal != null)
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  const editor = keyboard?.editor ?? null
  const attachments = useMemo(
    () => input === undefined || resolveDraftAttachments === undefined ? [] : resolveDraftAttachments(input.attachmentIds),
    [resolveDraftAttachments, input?.attachmentIds],
  )
  const empty = draft.trim() === '' && attachments.length === 0
  const uploads = useFileUploads(snapshot => snapshot)
  const uploadsPending = attachments.some(attachment => attachment.kind === 'file'
    ? uploads[attachment.id]?.status !== 'ready'
    : uploads[attachment.id] !== undefined && uploads[attachment.id]?.status !== 'ready')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  const imageLimits = useProjection('imageLimits')
  const failedUpload = attachments.map(attachment => uploads[attachment.id]).find(upload => upload?.status === 'error')
  const uploadsHeldText = failedUpload?.status !== 'error'
    ? t('file.stillUploading')
    : failedUpload.reason === undefined ? t('file.uploadFailed') : attachmentErrorText(t, failedUpload.reason, imageLimits)
  useEffect(() => {
    if (promptError === null) return
    const { error } = promptError
    if (error.code === 'session/writer-held') {
      showToast(t('error.sessionInUse'))
      return
    }
    showToast(error.code === 'session/attachment-invalid' || error.code === 'subagent/attachment-invalid'
      ? attachmentErrorText(t, error.details.reason, imageLimits)
      : `${error.message} (${error.code})`)
  }, [promptError, showToast, t, imageLimits])
  useEffect(() => {
    if (notice?.level === 'error') showToast(notice.text)
  }, [notice, showToast])
  const rowRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    return observeControlRow(row)
  }, [])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const continuable = subagent?.address.mode === 'continuable'
  const parentOffline = continuable && subagent.parentAvailable !== true
  const disabled = removed || inert || !live || blocked !== undefined || parentOffline
  const locked = disabled
  const modelSeatLocked = removed || inert || !live
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting'
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const editorDisabled = removed || (locked && !workspaceTrigger)
  const editable = live && !locked && !machineBusy
  const steeringAvailable = subagent === null || subagent.address.mode === 'continuable'
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && steeringAvailable
    && input.queue.length > 0

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.attachmentIds, inputActions])

  const revealSelection = (): void => {
    revealDraftSelection(scrollRef)
  }

  useEffect(() => {
    if (locked || editor === null) return
    if (isMobileDevice()) return
    focusDraftEditor(editor, revealSelection)
  }, [locked, sessionId, editor])

  useEffect(() => {
    if (locked || draft === '') return
    revealSelection()
  }, [draft !== ''])

  useEffect(() => {
    return installDraftWheel(scrollRef)
  }, [])

  const intakeFiles = useCallback((files: readonly File[], directories?: ReadonlySet<File>): void => {
    if (uploadDenied || locked || machineBusy || (subagent !== null && !continuable)
      || addFiles === undefined || files.length === 0) return
    const rejected = ((): string | null => {
      if (continuable && files.some(file => directories?.has(file) || !isImageMediaType(file.type))) {
        return t('image.unsupportedType')
      }
      if (imageLimits !== undefined) {
        const mediaTypes = imageLimits.mediaTypes as readonly string[]
        const images = files.filter(file => mediaTypes.includes(file.type))
        const imageAttachments = attachments.filter(attachment => attachment.kind === 'image')
        if (imageAttachments.length + images.length > imageLimits.maxImagesPerMessage) {
          return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
        }
        if (images.some(file => file.size > imageLimits.maxImageBytes)) {
          return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
        }
        const total = imageAttachments.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + images.reduce((sum, file) => sum + file.size, 0)
        if (total > imageLimits.maxMessageImageBytes) {
          return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
        }
      }
      return addFiles(files, directories)
    })()
    if (rejected !== null) showToast(rejected)
  }, [uploadDenied, locked, machineBusy, subagent, continuable, addFiles, attachments, imageLimits, showToast, t])

  const canAcceptDrop = !uploadDenied && (subagent === null || continuable) && !locked && !machineBusy && addFiles !== undefined

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files === null ? [] : [...e.target.files]
    e.target.value = ''
    if (picked.length > 0) intakeFiles(picked)
  }

  const gate = useRef({
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, uploadsPending, uploadsHeldText, showToast, canAcceptDrop,
  })
  gate.current = {
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, uploadsPending, uploadsHeldText, showToast, canAcceptDrop,
  }

  useEffect(() => {
    if (keyboard === undefined) return
    return installDraftFilePicker(keyboard, gate, fileInputRef)
  }, [keyboard])

  useEffect(() => {
    if (editor === null || keyboard === undefined) return
    return installDraftKeymap(editor, keyboard, gate)
  }, [editor, keyboard])

  useEffect(() => {
    if (editor === null) return
    return installDraftKeyboardDismissal(editor, cardRef)
  }, [editor])

  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    keepDraftFocus(e, editor)
  }

  const onCardMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (!editable || editor === null || e.button !== 0 || e.defaultPrevented) return
    const target = e.target
    if (!(target instanceof Element) || !e.currentTarget.contains(target)) return
    if (target.closest('[data-composer-overlay]') !== null) return
    if (scrollRef.current?.contains(target)) return
    const control = target.closest('button, a, input, select, textarea, [role="button"], [contenteditable], [tabindex]')
    if (control !== null && control !== e.currentTarget && e.currentTarget.contains(control)) return
    e.preventDefault()
    if (document.activeElement !== editor.getRootElement()) focusDraftEditor(editor, revealSelection)
  }

  const onToggleCommandMenu = (): void => {
    if (keyboard === undefined) return
    if (editor !== null) focusDraftEditor(editor, revealSelection)
    toggleCommandMenu?.(keyboard.caretSpan())
  }

  const onWorkspaceKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!workspaceTrigger) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRequestWorkspace()
    }
  }

  const primaryStops = running && subagent === null && (empty || blocked !== undefined)
  const primaryDisabled = primaryStops ? stopAction === undefined : empty || disabled || machineBusy || uploadsPending
  const interruptible = running && continuable
  const primarySubmitMode = resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)
  const plainMessageDraft = !empty && input?.phase === 'plain' && !draft.trimStart().startsWith('/')
  const primaryLabel = primaryStops
    ? t('input.stop')
    : running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft
      ? t(primarySubmitMode === 'steer' ? 'input.send.steer' : 'input.send.queue')
      : t('input.send')
  const onPrimary = (): void => {
    if (primaryStops) {
      stopAction?.()
      return
    }
    if (keyboard === undefined) return
    if (!empty && !disabled && !machineBusy && !uploadsPending) keyboard.submit(primarySubmitMode, 'click')
  }

  const claimActive = (input?.phase === 'claimed' || input?.phase === 'submitting')
    && input.claim !== undefined && draft.startsWith(input.claim.token)
  const rawHint = claimActive && input.claim.hint !== undefined
    && draft.slice(input.claim.token.length).trim() === ''
    ? input.claim.hint
    : null
  const hint = ((): string | null => {
    if (rawHint === null) return null
    const commandName = input?.claim?.name ?? ''
    const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
    const translated = (t as Translate)(hintKey)
    return translated !== hintKey ? translated : rawHint
  })()

  const placeholderText = placeholder ?? (parentOffline
    ? t('placeholder.parentOffline')
    : disabled
      ? t('placeholder.unavailable')
      : canSteerQueue
        ? t('placeholder.steerQueue')
        : planActive ? t('placeholder.plan') : t('placeholder.default'))

  return (
    <div className={clsx(css.root, variant === 'hero' && css.hero)}>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={clsx(css.card, workspaceTrigger && css.cardWorkspaceTrigger)}
        data-composer-card
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
        onMouseDown={onCardMouseDown}
      >
        {sessionId !== undefined && (
          <div className={css.overlayAnchor} data-composer-overlay>{renderSlot('conversation.input.overlay', {})}</div>
        )}
        {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
        {renderSlot('conversation.input.attachments', {
          attachments,
          canAcceptDrop,
          onAddFiles: intakeFiles,
          onRemoveAttachment: (id) => { removeAttachment?.(id) },
          uploads,
          onRetryFile: (id) => { retryFileUpload?.(id) },
          dropLimits: imageLimits === undefined ? undefined : {
            count: imageLimits.maxImagesPerMessage,
            size: imageSizeText(imageLimits.maxImageBytes),
          },
        })}
        <DraftEditor
          classNames={css}
          editor={editor}
          scrollRef={scrollRef}
          editable={editable}
          editorDisabled={editorDisabled}
          phase={input?.phase ?? 'inert'}
          placeholderText={placeholderText}
          ariaLabel={workspaceTrigger ? t('hero.chooseWorkspace') : placeholderText}
          workspaceTrigger={workspaceTrigger}
          workspacePickerOpen={workspacePickerOpen}
          onWorkspaceKeyDown={onWorkspaceKeyDown}
          hint={hint}
          showPlaceholder={draft === '' && attachments.length === 0 && !claimActive}
        />
        <div ref={rowRef} className={css.row}>
          <div className={css.tools} hidden={activity}>
            <Tooltip label={t('input.commands')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.add}
                aria-label={t('input.commands')}
                aria-haspopup="listbox"
                aria-expanded={commandMenuOpen}
                disabled={locked || toggleCommandMenu === undefined}
                onMouseDown={keepFocus}
                onClick={onToggleCommandMenu}
              >
                <IconPlusOutlineMedium size={14} />
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={!canAcceptDrop || subagent !== null}
              hidden
              onChange={onPickFiles}
            />
            <div className={css.modes}>
              {sessionId === undefined ? null : renderSlot('conversation.input.permission', { locked })}
              {sessionId === undefined ? null : renderSlot('conversation.input.plan', { locked })}
            </div>
            {input === undefined || sessionId === undefined
              ? null
              : renderSlot('conversation.input.left', {})}
          </div>
          <div className={clsx(css.trailing, activity && css.trailingActive)}>
            <div className={css.standardControls} hidden={activity}>
              {input === undefined || sessionId === undefined
                ? null
                : renderSlot('conversation.input.right', {})}
              {sessionId === undefined ? null : renderSlot('conversation.input.model', { locked: modelSeatLocked })}
            </div>
            {input === undefined || sessionId === undefined ? null : (
              <div className={activity ? css.activityExpanded : css.activity}>
                {renderSlot('conversation.input.activity', { locked, onActiveChange: setActivity })}
              </div>
            )}
            {interruptible && !cancelDenied && (
              <Tooltip label={t('input.stop')} shortcutKeys={stopKeys} side="top" delayMs={500} disabled={stopAction === undefined}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={t('input.stop')}
                  disabled={stopAction === undefined}
                  onMouseDown={keepFocus}
                  onClick={stopAction}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                    <rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            )}
            {(primaryStops ? cancelDenied : promptDenied) ? null : (
              <Tooltip label={primaryStops ? t('input.stop') : primaryLabel} shortcutKeys={primaryStops ? stopKeys : undefined} side="top" delayMs={500} disabled={primaryDisabled}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={primaryLabel}
                  disabled={primaryDisabled}
                  onMouseDown={keepFocus}
                  onClick={onPrimary}
                >
                  {primaryStops ? (
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                      <rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  )}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <div className={css.dock} data-composer-dock>
        <div className={css.dockReadings}>
          {variant === 'composer' && input !== undefined && sessionId !== undefined
            ? renderSlot('conversation.composer.dock', {})
            : null}
          {activity ? null : <ContextMeter useProjection={useProjection} t={t} />}
        </div>
      </div>
      {variant === 'hero' && !inert && (
        <div className={css.heroSuggestions}>
          <div className={css.suggestionGrid}>
            {(HERO_SUGGESTION_SETS[suggestionSetIndex % HERO_SUGGESTION_SETS.length] ?? HERO_SUGGESTION_SETS[0]).map((item, idx) => (
              <button
                key={item.key}
                type="button"
                className={css.suggestionRow}
                disabled={!editable || !empty}
                style={{ animationDelay: `${220 + idx * 55}ms` }}
                onClick={() => {
                  if (editor === null || !editable || !empty) return
                  editor.update(() => {
                    const root = $getRoot()
                    root.clear()
                    const p = $createParagraphNode()
                    p.append($createTextNode(t(`hero.${item.key}.text`)))
                    root.append(p)
                    p.selectEnd()
                  })
                  focusDraftEditor(editor, revealSelection)
                }}
              >
                <div className={css.suggestionTop}>
                  <span className={css.suggestionIcon} aria-hidden="true">
                    {item.icon === 'code' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
                      </svg>
                    ) : item.icon === 'sparkle' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6M8 13h8M8 17h5" />
                      </svg>
                    )}
                  </span>
                  <span className={css.suggestionKicker}>{t(`hero.${item.key}.label`)}</span>
                </div>
                <span className={css.suggestionText}>{t(`hero.${item.key}.text`)}</span>
              </button>
            ))}
          </div>
          <div className={css.shuffleRow}>
            <button
              type="button"
              className={css.shuffleButton}
              onClick={() => { setSuggestionSetIndex(i => i + 1) }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              <span>{t('hero.shuffle')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
