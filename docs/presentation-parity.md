# 普通问题的代码折叠与列表槽遮挡的限制

此实现保留官方 rc.4 的问题卡、回答通道、持久草稿 store、预设设置控制器与 Creator 动作。插件仅在公开 SlotRegistry 内登记展示体；没有停用这两个官方业务 owner，没有修改官方 npm 包、模块表、原型或 `StoredEntry`。

## 展示范围

- 普通问题：从精确旧补丁版 `QuestionComposer` 派生普通 QuestionFlow 展示和草稿类型，使用 Modern Markdown 代码折叠，恢复旧长问题/选项描述展开。复用官方 composer entry 的 `select`、同一 store handle 和 `inject`，仅接受原 selector 返回的 `kind === 'question'`。计划审阅返回 null，继续由官方条目及其 `conversation.plan-review.actions` 子槽处理；新展示没有声明或渲染这个子槽。
- 预设设置：2026-10-29 起不再遮挡，整节由官方 ui-agent-preset 渲染。原先在 `settings.section` 以同一 id `agent-presets`、priority `-100` 登记派生展示，设置导航因此多出一行「Agent 预设」（原因见下一节）。官方预设帮助文案没有 fenced code，遮挡带来的代码折叠本来就看不到；补丁版的排版差异（节标题、分组标题、卡片名、帮助标题与帮助里的 h3 改为 500 字重，卡片描述加 `text-wrap-style: pretty`）改由 `official-controls.css` 按 rc.2、rc.3、rc.4 共有的哈希类名覆盖。
- 原字典和翻译函数保留。新增的代码折叠与长文展开词条位于 `modern-presentation` namespace，不覆盖官方 namespace，并通过全局 locale revision 更新展示。

第三方更低数值 priority 的贡献继续优先。停用 Modern 展示后，官方条目立即恢复；官方来源 entry 被撤销或重新创建时，展示贡献撤销或重新绑定相应的新公开 face，不能继续调用旧 owner 的注入函数。

## 列表槽遮挡的限制

`ctx.slots.entriesOfSlot` 只返回每个格子在 priority 顺序下的胜者，`renderSlot` 用它渲染，所以 single、keyed、chain 槽和 list 槽的内容区都只显示遮挡后的那一份。但官方有界面直接用原始的 `ctx.slots.entries` 生成行：

- 设置导航（dsh-client-ui-settings-general，`hooks.sections.getSnapshot`）。
- 插件管理页的标签栏（dsh-client-ui-plugin-manager，`tabLedgerSource`）。

这两处会把 priority `-100` 的遮挡条目和原条目各列一行，两行 id 相同，点任一行都会同时高亮。所以不要在 list 槽上用遮挡替换官方条目。

还剩一处同类情况没改：`plugin-documents` 在 `plugins.tab` 上遮挡 id `discover`，用来在「发现」标签里显示插件 README。启用 `@deepseek-ai/dsh-experimental-plugin-market-bundle` 时，插件管理页会出现两个「发现」标签；去掉遮挡会丢掉 README 显示，需要另行决定做法。

## 公开生命周期 helper

`watchPresentation(ctx, slot, { source, register })` 位于 `src/presentation-shadow.ts`：

```ts
watchPresentation(ctx, 'conversation.composer', {
  source: entry => entry.locale === 'question'
    && (entry.options.priority ?? 0) === 0
    && entry.children?.['conversation.plan-review.actions'] !== undefined,
  register: source => {
    // Read the source's documented public injection face, then register the
    // replacement presentation at priority -100 on the same chain slot.
    // Return the disposer returned by ctx.slots.register(...).
    return registerQuestionPresentation(source)
  },
})
```

source 谓词必须排除本插件自己的 entry；helper 只读取 `entries` 并订阅公开 `subscribe`，保存来源对象身份，在来源换代时先撤销旧展示再创建新展示。其 effect disposer 取消订阅并撤销展示。调用者负责使用相应公开组件契约给 type-erased `StoredEntry` face 加回精确类型，并自行选择是否复用 store；helper 不复制、修改或调用任何私有对象方法。

## 主接线

1. 主 client 调用一次 `installPresentationParity(ctx)`，所在 context 已注入 slots/locale。
2. 为新增派生展示、类型与 CSS 更新 provenance。

## 验证

普通问题的展示曾由 `tests/plugin/presentation-parity.test.mjs` 覆盖（仓库现已不带测试）：实际加载官方发布的 ui-user-questions 与 ui-renderer 浏览器 descriptors，经真实 SlotRegistry 与 renderer 验证普通问题代码折叠、原 carrier/同一草稿 store、Modern 停用/重装保留草稿、一次回答走原 RPC、计划审阅仍归官方、更高优先级的第三方展示继续获胜、官方来源 owner 换代后重新绑定新 store/face。

预设设置改回官方后的核对在临时实例上做：设置导航只有一行「Agent 预设」，点开渲染官方 `rtSEdW_title`，节标题字重为 500。
