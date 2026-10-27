# Host 兼容修复

消费基线是官方 npm `0.2.1-rc.4`。旧补丁来自 Modern UI `a9f4c370`，其源基线为 `22ddee37`。下面区分已实现的显式插件替代、真实测试和仍未保留的依赖差异。

## 明确选择的替代插件

`@iroha1145/dsh-modern-ui/translator` 与 `@iroha1145/dsh-modern-ui/mcp-client` 是本项目的 Host 入口。它们由旧修复后的相应小插件提取，保留 MIT、来源及公开配置接口，未复制整个后端。所有 DSH/Cordis 服务均 external/peer；MCP SDK 是插件自身固定的正常依赖 `2.3.0`。

安装器读取实际组合后的配置，在新 profile 的用户 patch 中禁用被替换的原条目，再以新 id 插入替代插件，保留配置和条目 metadata。官方 `name` patch 字段是匹配条件，不能用它直接改模块名；`tests/migration/profile-settings.test.mjs` 用真实 `applyEntryPatches` 核对了禁用和插入。显式禁用的功能不会被打开。嵌套/自定义 preset 中的目标或动态 activation 目前要求单独审阅，自动安装会拒绝这类不确定转换。

没有模块别名劫持、原型修改、加载器拦截或官方文件覆盖。默认没有翻译/MCP 实例的官方 Web profile 不会为此凭空启用它们；存在这些顶层实例的配置副本才选择替代。

## 已运行行为检查

`node --test tests/host-compat/host.test.mjs`，固定 Node `24.22.1`，10 项通过：

- Google 和 Bing：非空原文得到空白译文时拒绝；合法译文原样返回；失败后可以重试。
- 正常官方翻译器生成旧空白缓存，再使用替代插件与真实 JSONL/Agent 恢复：追加有效结果、旧事件及文件前缀不改，第二次读取和完整 Host 重启后均复用有效缓存，不再发送 HTTP 请求。
- 官方 `CotTranslationController` 能识别替代插件抛出的公开 `TranslationError` 并启动冷会话。没有复制第二个错误类来破坏 `instanceof` 契约。
- MCP 直接回环端点正常连接；同源/跨源 307 和 308 都在到达目标前失败，目标访问计数为零。请求头和正文只包含合成夹具内容。

`scripts/host-compat/probe.mjs <官方消费者>` 对未修改的官方成品给出对照：rc.4 接受空白译文，MCP 的四种重定向都到达目标。因此不能把这两项旧修复说成已被官方 rc.4 吸收。

Host 严格 TypeScript 检查通过。构建先用 TypeScript emit，再 bundle，以内联已发布 Cordis 只有类型声明、没有 JavaScript 导出的 const enum。所有被引用宿主模块来自公开 exports，不读取 `src/*` 或上游 checkout。

付费翻译提供方未消耗真实额度；其完整端到端路径仍未验收。上述 Host 检查也不等于浏览器翻译 UI 的接线验证，后者在 UI 地图单列。

## 依赖修复差异

旧 `pnpm-workspace.yaml` 的安全版本地板不能通过改写官方依赖树补回。初次真实官方 npm 消费闭包中观察到：

| 旧约束 / 改动 | 官方 rc.4 实际依赖 | 当前结论 |
| --- | --- | --- |
| Node 24.22.1 | 私有运行时已固定并验证 | 保留 |
| MCP client 2.3.0、拒绝 HTTP 重定向 | 官方 client 2.2.0、会跟随重定向 | 显式替代入口恢复这项行为；不修改原包 |
| Undici 8.12.2 地板 | `dsh-http-proxy` 与 `dsh-web-fetch-http` 精确依赖 8.11.2 | 未保留旧依赖修复，需官方合适发行版；不做 overrides/替包 |
| Zod 4.6.6 地板 | 多个官方包精确依赖 4.4.3 | 未保留，不能把整个宿主依赖替换后声称仍是正常官方发行依赖 |
| fflate 0.8.3 地板 | 正常 0.8.3 和 libreoffice-kit 自带的 0.8.2 | 未全覆盖；本插件自己的预检 bundle 使用 0.8.3 |
| http-cache-semantics 4.3.0、fast-uri 3.1.9 | 实际分别为 4.3.0、3.1.9 | 本次已见版本达到旧地板 |
| 浏览器与开发库 / Electron / 外部 SDK 修补 | 并非都作为该 CLI 消费闭包的独立 npm 包出现 | 不从“没发现目录”推断已修复；本轮不是 Electron 发行验收 |

