/** Answer-presentation switches shared by the Host schema, the Settings row and the code-fence presenters. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The `presentation` section of the Modern UI entry config (see src/index.ts). */
export interface PresentationSettings {
  /** Append the response-presentation guidance to the system prompt (changes model output). */
  prompt: boolean
  /** Append the progressive result delivery guidance to the system prompt (changes model output). */
  progressive: boolean
  /** Render `openui-lang` code fences (and `openui` fences written in openui-lang) as inline components. */
  openui: boolean
  /** Render `followups` code fences as suggestion chips. */
  followups: boolean
}

/** Defaults matching the Host schema; saved choices take precedence over these defaults. */
export const DEFAULT_PRESENTATION: PresentationSettings = { prompt: true, progressive: true, openui: true, followups: true }

/** Locale namespace of the settings row. */
export const PRESENTATION_LOCALE = 'modern-presentation-settings'

const zh = {
  'settings.presentation.title': '回答可视化组件',
  'settings.presentation.description': '开启后会向模型追加约 30 KB 提示词，让回答使用卡片、流程图等组件',
  'settings.presentation.saveFailed': '保存失败，设置没有改变，请重试',
  'settings.presentation.on': '开启',
  'settings.presentation.off': '关闭',
  'settings.progressive.title': '分段交付成果',
  'settings.progressive.description': '开启后会向模型追加约 3 KB 提示词：需要几轮工具调用的回答，查完一部分就先交出这部分的结果，再继续下一部分',
}
type Dictionary = Record<keyof typeof zh, string>
const en: Dictionary = {
  'settings.presentation.title': 'Answer visual components',
  'settings.presentation.description': 'Adds about 30 KB of instructions to the model prompt so answers use cards, diagrams and similar components',
  'settings.presentation.saveFailed': 'Could not save; the setting is unchanged. Try again.',
  'settings.presentation.on': 'On',
  'settings.presentation.off': 'Off',
  'settings.progressive.title': 'Deliver results in stages',
  'settings.progressive.description':
    'Adds about 3 KB of instructions to the model prompt: when an answer takes several rounds of tool calls, each finished part is delivered before the next is researched',
}
const ja: Dictionary = {
  'settings.presentation.title': '回答のビジュアルコンポーネント',
  'settings.presentation.description': 'オンにするとモデルに約 30 KB の指示を追加し、カードや図などで回答します',
  'settings.presentation.saveFailed': '保存できませんでした。設定は変更されていません。もう一度お試しください',
  'settings.presentation.on': 'オン',
  'settings.presentation.off': 'オフ',
  'settings.progressive.title': '成果を段階的に届ける',
  'settings.progressive.description':
    'オンにするとモデルに約 3 KB の指示を追加し、何度もツールを呼ぶ回答では、調べ終えた部分から先に結果を届けてから次へ進みます',
}
const es: Dictionary = {
  'settings.presentation.title': 'Componentes visuales en respuestas',
  'settings.presentation.description': 'Añade unos 30 KB de instrucciones al modelo para que responda con tarjetas, diagramas y componentes similares',
  'settings.presentation.saveFailed': 'No se pudo guardar; el ajuste no ha cambiado. Inténtalo de nuevo.',
  'settings.presentation.on': 'Activado',
  'settings.presentation.off': 'Desactivado',
  'settings.progressive.title': 'Entregar resultados por etapas',
  'settings.progressive.description':
    'Añade unos 3 KB de instrucciones al modelo: cuando una respuesta requiere varias rondas de herramientas, entrega cada parte terminada antes de investigar la siguiente',
}
const fr: Dictionary = {
  'settings.presentation.title': 'Composants visuels des réponses',
  'settings.presentation.description':
    'Ajoute environ 30 Ko d’instructions au modèle pour répondre avec des cartes, des diagrammes et des composants similaires',
  'settings.presentation.saveFailed': 'Échec de l’enregistrement ; le réglage n’a pas changé. Réessayez.',
  'settings.presentation.on': 'Activé',
  'settings.presentation.off': 'Désactivé',
  'settings.progressive.title': 'Livrer les résultats par étapes',
  'settings.progressive.description':
    'Ajoute environ 3 Ko d’instructions au modèle : quand une réponse demande plusieurs séries d’outils, chaque partie terminée est livrée avant de chercher la suivante',
}
const de: Dictionary = {
  'settings.presentation.title': 'Visuelle Antwortkomponenten',
  'settings.presentation.description': 'Fügt dem Modell etwa 30 KB Anweisungen hinzu, damit Antworten Karten, Diagramme und ähnliche Komponenten nutzen',
  'settings.presentation.saveFailed': 'Speichern fehlgeschlagen; die Einstellung ist unverändert. Bitte erneut versuchen.',
  'settings.presentation.on': 'An',
  'settings.presentation.off': 'Aus',
  'settings.progressive.title': 'Ergebnisse schrittweise liefern',
  'settings.progressive.description':
    'Fügt dem Modell etwa 3 KB Anweisungen hinzu: Braucht eine Antwort mehrere Werkzeugrunden, wird jeder fertige Teil geliefert, bevor der nächste recherchiert wird',
}
const ru: Dictionary = {
  'settings.presentation.title': 'Визуальные компоненты ответов',
  'settings.presentation.description': 'Добавляет модели около 30 КБ инструкций, чтобы ответы использовали карточки, схемы и похожие компоненты',
  'settings.presentation.saveFailed': 'Не удалось сохранить; настройка не изменилась. Попробуйте ещё раз.',
  'settings.presentation.on': 'Вкл.',
  'settings.presentation.off': 'Выкл.',
  'settings.progressive.title': 'Выдавать результаты по этапам',
  'settings.progressive.description':
    'Добавляет модели около 3 КБ инструкций: если ответ требует нескольких раундов инструментов, каждая готовая часть выдаётся до поиска следующей',
}
const pt: Dictionary = {
  'settings.presentation.title': 'Componentes visuais nas respostas',
  'settings.presentation.description': 'Adiciona cerca de 30 KB de instruções ao modelo para responder com cartões, diagramas e componentes semelhantes',
  'settings.presentation.saveFailed': 'Não foi possível salvar; a configuração não mudou. Tente novamente.',
  'settings.presentation.on': 'Ativado',
  'settings.presentation.off': 'Desativado',
  'settings.progressive.title': 'Entregar resultados por etapas',
  'settings.progressive.description':
    'Adiciona cerca de 3 KB de instruções ao modelo: quando uma resposta exige várias rodadas de ferramentas, cada parte concluída é entregue antes de pesquisar a próxima',
}
/** Row copy in the eight interface languages. */
export const presentationLocale = { zh, en, ja, es, fr, de, ru, pt }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'modern-presentation-settings': keyof Dictionary
  }
}

