/** Localized visualization controls, local failure states, and the related-questions heading. */

/** zh visualization dictionary. */
export const zh = {
  openLinkQuestion: '打开此链接？',
  openLink: '打开链接',
  cancelLink: '取消',
  insertRejected: '未能插入问题，草稿已保留。请稍后重试。',
  incomplete: '内容未完成，已保留原文',
  title: '交互可视化',
  preparing: '正在生成可视化…',
  invalid: '可视化数据不完整，已保留源代码',
  tooLarge: '可视化内容过长，已保留源代码',
  failed: '可视化未能载入，可以重新显示或查看源代码',
  scriptError: '可视化脚本运行出错，部分内容或交互可能不完整',
  source: '查看源代码',
  hideSource: '收起源代码',
  retry: '重新显示',
  loading: '可视化正在载入',
  related: '相关问题',
} satisfies Record<string, string>

/** Visualization dictionary key union. */
export type IntelligentKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    intelligent: IntelligentKey
  }
}

/** en visualization dictionary. */
export const en = {
  openLinkQuestion: 'Open this link?',
  openLink: 'Open link',
  cancelLink: 'Cancel',
  insertRejected: 'The question could not be inserted. Your draft is unchanged; try again shortly.',
  incomplete: 'Content is incomplete; original source preserved',
  title: 'Interactive visualization',
  preparing: 'Generating visualization…',
  invalid: 'Visualization data is incomplete; source preserved',
  tooLarge: 'Visualization is too large; source preserved',
  failed: 'The visualization did not load; retry or view the source',
  scriptError: 'A visualization script failed; some content or interactions may be missing',
  source: 'View source',
  hideSource: 'Hide source',
  retry: 'Retry display',
  loading: 'Loading visualization',
  related: 'Related',
} satisfies Record<IntelligentKey, string>

/** ja visualization dictionary. */
export const ja = {
  openLinkQuestion: 'このリンクを開きますか？',
  openLink: 'リンクを開く',
  cancelLink: 'キャンセル',
  insertRejected: '質問を挿入できませんでした。下書きは保持されています。少し待って再試行してください。',
  incomplete: '内容が未完成です。原文を保持しました',
  title: '対話型ビジュアル',
  preparing: 'ビジュアルを生成中…',
  invalid: 'データが不完全です。ソースを保持しました',
  tooLarge: '内容が長すぎます。ソースを保持しました',
  failed: 'ビジュアルを読み込めませんでした。再試行するかソースを確認できます',
  scriptError: 'スクリプトでエラーが発生しました。一部の内容や操作が欠けている可能性があります',
  source: 'ソースを表示',
  hideSource: 'ソースを閉じる',
  retry: '表示を再試行',
  loading: 'ビジュアルを読み込み中',
  related: '関連する質問',
} satisfies Record<IntelligentKey, string>

/** de visualization dictionary. */
export const de = {
  openLinkQuestion: 'Diesen Link öffnen?',
  openLink: 'Link öffnen',
  cancelLink: 'Abbrechen',
  insertRejected: 'Die Frage konnte nicht eingefügt werden. Ihr Entwurf bleibt erhalten. Versuchen Sie es gleich noch einmal.',
  incomplete: 'Inhalt unvollständig; Originaltext bleibt erhalten',
  title: 'Interaktive Visualisierung',
  preparing: 'Visualisierung wird erstellt …',
  invalid: 'Unvollständige Daten; Quelltext bleibt erhalten',
  tooLarge: 'Visualisierung zu groß; Quelltext bleibt erhalten',
  failed: 'Visualisierung nicht geladen; erneut versuchen oder Quelltext ansehen',
  scriptError: 'Ein Skript der Visualisierung ist fehlgeschlagen; Inhalte oder Interaktionen können fehlen',
  source: 'Quelltext anzeigen',
  hideSource: 'Quelltext ausblenden',
  retry: 'Anzeige wiederholen',
  loading: 'Visualisierung wird geladen',
  related: 'Verwandte Fragen',
} satisfies Record<IntelligentKey, string>

