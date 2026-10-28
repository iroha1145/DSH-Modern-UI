# 聊天引用和原图拖拽的插件迁移

本次以 upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 加保留的 `dsh-ui.patch` 为行为基线。实现仍运行在官方 `0.2.1-rc.4` Host 上，不修改官方包，也不增加消息投影或恢复联网开关。

## 文本选区与引用

Modern 的 ChatView 恢复 `conversation.chat.text-interaction` 标准 keyed 子槽，向原有 Conversation interaction registry 分发选区及右键手势。当前 consumer 被卸载、会话切换、选区失效或按 Escape 时，局部操作浮层关闭。第三方 consumer 可以按自己的 ID 登记 admission handler 和标准子槽组件；是否阻止原浏览器右键菜单仍由 consumer 同步决定。

`quotes.ts` 注册旧 message-quotes 的选区 admission、quote 文本规则与 sent-text renderer。点击引用按钮调用现有 `InputActions.insertQuote`，保留草稿其他内容，并继续使用现有 Lexical QuoteNode、草稿持久化和提交序列化。已发送消息中的显式 Markdown blockquote 恢复 QuotePreview 的紧凑展示和截断全文预览。

公开的 TypeScript 入口 `quotes.ts` 导出 `TextInteractionDefinition`、`TextInteractionGesture`、`TextInteractionRequest`、`TextInteractionSurface`、`TextInteractionTrigger` 和 `ConversationInteractionRegistry`。它通过声明合并补回 `ctx.uiConversation.interactions` 和 `InputActions.insertQuote` 的类型；对应运行时能力均由已选择的 Modern Conversation owner 提供。该文件同时补充标准 SlotMap，供消费者使用 `PropsRuntime<'conversation.chat.text-interaction'>`。

## 社区文档与本地文件导航

`dsh-better-sidebar@0.28.0` 的 `fs.read` 把相对文件名按 Git 仓库根解释，仓库子目录中的 Session 因此不能把已解析的目标重新缩成相对地址。Modern 的聊天文件动作先按当前 `workingDirectory`（尚未到达时按 Session 工作区）解析相对链接，再通过公开 `sessionFileAddress` 保留最终绝对路径和 Session scope。行号继续作为导航参数传递。官方包、社区包和资源加载器均不修改。

本次不改写已保存标签页的旧地址；历史相对地址可能与新绝对地址并存，不能据新打开的文件正确就宣称已有标签页已迁移。社区原有 Markdown 导航仅接受 `.md`/`.markdown`，其他本地后缀在文档内继续按其原规则显示为普通文本。聊天中的普通文件链接保持可打开。

`tests/plugin/browser.e2e.mjs` 在独立 Git 根的子工作区执行真实验收，默认三个社区包全部启用。28 项通过包含原 23 项，以及实际社区 `fs.read` 的绝对目标、社区原编辑器和双向 Markdown 导航、代码收起/展开、选区引用提交和 reload 后的 sent quote、官方 Installed 页包内 README 全文及代码折叠。隔离 fixture 同时核对原 consumer 数据未变。该项仅用本地 mock provider 和 loopback 服务，不调用付费模型。

## 原始图片的浏览器传输

`file-drag.ts` 提供本次插件激活拥有的 `fileDrag` service，以及独立的 `modern.images.content` gallery factory。标准聊天用户图片、助手图片、trajectory 图片及 tool image 槽使用该 gallery；read_image 的 Modern 原子卡使用同一个 factory。官方 `conversation.images.content` 和官方附件上传实现仍保留各自的所有权。

传输先通过现有 session 授权的原图 URL 或 local preview URL 获取真实字节，保留为 File，再生成 File-backed Blob URL。在 dragstart 阶段写入 `application/x-dsh-file` 当前激活 token，以及包含原图 MIME、文件名、Blob URL 的 Chromium `DownloadURL`。这条路径没有用原始 HTTP URL 冒充原始文件。文件名按图片 MIME 保留或修正扩展名，处理 Windows 保留名和无效字符，限制 UTF-8 文件名长度。

