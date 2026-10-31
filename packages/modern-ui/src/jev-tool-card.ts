/**
 * Copy for the jev_presentation_advice Tool row: its title, and the outcome of a settled call read from the result
 * metadata the Host tool records. Confidence is in that metadata too but is not shown: TypeSafe derives it from the
 * candidate distribution, and a number beside a suggestion reads as the chance that the suggestion is right.
 * Browser-side; the tool itself lives in jev-tool.ts.
 */

/** The model-facing tool name, as registered by jev-tool.ts. */
export const JEV_TOOL_NAME = 'jev_presentation_advice'

/** Outcome label keys by Jev choice (the PRESENTATIONS ids in jev-tool.ts) and by the statuses without a choice. */
const CHOICE_KEYS = {
  text: 'jev.outcome.text',
  table: 'jev.outcome.table',
  cards: 'jev.outcome.cards',
  steps: 'jev.outcome.steps',
  bar_chart: 'jev.outcome.bar_chart',
  line_chart: 'jev.outcome.line_chart',
  scatter_plot: 'jev.outcome.scatter_plot',
  part_to_whole: 'jev.outcome.part_to_whole',
  flowchart: 'jev.outcome.flowchart',
  diagram: 'jev.outcome.diagram',
  calculator: 'jev.outcome.calculator',
  several_visuals: 'jev.outcome.several_visuals',
} as const
const STATUS_KEYS = {
  unavailable: 'jev.outcome.unavailable',
  already_consulted: 'jev.outcome.alreadyConsulted',
  not_sent: 'jev.outcome.notSent',
} as const

export type JevOutcomeKey = (typeof CHOICE_KEYS)[keyof typeof CHOICE_KEYS] | (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS]

/**
 * The outcome label of one settled call.
 * @param meta - The persisted result metadata: `{ status, presentation?, confidence? }`.
 * @returns A label key, or undefined for metadata of any other shape (an older record, a cancelled call).
 */
export function jevOutcomeKey(meta: unknown): JevOutcomeKey | undefined {
  const { status, presentation } = (meta ?? {}) as { status?: unknown; presentation?: unknown }
  if (typeof status !== 'string') return undefined
  if (status === 'suggestion' || status === 'no_suggestion' || status === 'repeated') {
    return typeof presentation === 'string' && Object.hasOwn(CHOICE_KEYS, presentation) ? CHOICE_KEYS[presentation as keyof typeof CHOICE_KEYS] : undefined
  }
  return Object.hasOwn(STATUS_KEYS, status) ? STATUS_KEYS[status as keyof typeof STATUS_KEYS] : undefined
}

