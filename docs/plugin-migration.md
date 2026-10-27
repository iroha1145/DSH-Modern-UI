# 官方成品与 Modern UI 插件迁移

首轮记录：2026-10-27。V2 代码迁移、预编译插件、Windows x64 独立安装消费和本地交付完成时的验收快照；已执行范围与当时未验证项分别列出。

**记录边界：**下文包摘要、run id 和计时保留的是 `18c4e38` / Gwr tgz 的首轮本地验收，run id 是原始本地产物索引，不是仓库内可访问路径。PR #5 的后续审计修复、可复现驱动和当前 CI 状态见 [审计复核记录](pr5-audit-followup.md)。源码现已提交 PR，尚未发布 npm/Release 或部署；旧产物结果不替代新提交的消费验收。

## 产品范围和实现

最终路径为 **固定官方 DSH 发行包 + 独立预编译 Modern UI 插件/bundle + 薄安装器**。用户端不克隆上游、不应用补丁、不构建 DSH 或 UI。官方 Host 同源提供 API、鉴权、动态客户端资源与 WebSocket；不另建前端网关。

Modern UI 自定义会话联网按钮、`/web on|off`、`webSearch` projection、`web/search` 写入、工具前缀过滤及待生效状态已退出新插件。实验 `packages/web-policy` 和专用 compatibility 探针已删除；不再维护伴生 preset、双写或缺失插件锁定。保留官方 tool-web、搜索/抓取提供商、插件管理与配置、搜索结果、来源引用和网页内容卡。停用搜索工具不等于禁止所有网络访问。

旧补丁流程保留在历史维护入口，供旧数据回看；它不进入新安装路径。含 `web/search` 的旧快照只预检、隔离和保留原件，不静默删除日志行。可选转换未实现，不阻塞新插件或新会话。

## 精确版本和来源

