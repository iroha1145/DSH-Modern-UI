# 普通问题与预设帮助的代码折叠

此实现保留官方 rc.4 的问题卡、回答通道、持久草稿 store、预设设置控制器与 Creator 动作。插件仅在公开 SlotRegistry 内登记展示体；没有停用这两个官方业务 owner，没有修改官方 npm 包、模块表、原型或 `StoredEntry`。

## 展示范围

- 普通问题：从精确旧补丁版 `QuestionComposer` 派生普通 QuestionFlow 展示和草稿类型，使用 Modern Markdown 代码折叠，恢复旧长问题/选项描述展开。复用官方 composer entry 的 `select`、同一 store handle 和 `inject`，仅接受原 selector 返回的 `kind === 'question'`。计划审阅返回 null，继续由官方条目及其 `conversation.plan-review.actions` 子槽处理；新展示没有声明或渲染这个子槽。
- 预设帮助：同 `settings.section` id `agent-presets`、priority `-100` 登记派生的最小展示闭包，复用原 entry 的 `inject`、标签和顺序。预设列表、默认值、配置阅读、Coding Tools 过滤与 Creator 回调仍来自官方控制器。Guide 中的 Markdown 使用 Modern 代码折叠。
- 原字典和翻译函数保留。新增的代码折叠与长文展开词条位于 `modern-presentation` namespace，不覆盖官方 namespace，并通过全局 locale revision 更新展示。

第三方更低数值 priority 的贡献继续优先。停用 Modern 展示后，官方条目立即恢复；官方来源 entry 被撤销或重新创建时，展示贡献撤销或重新绑定相应的新公开 face，不能继续调用旧 owner 的注入函数。

## 公开生命周期 helper

`watchPresentation(ctx, slot, { source, register })` 位于 `src/presentation-shadow.ts`：

```ts
watchPresentation(ctx, 'settings.section', {
  source: entry => entry.options.id === 'agent-presets'
    && entry.locale === 'settings.agentPreset'
    && (entry.options.priority ?? 0) === 0,
  register: source => {
    // Read the source's documented public injection face, then register the
    // same public id at priority -100 with the replacement presentation.
    // Return the disposer returned by ctx.slots.register(...).
    return registerPresetPresentation(source)
  },
})
```

source 谓词必须排除本插件自己的 entry；helper 只读取 `entries` 并订阅公开 `subscribe`，保存来源对象身份，在来源换代时先撤销旧展示再创建新展示。其 effect disposer 取消订阅并撤销展示。调用者负责使用相应公开组件契约给 type-erased `StoredEntry` face 加回精确类型，并自行选择是否复用 store；helper 不复制、修改或调用任何私有对象方法。

## 主接线

1. 主 client 调用一次 `installPresentationParity(ctx)`，所在 context 已注入 slots/locale。
2. 构建 pure whitelist 增加 `@deepseek-ai/dsh-agent-preset-registry/display`：这是官方无依赖的展示文案解析函数，不是浏览器服务模块。无需额外客户端模块到达边。
3. 为新增派生展示、类型与 CSS 更新 provenance。

## 验证

```powershell
& ../runtime/node-v24.22.1-win-x64/node.exe --test tests/plugin/presentation-parity.test.mjs
```

测试实际加载官方发布的 ui-user-questions、ui-agent-preset 与 ui-renderer 浏览器 descriptors。经真实 SlotRegistry 与 renderer 验证：普通问题代码折叠、原 carrier/同一草稿 store、Modern 停用/重装保留草稿、一次回答走原 RPC、计划审阅仍归官方；预设默认值保存、配置阅读和 Creator 回调仍触达原控制器；更高优先级的第三方展示继续获胜；官方来源 owner 换代后重新绑定新 store/face。

官方当前预设帮助文案没有 fenced code，测试在 guide 翻译输入中加入一个 fenced example，验证该内容进入正确 Markdown 路径及代码折叠，不把 fixture 文案当作产品修改。未调用外部模型，也未替代整体消费者安装与真实浏览器验收。
