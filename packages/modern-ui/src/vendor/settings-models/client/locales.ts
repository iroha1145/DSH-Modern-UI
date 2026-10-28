/** `modern-reasoning` namespace: the reasoning-declaration block on the Models settings page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '声明推理强度',
  'hint': '安装目录没有描述的模型（比目录更新的型号）在这里开启推理并勾选它支持的档位；关闭推理时写入 reasoningEfforts: false，而不是删掉字段。目录已描述的模型沿用目录的档位。',
  'switch': '{model} 的推理',
  'levels': '{model} 的推理档位',
  'writeRefused': '写入被拒绝：设置文档可能刚被别处改动，请刷新后重试。',
} satisfies Record<string, string>

/** Reasoning-declaration namespace keys. */
export type ReasoningDeclarationKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Declared reasoning levels',
  'hint': 'Models the installed catalog does not describe (releases newer than the catalog) turn reasoning on here and tick the levels they offer; turning it off stores reasoningEfforts: false instead of removing the field. Catalog-described models keep the catalog’s levels.',
  'switch': 'Reasoning for {model}',
  'levels': 'Reasoning levels for {model}',
  'writeRefused': 'The write was refused: the settings document may have just changed elsewhere. Reload and try again.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  'title': '推論レベルの宣言',
  'hint': 'インストール済みカタログに記載のないモデル（カタログより新しいモデル）は、ここで推論を有効にして対応するレベルを選びます。無効にするとフィールドを削除せず reasoningEfforts: false を保存します。カタログ記載のモデルはカタログのレベルを使います。',
  'switch': '{model} の推論',
  'levels': '{model} の推論レベル',
  'writeRefused': '書き込みが拒否されました。設定ファイルが別の場所で変更された可能性があります。再読み込みしてからやり直してください。',
} satisfies Record<ReasoningDeclarationKey, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'title': 'Niveles de razonamiento declarados',
  'hint': 'Los modelos que el catálogo instalado no describe (versiones más nuevas que el catálogo) activan aquí el razonamiento y marcan los niveles que ofrecen; al desactivarlo se guarda reasoningEfforts: false en lugar de eliminar el campo. Los modelos descritos por el catálogo conservan sus niveles.',
  'switch': 'Razonamiento de {model}',
  'levels': 'Niveles de razonamiento de {model}',
  'writeRefused': 'La escritura fue rechazada: el documento de ajustes puede haber cambiado en otro lugar. Recargue e inténtelo de nuevo.',
} satisfies Record<ReasoningDeclarationKey, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'title': 'Niveaux de raisonnement déclarés',
  'hint': 'Les modèles que le catalogue installé ne décrit pas (versions plus récentes que le catalogue) activent ici le raisonnement et cochent les niveaux proposés ; la désactivation enregistre reasoningEfforts: false au lieu de supprimer le champ. Les modèles décrits par le catalogue gardent ses niveaux.',
  'switch': 'Raisonnement de {model}',
  'levels': 'Niveaux de raisonnement de {model}',
  'writeRefused': 'L’écriture a été refusée : le document de paramètres a peut-être changé ailleurs. Rechargez puis réessayez.',
} satisfies Record<ReasoningDeclarationKey, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'title': 'Deklarierte Denkstufen',
  'hint': 'Modelle, die der installierte Katalog nicht beschreibt (neuer als der Katalog), schalten hier das Denken ein und wählen die angebotenen Stufen; beim Ausschalten wird reasoningEfforts: false gespeichert statt das Feld zu entfernen. Vom Katalog beschriebene Modelle behalten dessen Stufen.',
  'switch': 'Denken für {model}',
  'levels': 'Denkstufen für {model}',
  'writeRefused': 'Der Schreibvorgang wurde abgelehnt: Das Einstellungsdokument wurde möglicherweise gerade anderswo geändert. Neu laden und erneut versuchen.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'title': 'Объявленные уровни рассуждения',
  'hint': 'Модели, которых нет в установленном каталоге (новее каталога), включают рассуждение здесь и отмечают поддерживаемые уровни; при выключении сохраняется reasoningEfforts: false, а не удаляется поле. Модели из каталога используют уровни каталога.',
  'switch': 'Рассуждение для {model}',
  'levels': 'Уровни рассуждения для {model}',
  'writeRefused': 'Запись отклонена: документ настроек мог только что измениться в другом месте. Обновите страницу и повторите.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'title': 'Níveis de raciocínio declarados',
  'hint': 'Modelos que o catálogo instalado não descreve (versões mais novas que o catálogo) ativam aqui o raciocínio e marcam os níveis que oferecem; ao desativar, grava-se reasoningEfforts: false em vez de remover o campo. Modelos descritos pelo catálogo mantêm os níveis do catálogo.',
  'switch': 'Raciocínio de {model}',
  'levels': 'Níveis de raciocínio de {model}',
  'writeRefused': 'A gravação foi recusada: o documento de configurações pode ter mudado noutro lugar. Recarregue e tente novamente.',
} satisfies Record<ReasoningDeclarationKey, string>
