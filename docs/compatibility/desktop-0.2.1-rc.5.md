# 官方 Desktop 0.2.1-rc.5 验收记录

**结论：部分支持。** 在 Windows x64 的官方 DeepSeek Harness Desktop `0.2.1-rc.5` 中，Modern UI 用 Desktop 自带的 `dsh` 安装后，Web Client 的 12 项真实浏览器检查、Windows 标题栏标记、系统主题跟随、窄视口，以及「移除并重启恢复官方界面 → 重装并重启恢复 Modern」全部通过。不工作或降级的面：

- **首次引导记为已跳过（降级）**。官方引导的最后一步写入官方聊天设置（`ui-chat`），而 Modern bundle 停用了它，保存会一直失败、遮罩关不掉（修复前的实际卡死）。现在 bundle 把引导组合为已跳过，已经保存的半途进度会被重新继承为同一份跳过记录；工作过程、用量展示在「设置 → 通用」里调整。
- **聊天偏好不迁移**。Modern 的聊天偏好存在自己的条目里；`dsh plugin add`（Web 与 Desktop 相同）不会把官方 `ui-chat` 的设置搬过来，只有私有安装器做这一步。
- **工作过程默认视图不同**。Desktop 里 Modern 默认「标准」视图（与官方 Desktop 默认一致），已完成的过程行不能就地展开；改为「详细」后行为与 Web 相同。
- **原生桥能力未验证**：原生文件拖出、多窗口、「Open In…」、原生目录选择器、最大化/全屏下的覆盖层、macOS 外壳。它们只能人工操作，本轮没有做，不计为通过。

## 环境

| 项 | 值 |
| --- | --- |
| Desktop | `0.2.1-rc.5`，Electron 44.7.0，Chrome 152.0.7977.130（来自 CDP `/json/version` 的 User-Agent `@deepseek-ai/dsh-desktop/0.2.1-rc.5`） |
| 内嵌 DSH | `0.2.1-rc.5`（`hostRange` 内，不在 `verifiedHosts`，状态 unverified） |
| 平台 | Windows 11 x64，Node `24.22.1`，pnpm `11.28.5` |
| 插件 | `@iroha1145/dsh-modern-ui@0.1.0` 预编译 `modern-ui.tgz`，含首次引导修复 |
| 社区组合 | `dsh-context@0.75.1`、`dsh-better-sidebar@0.28.0`（按 SRI 校验后经 Desktop 自带 `dsh` 安装） |
| 日期 | 2026-10-30 |

全程隔离：独立 `DSH_HOME` 与 Chromium `--user-data-dir`，不读写用户的 `~/.dsh` 和 Desktop 自己的用户数据；模型与外部服务是本地确定性夹具，不登录账号。

## 宿主盘点

- Desktop 自带的 `dsh` 是 `resources/runtime/cli/bin/dsh(.cmd)`：以 `ELECTRON_RUN_AS_NODE=1` 运行应用内的 `@deepseek-ai/dsh-desktop-host/lib/cli.js`。菜单「应用 → 管理 dsh 命令…」把它加入终端。
- `dsh --version` → `0.2.1-rc.5`。
- `dsh --profile desktop --dump-config` 被拒（npm 的 `dsh` 与 Desktop 自带的 `dsh` 相同）：

  ```text
  error: profile "desktop" is managed exclusively by the Electron application
  ```

  npm 的 `dsh plugin --profile desktop …` 也报同一错误；只有 Desktop 自带的 `dsh` 能管理保留 profile。profile 目录以打开一次 Desktop 后 `DSH_HOME/profiles/desktop/package.json` 出现为准。
- `dsh plugin --profile desktop add <modern-ui.tgz>`：退出码 0，`Done in 2.5s using pnpm v11.28.5`。pnpm 提示 `Issues with peer dependencies found`：缺的是 `@deepseek-ai/*` peers，它们在应用 asar 里，由 Host loader 解析，不影响加载（下面 `installed-loader-shared-instances` 检查实际核对了共享实例）。社区插件安装时有同样提示；Web profile 的 rc.5 兼容回归里 `dsh plugin add` 也给出同一条提示，不是 Desktop 特有的。
- Desktop 没有可用的「刷新页面」（菜单里的刷新与重启宿主只在开发构建出现），切换 bundle 必须完全退出再打开应用。

## 逐项结果

自动化入口：`node tests/compat/desktop.mjs --root <隔离目录> --plugin <modern-ui.tgz>`。它以远程调试端口启动 Desktop，复用 `tests/compat/browser.mjs` 的检查；夹具覆盖层作为隔离 profile 的用户层，Host 重启即应用重启。

