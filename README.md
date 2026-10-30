# DSH Modern UI

中文 · [English](README.en.md)

为官方 **DeepSeek Harness（DSH）** 打造的现代化 Web 界面插件（`@iroha1145/dsh-modern-ui`）。不修改官方后端，随时可切回官方界面。

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

装好后**刷新浏览器**即可看到 Modern UI；切回官方界面见[常见问题](#常见问题)，支持的宿主版本见[兼容矩阵](docs/compatibility.md)。

> **发布状态**：npm 包和 GitHub Release 从 `v0.1.0` 起提供。首个版本发布前，上面的命令和下文的 Release 都还用不了（`npm view @iroha1145/dsh-modern-ui version` 查不到就是还没发布）。在那之前，从 [Official runtime plugin preview](https://github.com/iroha1145/DSH-Modern-UI/actions/workflows/plugin-preview.yml?query=branch%3Amain+is%3Asuccess) 最近一次成功的运行里下载 `modern-ui-precompiled-preview`（要登录 GitHub，只保留 7 天），解压后在其中执行 `dsh plugin --profile web add ./modern-ui.tgz`。

<p>
  <img src="docs/assets/screenshot-light.png" alt="Modern UI 亮色主题：推理分组、官方工具卡与回答" width="49%">
  <img src="docs/assets/screenshot-dark.png" alt="Modern UI 暗色主题：代码块、表格与追问建议" width="49%">
</p>

> 前提：已安装受支持版本的官方 DSH，且 `pnpm` 在 PATH 上（`dsh plugin` 会把命令转发给 pnpm）。如果从未启动过 web profile，先运行一次 `dsh web`。截图里的模型是本地演示模型，由 [`tests/compat/readme-screenshots.mjs`](tests/compat/readme-screenshots.mjs) 在隔离环境里生成。
>
> 一行安装**不会**把官方聊天界面的偏好（工作过程视图、折叠时机、用量展示、链接打开方式、忙碌时回车的行为等）搬进 Modern UI，Modern UI 先用自己的默认值，可在「设置 → 通用」里重新选。官方原有的设置不会被删，切回官方界面后照旧生效。下文的一键隔离安装器会迁移这些偏好。

---

## 核心特性

- **现代化对话体验**：全新设计的对话流、思考过程（Reasoning）分组折叠、消息时间轴导航、代码块与 Markdown 预览一键折叠。
- **高效输入与交互**：支持选中文字快捷引用、浏览器原图拖拽/粘贴无损直传、命令与文件引用胶囊（Lexical 编辑器）。
- **增强视图与卡片**：内置 Intelligent UI（`openui` 交互式沙箱与 `followups` 追问建议）、Subagent 编队树与调用链视图、精细化工具调用卡片。Intelligent UI 默认**不改变模型提示词**，只渲染模型已经写出的 `openui` / `followups` 代码块；在「设置 → 通用 → 回答可视化组件」开启后会向系统提示词追加约 3 KB 指令。从旧版本升级的安装器用户保持原行为（开启）。条目配置里的 `presentation.openui` / `presentation.followups` 可分别关闭这两种代码块的渲染（关闭后按普通代码块显示），见[包说明](packages/modern-ui/README.md)。
- **模型与推理控制**：现代化模型选择卡片，支持自定义模型标签扩展与推理强度（Reasoning Effort，含 `Off`）配置。
- **多语言与主题**：内置中、英、日、西、法、德、俄、葡 8 种界面语言与多套明暗主题。

> **说明**：旧版自定义的会话级联网开关（`/web on|off`）已移除，联网搜索与网页抓取工具统一遵循官方插件管理与配置。

## 安装方式说明

- **npm（推荐，首个版本发布后可用）**：即上面的一行命令。指定版本用 `@iroha1145/dsh-modern-ui@<版本>`。
- **GitHub Release（首个版本发布后可用）**：每个版本的 Release 附带 `modern-ui.tgz`，可 `dsh plugin --profile web add ./modern-ui.tgz` 离线安装。发布前用上面「发布状态」里的 CI 成品，安装命令相同。
- **不支持 Git 源安装**（`dsh plugin add github:iroha1145/DSH-Modern-UI`）：构建依赖在仓库根目录，且 pnpm 10+ 默认禁止 Git 依赖执行 build script。请使用 npm 包或 Release 中的 tgz。

## 官方 Desktop

官方 DeepSeek Harness Desktop 内嵌同一套 Web Client 和自己的 DSH 宿主，Modern UI 装进它的保留 profile `desktop`：

1. 打开一次 Desktop 再完全退出，让它初始化 profile。
2. 用 **Desktop 自带的 `dsh` 命令**安装。菜单「应用 → 管理 dsh 命令…」会把它加入终端；npm 装的 `dsh` 会拒绝 `--profile desktop`。
   ```bash
   dsh plugin --profile desktop add @iroha1145/dsh-modern-ui
   ```
   Windows 也可以直接运行 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`。
3. 完全退出并重新打开 Desktop。Desktop 没有「刷新页面」，切换 bundle 要重启应用。

切回官方界面：`dsh plugin --profile desktop remove @iroha1145/dsh-modern-ui`，再重启 Desktop。启用 Modern UI 时 Desktop 的首次引导记为已跳过（它最后一步写的是被 Modern 接管的官方聊天设置）；工作过程和用量展示在「设置 → 通用」里调整。逐项验收结论与未验证的原生能力见 [Desktop 验收记录](docs/compatibility/desktop-0.2.1-rc.5.md)。

## 可选：一键隔离环境

适用于**本机没有现成 DSH**，或想让 Modern UI 使用**独立的程序与数据目录**（不碰现有 `~/.dsh`）的场景。这是社区维护、尽力支持的附件，不是主安装渠道。

安装器下载并校验私有 Node `24.22.1`、pnpm `11.28.5`（Windows 另含私有 PowerShell `7.6.5`）与官方 `@deepseek-ai/dsh` 后端，建立独立 profile，再通过官方 `dsh plugin add` 安装插件；安装或更新非空数据目录前自动生成整树快照备份。从 Release 下载 `installer.zip` 并解压，进入 `plugin-preview` 目录（**程序目录与数据目录必须是两个互相独立的路径**）：

- **Windows (PowerShell)**：
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'
  ```
- **macOS / Linux**：
  ```bash
  sh ./install.sh '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```
- **基于本机已有的官方 DSH**（读取实际版本，不升级后端）：
  ```bash
  sh ./install-existing.sh '/path/to/official/@deepseek-ai/dsh/package.json' '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```
  Windows 用 `./install-existing.ps1 -Backend '<官方 package.json>' -Root '<程序目录>' -DataHome '<数据目录>'`。

社区插件默认**不安装**。如需同时装上已验证组合（`dsh-context@0.75.1`、`dsh-better-sidebar@0.28.0`），Windows 追加 `-WithCommunity`，macOS / Linux 设置 `DSH_MODERN_WITH_COMMUNITY=1`。指定旧宿主用 `-BackendVersion` 或 `DSH_MODERN_BACKEND_VERSION`。

安装完成后运行程序目录下的 `dsh-ui.cmd`（Windows）或 `dsh-ui`（macOS / Linux）。状态、校验、回滚与卸载命令见[安装详情](docs/install.md)。

## 常见问题

### 装好后界面没有变化？

先刷新浏览器（Desktop 要完全退出再打开）。仍是官方界面时，到「插件管理」确认整个 `@iroha1145/dsh-modern-ui` bundle 处于启用状态，并确认装进了正在运行的 profile：`dsh web` 用的是 `web`，Desktop 用的是 `desktop`。宿主启动日志里如果出现 `entry did not activate`，后面会列出没有激活的条目和原因。

### 能和 better-sidebar 等社区插件一起用吗？

已验证组合是 `dsh-context@0.75.1` 和 `dsh-better-sidebar@0.28.0`，兼容回归每次都带着它们跑。其他插件只要通过官方公开槽位贡献内容一般可以共存；依赖官方私有 DOM 或内部方法的插件，以及另带一套聊天或布局界面的插件不保证兼容，见[兼容矩阵](docs/compatibility.md)。

### 怎么切回官方界面？

在「插件管理」停用**整个** bundle 并刷新，或执行 `dsh plugin --profile web remove @iroha1145/dsh-modern-ui`。只停用里面的 `modern-ui` 条目不够：bundle 停用了七个官方界面模块，只有整个 bundle 关闭时才会还原。配置里有显式宿主兼容绑定时，移除前的额外步骤见[安装详情](docs/install.md)。

### 官方 DSH 升级后插件失效怎么办？

先看[兼容矩阵](docs/compatibility.md)：新版本是否在支持范围内、是否已验证。每天的 canary 会用新的官方版本跑兼容套件，失败时开一个标题为 `upstream: <版本> 兼容失败` 的 [issue](https://github.com/iroha1145/DSH-Modern-UI/issues)，里面附有失败证据和上游改动线索。修复发布前，可以装回矩阵里最近一个已验证的宿主版本；没有对应 issue 时欢迎新开一个，写明 DSH 版本、平台和启动日志。

### 支持官方 Desktop 吗？

部分支持。Desktop 0.2.1-rc.5 / Windows x64 上，Web Client 的 12 项检查、主题跟随、窄视口和移除重装都已通过；原生文件拖出、多窗口、「Open In…」、原生目录选择器和 macOS 外壳尚未验证。安装步骤见上方[官方 Desktop](#官方-desktop)，逐项结论见 [Desktop 验收记录](docs/compatibility/desktop-0.2.1-rc.5.md)。

## 本地构建

需 Node.js 24（CI 使用 `24.22.1`），仓库使用 npm 与 `package-lock.json`：

```bash
npm ci --ignore-scripts
npm run build      # 编译插件产物到 packages/modern-ui/lib
npm run preview    # 生成 .artifacts/plugin-preview（tgz + 可选安装器）
```

## 文档

- [安装详情](docs/install.md)、[兼容矩阵](docs/compatibility.md)、[架构与 UI 映射](docs/architecture.md)（含给第三方插件作者的接管关系图）、[旧数据迁移](docs/data-migration.md)、[宿主兼容层](docs/host-compat.md)
- 审计与 PR 跟进记录在 [`docs/history/`](docs/history/)
- 旧的“下载上游源码 + 打补丁再编译”路线已从 main 移除，见 tag [`legacy-patch-final`](https://github.com/iroha1145/DSH-Modern-UI/tree/legacy-patch-final)

## License

[MIT](LICENSE)。从 DeepSeek Harness 派生的部分保留上游版权，见 [`THIRD_PARTY_NOTICES.md`](packages/modern-ui/THIRD_PARTY_NOTICES.md)。
