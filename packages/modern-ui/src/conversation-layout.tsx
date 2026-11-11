import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button } from '@iroha1145/dsh-modern-ui/primitives'
import { PreferenceRow } from './vendor/chat/client/settings/PreferenceRow.tsx'
import type { ConversationWidthControlsInputProps } from './vendor/conversation/client/contract/slots.ts'
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  LAYOUT_WIDTHS,
  MAX_LAYOUT_WIDTH,
  MIN_LAYOUT_WIDTH,
  draggedLayoutWidth,
  readLayoutPreference,
  resolveLayoutWidth,
  selectLayoutMode,
  type ConversationLayoutMode,
  type ConversationLayoutPreference,
} from './conversation-layout-state.ts'
import css from './conversation-layout.module.css'

export const layoutLabels = {
  zh: {
    label: '对话宽度',
    reading: '阅读',
    standard: '标准',
    wide: '宽屏',
    custom: '自定义',
    resize: '拖动两侧调宽，松手即保存',
    done: '完成',
    cancel: '取消',
    hint: '方向键微调，Shift 加速，Home / End 到最小 / 最大宽度；Enter 完成，Escape 取消。',
  },
  en: {
    label: 'Chat width',
    reading: 'Reading',
    standard: 'Standard',
    wide: 'Wide',
    custom: 'Custom',
    resize: 'Drag either edge; release to save',
    done: 'Done',
    cancel: 'Cancel',
    hint: 'Arrow keys adjust, Shift accelerates, Home / End select minimum / maximum. Enter saves; Escape cancels.',
  },
  ja: {
    label: '会話の幅',
    reading: '読書',
    standard: '標準',
    wide: 'ワイド',
    custom: 'カスタム',
    resize: '両端をドラッグし、離すと保存',
    done: '完了',
    cancel: 'キャンセル',
    hint: '矢印キーで調整、Shift で加速、Home / End で最小 / 最大。Enter で保存、Escape でキャンセル。',
  },
  es: {
    label: 'Ancho del chat',
    reading: 'Lectura',
    standard: 'Estándar',
    wide: 'Amplio',
    custom: 'Personalizado',
    resize: 'Arrastra un borde; suelta para guardar',
    done: 'Listo',
    cancel: 'Cancelar',
    hint: 'Flechas para ajustar, Shift acelera, Home / End para mínimo / máximo. Enter guarda; Escape cancela.',
  },
  fr: {
    label: 'Largeur du chat',
    reading: 'Lecture',
    standard: 'Standard',
    wide: 'Large',
    custom: 'Personnalisé',
    resize: 'Glissez un bord ; relâchez pour enregistrer',
    done: 'Terminé',
    cancel: 'Annuler',
    hint: 'Flèches pour ajuster, Shift accélère, Home / End pour minimum / maximum. Entrée enregistre ; Échap annule.',
  },
  de: {
    label: 'Chatbreite',
    reading: 'Lesen',
    standard: 'Standard',
    wide: 'Breit',
    custom: 'Angepasst',
    resize: 'Rand ziehen; Loslassen speichert',
    done: 'Fertig',
    cancel: 'Abbrechen',
    hint: 'Pfeiltasten ändern, Shift beschleunigt, Home / End wählen Minimum / Maximum. Enter speichert; Escape verwirft.',
  },
  ru: {
    label: 'Ширина чата',
    reading: 'Чтение',
    standard: 'Обычная',
    wide: 'Широкая',
    custom: 'Своя',
    resize: 'Перетащите край; отпустите для сохранения',
    done: 'Готово',
    cancel: 'Отмена',
    hint: 'Стрелки меняют ширину, Shift ускоряет, Home / End — минимум / максимум. Enter сохраняет, Escape отменяет.',
  },
  pt: {
    label: 'Largura do chat',
    reading: 'Leitura',
    standard: 'Padrão',
    wide: 'Amplo',
    custom: 'Personalizado',
    resize: 'Arraste uma borda; solte para salvar',
    done: 'Concluir',
    cancel: 'Cancelar',
    hint: 'Setas ajustam, Shift acelera, Home / End selecionam mínimo / máximo. Enter salva; Escape cancela.',
  },
} as const
const language = createSnapshotStore<keyof typeof layoutLabels>('en')
const layoutDescriptions = {
  zh: '选择预设，或选「自定义」后关闭设置，拖动两侧调宽；松手后灰线自动隐藏。再次选择「自定义」可重新调整，仅保存在本机浏览器。',
  en: 'Choose a preset, or select Custom and close settings to drag either edge. Guides hide on release. Select Custom again to readjust. Saved in this browser only.',
  ja: 'プリセット、またはカスタムを選び設定を閉じて両端をドラッグ。離すとガイドが消えます。カスタムを再選択して再調整。このブラウザーにのみ保存。',
  es: 'Elige un ajuste o Personalizado y cierra los ajustes para arrastrar un borde. Las guías se ocultan al soltar. Vuelve a elegir Personalizado para ajustar. Solo se guarda en este navegador.',
  fr: 'Choisissez un préréglage ou Personnalisé, puis fermez les paramètres pour glisser un bord. Les guides disparaissent au relâchement. Resélectionnez Personnalisé pour ajuster. Enregistré dans ce navigateur uniquement.',
  de: 'Vorgabe oder Angepasst wählen und Einstellungen schließen, um einen Rand zu ziehen. Hilfslinien verschwinden beim Loslassen. Angepasst erneut wählen zum Ändern. Nur in diesem Browser gespeichert.',
  ru: 'Выберите режим или «Своя» и закройте настройки, чтобы перетащить край. Линии исчезнут при отпускании. Снова выберите «Своя» для изменения. Сохраняется только в этом браузере.',
  pt: 'Escolha uma predefinição ou Personalizado e feche as configurações para arrastar uma borda. As guias somem ao soltar. Selecione Personalizado novamente para ajustar. Salvo apenas neste navegador.',
} as const
const preference = createSnapshotStore<ConversationLayoutPreference>(DEFAULT_LAYOUT)
// Editing is deliberately transient: reloading never brings the guides back.
const editing = createSnapshotStore<ConversationLayoutPreference | null>(null)
let loaded = false