/** es visualization dictionary. */
export const es = {
  openLinkQuestion: '¿Abrir este enlace?',
  openLink: 'Abrir enlace',
  cancelLink: 'Cancelar',
  insertRejected: 'No se pudo insertar la pregunta. El borrador no ha cambiado. Inténtalo de nuevo en un momento.',
  incomplete: 'Contenido incompleto; se conserva el original',
  title: 'Visualización interactiva',
  preparing: 'Generando visualización…',
  invalid: 'Datos incompletos; se conserva el código',
  tooLarge: 'Contenido demasiado grande; se conserva el código',
  failed: 'No se pudo cargar la visualización; reintenta o consulta el código',
  scriptError: 'Falló un script de la visualización; puede faltar contenido o interacción',
  source: 'Ver código',
  hideSource: 'Ocultar código',
  retry: 'Reintentar',
  loading: 'Cargando visualización',
  related: 'Preguntas relacionadas',
} satisfies Record<IntelligentKey, string>

/** fr visualization dictionary. */
export const fr = {
  openLinkQuestion: 'Ouvrir ce lien ?',
  openLink: 'Ouvrir le lien',
  cancelLink: 'Annuler',
  insertRejected: 'La question n’a pas pu être insérée. Votre brouillon est conservé. Réessayez dans un instant.',
  incomplete: 'Contenu incomplet ; texte original conservé',
  title: 'Visualisation interactive',
  preparing: 'Génération de la visualisation…',
  invalid: 'Données incomplètes ; source conservée',
  tooLarge: 'Contenu trop volumineux ; source conservée',
  failed: "La visualisation n'a pas pu se charger ; réessayez ou consultez la source",
  scriptError: 'Un script de la visualisation a échoué ; du contenu ou des interactions peuvent manquer',
  source: 'Voir la source',
  hideSource: 'Masquer la source',
  retry: 'Réessayer',
  loading: 'Chargement de la visualisation',
  related: 'Questions associées',
} satisfies Record<IntelligentKey, string>

/** ru visualization dictionary. */
export const ru = {
  openLinkQuestion: 'Открыть эту ссылку?',
  openLink: 'Открыть ссылку',
  cancelLink: 'Отмена',
  insertRejected: 'Не удалось вставить вопрос. Черновик сохранён. Повторите попытку чуть позже.',
  incomplete: 'Содержимое не завершено; исходный текст сохранён',
  title: 'Интерактивная визуализация',
  preparing: 'Создаётся визуализация…',
  invalid: 'Неполные данные; исходный код сохранён',
  tooLarge: 'Слишком большой объём; исходный код сохранён',
  failed: 'Визуализация не загрузилась; повторите или посмотрите код',
  scriptError: 'Ошибка в скрипте визуализации; часть содержимого или действий может не работать',
  source: 'Показать код',
  hideSource: 'Скрыть код',
  retry: 'Повторить показ',
  loading: 'Загрузка визуализации',
  related: 'Похожие вопросы',
} satisfies Record<IntelligentKey, string>

/** pt visualization dictionary. */
export const pt = {
  openLinkQuestion: 'Abrir este link?',
  openLink: 'Abrir link',
  cancelLink: 'Cancelar',
  insertRejected: 'Não foi possível inserir a pergunta. O rascunho foi preservado. Tente novamente em instantes.',
  incomplete: 'Conteúdo incompleto; texto original preservado',
  title: 'Visualização interativa',
  preparing: 'Gerando visualização…',
  invalid: 'Dados incompletos; código preservado',
  tooLarge: 'Conteúdo muito grande; código preservado',
  failed: 'A visualização não carregou; tente novamente ou veja o código',
  scriptError: 'Um script da visualização falhou; parte do conteúdo ou das interações pode faltar',
  source: 'Ver código',
  hideSource: 'Ocultar código',
  retry: 'Tentar novamente',
  loading: 'Carregando visualização',
  related: 'Perguntas relacionadas',
} satisfies Record<IntelligentKey, string>
