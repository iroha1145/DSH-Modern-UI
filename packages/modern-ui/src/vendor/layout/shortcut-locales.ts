// Derived from deepseek-ai/deepseek-harness (MIT); see package LICENSE.
/** Layout command labels. */
export const zh = { resizeSidebar: '调整左侧栏宽度', resizeRightbar: '调整右侧栏宽度', toggle: '展开／收起左侧栏' }
/** English labels for the same layout commands. */
export const en: Record<keyof typeof zh, string> = { resizeSidebar: 'Resize left sidebar', resizeRightbar: 'Resize right sidebar', toggle: 'Toggle left sidebar' }

/** Japanese copy, checked against the English keys. */
export const ja = { resizeSidebar: '左サイドバーの幅を調整', resizeRightbar: '右サイドバーの幅を調整',
  'toggle': '左サイドバーを切り替え',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = { resizeSidebar: 'Cambiar ancho de la barra izquierda', resizeRightbar: 'Cambiar ancho de la barra derecha', toggle: 'Alternar barra lateral izquierda' } satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = { resizeSidebar: 'Redimensionner la barre latérale gauche', resizeRightbar: 'Redimensionner la barre latérale droite', toggle: 'Basculer la barre latérale gauche' } satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = { resizeSidebar: 'Breite der linken Seitenleiste ändern', resizeRightbar: 'Breite der rechten Seitenleiste ändern', toggle: 'Linke Seitenleiste umschalten' } satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = { resizeSidebar: 'Изменить ширину левой панели', resizeRightbar: 'Изменить ширину правой панели', toggle: 'Переключить левую боковую панель' } satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = { resizeSidebar: 'Redimensionar barra lateral esquerda', resizeRightbar: 'Redimensionar barra lateral direita', toggle: 'Alternar barra lateral esquerda' } satisfies Record<keyof typeof en, string>