function loadPreference(): void {
  if (loaded) return
  loaded = true
  try {
    preference.set(readLayoutPreference(localStorage.getItem(LAYOUT_STORAGE_KEY)))
  } catch {
    /* Storage may be disabled. */
  }
}

function savePreference(value: ConversationLayoutPreference, persist = true): void {
  preference.set(value)
  if (persist)
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(value))
    } catch {
      /* Keep the current view usable without storage. */
    }
}

function usePreference(): ConversationLayoutPreference {
  loadPreference()
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getSnapshot)
}

function useLabels() {
  return layoutLabels[useSyncExternalStore(language.subscribe, language.getSnapshot, language.getSnapshot)]
}

/** The General Settings row shares the existing preference control and the two drag handles' local state. */
export function ConversationLayoutSettings() {
  const current = usePreference()
  const labels = useLabels()
  const activeLanguage = useSyncExternalStore(language.subscribe, language.getSnapshot, language.getSnapshot)
  return (
    <div data-conversation-layout-settings>
      <PreferenceRow
        title={labels.label}
        description={layoutDescriptions[activeLanguage]}
        value={current.mode}
        selectedLabel={current.mode === 'custom' ? `${labels.custom} · ${current.customWidth ?? LAYOUT_WIDTHS.standard}px` : labels[current.mode]}
        options={[...Object.keys(LAYOUT_WIDTHS), 'custom'].map(id => ({ id, label: labels[id as ConversationLayoutMode] }))}
        onSelect={value => {
          editing.set(value === 'custom' ? current : null)
          savePreference(selectLayoutMode(current, value as ConversationLayoutMode))
        }}
      />
    </div>
  )
}

