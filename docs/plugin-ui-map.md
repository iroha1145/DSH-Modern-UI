# Modern UI 插件映射与验收

目标为未经修改的官方 `@deepseek-ai/dsh@0.2.1-rc.4`。展示来源为 upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 应用仓库补丁后的精确源码。保留文件原始/适配后 SHA-256、原创协作接口和多来源适配器记录在 `packages/modern-ui/provenance.json`。

## 唯一 UI owner

官方 bundle selection 停用原 `ui-layout`、`ui-sidebar`、`ui-workspace`、`ui-conversation` 和（2026-10-28 起）`ui-chat` 五项，由自有包提供公开服务及原 child declarations（聊天流的做法见 [聊天流整体接管](ui-chat-takeover.md)）。没有伪装官方 module id、全局别名、模块表劫持或修改官方 npm 文件。附件、工具、插件管理及社区贡献仍使用原公开槽，聊天的子槽也沿用官方标准名。主客户端先启动 layout/workspace/sidebar/conversation/settings 样式，再事件注入依赖 modelDirectories/sessions/sidebarRight 的展示贡献；主 async apply 按顺序等待各 owner 当前启动，传播启动异常。

Manifest 的 inject 是模块到达与组合边，immediately 只控制预取，不能把任意边当成无害。当前只列真实 rc.4 基础模块，避免让 UI owner 依赖反向消费者。React/React DOM/Cordis/client-store/ui-slots/官方 ui-primitives 保持共享外部实例。Modern primitives 使用自有包名；弹层栈、pointer modality、composition observer 复用官方实例。构建拒绝未声明的 DeepSeek runtime import。

官方 Host/session/Remote/命令/model directory/locale/theme 服务保留。Conversation 公开 Host schema/apply 被复用，使 busyEnter/collapsedViews 有正式的 modern-ui 设置通路；安装器复制旧设置并备份。原 settings-general Host/client 全部保留，因为其他官方设置依赖其 schema；仅通过语义根应用真实 CSS 差异。

## 展示映射

1. **外壳/侧栏/工作区：** 精确补丁的 AppFrame、宽度状态、拖动区、主题呈现、侧栏与工作区树/选择/顺序/手机 drawer 已接入。原 Workspace/Session 控制器执行动作。原创 modernLayout 仅暴露同一个布局 store 的 viewport 与关闭手机 drawer，不另建布局状态。
2. **会话/输入/视图：** 唯一 Conversation owner 提供原服务和 children，保留真实输入、附件、排队、停止与第三方贡献。rc.4 不存在的 ui-file-drag 没有被复制或冒充；使用实际 inline image/file-upload。collapsedViews 已接入 pin store，写入失败恢复已接受值。旧“必须等上游才能恢复”的结论撤回。
3. **消息/推理/代码/steering：** 用户、assistant、context、重试、错误、压缩、turn-process、代码折叠、引用、图片、推理折叠来自精确补丁。Steering batch 通过真实官方 assembler 发布显示 metadata，保留 prepend、取消、重插与卸载，不建立第二份消息或进程投影。
4. **模型：** 自有模型列表、供应商图标、卡片、推理等级复用官方 modelDirectories；选择、清单和发送路径仍为官方服务。卡片设置在自有 namespace 保存。
5. **工具/Schedule：** Read/write/search/web/TODO/问答/通用卡使用公开 keyed leaves；read_image 复用原 gallery factory，TODO 复用原 target。原 pwsh/terminal provider 保留。Schedule 实际 CSS 差异应用于公开语义根，保留目录、时钟标记和操作。
6. **可视化/追问：** OpenUI 完整结果、原生嵌套 sandbox、容错展示和 Followups 已迁移；真实 iframe 按钮验证交互。没有引入上游服务端或宿主能力桥。
7. **主题/语言/设置：** 公开 theme override layer 安装 Modern 调色板，卸载恢复旧层及偏好。支持八种语言；自有 owner 使用自有 namespace，避免与已有语言包重复注册。原设置贡献和配置写入保留。
8. **Markdown/附件：** 公开 cwd/openFile/fileMediaUrl 支持相对文件、行号和图片；HTTP 遵从官方 linkOpening，浏览器席位缺失时新窗口回退。图片弹层进入共享官方栈。
9. **翻译：** optional remote.cotTranslation 复用官方 Controller/Host 设置；自有 reasoning 槽适配展示体、缓存和取消。Remote 撤回恢复原文。直接登记在官方原 reasoning children 的第三方贡献不会自动进入 Modern 独立 children，没有声称存在通用透传接口。
10. **V2 联网范围：** Modern 会话联网按钮、/web on|off、webSearch projection、专用能力缓存/状态/词条已删除。官方搜索/抓取工具、provider、插件启停/配置、结果卡和引用保留。

## 已执行验证

