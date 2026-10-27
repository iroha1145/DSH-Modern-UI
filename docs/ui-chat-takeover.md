# 聊天流整体接管（2026-10-28）

## 为什么

官方 rc.4 的 `@deepseek-ai/dsh-client-ui-chat` 自己渲染 `ChatView`/`ChatFlow`/`ChatGroupSeat`，并声明了 `conversation.chat.node`、`conversation.chat.reasoning.body`、`conversation.chat.message.images`、`conversation.chat.turnTail`、`conversation.chat.assistant-actions` 等子槽。官方注册表不允许第二个条目声明同名子槽，组件也只能渲染自己条目声明的子槽，所以插件在 PR #5–#8 里只能遮住节点视图、给自己的子槽加 `modern.` 前缀，运行状态行要靠 portal 渲染进官方行。旧补丁在分组座（`ChatGroupSeat`）里加的推理点阵、完成对勾、工具扳手和展开分组的左侧时间轴，在这种局部接管下做不出来。用户要求和「完整构建的补丁版」一致，于是停用官方 ui-chat，由插件整体接管。

## 做法

- `packages/modern-ui/cordis.patch.yml` 多停用一个 `ui-chat`（与 layout/sidebar/conversation/workspace 同一种方式）。
- `packages/modern-ui/src/vendor/chat/client/` 现在是补丁版 rc.3（upstream `22ddee37` + `patches/dsh-ui.patch`）ui-chat 客户端的完整副本：会话数据层 `conversation-nodes/`、契约 `contract/`、`ChatView`/`ChatFlow`/`ChatNodeSeat`/`ChatGroupSeat`、全部节点视图、两个工厂（`conversation.chat.user.content`、`conversation.chat.reasoning.content`）、额度提示浮层、输入框读数行的两个读数胶囊、`conversation.approval.detail`、三条通用设置行（transcript-view 12、link-opening 17、performance-usage 30），由 `vendor/chat/client/apply.ts` 登记，`client.tsx` 在 `installPresentation` 里以 `ctx.inject(['uiWorkspace', 'uiSession', 'uiConversation', 'connection', 'sidebarRight', 'fileDrag'], applyChat)` 挂上。
- 子槽改回标准名：`conversation.chat.reasoning.body`、`conversation.chat.message.images`、`conversation.chat.message.code`（补丁新增，由 `src/contracts.ts` 声明）。官方 ui-attachment 往 `message.images` 的登记仍在，插件自己的图片画廊以 -100 优先；推理翻译以 -100 登记在 `reasoning.body`。
- 运行状态行由插件自己的 `ChatFlow` 直接渲染（`RunningStatus`），portal 宿主、隐藏官方子元素的规则和 `official-chat-view.css` 都删了；断线时冻结计时由 flow 登记注入的 `connectionState` 提供。
- 偏好：`ui-chat` 的宿主端 Config（transcriptView、collapseTiming、performanceUsage、linkOpening）通过 `...ChatConfig.dict` 并进插件的 `modern-ui` 命名空间（`src/index.ts`），和已经在那里的 `foldedReplies` 一起由补丁版 `TranscriptViewPolicy`/`PerformanceUsagePolicy` 读写；`vendor/chat/chat-settings.ts` 的 `CHAT_SETTINGS_NAMESPACE` 改为 `modern-ui`。安装器迁移升到 conversionVersion 2：`transformChatPreferences` 把这五个字段从 `ui-chat` 行搬到 `modern-ui` 行（已有值不覆盖，原行保留，非字符串值拒绝），`preserveChatPreferences` 对 v1 回执的 profile 再做一次，备份名 `modern-ui-chat-before-migration-v2.yml`。
- 词典：所有聊天组件仍用 `modern-chat` 命名空间（`vendor/chat/client/locale.ts` 的 `NS`），工厂登记处因官方工厂声明固定了 `chat` 命名空间而做一次类型转换。

## 类型边界

rc.4 只有编译产物，公开仓库 master 还停在 rc.3（`compactAnswer`、去掉文本选区交互和 PTC 事件都是 rc.4 才有的改动）。插件的实现是 rc.3 补丁版，但 TypeScript 程序里官方 rc.4 的声明文件会经由 `@deepseek-ai/dsh-client-ui-tool/client` 被拉进来，SlotMap 的键不能重复声明。因此：

- `vendor/chat/client/contract/slots.ts` 是补丁版契约去掉两个 `declare module` 块后的副本，只导出组件自己组合用的 props 与 hook 类型；`ModernRuntime<Name>` 把 `useChat` 换成本地 `ChatSnapshot`。
- 登记处用 `vendor/chat/client/compat.ts` 的 `compat()` 把组件转成注册表期望的类型。运行时形状是一致的（都是同一套 rc.3 补丁版实现），只是名义类型不同。
- rc.3 ↔ rc.4 的已知差异，处理方式：`ChatTurnProcessPresentation` 的 `hasNonReplyProcess`（rc.4 换成 `compactAnswer`）——沿用 rc.3 语义；文本选区交互（`conversation.chat.text-interaction`、`uiConversation.interactions`）——rc.4 已删，插件也不做；`tool/ptc-dispatch*` 事件——rc.4 的 Host 不再发出，分支保留但按字符串比较；`@deepseek-ai/dsh-token-meter/client` 与 `@deepseek-ai/dsh-llm/assistant-stream` 作为纯函数模块加入 `scripts/build-plugin.mjs` 的打包白名单；`@tanstack/react-virtual@3.14.10` 随插件打包（`TurnNavigator`）。
- 依赖官方 ui-chat 子槽的其它官方包（ui-tool、ui-goal、ui-user-questions、ui-workflow-run 往 `conversation.chat.node` 登记；ui-deliverables、ui-plan、ui-schedule 往 `turnTail`；ui-message-feedback 与社区 dsh-context 往 `assistant-actions`；ui-attachment 往 `message.images`/`user.images`；ui-settings-account 往 `shell.quota-notice`）现在登记到插件声明的同名槽里；`chat` 视图目标、`useChat` 会话钩子由插件的 `registerConversationNodes` 与 `uiSession.provide({ hooks: ['chat'] })` 提供。

## 验证

- `npm test` 147 项全过；`tests/plugin/client.test.mjs` 的夹具补了会话绑定、`fileUpload`/`remoteAccess`/`pluginNavigation` 桩和真实的官方 `ui-session` 客户端，让插件的会话层与聊天登记在单测里真正跑起来。
- 干净 scratch 安装上 `owners.e2e`、`browser.e2e`（结果见 PR）。

## 回滚

停用插件 bundle 即恢复官方 ui-chat（与其它四个官方 owner 一样）；`modern-ui` 命名空间里的偏好值保留，`ui-chat` 行里的原值也保留。