/** A component in the public conversation Factory's widthControls slot; no Host mutation is involved. */
export function ConversationWidthControls({ container, phase }: ConversationWidthControlsInputProps) {
  const current = usePreference()
  const labels = useLabels()
  const editBefore = useSyncExternalStore(editing.subscribe, editing.getSnapshot, editing.getSnapshot)
  const [geometry, setGeometry] = useState({ available: 0, offset: 0, phone: false })
  const { available, offset, phone } = geometry
  const actual = resolveLayoutWidth(current, available)
  const drag = useRef<{ x: number; initial: number; before: ConversationLayoutPreference; pointer: number } | null>(null)
  const pending = useRef<ConversationLayoutPreference | null>(null)
  const frame = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (container === null) return
    const scroll = container.querySelector<HTMLElement>(':scope > [data-conversation-scroll]') ?? container
    const measure = () => {
      // Match ChatView's padding: composer clearance + 16px on each edge. Measure the pane, not the window.
      const clearance = Number.parseFloat(getComputedStyle(container).getPropertyValue('--dsh-composer-side-clearance')) || 0
      const available = Math.max(0, scroll.clientWidth - 2 * (clearance + 16))
      const offset = scroll.getBoundingClientRect().left - container.getBoundingClientRect().left + scroll.clientWidth / 2 - container.clientWidth / 2
      // Same breakpoint as ConversationRoot's phone rule, which gives the input card the full width.
      const phone = window.matchMedia('(max-width: 640px)').matches
      setGeometry(previous =>
        previous.available === available && previous.offset === offset && previous.phone === phone ? previous : { available, offset, phone },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroll)
    // The side clearance follows a container query on the pane; observe it too, not only the scroll box.
    if (scroll !== container) observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [container])

  // The composer seat publishes its height on the scroll box, a sibling of these controls. Mirror it onto the
  // shared parent so the temporary bar and guides stay above a composer taller than the stylesheet fallback.
  useLayoutEffect(() => {
    if (container === null) return
    const scroll = container.querySelector<HTMLElement>(':scope > [data-conversation-scroll]')
    if (scroll === null) return
    const previous = container.style.getPropertyValue('--dsh-composer-height')
    const copy = () => {
      const height = scroll.style.getPropertyValue('--dsh-composer-height')
      if (height !== '') container.style.setProperty('--dsh-composer-height', height)
    }
    copy()
    const observer = new MutationObserver(copy)
    observer.observe(scroll, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      if (previous !== '') container.style.setProperty('--dsh-composer-height', previous)
      else container.style.removeProperty('--dsh-composer-height')
    }
  }, [container])

  useLayoutEffect(() => {
    if (container === null || available === 0) return
    // On phones the stylesheet's full-width rule keeps the input card wider than the transcript; inline widths
    // would override it and leave the card narrower than the text.
    const names = phone
      ? (['--dsh-layout-center-offset'] as const)
      : (['--dsh-chat-content-width', '--dsh-composer-card-max-width', '--dsh-layout-center-offset'] as const)
    const previous = names.map(name => [name, container.style.getPropertyValue(name), container.style.getPropertyPriority(name)] as const)
    for (const name of names) container.style.setProperty(name, `${name === '--dsh-layout-center-offset' ? offset : actual}px`)
    container.dataset.conversationLayout = current.mode
    return () => {
      for (const [name, value, priority] of previous) {
        if (value) container.style.setProperty(name, value, priority)
        else container.style.removeProperty(name)
      }
      delete container.dataset.conversationLayout
    }
  }, [container, actual, available, current.mode, offset, phone])

  const clearFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])
  const finish = (cancel: boolean) => {
    const active = drag.current
    const before = editing.getSnapshot()
    if (before === null) return
    clearFrame()
    drag.current = null
    savePreference(cancel ? before : (pending.current ?? preference.getSnapshot()))
    pending.current = null
    container?.removeAttribute('data-layout-dragging')
    editing.set(null)
    // The temporary control disappears; keep keyboard focus in the conversation.
    const composer = container?.querySelector<HTMLElement>('[data-composer-card]')
    if (active !== null || container?.contains(document.activeElement)) composer?.focus({ preventScroll: true })
  }
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      if (drag.current !== null) savePreference(drag.current.before, false)
      container?.removeAttribute('data-layout-dragging')
    },
    [container],
  )
  // Another tab can end the edit mid-drag; the guides then unmount before finish() runs, so release the drag here.
  useEffect(() => {
    if (editBefore !== null || drag.current === null) return
    clearFrame()
    drag.current = null
    pending.current = null
    container?.removeAttribute('data-layout-dragging')
  }, [editBefore, container, clearFrame])
  // Phones and panes too narrow for both guides show the full-width transcript whatever is chosen, so a temporary
  // edit there could only change a number the reader never sees; end it rather than offer it.
  const adjustable = !phone && available >= MIN_LAYOUT_WIDTH + 64
  useEffect(() => {
    if (editBefore !== null && available > 0 && !adjustable && drag.current === null) editing.set(null)
  }, [editBefore, available, adjustable])

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current !== null) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, initial: actual, before: preference.getSnapshot(), pointer: event.pointerId }
    pending.current = null
    container?.setAttribute('data-layout-dragging', '')
  }
  const move = (event: PointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    const active = drag.current
    if (active === null || active.pointer !== event.pointerId) return
    pending.current = { mode: 'custom', customWidth: draggedLayoutWidth(active.initial, event.clientX - active.x, side, available) }
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      if (pending.current !== null) savePreference(pending.current, false)
    })
  }
  const key = (event: KeyboardEvent<HTMLDivElement>, side: 'left' | 'right') => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault()
      finish(event.key === 'Escape')
      return
    }
    const step = event.shiftKey ? 40 : 8
    let width: number
    if (event.key === 'Home') width = Math.min(MIN_LAYOUT_WIDTH, available)
    else if (event.key === 'End') width = Math.min(MAX_LAYOUT_WIDTH, available)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      width = draggedLayoutWidth(actual, (event.key === 'ArrowLeft' ? -step : step) / 2, side, available)
    } else return
    event.preventDefault()
    savePreference({ mode: 'custom', customWidth: width }, false)
  }

  if (phase !== 'active' || actual === 0 || current.mode !== 'custom' || editBefore === null || !adjustable) return null
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: This groups resize actions, not form fields. */}
      <div
        className={css.adjustment}
        data-conversation-width-adjustment
        role="group"
        aria-label={labels.label}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(true)
          }
        }}
      >
        <span title={labels.hint}>
          {labels.resize} · {Math.round(actual)}px
        </span>
        <Button
          size="sm"
          onClick={() => {
            finish(true)
          }}
        >
          {labels.cancel}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            finish(false)
          }}
        >
          {labels.done}
        </Button>
      </div>
      {(['left', 'right'] as const).map(side => (
        // biome-ignore lint/a11y/useSemanticElements: This is an interactive splitter with a value, not a document rule.
        <div
          key={side}
          className={css.handle}
          data-conversation-width-handle={side}
          data-side={side}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={labels.resize}
          aria-valuemin={MIN_LAYOUT_WIDTH}
          aria-valuemax={Math.min(MAX_LAYOUT_WIDTH, available)}
          aria-valuenow={Math.round(actual)}
          title={labels.hint}
          onPointerDown={start}
          onPointerMove={event => {
            move(event, side)
          }}
          onPointerUp={event => {
            if (drag.current?.pointer !== event.pointerId) return
            move(event, side)
            finish(false)
          }}
          onPointerCancel={event => {
            if (drag.current?.pointer === event.pointerId) finish(true)
          }}
          // pointerup and pointercancel finish first; a capture lost without either (the window lost focus mid-drag)
          // is not a release, so it restores the width from before the drag.
          onLostPointerCapture={event => {
            if (drag.current?.pointer === event.pointerId) finish(true)
          }}
          onKeyDown={event => {
            key(event, side)
          }}
          onWheel={event => {
            if (event.ctrlKey || event.deltaY === 0) return
            const scroll = container?.querySelector<HTMLElement>(':scope > [data-conversation-scroll]')
            if (scroll === null || scroll === undefined) return
            const unit = event.deltaMode === 1 ? Number.parseFloat(getComputedStyle(scroll).lineHeight) || 16 : event.deltaMode === 2 ? scroll.clientHeight : 1
            scroll.scrollBy({ top: event.deltaY * unit })
          }}
        />
      ))}
    </>
  )
}

export function installConversationLayout(ctx: Context): void {
  ctx.effect(() => {
    const sync = () => {
      const active = ctx.locale.getLocale().active
      language.set(Object.hasOwn(layoutLabels, active) ? (active as keyof typeof layoutLabels) : 'en')
    }
    sync()
    const stop = ctx.locale.subscribe(sync)
    const onStorage = (event: StorageEvent) => {
      if (event.key === LAYOUT_STORAGE_KEY || event.key === null) {
        editing.set(null)
        preference.set(readLayoutPreference(event.newValue))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      stop()
      window.removeEventListener('storage', onStorage)
    }
  })
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      {
        name: 'settings.general.item',
        id: 'modern-conversation-layout',
        order: 15,
      },
      ConversationLayoutSettings,
    ),
  )
}
