/** State behind the optional Jev settings row: the on/off switch in the Modern UI config and the TypeSafe key in the DSH credentials service. */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** The `jev` section fields the row reads (see JevConfig in src/jev-tool.ts). */
export interface JevSection {
  enabled?: unknown
  credential?: unknown
}

/** The Modern UI config form, as far as the row reads and writes it. */
export type JevForm = Pick<ConfigForm<{ jev?: JevSection }>, 'getSnapshot' | 'subscribe' | 'mutate'>

/** What the browser may learn about a credential: never its value. */
export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

/** The credentials Remote of the settings controller. */
export interface JevCredentials {
  describe: (refs: string[]) => Promise<RemoteResult<Record<string, CredentialView>>>
  set: (ref: string, value: string) => Promise<RemoteResult<void>>
  unset: (ref: string) => Promise<RemoteResult<void>>
}

/** Default reference name, matching JevConfig. */
export const DEFAULT_CREDENTIAL = 'TYPESAFE_API_KEY'
// The credentials service's reference grammar; the Host never resolves any other name.
const REF_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Everything the row renders. */
export interface JevRowState {
  /** Host-accepted switch. */
  enabled: boolean
  /** Credential reference the Host resolves, or null when the configured name is not a valid one. */
  ref: string | null
  configured: boolean
  /** Where the key comes from: `file` is the DSH credentials file; the others are environment layers. */
  source: string | undefined
  writable: boolean
  /** A key write is in flight. */
  busy: boolean
  /** Outcome of the latest key write, or of the latest switch write when it failed. */
  notice: 'saved' | 'removed' | 'writeFailed' | 'switchFailed' | null
}

/** The row's live state and its actions. */
export interface JevState {
  state: ObservableSnapshot<JevRowState>
  /** Write the switch; the row shows the Host-accepted value only. */
  setEnabled: (enabled: boolean) => void
  /** Store a key under the configured reference; resolves true once the Host accepted it. */
  saveKey: (value: string) => Promise<boolean>
  /** Remove the stored key; an environment value, if any, applies again. */
  removeKey: () => Promise<boolean>
  /** Re-read the configured state after the Host reports a change to a reference. */
  refresh: (ref: string) => void
  dispose: () => void
}

/**
 * Read the accepted `jev` section.
 * @param section - the section from the Host config, possibly absent or partial.
 * @returns the switch and the credential reference.
 */
export function readJev(section: JevSection | undefined): Pick<JevRowState, 'enabled' | 'ref'> {
  const name = typeof section?.credential === 'string' ? section.credential : DEFAULT_CREDENTIAL
  return { enabled: typeof section?.enabled === 'boolean' ? section.enabled : true, ref: REF_NAME.test(name) ? name : null }
}

/**
 * Follow the switch and the key. The key never reaches the browser: a save sends it once to the credentials
 * service, and the row only learns whether one is configured and from where.
 * @param form - the Modern UI config form.
 * @param credentials - the credentials Remote.
 * @returns the state and actions.
 */
export function trackJev(form: JevForm, credentials: JevCredentials): JevState {
  const state = createSnapshotStore<JevRowState>({
    ...readJev(form.getSnapshot().value?.jev), configured: false, source: undefined, writable: true, busy: false, notice: null,
  })
  const update = (patch: Partial<JevRowState>) => { state.set({ ...state.getSnapshot(), ...patch }) }

  let reads = 0
  const describe = async () => {
    const read = ++reads
    const ref = state.getSnapshot().ref
    if (ref === null) { update({ configured: false, source: undefined, writable: false }); return }
    const response = await credentials.describe([ref]).catch(() => undefined)
    // Only the latest read applies: an older answer, or one for a reference since replaced, may describe a state
    // a save has already changed.
    if (read !== reads || response?.ok !== true || state.getSnapshot().ref !== ref) return
    const view = response.value[ref]
    update({ configured: view?.configured ?? false, source: view?.source, writable: view?.writable ?? true })
  }

  const sync = () => {
    const next = readJev(form.getSnapshot().value?.jev)
    const current = state.getSnapshot()
    if (next.enabled === current.enabled && next.ref === current.ref) return
    update(next)
    if (next.ref !== current.ref) void describe()
  }

  let latest = 0
  const setEnabled = (enabled: boolean) => {
    const write = ++latest
    const settle = (accepted: boolean) => {
      if (write !== latest) return
      sync()
      update({ notice: accepted ? null : 'switchFailed' })
    }
    form.mutate([{ op: 'set', path: ['jev', 'enabled'], value: enabled }]).then(settle, () => { settle(false) })
  }

  const writeKey = async (write: (ref: string) => Promise<RemoteResult<void>>, done: 'saved' | 'removed') => {
    const ref = state.getSnapshot().ref
    if (ref === null || state.getSnapshot().busy) return false
    update({ busy: true, notice: null })
    // The configured badge alone cannot tell a refused write from an accepted one when a key already existed.
    const response = await write(ref).catch(() => undefined)
    const ok = response?.ok === true
    await describe()
    update({ busy: false, notice: ok ? done : 'writeFailed' })
    return ok
  }

  return {
    state,
    setEnabled,
    saveKey: value => value.trim() === '' ? Promise.resolve(false) : writeKey(ref => credentials.set(ref, value.trim()), 'saved'),
    removeKey: () => writeKey(ref => credentials.unset(ref), 'removed'),
    refresh: (ref) => { if (ref === state.getSnapshot().ref) void describe() },
    dispose: (() => {
      const unsubscribe = form.subscribe(sync)
      void describe()
      return unsubscribe
    })(),
  }
}

