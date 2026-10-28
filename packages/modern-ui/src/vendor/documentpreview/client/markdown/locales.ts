/**
 * `modern-document-markdown` namespace: the Markdown file preview's primitive
 * chrome. The official `documentMarkdown` namespace falls back to `common` for
 * the code-block labels, and rc.4's `common` has no collapse/expand entries,
 * so the plugin's body names every label itself.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'code.copy': '复制',
  'code.copied': '已复制',
  'footnotes': '脚注',
  'codeBlock.title': '代码块',
  'codeBlock.wrap': '自动换行',
  'codeBlock.unwrap': '取消自动换行',
  'codeBlock.collapse': '收起代码',
  'codeBlock.expand': '展开代码',
} satisfies Record<string, string>

/** Markdown preview namespace keys. */
export type MarkdownPreviewKey = keyof typeof zh

/** English labels, paired with the Chinese key set. */
export const en = {
  'code.copy': 'Copy',
  'code.copied': 'Copied',
  'footnotes': 'Footnotes',
  'codeBlock.title': 'Code block',
  'codeBlock.wrap': 'Wrap lines',
  'codeBlock.unwrap': 'Do not wrap lines',
  'codeBlock.collapse': 'Collapse code',
  'codeBlock.expand': 'Expand code',
} satisfies Record<MarkdownPreviewKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'code.copy': 'コピー',
  'code.copied': 'コピーしました',
  'footnotes': '脚注',
  'codeBlock.title': 'コードブロック',
  'codeBlock.wrap': '行を折り返す',
  'codeBlock.unwrap': '行を折り返さない',
  'codeBlock.collapse': 'コードを折りたたむ',
  'codeBlock.expand': 'コードを展開',
} satisfies Record<MarkdownPreviewKey, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'code.copy': 'Copiar',
  'code.copied': 'Copiado',
  'footnotes': 'Notas a pie de página',
  'codeBlock.title': 'Bloque de código',
  'codeBlock.wrap': 'Ajustar líneas',
  'codeBlock.unwrap': 'No ajustar líneas',
  'codeBlock.collapse': 'Contraer código',
  'codeBlock.expand': 'Expandir código',
} satisfies Record<MarkdownPreviewKey, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'code.copy': 'Copier',
  'code.copied': 'Copié',
  'footnotes': 'Notes de bas de page',
  'codeBlock.title': 'Bloc de code',
  'codeBlock.wrap': 'Activer le retour à la ligne',
  'codeBlock.unwrap': 'Désactiver le retour à la ligne',
  'codeBlock.collapse': 'Réduire le code',
  'codeBlock.expand': 'Développer le code',
} satisfies Record<MarkdownPreviewKey, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'code.copy': 'Kopieren',
  'code.copied': 'Kopiert',
  'footnotes': 'Fußnoten',
  'codeBlock.title': 'Codeblock',
  'codeBlock.wrap': 'Zeilen umbrechen',
  'codeBlock.unwrap': 'Zeilen nicht umbrechen',
  'codeBlock.collapse': 'Code einklappen',
  'codeBlock.expand': 'Code ausklappen',
} satisfies Record<MarkdownPreviewKey, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'code.copy': 'Копировать',
  'code.copied': 'Скопировано',
  'footnotes': 'Сноски',
  'codeBlock.title': 'Блок кода',
  'codeBlock.wrap': 'Переносить строки',
  'codeBlock.unwrap': 'Не переносить строки',
  'codeBlock.collapse': 'Свернуть код',
  'codeBlock.expand': 'Развернуть код',
} satisfies Record<MarkdownPreviewKey, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'code.copy': 'Copiar',
  'code.copied': 'Copiado',
  'footnotes': 'Notas de rodapé',
  'codeBlock.title': 'Bloco de código',
  'codeBlock.wrap': 'Quebrar linhas',
  'codeBlock.unwrap': 'Não quebrar linhas',
  'codeBlock.collapse': 'Recolher código',
  'codeBlock.expand': 'Expandir código',
} satisfies Record<MarkdownPreviewKey, string>
