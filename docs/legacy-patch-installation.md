# 旧补丁版维护与数据回看

以下保留 a9f4c370 的历史说明，供旧环境维护和历史数据回看。这里的源码构建和自定义联网开关不属于新的插件发行路径；不要用它们作为新架构验收。新安装请返回仓库 README。

# DSH-UI

DSH-UI 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的一套界面改版。它以补丁形式发布：安装脚本下载固定版本的官方源码，打上本仓库的补丁，装好依赖并构建，再顺带装上三个社区插件。

[2026-10-26 独立复审修复](reaudit-remediation.md)记录了运行环境安全更新、数据目录保护与键盘导航修复及其验证边界；[手机滑动与复审后续修复](followup-20261026.md)记录了之后的修复和尚未处理的 Windows 问题。

[English](#english)

## 改了什么

- **模型选择器**：输入框里的模型卡片显示厂商的黑白图标（对不上时显示首字母，可以在设置里改），按模型显示它支持的推理等级，并列出速度、质量、成本和 models.dev 上的价格。
- **模型设置**：内置提供商上出现了比内置模型表更新的模型（例如 Kimi K3.1 Pro）时，可以在设置里为它声明推理等级。
- **编队页**：会话标签栏新增「编队」，用树状图显示子智能体的状态、模型、用量和耗时。
- **回答**：思考过程可以折叠，来源显示为编号标签，末尾有相关问题，可以开关网页搜索（开关时对话里不会多出记录行），回答里的交互组件显示正常。交互组件里的链接要在页面上点确认才会打开，超过高度上限的组件可以在内部滚动。
- **输入框**：下方的读数垫了一层毛玻璃，经过的正文不会和它叠在一起。
- **手机**：页面滑到顶或底后继续拖动，不会再把整个页面连同顶栏一起拖动，也不会触发下拉刷新。
- **图标**：工具调用的图标换成了扳手。鼠标悬停或用键盘选中按钮时，按钮上的图标会动一下，动作参照 [lucide-animated](https://lucide-animated.com)：对勾逐笔描出，复制的两张纸错开，垃圾桶盖抬起，齿轮转半圈。系统开了「减少动态效果」时图标不动。
- **排版**：按 [TypeUI](https://www.typeui.sh/) 的规则调整了行高、换行、阅读宽度、等宽数字和间距。回答正文每行最多 65 个字符宽（约 41 个汉字），行高 1.6；代码块和表格仍占满整栏。字族、字号、字重都没有改。
- 以及之前的一批界面修复。

补丁基于官方 0.2.1-rc.3（提交 `22ddee37`）。

## 安装

需要：

- macOS，或使用 glibc 的 Linux（Alpine 这类 musl 系统不行）。Windows 提供 PowerShell 5.1 及以上版本脚本；持续集成检查准备、续装和启动参数，完整 Windows 构建尚未验收。
- `curl`、`tar`，以及可正常执行 `git --version` 的 Git。发行补丁包含二进制文件删除，不能用 `patch` 替代；安装器会在创建安装目录、备份数据或下载运行时之前检查 Git。
- C 编译器。构建时要编译一个原生模块：macOS 装 Xcode 命令行工具（`xcode-select --install`），Linux 装 `build-essential`（或 gcc、clang）。个别依赖没有预编译包时还会用到 `python3`。
- 约 3 GB 磁盘空间，能访问 GitHub、nodejs.org 和 npm。

不用预先装 Node.js：安装脚本会从 nodejs.org 下载官方的 Node 24.22.1，核对官方校验值后放进安装目录，再用它装 pnpm 11.28.5，不改动系统里的 Node。

```bash
git clone https://github.com/iroha1145/DSH-Modern-UI.git
cd DSH-Modern-UI
./scripts/install.sh
```

也可以不克隆，直接运行：

```bash
curl -fsSL https://raw.githubusercontent.com/iroha1145/DSH-Modern-UI/main/scripts/install.sh | bash
```

Windows（PowerShell 5.1 或以上，完整构建尚未验收）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

装好后启动：

```bash
~/.dsh-ui/dsh-ui
```

它会打印一个带 token 的本机地址，用浏览器打开即可。后面加的参数会交给 DSH 命令行，比如 `~/.dsh-ui/dsh-ui web --port 3090`，启动器不添加配置覆盖参数。DSH 在你的主目录里运行，参数里的相对路径从主目录算起。

### 安装脚本做了什么

1. 准备私有的 Node 24.22.1 和 pnpm 11.28.5（已经有了就跳过）。
2. 从 GitHub 下载官方源码包，打上 `patches/dsh-ui.patch`。源码包和补丁分别核对清单中的 SHA-256；自定义镜像也必须提供相同字节。在 macOS 和 Linux 上，还会用 Git 检查源码包携带的提交标识。
3. 用 `pnpm install --frozen-lockfile` 装依赖，再运行 `pnpm run build`。源码包没有 Git 历史，安装器会通过 `DSH_CLIENT_COMMIT_HASH` 提供清单中的官方基线提交；完整改版由同一清单中的补丁摘要标识。
4. 在安装目录里放启动器 `dsh-ui`，记下数据目录和配置名。
5. 安装社区插件，已经装过的跳过（规则见下）。插件这一步出错时，启动器已经在了。

脚本会在安装目录里记下进度。解压、打补丁、装依赖或构建中途断了，再运行一次会接着做；同一版本已经装好，再运行不会重新下载和构建，只会刷新启动器并检查插件。重跑时不加 `--home`、`--profile`，会沿用上次记下的数据目录和配置名。安装目录里只能有安装脚本自己建的东西，指向一个放着别的文件的目录会被拒绝。

### 选项

| 选项 | 说明 |
|---|---|
| `--dir <目录>` | 安装目录，默认 `~/.dsh-ui` |
| `--home <目录>` | DSH 数据目录（`DSH_HOME`）。默认沿用上次安装记下的；首次安装用 `<安装目录>/data`，忽略环境变量 `$DSH_HOME`；已有数据会先备份 |
| `--profile <名称>` | 插件装进哪个配置。默认沿用上次的；第一次安装用 `web` |
| `--skip-plugins` | 不装社区插件 |
| `--prepare-only` | 只准备 Node、pnpm，下载源码并打补丁，不装依赖、不构建；再运行一次脚本会接着装 |
| `--force` | 同一版本已装好也重新下载和构建，旧目录改名保留 |

环境变量 `DSH_UI_TARBALL_URL` 可以换官方源码包的下载地址，`DSH_UI_NODE_MIRROR` 可以换 Node 安装包的下载根地址（比如 `https://npmmirror.com/mirrors/node`）。PowerShell 脚本的选项同名，写成 `-Dir`、`-DshHome`、`-DshProfile`、`-SkipPlugins`、`-PrepareOnly`、`-Force`。

## 一起安装的插件

| 插件 | 版本 | 作者仓库 |
|---|---|---|
| dsh-context | 0.75.1 | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) |
| dsh-better-sidebar | 0.28.0 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) |
| dsh-plugins-store | 0.1.4 | [ZASENJC/dsh-plugins-store](https://github.com/ZASENJC/dsh-plugins-store) |

插件通过 DSH 自带的 `dsh plugin add` 从 npm 安装，代码不在本仓库里。版本固定为和 DSH-UI 一起测试过的版本，记在 `dsh-ui.json`。

安装前会逐个检查配置目录（`<DSH_HOME>/profiles/web`）里有没有装过：

- 装了同一版本：跳过。
- 装了别的版本：只提示，不覆盖、不升级。
- 配置里声明了但文件不在：只提示，不动它。
- 没装：一次性装上，装完再核对一遍版本和插件列表。

另外，如果这个配置的依赖是用另一个 pnpm 仓库装的，pnpm 会拒绝继续安装（`ERR_PNPM_UNEXPECTED_STORE`）。有插件要装时，脚本会先查出这种情况并停下，同时说明怎么修。

只想看看现在装了什么，可以运行：

```bash
node scripts/plugins.mjs --check --home ~/.dsh-ui/data
```

dsh-context 自带一个编队标签，和 DSH-UI 的编队页重复。启动器不再注入 `context-fleet-tab.yml` 或强制隐藏标签，提示词、历史窗口及其他插件设置保持原值。需要隐藏重复标签时，通过 dsh-context 自身的 `fleetTab` 设置选择 `hide`。

## 数据目录与回退

首次安装默认使用 `<安装目录>/data`（通常是 `~/.dsh-ui/data`），不会读取环境变量 `DSH_HOME` 指向的官方数据。已有安装继续使用记录的数据目录。启动器始终使用安装记录的目录。数据目录只能放在 `<安装目录>/data` 子树或安装目录外的独立目录；不能包含安装目录，也不能与 `dsh`、`runtime`、`data-backups`、`overlays`、`dsh.old-*` 等安装器管理的目录重叠。安装器会解析符号链接和 Windows 目录联接（junction）的真实位置，在创建目录、备份或保存设置前检查；以前保存的不合法路径也会被拒绝，已有数据不会因此被删除或移动。对于尚不存在、但文件名可能被系统视为相同的路径，必要时会在既有父目录创建并立即移除临时目录，以确认文件系统的名称规则。

**会话不是双向兼容的。** DSH-UI 写入的 `web/search` 是必须识别的事件，记录联网开关的语义。固定的官方 0.2.1-rc.3 无法打开包含该事件的会话；不能通过删除事件或把它改成可忽略事件来回退，否则可能丢失关闭联网的意图。

- 全新使用：按默认选项安装，官方 `~/.dsh` 保持独立。
- 导入官方数据：停止所有使用原目录的 DSH，先把原目录完整复制到一个**不存在的、独立的新目录**，再用 `--home <新目录>` 安装（Windows 为 `-DshHome <新目录>`）。不要把副本放进原目录内部，不要合并覆盖已有目录。原目录保留作回退副本；导入后的两套数据独立演进。
- 明确共用：停止使用该目录的所有 DSH 后，传 `--home ~/.dsh`（Windows 为 `-DshHome "$HOME\.dsh"`）。安装器在首次使用或显式指定已有非空目录时，先生成 `<安装目录>/data-backups/home-*/data.tar.gz`，并打印准确路径。请保留该备份；只有备份完成后才保存安装意图和继续安装。安装期间及备份期间不能有其他进程写入该目录。不要给 `--home` 传整个用户主目录或包含安装目录的父目录。

实际兼容夹具位于还原源码的 `packages/session/session-persistence/tests/modern-ui-compatibility.spec.ts`；它使用固定官方版本的真实校验器与事件类型表，不改动全局注册表。

| 数据 | 官方 0.2.1-rc.3 读取 | DSH-UI 读取 |
|---|---|---|
| 官方会话事件 | 通过 | 通过 |
| 含必需 `web/search` 的会话 | 明确拒绝 | 通过 |
| 导入后保留的原件、写入新事件前的备份 | 通过，内容未变 | 通过 |

该夹具验证会话事件校验与文件复制隔离，不代表真实用户数据库的所有历史版本均可迁移。

回退时，先停止所有使用目标目录的 DSH，保留当前数据另作副本，把安装前备份解压到一个空的新目录，然后让原版 DSH 使用这个新目录。不要直接覆盖当前数据。回退副本只包含备份时的数据，之后在 DSH-UI 中新增或修改的会话不会自动合并回去。

安装意图在准备源码、下载运行时和构建之前写入 `install.conf`（Windows 为 `install.json`）。中断或 `--prepare-only` 后续装保留目录和配置名；显式参数优先。已有的 `launch.conf` / `launch.json` 只在构建成功后更新，因此未完成的安装不会提前切换启动参数。这不保证失败升级后的源码仍可启动：`--force` 会先把旧源码移至 `dsh.old-*`，构建失败后应续装，或停止程序后恢复保留的旧源码目录。

运行时先解压到独立临时目录，核验 Node、npm、完成标记以及 macOS/Linux 构建需要的头文件后才切换。下载或解压失败时原运行时仍保留；重跑可修复缺文件的安装。Windows 的原生构建跳过此平台，不额外下载未使用的头文件。

## 更新和卸载

更新：拉取本仓库的新版本后再运行一次安装脚本。版本变了时脚本会提示加 `--force`，旧目录会改名保留，确认没问题后可以删掉。

卸载前先把要保留的数据和 `data-backups` 移到安装目录外；默认数据也在 `~/.dsh-ui` 内，删除安装目录会一并删除它们。使用外部数据目录时，插件留在该目录的配置里，要移除可以运行 `~/.dsh-ui/dsh-ui plugin --profile web remove <插件名>`（先移除插件，再删安装目录）。

## 仓库结构

```text
dsh-ui.json                      官方版本、补丁校验值、Node 和 pnpm 版本、插件清单
patches/dsh-ui.patch             从官方 22ddee37 到 DSH-UI 的全部改动
scripts/install.sh               安装脚本（macOS、Linux）
scripts/install.ps1              安装脚本（Windows，完整构建尚未验收）
scripts/plugins.mjs              插件检测与安装，两个安装脚本共用
scripts/launch.sh、launch.ps1    启动器模板，安装时复制到安装目录
tests/installers.py              不联网的安装、续装、故障恢复与启动参数回归测试
```

## 验证情况

审计条目、翻译修复、验证方法和上游依赖限制见 [审计修复与验收](audit-remediation.md)。

本轮在独立源码目录和隔离依赖仓库中验证指定 Node / pnpm 的依赖安装、原生模块、完整构建及宿主与客户端类型检查。界面测试覆盖配置保存、并发编辑、会话与控件行为；联网开关另有真实服务恢复和无密钥会话重放。翻译回归使用本地端点和受控模型流，检查空白译文、重试、缓存及窄屏显示，不调用付费模型。

发行仓库提供摘要检查、安装中断与续装夹具，并在持续集成中运行 Linux、macOS 和 Windows 检查。浏览器检查使用 Chromium 与 WebKit；会改动工作区的两个用例先单独运行，再并行执行本轮涉及的 25 个测试文件。完整上游浏览器测试集的已知失败另记在验收说明中。具体通过结果应以对应提交的检查记录为准。

数据兼容夹具验证官方事件可读、新增必需事件被旧版明确拒绝，以及原件与备份保留；它不代表所有历史数据库都已验证迁移。原生桌面版本的 Electron 兼容性和未发布修复的构建依赖告警单独记录，不把浏览器版验收扩大为桌面安全认证。

## 许可证

MIT，见 [LICENSE](../LICENSE)。DeepSeek Harness 本身也是 MIT 许可证，版权归 DeepSeek。补丁里带的 Lobe Icons 图标是 MIT 许可证，说明在补丁新增的 `THIRD_PARTY_NOTICES.md` 和 `licenses/` 里。图标动画参照 lucide-animated（MIT）的动作设计，用 CSS 重新实现，没有复制它的代码。三个社区插件由各自作者发布，许可证以它们的仓库为准。

## English

DSH-UI is a UI rework of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), shipped as one patch against the official commit `22ddee37` (0.2.1-rc.3). The installer downloads that source, applies `patches/dsh-ui.patch`, runs `pnpm install --frozen-lockfile` and `pnpm run build`, installs three community plugins (dsh-context, dsh-better-sidebar, dsh-plugins-store) at tested versions, and writes a launcher. Among the UI changes, tool calls show a wrench, and product icons play a short hover motion modeled on lucide-animated unless reduced motion is on.

```bash
git clone https://github.com/iroha1145/DSH-Modern-UI.git && cd DSH-Modern-UI && ./scripts/install.sh
~/.dsh-ui/dsh-ui
```

Plugins already present in the profile are skipped. A different installed version, or one declared without its files, is reported and left alone. When something has to be installed, the installer first stops if the profile's `node_modules` was linked from another pnpm store. Re-running is safe: an interrupted install resumes, a finished one is not rebuilt, and the recorded data directory and profile are kept. Node does not need to be preinstalled: the installer fetches the official Node 24.22.1 release (checked against its SHASUMS256.txt) and pnpm 11.28.5 into the install directory. It needs curl, tar, working Git (checked before installation writes; binary patch changes cannot use POSIX patch), a C compiler (Xcode Command Line Tools or build-essential), glibc on Linux, and about 3 GB of disk. The reconstructed source and isolated dependency store are checked on macOS (Apple silicon). CI runs the POSIX installer fixtures on Linux/macOS and real pinned-runtime preparation, resume and launcher checks on Windows; check the results for the exact commit. The browser release does not certify the native Electron application.


### Installer regression fixtures

Run `python3 tests/installers.py`. These tests execute the real Bash scripts with isolated homes, real tar extraction and Git binary patch application, and fake downloads/Node/pnpm subprocesses. They cover early failure without usable Git, unchanged existing installs on that failure, standalone help and bootstrap argument forwarding, binary PNG deletion, preparation and failed dependency/build retries, explicit overrides, active versus desired settings, fresh default isolation, backup contents, partial runtimes, corrupt archives, interrupted runtime switching, and CLI argument preservation. They do not certify a full cold build or Windows execution. Windows changes require a Windows runner; the Bash fixture does not substitute for that check.

Fresh installs use `<install-dir>/data`, ignoring ambient `DSH_HOME`. Use `--home` / `-DshHome` explicitly to share or import data. Stop every writer before copying or backing up a data home. The installer snapshots existing nonempty data before first mutation; retain the printed `data-backups` archive. Stock 0.2.1-rc.3 cannot read sessions containing required `web/search` events. For rollback, restore the pre-install snapshot into a new empty directory and point stock DSH there; post-snapshot changes remain only in the modern copy. Default data and backups live inside the install directory: preserve them before uninstalling.