/** Locale namespace of the row. */
export const JEV_LOCALE = 'modern-jev-settings'

const zh = {
  'settings.jev.title': 'Jev 呈现建议',
  'settings.jev.description': '可选。填入 TypeSafe 的密钥后，模型回答前可以请 Jev 参谋一下，用文字、表格、图表还是流程图来展示。Jev 只看到这一轮的请求和模型写的一小段内容结构概述；问不问、采不采纳都由模型决定。没有密钥时不会联系 TypeSafe。',
  'settings.jev.site': 'TypeSafe 官网',
  'settings.jev.needsPrompt': '要先打开上面的「回答可视化组件」才会生效。',
  'settings.jev.enable': '使用 Jev',
  'settings.jev.key': 'TypeSafe 密钥',
  'settings.jev.keyHint': '保存在 DSH 的凭据文件里，不写进设置，保存后也不会再显示。',
  'settings.jev.keyFile': '已配置密钥',
  'settings.jev.keyEnv': '已从环境变量或 .env 文件读取密钥',
  'settings.jev.keyUnset': '还没有配置密钥',
  'settings.jev.save': '保存密钥',
  'settings.jev.remove': '移除密钥',
  'settings.jev.saved': '密钥已保存，下一条消息起生效',
  'settings.jev.removed': '密钥已移除',
  'settings.jev.writeFailed': '没有保存成功，请重试',
  'settings.jev.switchFailed': '开关保存失败，设置没有改变，请重试',
}
type Dictionary = Record<keyof typeof zh, string>
const en: Dictionary = {
  'settings.jev.title': 'Jev presentation advice',
  'settings.jev.description': "Optional. With a TypeSafe key, the model may ask Jev before answering whether text, a table, a chart or a flowchart would present the answer well. Jev sees only this turn's request and the model's short outline of the content's structure; whether to ask, and whether to follow the advice, is up to the model. Without a key, TypeSafe is never contacted.",
  'settings.jev.site': 'TypeSafe website',
  'settings.jev.needsPrompt': 'Takes effect only while "Answer visual components" above is on.',
  'settings.jev.enable': 'Use Jev',
  'settings.jev.key': 'TypeSafe key',
  'settings.jev.keyHint': 'Stored in the DSH credentials file, not in settings, and never shown again after saving.',
  'settings.jev.keyFile': 'A key is configured',
  'settings.jev.keyEnv': 'A key is read from the environment or a .env file',
  'settings.jev.keyUnset': 'No key is configured',
  'settings.jev.save': 'Save key',
  'settings.jev.remove': 'Remove key',
  'settings.jev.saved': 'Key saved; it applies from the next message',
  'settings.jev.removed': 'Key removed',
  'settings.jev.writeFailed': 'Could not save. Try again.',
  'settings.jev.switchFailed': 'Could not save the switch; the setting is unchanged. Try again.',
}
const ja: Dictionary = {
  'settings.jev.title': 'Jev による表示方法の助言',
  'settings.jev.description': '任意。TypeSafe のキーを入れると、モデルは回答の前に、テキスト・表・グラフ・フローチャートのどれで見せるとよいかを Jev に相談できます。Jev が見るのは今回のリクエストと、モデルが書いた内容の構成の短い説明だけです。相談するか、助言に従うかはモデルが決めます。キーがなければ TypeSafe には接続しません。',
  'settings.jev.site': 'TypeSafe のサイト',
  'settings.jev.needsPrompt': '上の「回答のビジュアルコンポーネント」がオンのときだけ有効です。',
  'settings.jev.enable': 'Jev を使う',
  'settings.jev.key': 'TypeSafe のキー',
  'settings.jev.keyHint': 'DSH の資格情報ファイルに保存され、設定には書き込まれません。保存後は再表示されません。',
  'settings.jev.keyFile': 'キーは設定済みです',
  'settings.jev.keyEnv': '環境変数または .env ファイルのキーを使っています',
  'settings.jev.keyUnset': 'キーは未設定です',
  'settings.jev.save': 'キーを保存',
  'settings.jev.remove': 'キーを削除',
  'settings.jev.saved': 'キーを保存しました。次のメッセージから有効です',
  'settings.jev.removed': 'キーを削除しました',
  'settings.jev.writeFailed': '保存できませんでした。もう一度お試しください',
  'settings.jev.switchFailed': 'スイッチを保存できませんでした。設定は変更されていません。もう一度お試しください',
}
const es: Dictionary = {
  'settings.jev.title': 'Consejo de presentación de Jev',
  'settings.jev.description': 'Opcional. Con una clave de TypeSafe, el modelo puede consultar a Jev antes de responder si conviene presentar la respuesta como texto, tabla, gráfico o diagrama de flujo. Jev solo ve la petición de este turno y un breve resumen de la estructura del contenido escrito por el modelo; el modelo decide si consulta y si sigue el consejo. Sin clave no se contacta con TypeSafe.',
  'settings.jev.site': 'Sitio de TypeSafe',
  'settings.jev.needsPrompt': 'Solo tiene efecto con «Componentes visuales en respuestas» activado.',
  'settings.jev.enable': 'Usar Jev',
  'settings.jev.key': 'Clave de TypeSafe',
  'settings.jev.keyHint': 'Se guarda en el archivo de credenciales de DSH, no en los ajustes, y no vuelve a mostrarse.',
  'settings.jev.keyFile': 'Hay una clave configurada',
  'settings.jev.keyEnv': 'La clave se lee del entorno o de un archivo .env',
  'settings.jev.keyUnset': 'No hay ninguna clave configurada',
  'settings.jev.save': 'Guardar clave',
  'settings.jev.remove': 'Quitar clave',
  'settings.jev.saved': 'Clave guardada; se aplica desde el próximo mensaje',
  'settings.jev.removed': 'Clave quitada',
  'settings.jev.writeFailed': 'No se pudo guardar. Inténtalo de nuevo.',
  'settings.jev.switchFailed': 'No se pudo guardar el interruptor; el ajuste no ha cambiado. Inténtalo de nuevo.',
}
const fr: Dictionary = {
  'settings.jev.title': 'Conseil de présentation par Jev',
  'settings.jev.description': 'Facultatif. Avec une clé TypeSafe, le modèle peut demander à Jev, avant de répondre, si un texte, un tableau, un graphique ou un organigramme présenterait bien la réponse. Jev ne voit que la demande de ce tour et un court résumé de la structure du contenu rédigé par le modèle ; c’est le modèle qui décide de consulter Jev et de suivre ou non son avis. Sans clé, TypeSafe n’est jamais contacté.',
  'settings.jev.site': 'Site de TypeSafe',
  'settings.jev.needsPrompt': 'Ne s’applique que si « Composants visuels des réponses » est activé.',
  'settings.jev.enable': 'Utiliser Jev',
  'settings.jev.key': 'Clé TypeSafe',
  'settings.jev.keyHint': 'Enregistrée dans le fichier d’identifiants de DSH, pas dans les réglages, et plus jamais affichée.',
  'settings.jev.keyFile': 'Une clé est configurée',
  'settings.jev.keyEnv': 'La clé est lue depuis l’environnement ou un fichier .env',
  'settings.jev.keyUnset': 'Aucune clé configurée',
  'settings.jev.save': 'Enregistrer la clé',
  'settings.jev.remove': 'Supprimer la clé',
  'settings.jev.saved': 'Clé enregistrée ; elle s’applique dès le prochain message',
  'settings.jev.removed': 'Clé supprimée',
  'settings.jev.writeFailed': 'Échec de l’enregistrement. Réessayez.',
  'settings.jev.switchFailed': 'Échec de l’enregistrement de l’interrupteur ; le réglage n’a pas changé. Réessayez.',
}
const de: Dictionary = {
  'settings.jev.title': 'Darstellungsrat von Jev',
  'settings.jev.description': 'Optional. Mit einem TypeSafe-Schlüssel kann das Modell vor der Antwort Jev fragen, ob Text, Tabelle, Diagramm oder Flussdiagramm die Antwort gut darstellt. Jev sieht nur die Anfrage dieses Durchgangs und eine kurze Beschreibung der Inhaltsstruktur vom Modell; ob es fragt und dem Rat folgt, entscheidet das Modell. Ohne Schlüssel wird TypeSafe nie kontaktiert.',
  'settings.jev.site': 'TypeSafe-Website',
  'settings.jev.needsPrompt': 'Wirkt nur, solange „Visuelle Antwortkomponenten“ oben an ist.',
  'settings.jev.enable': 'Jev verwenden',
  'settings.jev.key': 'TypeSafe-Schlüssel',
  'settings.jev.keyHint': 'Wird in der DSH-Anmeldedatendatei gespeichert, nicht in den Einstellungen, und danach nie wieder angezeigt.',
  'settings.jev.keyFile': 'Ein Schlüssel ist eingerichtet',
  'settings.jev.keyEnv': 'Der Schlüssel kommt aus der Umgebung oder einer .env-Datei',
  'settings.jev.keyUnset': 'Kein Schlüssel eingerichtet',
  'settings.jev.save': 'Schlüssel speichern',
  'settings.jev.remove': 'Schlüssel entfernen',
  'settings.jev.saved': 'Schlüssel gespeichert; gilt ab der nächsten Nachricht',
  'settings.jev.removed': 'Schlüssel entfernt',
  'settings.jev.writeFailed': 'Speichern fehlgeschlagen. Bitte erneut versuchen.',
  'settings.jev.switchFailed': 'Schalter nicht gespeichert; die Einstellung ist unverändert. Bitte erneut versuchen.',
}
const ru: Dictionary = {
  'settings.jev.title': 'Советы Jev по виду ответа',
  'settings.jev.description': 'Необязательно. С ключом TypeSafe модель может перед ответом спросить Jev, как лучше его показать: текстом, таблицей, графиком или схемой. Jev видит только запрос этого хода и краткое описание структуры содержимого от модели; спрашивать ли и следовать ли совету, решает модель. Без ключа к TypeSafe нет обращений.',
  'settings.jev.site': 'Сайт TypeSafe',
  'settings.jev.needsPrompt': 'Работает, только когда выше включены «Визуальные компоненты ответов».',
  'settings.jev.enable': 'Использовать Jev',
  'settings.jev.key': 'Ключ TypeSafe',
  'settings.jev.keyHint': 'Хранится в файле учётных данных DSH, а не в настройках, и после сохранения больше не показывается.',
  'settings.jev.keyFile': 'Ключ настроен',
  'settings.jev.keyEnv': 'Ключ берётся из окружения или файла .env',
  'settings.jev.keyUnset': 'Ключ не настроен',
  'settings.jev.save': 'Сохранить ключ',
  'settings.jev.remove': 'Удалить ключ',
  'settings.jev.saved': 'Ключ сохранён; действует со следующего сообщения',
  'settings.jev.removed': 'Ключ удалён',
  'settings.jev.writeFailed': 'Не удалось сохранить. Попробуйте ещё раз.',
  'settings.jev.switchFailed': 'Не удалось сохранить переключатель; настройка не изменилась. Попробуйте ещё раз.',
}
const pt: Dictionary = {
  'settings.jev.title': 'Conselho de apresentação do Jev',
  'settings.jev.description': 'Opcional. Com uma chave da TypeSafe, o modelo pode consultar o Jev antes de responder se a resposta fica melhor como texto, tabela, gráfico ou fluxograma. O Jev só vê o pedido desta rodada e um breve resumo da estrutura do conteúdo escrito pelo modelo; consultar e seguir o conselho fica a critério do modelo. Sem chave, a TypeSafe nunca é contatada.',
  'settings.jev.site': 'Site da TypeSafe',
  'settings.jev.needsPrompt': 'Só funciona com «Componentes visuais nas respostas» ativado.',
  'settings.jev.enable': 'Usar Jev',
  'settings.jev.key': 'Chave da TypeSafe',
  'settings.jev.keyHint': 'Fica no arquivo de credenciais do DSH, não nas configurações, e não volta a ser exibida.',
  'settings.jev.keyFile': 'Há uma chave configurada',
  'settings.jev.keyEnv': 'A chave vem do ambiente ou de um arquivo .env',
  'settings.jev.keyUnset': 'Nenhuma chave configurada',
  'settings.jev.save': 'Salvar chave',
  'settings.jev.remove': 'Remover chave',
  'settings.jev.saved': 'Chave salva; vale a partir da próxima mensagem',
  'settings.jev.removed': 'Chave removida',
  'settings.jev.writeFailed': 'Não foi possível salvar. Tente novamente.',
  'settings.jev.switchFailed': 'Não foi possível salvar o interruptor; a configuração não mudou. Tente novamente.',
}
/** Row copy in the eight interface languages. */
export const jevLocale = { zh, en, ja, es, fr, de, ru, pt }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'modern-jev-settings': keyof Dictionary }
}