/**
 * Normalize one accepted config section; anything missing keeps its default.
 * @param value - the `presentation` value from the Host config, possibly absent or partial.
 * @returns complete switches.
 */
export function readPresentation(value: unknown): PresentationSettings {
  const section = value && typeof value === 'object' ? (value as Partial<Record<keyof PresentationSettings, unknown>>) : {}
  const flag = (key: keyof PresentationSettings) => (typeof section[key] === 'boolean' ? section[key] : DEFAULT_PRESENTATION[key])
  return { prompt: flag('prompt'), progressive: flag('progressive'), openui: flag('openui'), followups: flag('followups') }
}

/** The parts of the Modern UI config form the switches read and write. */
export type PresentationForm = Pick<ConfigForm<{ presentation?: Partial<PresentationSettings> }>, 'getSnapshot' | 'subscribe' | 'mutate'>

/** Host-accepted switches and the outcome of the latest write of each model-visible switch. */
export interface PresentationState {
  /** Accepted switches only: a write shows here once the Host has accepted it. */
  settings: ObservableSnapshot<PresentationSettings>
  /** Whether the latest prompt write was refused or never reached the Host. */
  saveFailed: ObservableSnapshot<boolean>
  /** Write the prompt switch; a newer call supersedes the outcome of an older one. */
  setPrompt: (enabled: boolean) => void
  /** Whether the latest progressive-delivery write was refused or never reached the Host. */
  progressiveSaveFailed: ObservableSnapshot<boolean>
  /** Write the progressive-delivery switch; a newer call supersedes the outcome of an older one. */
  setProgressive: (enabled: boolean) => void
  /** Stop following the form. */
  dispose: () => void
}

/**
 * Follow the accepted switches and write the model-visible switches without showing an unsaved value.
 * Both change what the Host sends to the model, so a row must not claim a value the Host did not accept:
 * a refused write reloads the accepted state, and a transport failure leaves it as it was.
 * @param form - the Modern UI config form.
 * @returns the accepted switches, each switch's latest write outcome and its writer.
 */
export function trackPresentation(form: PresentationForm): PresentationState {
  const settings = createSnapshotStore(readPresentation(form.getSnapshot().value?.presentation))
  const sync = () => {
    const next = readPresentation(form.getSnapshot().value?.presentation)
    const current = settings.getSnapshot()
    if ((Object.keys(next) as (keyof PresentationSettings)[]).some(key => next[key] !== current[key])) settings.set(next)
  }
  // Each switch keeps its own failure and its own latest write, so one row's outcome never shows on the other.
  const writer = (key: 'prompt' | 'progressive') => {
    const saveFailed = createSnapshotStore(false)
    let latest = 0
    const set = (enabled: boolean) => {
      const write = ++latest
      saveFailed.set(false)
      const settle = (accepted: boolean) => {
        if (write !== latest) return
        sync()
        saveFailed.set(!accepted)
      }
      form.mutate([{ op: 'set', path: ['presentation', key], value: enabled }]).then(settle, () => {
        settle(false)
      })
    }
    return { saveFailed, set }
  }
  const prompt = writer('prompt')
  const progressive = writer('progressive')
  return {
    settings,
    saveFailed: prompt.saveFailed,
    setPrompt: prompt.set,
    progressiveSaveFailed: progressive.saveFailed,
    setProgressive: progressive.set,
    dispose: form.subscribe(sync),
  }
}
