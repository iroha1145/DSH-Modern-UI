/** `modern-reasoning` namespace: the reasoning-declaration block on the Models settings page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  cancel: '取消',
  apply: '保存',
  modelReasoning: '推理等级',
  modelReasoningLevel: '档位',
  modelReasoningValue: 'API 参数值',
  modelReasoningHelp: '推理等级说明',
  modelReasoningHelpText: 'API 参数值会写入请求的推理强度字段（如 OpenAI 的 reasoning_effort），默认与档位名相同；如有不同，以模型提供商的 API 文档为准。Off 表示关闭思考，不需要填写参数值；配置中已写入的值会保留并发送。',
  modelReasoningNeedsLevel: '至少添加一个 Off 以外的档位；不需要思考请关闭推理等级。',
  modelReasoningValueRequired: 'Off 以外的档位都需要填写 API 参数值，且参数值不能为空字符串。',
  modelReasoningAdd: '添加档位',
  modelReasoningRemove: '删除档位',
  modelReasoningOffValuePlaceholder: '关闭思考',
  'title': '声明推理强度',
  'hint': "安装目录没有描述的模型在这里声明推理档位及 API 参数值；可添加或删除 Off，关闭推理时写入 reasoningEfforts: false。每行保存前可取消修改。",
  'switch': '{model} 的推理',
  'levels': '{model} 的推理档位',
  'writeRefused': '写入被拒绝：设置文档可能刚被别处改动，请刷新后重试。',
} satisfies Record<string, string>

/** Reasoning-declaration namespace keys. */
export type ReasoningDeclarationKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  cancel: 'Cancel',
  apply: 'Apply',
  modelReasoning: 'Reasoning levels',
  modelReasoningLevel: 'Level',
  modelReasoningValue: 'API value',
  modelReasoningHelp: 'About reasoning levels',
  modelReasoningHelpText: 'The API value is sent in the request\'s reasoning-effort field, such as OpenAI\'s reasoning_effort. It defaults to the level name; where the model provider\'s API documentation specifies a different value, follow it. Off turns reasoning off and needs no value; a value already written in the configuration is kept and sent.',
  modelReasoningNeedsLevel: 'Add at least one level besides Off, or turn reasoning levels off.',
  modelReasoningValueRequired: 'Every level besides Off needs an API value, and no value can be empty.',
  modelReasoningAdd: 'Add level',
  modelReasoningRemove: 'Delete level',
  modelReasoningOffValuePlaceholder: 'Turns reasoning off',
  'title': 'Declared reasoning levels',
  'hint': "Declare reasoning levels and API values for models the installed catalog does not describe. Add or remove Off, or turn reasoning off to store reasoningEfforts: false. Apply or cancel each row’s changes.",
  'switch': 'Reasoning for {model}',
  'levels': 'Reasoning levels for {model}',
  'writeRefused': 'The write was refused: the settings document may have just changed elsewhere. Reload and try again.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Japanese dictionary, checked against the English keys. */
