# DSH Modern UI

为官方 **DeepSeek Harness（DSH）** 打造的现代化 Web 界面插件（`@iroha1145/dsh-modern-ui`）。不修改官方后端，随时可切回官方界面。

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

装好后**刷新浏览器**即可看到 Modern UI。想切回官方界面：在「插件管理」停用整个 `@iroha1145/dsh-modern-ui` bundle 并刷新，或执行 `dsh plugin --profile web remove @iroha1145/dsh-modern-ui`。支持的宿主版本见[兼容矩阵](docs/compatibility.md)。

> 前提：已安装受支持版本的官方 DSH，且 `pnpm` 在 PATH 上（`dsh plugin` 会把命令转发给 pnpm）。如果从未启动过 web profile，先运行一次 `dsh web`。

---

## 核心特性

- **现代化对话体验**：全新设计的对话流、思考过程（Reasoning）分组折叠、消息时间轴导航、代码块与 Markdown 预览一键折叠。
- **高效输入与交互**：支持选中文字快捷引用、浏览器原图拖拽/粘贴无损直传、命令与文件引用胶囊（Lexical 编辑器）。
- **增强视图与卡片**：内置 Intelligent UI（`openui` 交互式沙箱与 `followups` 追问建议）、Subagent 编队树与调用链视图、精细化工具调用卡片。Intelligent UI 默认**不改变模型提示词**，只渲染模型已经写出的 `openui` / `followups` 代码块；在「设置 → 通用 → 回答可视化组件」开启后会向系统提示词追加约 3 KB 指令。从旧版本升级的安装器用户保持原行为（开启）。条目配置里的 `presentation.openui` / `presentation.followups` 可分别关闭这两种代码块的渲染（关闭后按普通代码块显示），见[包说明](packages/modern-ui/README.md)。
- **模型与推理控制**：现代化模型选择卡片，支持自定义模型标签扩展与推理强度（Reasoning Effort，含 `Off`）配置。
- **多语言与主题**：内置中、英、日、西、法、德、俄、葡 8 种界面语言与多套明暗主题。

> **说明**：旧版自定义的会话级联网开关（`/web on|off`）已移除，联网搜索与网页抓取工具统一遵循官方插件管理与配置。

## 安装方式说明

- **npm（推荐）**：即上面的一行命令。指定版本用 `@iroha1145/dsh-modern-ui@<版本>`。
- **GitHub Release**：每个版本的 Release 附带 `modern-ui.tgz`，可 `dsh plugin --profile web add ./modern-ui.tgz` 离线安装。
- **不支持 Git 源安装**（`dsh plugin add github:iroha1145/DSH-Modern-UI`）：构建依赖在仓库根目录，且 pnpm 10+ 默认禁止 Git 依赖执行 build script。请使用 npm 包或 Release 中的 tgz。

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

## 本地构建

需 Node.js 24（CI 使用 `24.22.1`），仓库使用 npm 与 `package-lock.json`：

```bash
npm ci --ignore-scripts
npm run build      # 编译插件产物到 packages/modern-ui/lib
npm run preview    # 生成 .artifacts/plugin-preview（tgz + 可选安装器）
```

## 文档

- [安装详情](docs/install.md)、[兼容矩阵](docs/compatibility.md)、[架构与 UI 映射](docs/architecture.md)、[旧数据迁移](docs/data-migration.md)、[宿主兼容层](docs/host-compat.md)
- 审计与 PR 跟进记录在 [`docs/history/`](docs/history/)
- 旧的“下载上游源码 + 打补丁再编译”路线已从 main 移除，见 tag [`legacy-patch-final`](https://github.com/iroha1145/DSH-Modern-UI/tree/legacy-patch-final)

## License

[MIT](LICENSE)。从 DeepSeek Harness 派生的部分保留上游版权，见 [`THIRD_PARTY_NOTICES.md`](packages/modern-ui/THIRD_PARTY_NOTICES.md)。
