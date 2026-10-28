# DSH Modern UI

**DSH Modern UI**（`@iroha1145/dsh-modern-ui`）是为官方 **DeepSeek Harness**（固定适配 `@deepseek-ai/dsh@0.2.1-rc.4`）打造的现代化 Web 界面插件。

本项目采用 **原版官方后端 + 独立预编译插件 + 隔离安装器** 架构：不修改任何官方后端文件，无需在用户端克隆源码或编译原生模块，创建独立 Profile 运行，随时可回退或切回官方原生界面。

---

## 核心特性

- **现代化对话体验**：全新设计的对话流、思考过程（Reasoning）分组折叠、消息时间轴导航、代码块与 Markdown 预览一键折叠。
- **高效输入与交互**：支持选中文字快捷引用、浏览器原图拖拽/粘贴无损直传、命令与文件引用胶囊（Lexical 编辑器）。
- **增强视图与卡片**：内置 Intelligent UI（`openui` 交互式沙箱与 `followups` 追问建议）、Subagent 编队树与调用链视图、精细化工具调用卡片。
- **模型与推理控制**：现代化模型选择卡片，支持自定义模型标签扩展与推理强度（Reasoning Effort，含 `Off`）配置。
- **多语言与主题**：内置中、英、日、西、法、德、俄、葡 8 种界面语言与多套明暗主题。
- **安全隔离与自动备份**：程序与数据目录分离，使用独立 Profile（保留原有配置与聊天数据），安装或更新非空数据目录前自动生成整树快照备份。

> **说明**：旧版自定义的会话级联网开关（`/web on|off`）已移除，联网搜索与网页抓取工具统一遵循官方插件管理与配置。

---

## 项目结构

```text
DSH-Modern-UI/
├── packages/modern-ui/      # Modern UI 核心插件源码 (@iroha1145/dsh-modern-ui)
│   ├── cordis.patch.yml     # UI 模块接管声明（替换官方默认展示层 owner）
│   └── src/                 # 浏览器端 UI 组件、状态管理与宿主兼容层
├── scripts/
│   ├── build-plugin.mjs     # 插件前端与服务端构建脚本 (esbuild + lightningcss)
│   ├── create-preview.mjs   # 预编译分发包 (.artifacts/plugin-preview) 生成脚本
│   └── distribution/        # 跨平台安装器、私有运行时拉取与代际管理器 (manager.mjs)
├── tests/                   # 单元测试、分发测试与 Playwright E2E 验收测试
└── docs/                    # 详细架构映射、安装边界与数据迁移文档
```

---

## 安装指南

插件目前通过预编译预览包（`plugin-preview`）方式分发。安装器会自动配置所需环境，并默认附带安装 3 个常用社区插件（`dsh-context@0.75.1`、`dsh-better-sidebar@0.28.0`、`dsh-plugins-store@0.1.4`）。

### 第一步：获取预编译安装包

您可以通过以下任一方式获取 `.artifacts/plugin-preview` 目录：

1. **下载 CI 构建产物**：在 GitHub Actions 的 `Official runtime plugin preview` 工作流中下载 `modern-ui-precompiled-preview` 压缩包并解压。
2. **从源码本地构建**（需 Node.js `24.22.1`）：
   ```bash
   npm ci --ignore-scripts
   npm run build
   npm run preview
   cd .artifacts/plugin-preview
   ```

---

### 第二步：执行安装命令

进入解压（或生成）后的 `plugin-preview` 目录，根据本机环境选择对应安装方式。
> ⚠️ **注意**：**程序目录（Program Root）** 与 **数据目录（Data Home）** 必须为两个互相独立的目录路径。

#### 方式 A：全新安装（推荐）
安装器会自动下载并校验独立的私有运行时（Node `24.22.1`、pnpm `11.28.5`，Windows 下含私有 PowerShell `7.6.5`）及官方 `@deepseek-ai/dsh@0.2.1-rc.4` 后端，不影响系统全局环境。

- **Windows (PowerShell)**：
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'
  ```
- **macOS / Linux**：
  ```bash
  sh ./install.sh '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```

*(可选：若不想安装附带的 3 个社区插件，Windows 可追加 `-SkipCommunity` 参数，macOS / Linux 可在命令前加上 `DSH_MODERN_SKIP_COMMUNITY=1`。)*

#### 方式 B：基于本机已有的官方 DSH 安装
如果您本机已安装官方 `@deepseek-ai/dsh@0.2.1-rc.4`，可直接指定其 `package.json` 路径：

- **Windows (PowerShell)**：
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install-existing.ps1 -Backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json' -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'
  ```
  *(若本机已安装精确的 Node `24.22.1`，也可直接执行：`node ./install-existing.mjs --backend '<官方package.json路径>' --root '<程序目录>' --home '<数据目录>'`)*
- **macOS / Linux**：
  ```bash
  sh ./install-existing.sh '/path/to/official/@deepseek-ai/dsh/package.json' '/path/to/dsh-modern/program' '/path/to/dsh-modern/data'
  ```

---

### 第三步：启动服务

安装完成后，直接运行程序目录下生成的启动脚本即可：

- **Windows**：
  ```powershell
  D:/DSH-Modern/program/dsh-ui.cmd
  ```
- **macOS / Linux**：
  ```bash
  /path/to/dsh-modern/program/dsh-ui
  ```

---

## 更新、切换与卸载

- **更新插件**：获取新版安装包后，对同一程序目录和数据目录再次执行上述安装命令即可（切换前会自动备份非空数据目录至 `<程序目录>/data-backups`）。
- **网页端临时切回官方 UI**：在 DSH 的「插件管理」页面中，停用整个 **`@iroha1145/dsh-modern-ui` bundle** 并刷新浏览器即可恢复官方原生界面（请勿仅停用内部的单个 `modern-ui` 条目）。
- **命令行管理（状态 / 校验 / 回滚 / 卸载）**：
  可通过程序目录内记录的内置管理器执行维护操作（以 PowerShell 为例）：
  ```powershell
  $state = Get-Content -Raw -Encoding UTF8 'D:/DSH-Modern/program/current.json' | ConvertFrom-Json

  # 查看当前安装状态
  & $state.node $state.manager status --root 'D:/DSH-Modern/program'

  # 校验官方后端与依赖完整性
  & $state.node $state.manager verify --root 'D:/DSH-Modern/program'

  # 回滚到上一个程序代际（不回滚会话数据）
  & $state.node $state.manager rollback --root 'D:/DSH-Modern/program'

  # 卸载 Modern UI 启动入口（保留所有用户数据与官方环境）
  & $state.node $state.manager uninstall --root 'D:/DSH-Modern/program'
  ```

---

## 开发者指南

开发环境要求 Node.js `24.22.1` 与 pnpm `11.28.5`：

```bash
# 安装开发依赖
npm ci --ignore-scripts

# 编译插件产物
npm run build

# 运行单元与集成测试
npm test

# 生成 .artifacts/plugin-preview 预编译分发包
npm run preview
```

更多细节请参阅 [`docs/`](docs/) 目录下的[安装详情](docs/plugin-installation.md)、[UI 映射说明](docs/plugin-ui-map.md)与[旧数据迁移说明](docs/plugin-data-migration.md)。

## License

[MIT](LICENSE)