export const ja = {
  cancel: 'キャンセル',
  apply: '適用',
  'modelReasoning': '推論レベル',
  'modelReasoningLevel': 'レベル',
  'modelReasoningValue': 'API値',
  'modelReasoningHelp': '推論レベルについて',
  'modelReasoningHelpText': 'API値はリクエストの推論強度フィールド（OpenAIのreasoning_effortなど）で送信されます。デフォルトはレベル名です。モデルプロバイダーのAPIドキュメントで別の値が指定されている場合はそれに従ってください。オフは推論を無効にするため値は不要です。設定に既に記述されている値は保持され、送信されます。',
  'modelReasoningNeedsLevel': 'オフ以外のレベルを少なくとも1つ追加するか、推論レベルを無効にしてください。',
  'modelReasoningValueRequired': 'オフ以外の各レベルにはAPI値が必要で、空の値は使用できません。',
  'modelReasoningAdd': 'レベルを追加',
  'modelReasoningRemove': 'レベルを削除',
  'modelReasoningOffValuePlaceholder': '推論を無効にします',
  'title': '推論レベルの宣言',
  'hint': "インストール済みカタログにないモデルの推論レベルとAPI値を設定します。Offを追加・削除でき、推論を無効にすると reasoningEfforts: false を保存します。行ごとに変更を適用またはキャンセルできます。",
  'switch': '{model} の推論',
  'levels': '{model} の推論レベル',
  'writeRefused': '書き込みが拒否されました。設定ファイルが別の場所で変更された可能性があります。再読み込みしてからやり直してください。',
} satisfies Record<ReasoningDeclarationKey, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  cancel: 'Cancelar',
  apply: 'Aplicar',
  modelReasoning: 'Niveles de razonamiento',
  modelReasoningLevel: 'Nivel',
  modelReasoningValue: 'Valor API',
  modelReasoningHelp: 'Acerca de los niveles de razonamiento',
  modelReasoningHelpText: 'El valor de la API se envía en el campo de esfuerzo de razonamiento de la solicitud, como reasoning_effort de OpenAI. De forma predeterminada se usa el nombre del nivel; si la documentación de la API del proveedor del modelo especifica otro valor, úselo. Desactivado deshabilita el razonamiento y no necesita un valor; cualquier valor ya guardado en la configuración se conserva y se envía.',
  modelReasoningNeedsLevel: 'Agregue al menos un nivel además de Desactivado o desactive los niveles de razonamiento.',
  modelReasoningValueRequired: 'Cada nivel además de Off necesita un valor API y ningún valor puede estar vacío.',
  modelReasoningAdd: 'Agregar nivel',
  modelReasoningRemove: 'Eliminar nivel',
  modelReasoningOffValuePlaceholder: 'Desactiva el razonamiento',
  'title': 'Niveles de razonamiento declarados',
  'hint': "Declare niveles y valores API para modelos que no figuran en el catálogo instalado. Agregue o elimine Off, o desactive el razonamiento para guardar reasoningEfforts: false. Aplique o cancele los cambios de cada fila.",
  'switch': 'Razonamiento de {model}',
  'levels': 'Niveles de razonamiento de {model}',
  'writeRefused': 'La escritura fue rechazada: el documento de ajustes puede haber cambiado en otro lugar. Recargue e inténtelo de nuevo.',
} satisfies Record<ReasoningDeclarationKey, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  cancel: 'Annuler',
  apply: 'Appliquer',
  modelReasoning: 'Niveaux de raisonnement',
  modelReasoningLevel: 'Niveau',
  modelReasoningValue: 'Valeur API',
  modelReasoningHelp: 'À propos des niveaux de raisonnement',
  modelReasoningHelpText: 'La valeur API est envoyée dans le champ d’effort de raisonnement de la requête, comme reasoning_effort chez OpenAI. Par défaut, elle correspond au nom du niveau ; si la documentation API du fournisseur du modèle indique une autre valeur, utilisez-la. Désactivé coupe le raisonnement et ne nécessite aucune valeur ; toute valeur déjà enregistrée dans la configuration est conservée et envoyée.',
  modelReasoningNeedsLevel: 'Ajoutez au moins un niveau en plus de Désactivé ou désactivez les niveaux de raisonnement.',
  modelReasoningValueRequired: 'Chaque niveau autre que Off nécessite une valeur API et aucune valeur ne peut être vide.',
  modelReasoningAdd: 'Ajouter un niveau',
  modelReasoningRemove: 'Supprimer le niveau',
  modelReasoningOffValuePlaceholder: 'Désactive le raisonnement',
  'title': 'Niveaux de raisonnement déclarés',
  'hint': "Déclarez les niveaux et les valeurs API des modèles absents du catalogue installé. Ajoutez ou supprimez Off ; désactiver le raisonnement enregistre reasoningEfforts: false. Appliquez ou annulez les modifications de chaque ligne.",
  'switch': 'Raisonnement de {model}',
  'levels': 'Niveaux de raisonnement de {model}',
  'writeRefused': 'L’écriture a été refusée : le document de paramètres a peut-être changé ailleurs. Rechargez puis réessayez.',
} satisfies Record<ReasoningDeclarationKey, string>