以下 run id 与数量对应 `18c4e38` 的历史本地产物索引，不是仓库链接。当前 PR 修复新增主题、翻译/压缩、凭据事件和 Markdown 导航回归；验证入口与最新结果见 [PR #5 复核](pr5-audit-followup.md)。

- 固定 Node 24.22.1；严格 TypeScript 与构建通过，861 browser inputs；构建检查共享边界并收集实际依赖许可证。消费者不需本地编译。
- client/translation/steering-batches/tool-cards 四组共25项通过：真实rc.4 registry、ThemeRuntime、官方primitives、Remote生命周期、翻译重试/单飞、代码链、子代理树、assembler与工具席位。
- layout-owner/shell-owner 共10项通过：nested owner、真实renderer/controller、卸载重启、手机drawer及已有shared namespace语言包共存。conversation-owner 7项通过：真实renderer/uiSession/官方附件和入口贡献、binding/input/queue、pin写入失败恢复、卸载重启、rc.4图片/文件receipt。
- 最终四owner结构 source-host 浏览器：`.artifacts/plugin-browser/run-8BCYob/result.json`，23项通过，console/page errors为空。官方rc.4成品Web + Windows x64 + headless Edge；发送mock到完成渲染阶段 `/api/remote.mux` 发送1帧、接收68帧。
- 浏览器实际验证模型/推理等级保存刷新、流式结果/引用/OpenUI/追问、编队、日语刷新、真实文件行号预览、相对图片、共享lightbox Tab/Escape/焦点恢复、Modern popover与官方Settings modal、明暗保存刷新、system跟随OS及刷新保留、theme-color等于body实际色、HTTP新窗口偏好。官方翻译Controller访问本地端点1次。mobile.png已确认是聊天界面，文件预览另存file-navigation.png。
- 新 owner 专项 source-host 浏览器：`.artifacts/plugin-owners/run-k7EdnC/result.json`，5项通过、errors=[]。真实有效PNG inline与TXT上传到官方事件和模型请求；More隐藏/打开隐藏视图/恢复，`modern-ui.collapsedViews`经过刷新与新Host进程仍保留；共享焦点返回；两条steering进入同turn下一step且首条实际margin-top为44px；Ctrl+Enter队列提交/删除与停止；390px视口下drawer选会话和工作区新会话关闭。窄视口使用鼠标模拟（工作区按钮通过hover显示），不代表真实触屏验收。
- 浏览器子进程清除常见API key/token并禁telemetry，只用mock及loopback翻译/外链端点，没有调用真实付费模型。
- 最终 Gwr tgz 在源码目录外的独立消费者安装后复验：`plugin-browser/run-Th2rIC/result.json` 23 项、`plugin-owners/run-Mpn4RB/result.json` 5 项均通过，errors=[]。实际本 turn 用 HTTP POST `/api/session/prompt` 成功提交并收到 86 个 WebSocket 推送帧；不把启动时帧数当作消息发送证明。偏好写入真实 profile，测试没有用 CLI overlay 覆盖其配置写入目标。
- 三个社区插件共存时，dsh-context 的 `fleet` 可以贡献另一个同名“编队”视图。Modern Hide/Show 只操作自身 `agents` id，社区视图保留；消费者断言按真实 id 和数量差异区分，不误删第三方贡献。

最终保留390个上游衍生前端文件，另有原创布局协作接口及多来源适配器。未用复制文件已按实际build/类型闭包删除，provenance和许可同步更新。

## 边界

最终 tarball/integrity、fresh/existing 安装及失败恢复、真实工具及私有 PowerShell、社区插件、官方文件哈希前后对比，以 `docs/plugin-migration.md` 消费记录为准。旧候选包大小和 integrity 不代表当前产物。

真实最终包的 bundle off/on 和 remove 已验证恢复四个官方 owner、主题 token 及 90 个 style。root owner 切换需要刷新页面；单 entry off 不是 bundle off。Lexical 的一个模块级 textInput 时间戳监听器保留到页面刷新，刷新/移除后重启为零，不能声称同一页卸载立即释放全部依赖全局监听器。详见安装文档。原 Web Shell 启动页与故障页仍为官方样式。

官方包仍在渲染的几处界面（输入触发菜单、权限选择器、审批卡、提问卡、变更文件卡、快捷键弹窗、左下角账号触发器）由 `src/official-surfaces.css` 和 `settings-shell.css` 以稳定钩子覆盖成旧补丁的样子（聊天流和回合尾部自 2026-10-28 起是插件自己的，不再需要覆盖）；其余官方包（模型设置页、Plan/文件预览的代码块折叠、定时任务私有选择器、调试轨迹、文件树）保持官方样式，取舍依据见 [2026-10-28 审计复核](audit-20261028.md)。

未逐个平台验证Electron拖动、多窗口、全部WebKit/输入法/触屏/屏幕阅读器组合；未对每种工具与Schedule状态做全像素对比。已迁移源码与已执行测试分别陈述，不以服务功能保留代替视觉验收。