| 项 | 结果 | 说明 |
| --- | --- | --- |
| 内嵌宿主版本 | 通过 | `0.2.1-rc.5`，unverified |
| 保留 profile 只在 Desktop 内启动 | 通过 | `--dump-config` 被拒，见上 |
| 打开一次并退出以初始化 profile | 通过 | |
| 社区插件（含完整性校验） | 通过 | |
| `dsh plugin --profile desktop add` | 通过 | |
| 已安装 loader 与共享实例 | 通过 | `installed-loader-shared-instances` |
| 模型选择、推理强度与公开标签 | 通过 | `model-selection-reasoning-and-public-label` |
| 官方计划操作 | 通过 | `official-plan-action` |
| 真实发送、流式、工具与答案区域 | 通过 | `real-send-stream-tools-and-answer-region`（检查把工作过程固定为「详细」，见上） |
| 原样复制与答案导航 | 通过 | `raw-whitespace-copy-and-answer-navigation` |
| 官方反馈操作 | 通过 | `official-feedback-action` |
| 侧栏读取、编辑保存与 Markdown 折叠 | 通过 | `sidebar-read-edit-save-and-markdown-fold`（`dsh-better-sidebar`） |
| 上下文真实统计 | 通过 | `context-real-statistics`（`dsh-context`） |
| 文件与图片附件 | 通过 | `file-and-image-attachments` |
| 真实流停止 | 通过 | `real-stream-stop-cancellation` |
| 设置与历史在宿主重启后保留 | 通过 | `settings-and-history-survive-host-restart`：从侧栏座位菜单打开设置（Desktop 窗口菜单接管了 Ctrl+Alt+,），深色主题与会话在应用重启后保留 |
| 运行时错误与请求结果 | 通过 | `browser-runtime-and-request-outcomes` |
| Windows 自定义标题栏 | 通过 | `<html data-windows-titlebar>` 存在，`--dsh-windows-titlebar-height` 为 `40px`，Modern 布局按它留白 |
| 系统深浅主题跟随 | 通过 | 主题设为「跟随系统」后切换 `prefers-color-scheme`，`body` 的深色标记与根元素 `color-scheme` 随之变化 |
| 窄视口 | 通过 | 720×820 视口下无横向溢出、输入框可见。Electron 的 CDP 没有窗口尺寸接口，这里是视口模拟，不是拖动原生窗口 |
| 移除并重启恢复官方界面 | 通过 | `dsh plugin --profile desktop remove` 后重启，Modern 标记消失 |
| 重装并重启恢复 Modern | 通过 | |
| 首次引导半途进度被重新继承为已跳过 | 通过 | 在用户层写入 `step: process` 的半途进度后重启，Modern 把这些字段全部改回继承，官方设置服务随即删掉这条空行，生效配置回到 bundle 组合的 `step: done`、`completion: skipped` |
| 原生文件拖出到系统 | 未验证 | 需要人工；Modern 不伪造 Electron 原生调用 |
| 多窗口同时打开两个会话 | 未验证 | 需要人工 |
| 「Open In…」打开工作区目录 | 未验证 | 官方 `ui-open-in-app` 未被 bundle 停用，需要人工 |
| 原生目录选择器 | 未验证 | 官方 `directory-picker-native` 未被 bundle 停用，需要人工 |
| 最大化/全屏下的覆盖层位置 | 未验证 | 需要人工 |
| macOS 标题栏留白、菜单底色、减少透明度、全屏 | 未验证 | 没有 macOS Desktop |

## 自动化在 Desktop 里的注意事项

- Desktop 窗口在画面不变时不出新帧；截图和 `prefers-color-scheme` 的变化事件都要等下一帧。测试在截图和切换配色期间放一个每帧变化的 1 像素标记，保持出帧。
- Playwright 的整页截图会先调整 Electron 视图尺寸，在打开 Markdown 的侧栏状态下会一直卡住；Desktop 模式改用协议自带的可见窗口截图。
- 测试窗口不能最小化（最小化后不绘制，测试会直接报错说明）；被其他窗口遮挡没有关系，启动参数关闭了遮挡检测。
- 测试中途不要在测试窗口登录：登录后官方账号插件会改写默认模型并重新引导页面，打断检查。

## 首次引导卡死（已修复）

修复前，在 Desktop 里登录后遮罩停在「选择工作过程展示方式」，点完成提示「未能保存设置，请重试。」且无法关闭。原因：引导最后一步 `save(next, true)` 写入 `ui-chat` 的配置表单，而 Modern bundle 停用了 `ui-chat`，该命名空间不可用，写入必然失败；遮罩在「未完成、已登录、可用」时一直显示。修复只用公开机制：bundle 的 `cordis.patch.yml` 把 `ui-settings-account` 组合为已跳过；客户端在 `ui-chat` 不可用、组合为已跳过、用户层却存有未完成进度时，经公开的配置表单把这些字段重新继承。修复在独立分支 `fix/desktop-onboarding`，单元与兼容测试覆盖组合结果与重新继承条件，上表「首次引导半途进度被重新继承为已跳过」一项在真实 Desktop 中验证。

## 证据

截图在 [`desktop-0.2.1-rc.5/`](desktop-0.2.1-rc.5/)：

- `final.png`：12 项检查后的 Modern 主界面（重启后的深色主题）。
- `shell-dark.png`、`shell-light.png`：跟随系统时的深浅两态。
- `shell-narrow.png`：720 宽视口。
- `official.png`：移除插件并重启后的官方界面。

最终一次完整运行（全新隔离目录）所有步骤通过；修复首次引导卡死之后，此前几次失败都来自测试脚本在 Desktop 里的假设，已按上一节修正。完整的 `report.json`、各次启动日志与安装日志保存在本地隔离目录，不提交（含随机端口与本机路径）。
