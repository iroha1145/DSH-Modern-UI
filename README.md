# DSH Modern UI

本分支将 Modern UI 迁移为 **固定版本的官方 DSH 成品后端 + 独立预编译插件/bundle + 薄安装入口**。官方后端为 `@deepseek-ai/dsh@0.2.1-rc.4`，插件为尚未发布的 `@iroha1145/dsh-modern-ui@0.1.0-migration.1`。

这是尚未发布的本地预览。实现、实际消费证据、平台范围和剩余差异见 [迁移记录](docs/plugin-migration.md)，不承诺未验证的平台或所有第三方组合完全兼容。

## 已确定的功能范围

Modern UI 自定义会话联网开关已取消。联网工具和提供商按官方插件管理/配置的原有范围启停；保留搜索结果、来源引用、网页卡片和工具过程。不会添加第二套命令、preset 或会话策略。

已迁移模型卡片与官方推理等级、聊天与思考折叠、Intelligent UI、相关问题、编队、语言、主题、布局、文件和终端；`collapsedViews` 已接入视图显隐并验证刷新和新 Host 恢复。逐项执行范围与边界见 [UI 地图](docs/plugin-ui-map.md)和 [Host 兼容记录](docs/plugin-host-compat.md)。

## 安装预编译插件

包尚未发布到 npm 或 Release。现在使用实际本地预览包；不存在可复制的远端一键下载地址。

取得并解压开发流程生成的 `.artifacts/plugin-preview` 后，在该目录执行一条命令。以下目标路径和已有官方包路径需要替换为本机实际值。

已有兼容官方 DSH 和 Node 24.22.1，在 PowerShell 中执行：

```powershell
node ./install-existing.mjs --backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json' --root 'D:/DSH Modern/program' --home 'D:/DSH Modern/data'
```

安装器通过官方插件管理器安装真实 tgz，创建独立 Modern UI profile，并保留其他 profile。所给官方包必须与固定版本匹配、来源核验通过。优先使用新的独立数据目录；旧数据不自动导入。

新用户在 Windows 执行以下命令；它会自动准备私有 Node：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH Modern/program' -DataHome 'D:/DSH Modern/data'
```

`ExecutionPolicy` 参数只作用于当前 PowerShell 进程，不修改系统策略。已有 DSH 但没有精确 Node 时，也可用 `install-existing.ps1 -Backend ...` 的同样 PowerShell 入口自动准备运行时。

安装器准备精确私有 Node/pnpm、Windows PowerShell 7 和官方发布成品。用户端不克隆上游，不构建 DSH 或 Modern UI；Windows 实际消费验证发布 prebuild 与辅助程序，不调用原生编译器。不能只把跳过安装脚本当作完整功能证明。

POSIX 入口是 `sh ./install.sh PROGRAM_ROOT DATA_HOME [EXISTING_OFFICIAL_PACKAGE_JSON]`。本地验收覆盖 Windows x64，Linux/macOS 以匹配源码提交的消费 CI 为准，不能从一套 JS/CSS 产物推导全部平台通过。详细版本、边界、社区插件与失败重试见 [安装文档](docs/plugin-installation.md)。

启动安装器生成的 `program/dsh-ui.cmd`（Windows）或 `program/dsh-ui`（POSIX）。程序和数据目录必须分开。社区插件固定为 `dsh-context@0.75.1`、`dsh-better-sidebar@0.28.0`、`dsh-plugins-store@0.1.4`；同版本跳过，已有不同版本不擅自覆盖。核心和社区安装结果分别报告。

## 更新、回退与旧数据

再次执行安装命令可准备新的插件代际，自检成功后切换。后端版本独立锁定，不接受未经验证的 `latest`。管理器提供 `status`、`verify`、`community`、`rollback` 与 `uninstall`，完整可执行示例见 [安装文档](docs/plugin-installation.md)。

回退仅改变程序/profile 选择，不能当作数据倒带。管理器卸载撤销当前启动选择，保留官方安装、所有 profile 与用户数据。切回官方界面使用官方插件管理中的整个 Modern UI **bundle** 开关，并刷新页面；不要仅停用其中的 `modern-ui` entry。实际包移除和包含 Host 兼容项的边界见安装文档。

旧数据先用随插件交付的 `modern-ui-data` 预检。普通快照通过官方读取器后可走已验证的导入路径；含旧 `web/search` 的快照保留原件，留给旧环境或只读导出。第一版不做可选转换，不恢复已取消的会话开关。见 [旧数据策略](docs/plugin-data-migration.md)。

## 开发与验证

开发使用 Node `24.22.1`、pnpm `11.28.5`；以下命令只由开发者执行：

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run preview
```

预览目录包含真实 tgz、来源/完整性清单、薄安装器和可选消费测试驱动。消费者不在预览目录执行 `npm install` 或构建。

[插件预览 CI](.github/workflows/plugin-preview.yml) 将构建与消费分开：消费 job 没有 checkout，仅取预编译产物，检查官方来源、原生能力、官方联网配置和浏览器交互。PR #5 的远端执行与审计修复见 [复核记录](docs/pr5-audit-followup.md)、[启动生命周期修复](docs/pr5-lifecycle-followup.md)、[macOS / Linux 复核](docs/pr5-posix-followup.md)及 [PR 检查页](https://github.com/iroha1145/DSH-Modern-UI/pull/5/checks)；未通过匹配提交的目标不标为已验证。

旧补丁构建已移出默认 README 和自动 CI 路径。原脚本和固定 patch 保留用于旧数据回看；[历史说明](docs/legacy-patch-installation.md)与手动工作流 `Legacy patched build` 不属于新安装的验收证据。

## English

This branch migrates Modern UI to an unmodified official DSH release plus a separately precompiled plugin. This local preview is not published. The custom per-session web switch is retired; official web tools, providers, configuration and result rendering remain. See the migration record for executed checks, platform limits and remaining differences. The source-patched legacy build is retained only for maintenance and historical data access.