/** German dictionary, checked against the English keys. */
export const de = {
  cancel: 'Abbrechen',
  apply: 'Anwenden',
  modelReasoning: 'Argumentationsebenen',
  modelReasoningLevel: 'Ebene',
  modelReasoningValue: 'API-Wert',
  modelReasoningHelp: 'Über Argumentationsebenen',
  modelReasoningHelpText: 'Der API-Wert wird im Feld für den Denkaufwand der Anfrage gesendet, etwa reasoning_effort bei OpenAI. Standardmäßig wird der Stufenname verwendet; gibt die API-Dokumentation des Modellanbieters einen anderen Wert vor, verwenden Sie diesen. Aus deaktiviert das Denken und benötigt keinen Wert; ein bereits konfigurierter Wert bleibt erhalten und wird gesendet.',
  modelReasoningNeedsLevel: 'Fügen Sie neben „Aus“ mindestens eine Ebene hinzu oder deaktivieren Sie die Argumentationsebenen.',
  modelReasoningValueRequired: 'Jede Ebene außer Off benötigt einen API-Wert und kein Wert darf leer sein.',
  modelReasoningAdd: 'Ebene hinzufügen',
  modelReasoningRemove: 'Ebene löschen',
  modelReasoningOffValuePlaceholder: 'Schaltet das Denken aus',
  'title': 'Deklarierte Denkstufen',
  'hint': "Legen Sie Denkstufen und API-Werte für Modelle außerhalb des installierten Katalogs fest. Off kann hinzugefügt oder entfernt werden; Ausschalten speichert reasoningEfforts: false. Änderungen je Zeile anwenden oder abbrechen.",
  'switch': 'Denken für {model}',
  'levels': 'Denkstufen für {model}',
  'writeRefused': 'Der Schreibvorgang wurde abgelehnt: Das Einstellungsdokument wurde möglicherweise gerade anderswo geändert. Neu laden und erneut versuchen.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  cancel: 'Отмена',
  apply: 'Применить',
  modelReasoning: 'Уровни рассуждения',
  modelReasoningLevel: 'Уровень',
  modelReasoningValue: 'Значение API',
  modelReasoningHelp: 'Об уровнях рассуждения',
  modelReasoningHelpText: 'Значение API передаётся в поле уровня рассуждений запроса, например reasoning_effort у OpenAI. По умолчанию используется название уровня; если документация API поставщика модели указывает другое значение, используйте его. Выкл. отключает рассуждения и не требует значения; уже записанное в конфигурации значение сохраняется и отправляется.',
  modelReasoningNeedsLevel: 'Добавьте хотя бы один уровень помимо «Выкл.» или отключите уровни рассуждения.',
  modelReasoningValueRequired: 'Для каждого уровня, кроме Off, требуется значение API, и ни одно значение не может быть пустым.',
  modelReasoningAdd: 'Добавить уровень',
  modelReasoningRemove: 'Удалить уровень',
  modelReasoningOffValuePlaceholder: 'Отключает рассуждения',
  'title': 'Объявленные уровни рассуждения',
  'hint': "Настройте уровни и значения API для моделей вне установленного каталога. Off можно добавить или удалить; выключение сохраняет reasoningEfforts: false. Примените или отмените изменения каждой строки.",
  'switch': 'Рассуждение для {model}',
  'levels': 'Уровни рассуждения для {model}',
  'writeRefused': 'Запись отклонена: документ настроек мог только что измениться в другом месте. Обновите страницу и повторите.',
} satisfies Record<ReasoningDeclarationKey, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  cancel: 'Cancelar',
  apply: 'Aplicar',
  modelReasoning: 'Níveis de raciocínio',
  modelReasoningLevel: 'Nível',
  modelReasoningValue: 'valor API',
  modelReasoningHelp: 'Sobre níveis de raciocínio',
  modelReasoningHelpText: 'O valor da API é enviado no campo de esforço de raciocínio da solicitação, como reasoning_effort da OpenAI. Por padrão, usa-se o nome do nível; se a documentação da API do provedor do modelo especificar outro valor, use-o. Desativado desliga o raciocínio e não exige valor; qualquer valor já salvo na configuração é mantido e enviado.',
  modelReasoningNeedsLevel: 'Adicione pelo menos um nível além de Desativado ou desative os níveis de raciocínio.',
  modelReasoningValueRequired: 'Cada nível além de Desligado precisa de um valor API e nenhum valor pode ficar vazio.',
  modelReasoningAdd: 'Adicionar nível',
  modelReasoningRemove: 'Excluir nível',
  modelReasoningOffValuePlaceholder: 'Desativa o raciocínio',
  'title': 'Níveis de raciocínio declarados',
  'hint': "Declare níveis e valores API para modelos fora do catálogo instalado. Adicione ou remova Off; desligar o raciocínio grava reasoningEfforts: false. Aplique ou cancele as alterações de cada linha.",
  'switch': 'Raciocínio de {model}',
  'levels': 'Níveis de raciocínio de {model}',
  'writeRefused': 'A gravação foi recusada: o documento de configurações pode ter mudado noutro lugar. Recarregue e tente novamente.',
} satisfies Record<ReasoningDeclarationKey, string>
