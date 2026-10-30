# 完整 Tool UI owner 的插件迁移

旧补丁不只修改预先列举的原子工具卡，也修改 ToolCallTree 内部的通用 fallback 与自动审查拒绝卡。官方 rc.4 的树对拒绝结果直接渲染自己的 GenericToolCard，未注册工具名也走同一个硬编码 fallback。给几个已知工具名登记 shadow 条目无法覆盖这两条路径。

本次让 Modern 完整拥有 Tool UI 子树。`tool-cards.tsx` 只启动 `tool-owner.ts`；后者通过公开注册 API 声明唯一的 `conversation.chat.node` / `tool-call` 条目及其 `tool.call.toolview` 子槽，并安装全部内建原子 view。未识别的工具名、任意 MCP 工具名和自动审查拒绝结果都进入 Modern 自己的 GenericToolCard、ToolRow、primitives 和 CSS。

组合需要停用官方 `ui-tool` UI entry。官方 `@deepseek-ai/dsh-client-ui-tool@0.2.1-rc.4/lib/index.js` 的 Host entry 只有空 `apply`，因此选择新的 UI owner 不转移任何 Host 执行服务，也不修改工具调用、审批、MCP 或 Session 后端。官方包仍提供公共 TypeScript 契约，运行时不导入其未发布源码，也不修改官方模块或原型。

## 保留的公开契约

- ToolCallTree 继续消费 rc.4 公共 `ToolTreeProps`、`ToolCallOwnerProps`、`ToolCallPhaseProps`。三个 phase、递归 subcalls、call ID、工作目录和 Host home、授权 image loader、file/line callback、inspection callback 均继续由原 owner payload 提供。
- Host home 是 `remote.$host` 的可观察 face，连接 reset 后读到新 Host facts。
- 内建原子 view 恢复官方默认优先级 0，移除局部 shadow 阶段的 -100。第三方可通过 -10 正常覆盖一个 key；相同 key、相同优先级仍按原框架契约报冲突，未改成静默覆盖。
- `read_image` 唯一声明并实际消费标准 `tool.call.images` 子槽，保持第三方 gallery 扩展链。原始字节 gallery 的基础贡献为 0，第三方 -10 可覆盖；默认路径继续进入 `modern.images.content`。普通官方 attachment 仍在，其他 image 槽的 shadow 优先级单独保留。
- 自动审查拒绝保留官方树的 admission 语义：即使有人 claim 了该工具的 atomic key，拒绝结果仍进入通用拒绝卡，显示本地化“未执行”和规范化原因，不把原始异常栈或参数当成执行结果。
- 问答 view 保留 rc.4 `userQuestionPanels.reveal/review` API、稳定 question ID 配对、active/settled projection、late answer 及 queued reply 处理。没有恢复已经退役的问答协议。

## Todo 历史索引与 PTC

停用官方 Tool UI 后，原先由它注册的 `tool-todo-history` 必须一并迁移。本 owner 通过原 Conversation registry 唯一登记 `tool-todo-write`、`tool-todo-call` 和 `tool-todo-history`；每个登记都绑定当前插件 lifetime。

已对照官方 rc.4 实际 `lib/client.js`：它仍按 `tool/ptc-dispatch-start` 为历史 nested todo 调用记录前驱。迁移保留同一匹配分支；rc.4 public event union 没声明该历史事件，所以仅在匹配边界按历史字符串与 payload 读取，不导入已不存在的 PTC client 包，也不恢复 PTC 执行器。根工具、历史子调用、较早历史补入与既有 incremental target 都沿用同一数据模型。

## 来源与变更范围

补入的 MIT 源码来自旧已打补丁源码的 `packages/client/ui-tool/src/client/tool/ToolCallTree.{tsx,module.css}`、`tool/toolviews/bash-sample.{tsx,module.css}`、`tool/models/todo-history.ts`。`tool-owner.ts` 改编自旧 `src/client/apply.ts`，并与官方 rc.4 实际客户端 apply、tree、Bash、Todo 与问答分支核对。既有 Modern GenericToolCard、ToolRow、业务模型和卡片复用，不复制工具执行实现。

所有共享主入口、组合 patch、manifest、构建和 provenance 的最终整合由同一 PR 的整合步骤完成。所需组合变化仅是停用官方 `ui-tool`；现有 `installToolCards(ctx)` 已自行启动新 owner，不应再另外调用一次 `toolOwner.apply` 或重复登记原子 view。

## 验证

固定 Node 24.22.1 执行：

```powershell
../runtime/node-v24.22.1-win-x64/node.exe --test tests/plugin/tool-cards.test.mjs tests/plugin/tool-parity.test.mjs
```

最终两个工具测试文件合计 14 项通过；与 quotes-parity、file-drag-parity 一起运行时为 23 项通过、0 失败、0 跳过。所选 owner 闭包的 TypeScript 检查为 0 错误。

定向覆盖包括：

- 未注册/MCP fallback 的 wrench 图标、完整 input/output、Enter/Space 展开和 inspection。
- preparing → start → result 保留同一 disclosure 状态和完整记录参数。
- 自动审查拒绝绕过已 claim 的 atomic key，使用 Modern 行和本地化未执行原因。
- 递归子调用保持准确 call ID、file/line、授权 image loader、Host home 和 inspection callbacks。
- 真实 Conversation assembler 重放根 todo 与历史 PTC todo，owner 卸载/重挂后定义与 target 数量始终唯一。
- 实际问答卡从 settled record 构造只读 review panel，展开后仍显示原问题和回答。
- 内建默认优先级、同级冲突，以及第三方 -10 对 atomic view 和标准 image child 的覆盖/卸载恢复。
- Modern 完整卸载后，通过原封 rc.4 `/client` 模块重新挂载官方 owner，再切回 Modern，无重复 child declaration 或 todo projection。
- 既有 read/write/search/web/image/error/navigation/keyboard 断言保留，旧“原子 shadow”fixture 改为真实完整 owner 选择与官方恢复。

TypeScript 对所选 Tool owner 和公开依赖闭包执行无输出检查。局部组件测试使用真实 Cordis SlotRegistry、React DOM、公开 rc.4 客户端与 Modern Conversation assembler；它们不替代完整应用的 CSS、安装或 Host 执行验收。本次没有运行全量 build 或 npm test。