这里是在核对旧补丁的依赖修复是否保留，不是新的全面安全认证。官方 bundle 内联的浏览器库、所有外部模型 SDK 和所有平台仍需要更广的发行核验；不把开发依赖表或一次审计结果扩大为完整无风险结论。

## 图标雪碧图

`@iroha1145/dsh-modern-ui/primitives` 的产品图标都渲染成 `<svg data-icon="dsw-icon-<glyph>-<weight>"><use href="#dsw-icon-…"></svg>`，引用文档里的雪碧图符号。旧补丁版由打过补丁的 ui-theme 随外壳发布这张雪碧图；官方 rc.4 没有这些符号，也不会有人替插件挂上，于是每个图标都成了空框（没有任何控制台错误，截图里才看得出来）。2026-10-27 起由插件自己挂：`vendor/theme/client/icon-sprite.ts` 的 `installIconSprite()` 在 `apply` 里把 `ICON_SYMBOLS` 的每个 SVG 文档转成同 id 的 `<symbol>`，放进 `#modern-ui-icon-sprite`（零尺寸、`aria-hidden`）追加到 `<body>`；同一文档里多个插件实例共用一张，按 `data-owners` 计数，最后一个卸载时移除。单测核对整套符号与 `stroke-width`，浏览器验收断言页面里没有落空的 `<use>` 引用。

## 运行状态行与「收起后显示的回复」

旧补丁改过聊天流（`ChatFlow`）里的运行状态行：去掉官方的「深度求索中，用时 …」蓝色扫光，换成矩阵式加载指示加阶段文字（正在思考 / 正在使用工具 / 正在输出回复 / 正在处理）和单独的耗时，并在推理阶段只留耗时（分组标题已经在说明活动）。插件没有接管聊天流本身（它是官方 `conversation.chat.flow` 单例，带滚动与虚拟化逻辑），改为：样式里把官方的 `[data-chat-running]` 行隐藏，并向官方回合尾的 `conversation.chat.turnTail` 列表槽登记一条 `modern-running-status`（`vendor/chat/client/chat/RunningTail.tsx`），回合打开期间用 `useChat` 读官方快照的 `legacy.partial` / `legacy.runningCalls` 判断阶段，渲染 `RunningStatus`（补丁版）。官方的回合尾节点、点赞/点踩、交付物、计划、日程等第三方对 `turnTail` / `assistant-actions` 的贡献原样保留；回合尾节点的键不能由插件替换，因为注册表不允许两个条目声明同名子槽，而第三方正是往官方的子槽登记的。没有做的：旧补丁还让运行中的分组标题在推理阶段显示矩阵（`ChatGroupSeat` 的 `runningPhase`），官方分组标题保持官方样式；断线时冻结计时也没有搬。

「收起后显示的回复」（`foldedReplies`，全部回复 / 仅最终回答）是补丁独有的设置，官方 rc.4 的 `ui-chat` 没有这个字段、通用设置里也没有这一项。插件现在把它放进自己的 `modern-ui` 配置（`index.ts` 的 `Config`），在官方通用设置里紧跟「工作步骤展示」登记一行 `modern-folded-replies`（`vendor/chat/client/settings/FoldedRepliesRow.tsx`），展示策略从 `modern-ui` 表单读取（迁移前残留在 `ui-chat` 的旧值仍被承认）。安装器新增第三份迁移回执 `modern-ui-chat-migration.json`：把复制的 profile 里 `ui-chat.foldedReplies` 搬进 `modern-ui` 行（已有值不覆盖，原行保留），已迁移过设置与会话偏好的 profile 在下一次升级时也会补做这一步。

