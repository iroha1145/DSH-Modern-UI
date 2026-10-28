/**
 * `modern-plan` namespace: the plan preview's states and primitive chrome. The
 * official `plan` namespace leaves the code-block labels to `common`, which in
 * rc.4 has no collapse/expand entries, so the plugin's preview names every
 * label itself.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'preview.loading': '正在读取计划…',
  'preview.failed': '无法读取计划',
  'preview.invalidAddress': '计划地址无效',
  'preview.historyUnavailable': '无法读取会话历史',
  'preview.notFound': '未找到这份计划',
  'preview.unavailable': '计划预览不可用',
  'preview.expired': '临时计划预览已失效，请从仍在等待审批的卡片重新打开。',
  'copy': '复制',
  'copied': '复制成功',
  'codeBlock.title': '代码块',
  'codeBlock.wrap': '自动换行',
  'codeBlock.unwrap': '取消自动换行',
  'codeBlock.collapse': '收起代码',
  'codeBlock.expand': '展开代码',
  'markdown.footnotes': '脚注',
} satisfies Record<string, string>

/** Plan preview namespace keys. */
export type PlanPreviewKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'preview.loading': 'Loading plan…',
  'preview.failed': 'Could not load plan',
  'preview.invalidAddress': 'Invalid plan address',
  'preview.historyUnavailable': 'Session history is unavailable',
  'preview.notFound': 'This plan was not found',
  'preview.unavailable': 'Plan preview is unavailable',
  'preview.expired': 'This temporary plan preview has expired. Reopen it from the pending review card.',
  'copy': 'Copy',
  'copied': 'Copied',
  'codeBlock.title': 'Code block',
  'codeBlock.wrap': 'Wrap lines',
  'codeBlock.unwrap': 'Do not wrap lines',
  'codeBlock.collapse': 'Collapse code',
  'codeBlock.expand': 'Expand code',
  'markdown.footnotes': 'Footnotes',
} satisfies Record<PlanPreviewKey, string>

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  'preview.loading': '計画を読み込み中…',
  'preview.failed': '計画を読み込めませんでした',
  'preview.invalidAddress': '計画のアドレスが無効です',
  'preview.historyUnavailable': 'セッション履歴を利用できません',
  'preview.notFound': 'この計画は見つかりませんでした',
  'preview.unavailable': '計画のプレビューを利用できません',
  'preview.expired': 'この一時的な計画プレビューは期限切れです。保留中のレビューカードから再度開いてください。',
  'copy': 'コピー',
  'copied': 'コピーしました',
  'codeBlock.title': 'コードブロック',
  'codeBlock.wrap': '行を折り返す',
  'codeBlock.unwrap': '行を折り返さない',
  'codeBlock.collapse': 'コードを折りたたむ',
  'codeBlock.expand': 'コードを展開',
  'markdown.footnotes': '脚注',
} satisfies Record<PlanPreviewKey, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'preview.loading': 'Cargando plan…',
  'preview.failed': 'No se pudo cargar el plan',
  'preview.invalidAddress': 'Dirección del plan no válida',
  'preview.historyUnavailable': 'El historial de sesiones no está disponible',
  'preview.notFound': 'Este plan no fue encontrado.',
  'preview.unavailable': 'La vista previa del plan no está disponible',
  'preview.expired': 'Esta vista previa del plan temporal ha caducado. Vuelva a abrirlo desde la tarjeta de revisión pendiente.',
  'copy': 'Copiar',
  'copied': 'Copiado',
  'codeBlock.title': 'Bloque de código',
  'codeBlock.wrap': 'Ajustar líneas',
  'codeBlock.unwrap': 'No ajustar líneas',
  'codeBlock.collapse': 'Contraer código',
  'codeBlock.expand': 'Expandir código',
  'markdown.footnotes': 'Notas a pie de página',
} satisfies Record<PlanPreviewKey, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'preview.loading': 'Plan de chargement…',
  'preview.failed': 'Impossible de charger le plan',
  'preview.invalidAddress': 'Adresse du forfait invalide',
  'preview.historyUnavailable': "L'historique des sessions n'est pas disponible",
  'preview.notFound': "Ce plan n'a pas été trouvé",
  'preview.unavailable': "L'aperçu du plan n'est pas disponible",
  'preview.expired': 'Cet aperçu du plan temporaire a expiré. Rouvrez-le à partir de la carte de révision en attente.',
  'copy': 'Copier',
  'copied': 'Copié',
  'codeBlock.title': 'Bloc de code',
  'codeBlock.wrap': 'Activer le retour à la ligne',
  'codeBlock.unwrap': 'Désactiver le retour à la ligne',
  'codeBlock.collapse': 'Réduire le code',
  'codeBlock.expand': 'Développer le code',
  'markdown.footnotes': 'Notes de bas de page',
} satisfies Record<PlanPreviewKey, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'preview.loading': 'Ladeplan…',
  'preview.failed': 'Plan konnte nicht geladen werden',
  'preview.invalidAddress': 'Ungültige Planadresse',
  'preview.historyUnavailable': 'Der Sitzungsverlauf ist nicht verfügbar',
  'preview.notFound': 'Dieser Plan wurde nicht gefunden',
  'preview.unavailable': 'Die Planvorschau ist nicht verfügbar',
  'preview.expired': 'Diese temporäre Planvorschau ist abgelaufen. Öffnen Sie es erneut über die ausstehende Überprüfungskarte.',
  'copy': 'Kopieren',
  'copied': 'Kopiert',
  'codeBlock.title': 'Codeblock',
  'codeBlock.wrap': 'Zeilen umbrechen',
  'codeBlock.unwrap': 'Zeilen nicht umbrechen',
  'codeBlock.collapse': 'Code einklappen',
  'codeBlock.expand': 'Code ausklappen',
  'markdown.footnotes': 'Fußnoten',
} satisfies Record<PlanPreviewKey, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'preview.loading': 'План загрузки…',
  'preview.failed': 'Не удалось загрузить план',
  'preview.invalidAddress': 'Неверный адрес плана',
  'preview.historyUnavailable': 'История сеансов недоступна',
  'preview.notFound': 'Этот план не найден',
  'preview.unavailable': 'Предварительный просмотр плана недоступен.',
  'preview.expired': 'Срок действия этой временной предварительной версии плана истек. Откройте его снова из карточки ожидающего рассмотрения.',
  'copy': 'Копировать',
  'copied': 'Скопировано',
  'codeBlock.title': 'Блок кода',
  'codeBlock.wrap': 'Переносить строки',
  'codeBlock.unwrap': 'Не переносить строки',
  'codeBlock.collapse': 'Свернуть код',
  'codeBlock.expand': 'Развернуть код',
  'markdown.footnotes': 'Сноски',
} satisfies Record<PlanPreviewKey, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'preview.loading': 'Carregando plano…',
  'preview.failed': 'Não foi possível carregar o plano',
  'preview.invalidAddress': 'Endereço do plano inválido',
  'preview.historyUnavailable': 'O histórico da sessão não está disponível',
  'preview.notFound': 'Este plano não foi encontrado',
  'preview.unavailable': 'A visualização do plano não está disponível',
  'preview.expired': 'Esta visualização temporária do plano expirou. Reabra-o no cartão de revisão pendente.',
  'copy': 'Copiar',
  'copied': 'Copiado',
  'codeBlock.title': 'Bloco de código',
  'codeBlock.wrap': 'Quebrar linhas',
  'codeBlock.unwrap': 'Não quebrar linhas',
  'codeBlock.collapse': 'Recolher código',
  'codeBlock.expand': 'Expandir código',
  'markdown.footnotes': 'Notas de rodapé',
} satisfies Record<PlanPreviewKey, string>