同应用图片只在目标 composer card 接收自己的有效 token。`original-image-drop.ts` 将持有的原始 File 送入 InputBar 已有 `intakeFiles`，继续使用权限、只读状态、文件数量/大小和上传验证。普通系统 `Files` drop 仍交给官方 attachment 处理。失效 token 不会获得其他传输的字节。

`MarkdownScope` 保留外层 Markdown provider 的 `fileDrag` 和 `resourceAddress`，因此助手 Markdown 的嵌套导航 scope 不再丢掉图片传输能力。源组件释放准备项不会提前销毁正在拖动的 Blob；dragend、drop 或插件卸载会结束当前传输并回收 URL。卸载还会取消未完成的原图读取，重新激活使用新的 service 和 token 所有权。

## 宿主边界

旧 desktop 路径需要 Electron 主进程公开的 `prepare/start/release` file-drag bridge。官方 rc.4 没有该公开接口，本插件没有伪造或恢复旧 native 调用。已验收的是 Web profile 的真实 File/Blob 传输、Chromium DownloadURL 载荷，以及应用内鼠标拖拽后的原图 intake。向任意操作系统原生应用或桌面执行 Electron native file drag，仍需要宿主另行提供公开能力；本次没有以浏览器 URL 拖动宣称已支持该能力。

## 验证

固定 Node `24.22.1` 执行：

```powershell
../runtime/node-v24.22.1-win-x64/node.exe --test tests/plugin/quotes-parity.test.mjs tests/plugin/file-drag-parity.test.mjs
```

本机结果为 9 项通过、0 失败、0 跳过：

- DOM 选区经标准槽按钮进入现有 Lexical 原子 quote，实际 submit 序列化仍能被 sent quote 规则识别。
- 只读子会话拒绝引用 admission；consumer 卸载移除规则和操作浮层，重载不会重复登记。
- 独立第三方右键 consumer 可以通过标准 interaction registry 取得自己的 surface 并同步阻止默认菜单。
- 原图 File、DownloadURL Blob 的 MIME、文件名和全部字节相等；无效 token、释放、取消和卸载行为正确。
- 原图 token 进入现有文件 intake，普通外部 Files 不被拦截；blocked composer 不接受 token。
- Gallery 的真实组件 gesture 能准备原图；嵌套 Markdown scope 保留 transfer callbacks。
- Edge/Chromium `156.0.4314.42` 的真实 HTML5 鼠标拖拽将 68 字节 PNG 送到 composer callback，收到的文件和 dragstart DownloadURL Blob 均与源图逐字节相同，页面无错误。

浏览器项在 Windows 默认使用本机 Edge，其他环境可设置 `MODERN_UI_BROWSER`；没有可用浏览器时明确跳过该项。单元部分采用真实 Cordis SlotRegistry、React DOM 和 Lexical 输入实现，仅将 CSS 排版留给整体验收。另做所选新增入口、Chat owner、Conversation owner 的 TypeScript 无输出检查，结果 0 错误。本文件不将这些局部验证描述为完整应用或 native OS 拖拽验收。

## 来源与整合

新增派生源码来自旧 MIT 源码的 `packages/client/ui-chat/src/client/chat/text-{interaction,selection}.ts`、`packages/session/message-quotes/src/client/`、`packages/client/ui-file-drag/src/client/` 和 `packages/client/ui-attachment/src/MessageImage.{tsx,module.css}`。图片文件名清理逻辑缩小自 `packages/util/file-drag/src/index.ts`，本次只保留图片 MIME 后缀映射，不引入 `mime` 依赖。每个派生文件保留来源说明，许可和文件清单由插件现有 provenance / MIT 机制维护。

主入口在 owners 前安装 `installFileDrag(ctx)`，在 presentation 阶段安装 `installQuotes(ctx)`；read_image 的 Modern renderer 经恢复的标准 `tool.call.images` 子槽进入 `modern.images.content`。该 Tool gallery 的基础贡献使用默认优先级 0，第三方可用 -10 替换；仍需覆盖官方 attachment/Chat 适配器的 user/message/trajectory image 槽保留 -200。共享入口、公开导出与 provenance 更新由同一迁移补齐 PR 的整合步骤完成。