const zh = {
  'tool.title.jevAdvice': '请 Jev 参谋呈现方式',
  'jev.outcome.text': '没有额外建议',
  'jev.outcome.table': '可考虑：表格',
  'jev.outcome.cards': '可考虑：卡片',
  'jev.outcome.steps': '可考虑：步骤',
  'jev.outcome.bar_chart': '可考虑：柱状图',
  'jev.outcome.line_chart': '可考虑：折线图',
  'jev.outcome.scatter_plot': '可考虑：散点图',
  'jev.outcome.part_to_whole': '可考虑：饼图',
  'jev.outcome.flowchart': '可考虑：流程图',
  'jev.outcome.diagram': '可考虑：示意图',
  'jev.outcome.calculator': '可考虑：计算器',
  'jev.outcome.several_visuals': '可考虑：多种可视化',
  'jev.outcome.unavailable': '这次没有建议',
  'jev.outcome.alreadyConsulted': '本轮已问过',
  'jev.outcome.notSent': '未发送',
} satisfies Record<'tool.title.jevAdvice' | JevOutcomeKey, string>
type Dictionary = Record<keyof typeof zh, string>
const en: Dictionary = {
  'tool.title.jevAdvice': 'Ask Jev about presentation',
  'jev.outcome.text': 'No additional suggestion',
  'jev.outcome.table': 'Possible: table',
  'jev.outcome.cards': 'Possible: cards',
  'jev.outcome.steps': 'Possible: steps',
  'jev.outcome.bar_chart': 'Possible: bar chart',
  'jev.outcome.line_chart': 'Possible: line chart',
  'jev.outcome.scatter_plot': 'Possible: scatter chart',
  'jev.outcome.part_to_whole': 'Possible: pie chart',
  'jev.outcome.flowchart': 'Possible: flowchart',
  'jev.outcome.diagram': 'Possible: drawing',
  'jev.outcome.calculator': 'Possible: calculator',
  'jev.outcome.several_visuals': 'Possible: several visuals',
  'jev.outcome.unavailable': 'No suggestion this time',
  'jev.outcome.alreadyConsulted': 'Already asked this turn',
  'jev.outcome.notSent': 'Not sent',
}
const ja: Dictionary = {
  'tool.title.jevAdvice': 'Jev に表示方法を相談',
  'jev.outcome.text': '追加の提案なし',
  'jev.outcome.table': '候補：表',
  'jev.outcome.cards': '候補：カード',
  'jev.outcome.steps': '候補：手順',
  'jev.outcome.bar_chart': '候補：棒グラフ',
  'jev.outcome.line_chart': '候補：折れ線グラフ',
  'jev.outcome.scatter_plot': '候補：散布図',
  'jev.outcome.part_to_whole': '候補：円グラフ',
  'jev.outcome.flowchart': '候補：フローチャート',
  'jev.outcome.diagram': '候補：図',
  'jev.outcome.calculator': '候補：計算ツール',
  'jev.outcome.several_visuals': '候補：複数のビジュアル',
  'jev.outcome.unavailable': '今回は提案なし',
  'jev.outcome.alreadyConsulted': 'このターンでは相談済み',
  'jev.outcome.notSent': '未送信',
}
const es: Dictionary = {
  'tool.title.jevAdvice': 'Consultar a Jev sobre la presentación',
  'jev.outcome.text': 'Sin sugerencia adicional',
  'jev.outcome.table': 'Posible: tabla',
  'jev.outcome.cards': 'Posible: tarjetas',
  'jev.outcome.steps': 'Posible: pasos',
  'jev.outcome.bar_chart': 'Posible: gráfico de barras',
  'jev.outcome.line_chart': 'Posible: gráfico de líneas',
  'jev.outcome.scatter_plot': 'Posible: gráfico de dispersión',
  'jev.outcome.part_to_whole': 'Posible: gráfico circular',
  'jev.outcome.flowchart': 'Posible: diagrama de flujo',
  'jev.outcome.diagram': 'Posible: dibujo',
  'jev.outcome.calculator': 'Posible: calculadora',
  'jev.outcome.several_visuals': 'Posible: varios elementos visuales',
  'jev.outcome.unavailable': 'Sin sugerencia esta vez',
  'jev.outcome.alreadyConsulted': 'Ya se consultó en este turno',
  'jev.outcome.notSent': 'No enviado',
}
const fr: Dictionary = {
  'tool.title.jevAdvice': 'Consulter Jev sur la présentation',
  'jev.outcome.text': 'Pas de suggestion supplémentaire',
  'jev.outcome.table': 'Possible : tableau',
  'jev.outcome.cards': 'Possible : cartes',
  'jev.outcome.steps': 'Possible : étapes',
  'jev.outcome.bar_chart': 'Possible : graphique en barres',
  'jev.outcome.line_chart': 'Possible : graphique linéaire',
  'jev.outcome.scatter_plot': 'Possible : nuage de points',
  'jev.outcome.part_to_whole': 'Possible : graphique circulaire',
  'jev.outcome.flowchart': 'Possible : organigramme',
  'jev.outcome.diagram': 'Possible : dessin',
  'jev.outcome.calculator': 'Possible : calculatrice',
  'jev.outcome.several_visuals': 'Possible : plusieurs visuels',
  'jev.outcome.unavailable': 'Pas de suggestion cette fois',
  'jev.outcome.alreadyConsulted': 'Déjà consulté pendant ce tour',
  'jev.outcome.notSent': 'Non envoyé',
}
const de: Dictionary = {
  'tool.title.jevAdvice': 'Jev zur Darstellung befragen',
  'jev.outcome.text': 'Kein zusätzlicher Vorschlag',
  'jev.outcome.table': 'Möglich: Tabelle',
  'jev.outcome.cards': 'Möglich: Karten',
  'jev.outcome.steps': 'Möglich: Schritte',
  'jev.outcome.bar_chart': 'Möglich: Balkendiagramm',
  'jev.outcome.line_chart': 'Möglich: Liniendiagramm',
  'jev.outcome.scatter_plot': 'Möglich: Streudiagramm',
  'jev.outcome.part_to_whole': 'Möglich: Kreisdiagramm',
  'jev.outcome.flowchart': 'Möglich: Flussdiagramm',
  'jev.outcome.diagram': 'Möglich: Zeichnung',
  'jev.outcome.calculator': 'Möglich: Rechner',
  'jev.outcome.several_visuals': 'Möglich: mehrere Visualisierungen',
  'jev.outcome.unavailable': 'Diesmal kein Vorschlag',
  'jev.outcome.alreadyConsulted': 'In diesem Durchgang schon gefragt',
  'jev.outcome.notSent': 'Nicht gesendet',
}
const ru: Dictionary = {
  'tool.title.jevAdvice': 'Спросить Jev о виде ответа',
  'jev.outcome.text': 'Без дополнительных советов',
  'jev.outcome.table': 'Можно: таблица',
  'jev.outcome.cards': 'Можно: карточки',
  'jev.outcome.steps': 'Можно: шаги',
  'jev.outcome.bar_chart': 'Можно: столбчатая диаграмма',
  'jev.outcome.line_chart': 'Можно: линейный график',
  'jev.outcome.scatter_plot': 'Можно: точечная диаграмма',
  'jev.outcome.part_to_whole': 'Можно: круговая диаграмма',
  'jev.outcome.flowchart': 'Можно: блок-схема',
  'jev.outcome.diagram': 'Можно: рисунок',
  'jev.outcome.calculator': 'Можно: калькулятор',
  'jev.outcome.several_visuals': 'Можно: несколько визуальных форм',
  'jev.outcome.unavailable': 'На этот раз без совета',
  'jev.outcome.alreadyConsulted': 'В этом ходе уже спрашивали',
  'jev.outcome.notSent': 'Не отправлено',
}
const pt: Dictionary = {
  'tool.title.jevAdvice': 'Consultar o Jev sobre a apresentação',
  'jev.outcome.text': 'Sem sugestão adicional',
  'jev.outcome.table': 'Possível: tabela',
  'jev.outcome.cards': 'Possível: cartões',
  'jev.outcome.steps': 'Possível: etapas',
  'jev.outcome.bar_chart': 'Possível: gráfico de barras',
  'jev.outcome.line_chart': 'Possível: gráfico de linhas',
  'jev.outcome.scatter_plot': 'Possível: gráfico de dispersão',
  'jev.outcome.part_to_whole': 'Possível: gráfico de pizza',
  'jev.outcome.flowchart': 'Possível: fluxograma',
  'jev.outcome.diagram': 'Possível: desenho',
  'jev.outcome.calculator': 'Possível: calculadora',
  'jev.outcome.several_visuals': 'Possível: vários visuais',
  'jev.outcome.unavailable': 'Sem sugestão desta vez',
  'jev.outcome.alreadyConsulted': 'Já consultado nesta rodada',
  'jev.outcome.notSent': 'Não enviado',
}
/** Row copy in the eight interface languages, merged into the `modern-tool` namespace by tool-owner.ts. */
export const jevToolLocale = { zh, en, ja, es, fr, de, ru, pt }
