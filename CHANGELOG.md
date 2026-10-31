# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。插件版本与官方宿主版本的对应关系见[兼容矩阵](docs/compatibility.md)。

## [Unreleased]

### Added

- 可选的 TypeSafe Jev 渲染路由：配置 `TYPESAFE_API_KEY` 并开启「回答可视化组件」后，每条新消息先请 Jev 选出最适合的呈现方式，作为一行提示交给回答模型；系统提示词不变，不影响缓存。没有密钥、超时或出错时不加提示，回合照常进行。

### Changed

- 回答里的交互组件改用 [OpenUI](https://github.com/thesysdev/openui)：模型写 `openui-lang` 代码块，插件用 OpenUI 渲染器边生成边画出卡片、流程图、图表、表格、照片和能自己计算的小工具（滑块、输入框改了数值当场重算，不用再问模型）。组件里的「发给助手」按钮只把内容放进输入框，由你确认后发送。组件需要 Chrome/Edge 111、Safari 16.2、Firefox 121 或更新的浏览器（官方 Desktop 内置的 Electron 满足）。组件库取自 thesysdev/open-intelligent-ui，按 DSH 主题配色，补了流程图组件，去掉了地图、视频和 CDN 脚本。原先借鉴 CopilotKit/OpenIntelligentUI 的 HTML 沙箱组件已删除，旧回答里写成 HTML 的 `openui` 代码块改为按普通代码显示。
- 「回答可视化组件」开启后追加的提示词从约 8 KB 增加到约 30 KB（约 7,000 个词元）。

### Fixed

- 输入框的模型选择卡片在模型很多、窗口又够高时会飘到页面上方，和按钮之间留出一大段空白：卡片最高 560 像素，定位却按列表完全展开的高度算。现在向上展开时按底边贴住按钮，判断往上还是往下展开也改用封顶后的高度。

## [0.1.0] - 2026-10-31

首个以 npm 包 `@iroha1145/dsh-modern-ui` 分发的版本。此前的分发方式（对官方前端打补丁）已归档，见 tag `legacy-patch-final`。

### Added

- README 首屏截图（明暗各一，`tests/compat/readme-screenshots.mjs` 在隔离环境里用演示模型生成）、英文版 `README.en.md` 与常见问题。
- `docs/architecture.md` 新增给第三方插件作者的接管关系图。
- vendor 漂移报告 `scripts/vendor-drift.mjs`：对比 vendored 拷贝的上游源文件在指定官方版本里的改动，接入每日 canary（步骤摘要、artifact、失败 issue）。
- 一行安装：`dsh plugin --profile web add @iroha1145/dsh-modern-ui`；GitHub Release 附带 `modern-ui.tgz` 与可选的一键隔离环境安装器。
- 发布管线：`v*` tag 触发校验、npm 发布（带 provenance）与 GitHub Release。
- 「设置 → 通用 → 回答可视化组件」开关，控制是否向系统提示词追加 Intelligent UI（`openui` / `followups`）指令；`presentation.openui` / `presentation.followups` 配置项可分别关闭两种代码块的渲染。
- 上游 canary：每天对范围内最新的未验证官方预发布版与正式版跑兼容套件，失败时开 issue；范围外更新的版本也开 issue，提醒评估宿主范围。
- `CONTRIBUTING.md`、`SECURITY.md`、issue / PR 模板、Renovate 配置。

### Changed

- 宿主兼容声明从精确版本枚举改为范围 `>=0.2.1-rc.2 <0.3.0-0`（上界写成 `-0`，官方宿主按含预发布版的规则判断时也不会放行 `0.3.0-alpha.*`）；范围内未验证的宿主可以安装并给出警告，已知不兼容的版本被安装器拒绝。
- `engines.node` 放宽为 `>=24.0.0`；`react` / `react-dom`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` peers 改为 caret 范围。
- 默认**不再**改变模型提示词；经安装器从旧版本升级的 profile 保持原行为（开启）。
- 测试统一到 vitest（unit / audit / compat 三层），`scripts/` 与 `tests/` 由 Biome 格式化与检查。

### Fixed

- 官方 Desktop：登录 DeepSeek 账号后首次引导卡在「你希望看到多少工作过程？」，「进入应用」和「跳过」都提示「未能保存设置，请重试。」。引导最后一步写的是官方聊天设置（`ui-chat`），Modern UI 接管聊天时禁用了它，写入必然失败。现在启用 Modern UI 时引导记为已跳过、不再弹出；已经卡在半路的进度会被同样记为跳过。工作过程与用量展示在「设置 → 通用」里调整；卸载 Modern UI 后官方引导照常出现（已被记为跳过的除外）。
- 「设置 → 通用 → 回答可视化组件」保存失败时，界面会显示新值，宿主却仍按旧值给模型加提示词。现在这一行只显示宿主已接受的值，保存失败时说明会改成「保存失败，设置没有改变，请重试」。

### Removed

- 会话级联网开关（`/web on|off`）及其协议；联网工具统一走官方插件管理。

[Unreleased]: https://github.com/iroha1145/DSH-Modern-UI/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/iroha1145/DSH-Modern-UI/releases/tag/v0.1.0