| 对象 | 固定内容 | 核验方式 |
| --- | --- | --- |
| Modern UI main | `a9f4c370fa480c9a17d5c9a79cb83aeba26bdf0d` | 初次 GitHub/clone 一致，V2 再次核对远端；分支 `codex/official-plugin-migration` |
| 旧补丁参考 | upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` + 原仓库 patch | 只作真实 diff/行为参考；未作为官方成品 |
| 官方后端 | `@deepseek-ai/dsh@0.2.1-rc.4` | 已发布 npm 成品；查询时 next 为 rc.4、latest 为 rc.2、GitHub Release 为 rc.3 |
| 插件 | `@iroha1145/dsh-modern-ui@0.1.0-migration.1` | 真实 npm pack，本地未发布 |
| 运行时 | Node `24.22.1`、pnpm `11.28.5` | 官方发布资源与摘要固定在 runtime-lock.json；实际可执行文件打印版本 |
| Windows shell | Microsoft PowerShell `7.6.5` x64 自包含 ZIP | 官方 URL/SHA256、许可证、私有 pwshPath 及真实工具执行 |

官方 [npm tgz](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.4.tgz) 的 SRI：

```text
sha512-8gxl6zOi6vx1sDolH+vjh9txrpbXD+t74Z2YfWkEBtR3xP2YEtk0bbLkgLZRnYQgDxCoXitXyXDKn5k0+6iXrg==
```

最终 UI tgz 为 2,577,807 字节，SRI：

```text
sha512-GwrCDGceVDy6U4/0L2H3rCrHOdcGBlN1yQW2qE03EQ0F+zkU1U+pNa8TcQSDYv+bcfcp/G29KbRkT/vF1nSlmQ==
```

发行包中的 Web 标识为 `ec17a2c`；没有把不可解析的短标识补成虚构 full SHA，也不以 rc.3 源码代替 rc.4 运行证据。

## M1：entry、Host、主题和共享身份

真实 bundle patch 只禁用匹配 id/name 的官方 `ui-layout`、`ui-sidebar`、`ui-workspace`、`ui-conversation`，插入自有 `modern-ui` entry。前三项原 Host 为空；Conversation 公开 Config/apply 被复用，偏好写入自有 namespace。settings-general 双端插件完整保留，避免破坏其他设置对其 schema 的依赖。translator/MCP 仅在被复制 profile 确有顶层实例时通过公开配置替换，保留原配置和 metadata。

自有 primitives 标识为 `@iroha1145/dsh-modern-ui/primitives`，由 Modern 组件显式消费。React、React DOM、Cordis、store、slots，以及官方公开 modal/input/composition 状态保持外部共享；没有覆盖静态模块表或复制第二套模态栈。Markdown delegate 使用公开 cwd/openFile/fileMediaUrl/linkOpening 能力适配。构建拒绝未允许的官方 runtime import。

主题采用 `ctx.theme.overrideTokens`；CSS 只负责布局、滚动、动效等，并随 owner 销毁恢复。真实 ThemeRuntime 测试覆盖叠层、撤销和重挂；浏览器覆盖明暗、系统主题、OS 切换、保存和刷新。原先“公开接口不支持替换 owner / collapsedViews”的暂定结论已由真实实现和运行证据撤回。

## M2：功能验收矩阵

完整文件来源和适配后 SHA256 在 `packages/modern-ui/provenance.json`。保留 390 个实际进入构建/类型闭包的上游衍生前端文件、57 组语言包，以及少量原创协作接口。未按 Gemini 的文件数量机械删除。

| 范围 | 目标接口和数据影响 | 已执行结果 |
| --- | --- | --- |
| 主题、排版、布局、图标动效 | 主题层、唯一 layout/sidebar/workspace owner | 严格构建、10 项 owner 测试，浏览器明暗/system 与窄屏通过 |
| 宽度、拖动与手机 drawer | 同一个 layout store；保留原 transient 宽度语义 | 桌面结构与窄视口会话/工作区导航关闭 drawer 通过；未承诺跨刷新保存宽度 |
| 聊天、流式、代码、表格、推理折叠 | 原 session/assembler/renderer，迁移显示叶子 | source-host 23 场景通过；最终安装包另列 |
| 来源引用、搜索/网页卡片 | 原工具结果与 keyed toolviews | UI 引用和工具测试通过；官方搜索/抓取实际运行另列 |
| Intelligent UI、追问、展示提示词 | 原 sandbox、结果槽、公开 systemPrompt additive section | iframe 内按钮真实交互、追问、消息恢复通过 |
| 模型/推理等级/厂商/卡片与价格 | 官方 ModelDirectory，插件自有 models/prices/pricesUpdatedAt | 选择、发送、描述编辑、刷新恢复；配置迁移通过；不另造 /effort |
| 编队/子智能体模型、用量、耗时 | 原 agents/session 服务和迁移树叶子 | 真实浏览器编队与树结构测试通过；未穷举所有复杂并发图 |
| 视图显隐 collapsedViews | 唯一 Conversation pin store，modern-ui config | Hide/Show、隐藏视图仍可打开、刷新及新 Host 持久化通过；Chat 不隐藏 |
| busyEnter、steering、排队、取消 | 官方输入与队列，独立显示 metadata target | 真实附件和输入，两个 steering 同 turn 下一 step，首条 44px 间距，队列删除/停止通过 |
| 文件/图片/Markdown/键盘 | 官方 file upload、共享 modal 栈和公开导航 | 文件行号、相对图片、Tab/Escape/焦点恢复、混合官方 Settings modal 与 Modern popover 通过 |
| 工作区、文件、终端、PTY、搜索 | 官方 controller/实际工具、发布 native/helper | 写读/shell、文件锁、PTY、ripgrep 实际通过；私有 shell 路径另列 |
| 翻译与旧 Host 修复 | 官方 Remote + 显式 translator/MCP 扩展 | 10 项 Host 检查通过，浏览器本地翻译/缓存通过；依赖版本差异见 Host 文档 |
| 八种语言 | 自有 owner namespace + 保留官方语言贡献 | 八语源码保留，日语选择刷新通过；非每种语言逐页视觉审校 |
| 官方插件和社区贡献 | 原 pluginManager、公开 children/slots | 三个固定社区包共存，正常官方配置路径保留；最终 bundle/remove 专项另列 |
| 已删除的联网控制 | 无新命令、projection、事件或工具拦截 | 新插件源码引用检查；真实新会话事件检查另列 |

详见 [UI 地图](plugin-ui-map.md)与 [Host 差异](plugin-host-compat.md)。未知 generic tool fallback 与部分 Schedule 私有 picker/menu 保留官方样式；工具功能没有删减。官方预编译 Web Shell 启动页和故障页保留官方样式，不覆盖 dist，也不承诺固定显示时长。原 reasoning 私有 children 上第三方贡献没有通用透传保证。

## M3/M4：安装、数据与消费证据

| 关卡 | 已执行证据 / 当前范围 |
| --- | --- |
| 本地回归 | 精确 Node 24.22.1，UI/Host/安装/数据共 95 tests / 0 failures；随后新增 Windows 自包含 dispatcher 2 项定向回归通过；最终 UI 构建 861 browser inputs |
| source-host 浏览器 | `plugin-browser/run-8BCYob/result.json`，23 PASS、errors=[]；官方发布 Host/Web，四个自有 owner |
| source-host 输入/偏好 | `plugin-owners/run-k7EdnC/result.json`，5 PASS、errors=[]；真实 PNG/TXT、保存重启、steering/queue/mobile |
| 原数据 | 11 项预检与 9 项配置/Host 绑定；普通 v4 用官方 persistence 导入/重启正控，源字节不变；含 web/search 只隔离 |
| 官方后端来源 | 每个实际 npm 包与精确 registry tgz 对比；已有安装 614 包，新用户布局另有记录；安装和运行后逐文件摘要复核 |
| 既有 DSH 的最终 tgz | 源码树外一条 Node 命令已升级到最终 d9bd0f76 代际；7 个 installed lib 文件逐字节匹配最终 tgz；源 Web 4 文件、旧 Modern 12 文件及 sentinel 不变 |
| 最终安装包浏览器/官方 web | 源码树外 `plugin-browser/run-Th2rIC` 23 项、`plugin-owners/run-Mpn4RB` 5 项通过，errors=[]；`official-web/run-y6XhOG` 5 阶段通过 |
| 新用户 bootstrap | OS-only PATH 下无 Node 首装成功，私有 Node/pnpm/pwsh、565 包发布来源核验，无 checkout 或用户端构建；launcher 修复后正常升级到 d3c521c2 并复验 |
| 最终工具/运行时 | existing `runtime-tools/run-WEMqYk` 与 fresh `run-y2LGVA` 均真实 write/read/pwsh/read 通过；私有 pwsh 7.6.5，官方 sandbox workspace-write / partial；PTY、锁、发布 ripgrep、koffi/conpty 加载字节通过 |
| 更新、失败恢复、卸载 | 最终坏 SRI 在切换前拒绝；rollback 到前代、uninstall 保留 backend/profile/generation，精确恢复最终选择后官方 614 包 unchanged；源 profile 和 sentinel 全保留 |

源码树外的统一结果索引为 `v2-final-preview/evidence/final-summary.json` 和 `v2-fresh-final/fresh-final-acceptance.json`。前者 UI 三组运行于前一代际，后续只修 Windows dispatcher；最终代际 7 个 lib 文件再次与相同 Gwr tgz 逐字节对比，并完成工具、来源、启动与恢复验证，没有把旧 UI 候选结果冒充最终包。

官方联网检查使用真实 ConfigEditor 修改原 standard preset 的 tool-web 配置，公开 pluginManager 启停原搜索 provider；新 Host/新会话的工具 schema 随配置生效。禁用 provider 时工具仍可见，但返回官方 `WEB_PROVIDER_CONFIGURED_MISSING` 且无搜索请求。实际官方 DeepSeek 搜索 provider 访问受控本地 Anthropic 兼容端点两次；fetch 正控使用公开 fixture provider 和原工具 HTML 转换，原 HTTP provider 对 loopback 的阻拦仍保留。新记录无 Modern `web/search`，但保留官方 `web/deepseek-search-llm-request`。

最终包的 `v2-bundle-lifecycle/result.json` 验证真实 installBundle / setBundleEnabled / removeBundle。移除后重启：四个官方 owner active、输入框和 dsh-context 正常、Modern styles/listeners 为零；两个真实空会话存储文件及其他 profile sentinel 摘要不变。整包切换需刷新浏览器；官方返回 applied 不代表 root owner 无缝热替换。当前页卸载后 Lexical 的一个模块级 textInput 时间戳监听器保留到刷新；主题 token 与 90 个 Modern style 已撤销。含显式 translator/MCP 兼容绑定的 profile 不自动反向转换，优先撤销 Modern 启动选择并回到保留的原 profile。

旧候选 9zv 的已有 DSH 首装：2026-10-27 07:37:02Z–07:46:06Z，核心 509.122 秒、含社区 544.123 秒。release-cache/store 初始不存在，复用已有 Node；这是来源闭包全量核验的首次安装观测，**不是最终 UI 包验收**。

同一 Gwr UI 在最终 Windows wrapper 修复后的测量如下；下载速度和系统负载会影响结果，不作固定安装时间承诺。

| 测量 | 实测时间 | 环境/缓存边界 |
| --- | --- | --- |
| 既有官方 DSH 更新（最终 d9bd0f76） | 核心 75.410 秒，总计 92.265 秒 | release-cache 已存在，store 目录未存在；复用精确 Node；含社区检查 |
| 全新目录零 Node 首装（9bac12f6） | 核心 249.046 秒，总计 277.108 秒 | OS-only PATH 无 Node，release-cache/store 均不存在，下载全部私有运行时；UI 为最终 Gwr，薄启动器是 Unicode 修复前版本 |
| fresh 实例正常升级到最终 d3c521c2 | 核心 63.017 秒，总计 79.499 秒 | 复用已校验的官方后端、Node 与缓存；不是另一次冷首装 |
| 最终 dsh-ui.cmd 新进程启动 | 完整性扫描后 dispatch 16.703 秒，官方 ready 20.716 秒，认证 HTML/Modern 资源完成 21.688 秒 | CP932、含 Unicode/空格路径、OS-only 基础 PATH；包括启动器扫描，OS 文件缓存未清空，不是整机冷启动或页面 TTI |

安装消费中发现并修复了 Windows UTF-8 批处理绝对路径在非 UTF-8 控制台损坏的问题。最终 launcher 和 pnpm 用纯 ASCII 桥与 UTF-8 JSON 路径，按 Windows argv 规则传参；真实官方插件管理服务会清理自定义环境变量，因此 pnpm 桥是自包含的。CP932/Unicode/引号定向回归及真实 `installBundle/removeBundle` 均通过。没有修改控制台或系统策略。

安装器显式跳过编译 hook，并单独核验、实际执行发布 prebuild 和 helper；不能仅从 `--ignore-scripts` 推导能力完整。Windows 私有 PowerShell 完整保留微软许可及运行资源，通过官方 pwsh-sandbox 配置绑定绝对路径；实际 workspace-write、partial enforcement，没有关闭沙箱。Git 是 Git 工作区/worktree 功能的外部前提，缺失时不声称这些功能通过；基础安装、聊天、文件与 shell 不依赖 Git。模型及翻译调用均为受控 fixture；未消耗真实付费凭据，未将本地 fetch 正控说成公网提供商完整验收。

## 平台与数据边界

| 范围 | 状态 |
| --- | --- |
| Windows x64，Node 24.22.1，Edge Chromium | 本地真实消费通过；已安装 UI、原生/工具、社区、来源及启动证据单列 |
| Linux x64/arm64、macOS x64/arm64 | 候选安装资源与无 checkout 消费 CI 已准备，未运行，不标通过 |
| Windows arm64、Linux musl | 安装器拒绝；没有静默源码构建回退 |
| Electron、多窗口、WebKit、真实触屏/输入法/屏幕阅读器组合 | 未做全面验收；窄视口鼠标模拟不冒充真机触屏 |
| 普通官方 v4 快照 | 限定读取、导入、重启正控通过；附件/后代/UI ZIP 导入未全面验收 |
| 含 web/search 的旧快照 | 识别、保留/隔离/恢复通过；不交给原版继续执行，不做可选转换 |
| 生产发布 | 未执行；没有 npm、Release、镜像或远端 CI 成功声明 |

## 使用与后续工作

[安装文档](plugin-installation.md)提供已有官方 DSH 的 Node 单命令、新用户 Windows bootstrap、启动、独立社区重试、回退和卸载。程序版本与数据分离；坏摘要、自检失败不会切换 current.json。原始 profile、会话和恢复代际保留。

[数据策略](plugin-data-migration.md)说明只处理完成的导出快照，不扫描真实用户会话。旧补丁说明移至 [历史安装文档](legacy-patch-installation.md)，原构建 CI 改为手动入口；新 CI 的消费 job 只下载预编译产物、不 checkout。

后续发布前需在真实 Linux/macOS runner 执行候选流程，并依据结果决定平台支持范围。未吸收的官方依赖版本差异、第三方私有 children 适配和真机触屏测试分别跟进，不以“100%兼容”代替证据。旧会话联网控制已取消，不作为后续验收目标。
