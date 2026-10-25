# DSH-UI

DSH-UI 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的一套界面改版。它以补丁形式发布：安装脚本下载固定版本的官方源码，打上本仓库的补丁，装好依赖并构建，再顺带装上三个社区插件。

[English](#english)

## 改了什么

- **模型选择器**：输入框里的模型卡片显示厂商的黑白图标（对不上时显示首字母，可以在设置里改），按模型显示它支持的推理等级，并列出速度、质量、成本和 models.dev 上的价格。
- **编队页**：会话标签栏新增「编队」，用树状图显示子智能体的状态、模型、用量和耗时。
- **回答**：思考过程可以折叠，来源显示为编号标签，末尾有相关问题，可以开关网页搜索，回答里的交互组件显示正常。交互组件里的链接要在页面上点确认才会打开，超过高度上限的组件可以在内部滚动。
- **输入框**：下方的读数垫了一层毛玻璃，经过的正文不会和它叠在一起。
- **排版**：按 [TypeUI](https://www.typeui.sh/) 的规则调整了行高、换行、阅读宽度、等宽数字和间距。回答正文每行最多 65 个字符宽（约 41 个汉字），行高 1.6；代码块和表格仍占满整栏。字族、字号、字重都没有改。
- 以及之前的一批界面修复。

补丁基于官方 0.2.1-rc.3（提交 `22ddee37`）。

## 安装

需要：

- macOS，或使用 glibc 的 Linux（Alpine 这类 musl 系统不行）。Windows 有 PowerShell 脚本，但还没有实测。
- `curl`、`tar`，以及 `git`（没有可用的 git 时用 `patch`）。
- C 编译器。构建时要编译一个原生模块：macOS 装 Xcode 命令行工具（`xcode-select --install`），Linux 装 `build-essential`（或 gcc、clang）。个别依赖没有预编译包时还会用到 `python3`。
- 约 3 GB 磁盘空间，能访问 GitHub、nodejs.org 和 npm。

不用预先装 Node.js：安装脚本会从 nodejs.org 下载官方的 Node 24.13，核对官方校验值后放进安装目录，再用它装 pnpm 11.28.5，不改动系统里的 Node。

```bash
git clone https://github.com/iroha1145/DSH-Modern-UI.git
cd DSH-Modern-UI
./scripts/install.sh
```

也可以不克隆，直接运行：

```bash
curl -fsSL https://raw.githubusercontent.com/iroha1145/DSH-Modern-UI/main/scripts/install.sh | bash
```

Windows（未实测）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

装好后启动：

```bash
~/.dsh-ui/dsh-ui
```

它会打印一个带 token 的本机地址，用浏览器打开即可。后面加的参数会交给 DSH 命令行，比如 `~/.dsh-ui/dsh-ui web --port 3090`；启动器只会在配置名后面插入一个隐藏编队标签的叠加层（见下文）。DSH 在你的主目录里运行，参数里的相对路径从主目录算起。

### 安装脚本做了什么

1. 准备私有的 Node 24.13 和 pnpm 11.28.5（已经有了就跳过）。
2. 从 GitHub 下载官方源码包，打上 `patches/dsh-ui.patch`。打补丁前会核对补丁文件的校验值；在 macOS 和 Linux 上，有 git 时还会核对源码包对应的提交。
3. 用 `pnpm install --frozen-lockfile` 装依赖，再运行 `pnpm run build`。
4. 在安装目录里放启动器 `dsh-ui`，记下数据目录和配置名。
5. 安装社区插件，已经装过的跳过（规则见下）。插件这一步出错时，启动器已经在了。

脚本会在安装目录里记下进度。解压、打补丁、装依赖或构建中途断了，再运行一次会接着做；同一版本已经装好，再运行不会重新下载和构建，只会刷新启动器并检查插件。重跑时不加 `--home`、`--profile`，会沿用上次记下的数据目录和配置名。安装目录里只能有安装脚本自己建的东西，指向一个放着别的文件的目录会被拒绝。

### 选项

| 选项 | 说明 |
|---|---|
| `--dir <目录>` | 安装目录，默认 `~/.dsh-ui` |
| `--home <目录>` | DSH 数据目录（`DSH_HOME`）。默认沿用上次安装记下的；第一次安装用 `$DSH_HOME`，没有则 `~/.dsh` |
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
node scripts/plugins.mjs --check --home ~/.dsh
```

dsh-context 自带一个编队标签，和 DSH-UI 的编队页重复。启动器在 dsh-context 装着时会叠加 `overlays/context-fleet-tab.yml` 把它隐藏，不改你的配置文件。想保留它，启动前设置 `DSH_UI_CONTEXT_FLEET_TAB=show`。

## 数据目录

默认和官方 DSH 共用 `~/.dsh`，会话、设置和插件都在这里。如果你同时还在用其他版本的 DSH，建议用 `--home` 给 DSH-UI 单独指定一个目录。启动器总是用安装时记下的数据目录，不受环境变量 `DSH_HOME` 影响；要换目录，带上新的 `--home` 重跑安装脚本。

## 更新和卸载

更新：拉取本仓库的新版本后再运行一次安装脚本。版本变了时脚本会提示加 `--force`，旧目录会改名保留，确认没问题后可以删掉。

卸载：删掉安装目录 `~/.dsh-ui`。插件留在数据目录的配置里，要移除可以运行 `~/.dsh-ui/dsh-ui plugin --profile web remove <插件名>`（先移除插件，再删安装目录）。

## 仓库结构

```text
dsh-ui.json                      官方版本、补丁校验值、Node 和 pnpm 版本、插件清单
patches/dsh-ui.patch             从官方 22ddee37 到 DSH-UI 的全部改动
scripts/install.sh               安装脚本（macOS、Linux）
scripts/install.ps1              安装脚本（Windows，未实测）
scripts/plugins.mjs              插件检测与安装，两个安装脚本共用
scripts/launch.sh、launch.ps1    启动器模板，安装时复制到安装目录
overlays/context-fleet-tab.yml   启动时叠加的配置，隐藏 dsh-context 的编队标签
```

## 验证情况

在 macOS（Apple 芯片）上验证过：

- 在中文和英文 UTF-8 终端里、只用系统自带工具，脚本能下载官方 Node 和 pnpm，下载源码包并打上补丁；结果和作者正在运行的源码逐字节一致。
- 用这个私有 Node 能编译构建里的原生模块。
- pnpm 11.28.5 按打完补丁的依赖重新解析，锁文件没有任何变化，并通过它的供应链检查。
- 在全新的数据目录里，脚本能初始化配置并装上三个插件；再运行一次三个都跳过，配置文件不变。装了别的版本、声明了但缺文件这两种情况只提示、不动它们；pnpm 仓库对不上时，在调用 pnpm 之前停下。
- 中断后接着装、另一个版本已装好、目录不是安装器建的、重跑时沿用上次的数据目录，这几条分支都按说明工作。
- 启动器（包括通过符号链接调用）能启动 DSH，三个插件都加载，dsh-context 的编队标签被隐藏。
- 2026 年 10 月 25 日做过一轮前端审查，查出的 8 个问题修好了 7 个，修复后的前端测试和浏览器测试都通过。

没有验证过：

- 在一台全新的机器上从零完整安装里「装依赖并构建」这一步。作者机器磁盘空间不够，这一步是在内容相同、已有依赖的源码树上验证的，构建和测试都通过。
- Linux，以及 Windows 脚本（只做过代码审查，没有运行过）。

已知问题：在设置里保存模型资料时，DSH 会把这个模型配置的整段基础资料一起写进你的配置文件。之后基础资料再改动，这个模型不会跟着变。这是 DSH 配置编辑器原有的写法，这一版还没有改。

## 许可证

MIT，见 [LICENSE](LICENSE)。DeepSeek Harness 本身也是 MIT 许可证，版权归 DeepSeek。补丁里带的 Lobe Icons 图标是 MIT 许可证，说明在补丁新增的 `THIRD_PARTY_NOTICES.md` 和 `licenses/` 里。三个社区插件由各自作者发布，许可证以它们的仓库为准。

## English

DSH-UI is a UI rework of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), shipped as one patch against the official commit `22ddee37` (0.2.1-rc.3). The installer downloads that source, applies `patches/dsh-ui.patch`, runs `pnpm install --frozen-lockfile` and `pnpm run build`, installs three community plugins (dsh-context, dsh-better-sidebar, dsh-plugins-store) at tested versions, and writes a launcher.

```bash
git clone https://github.com/iroha1145/DSH-Modern-UI.git && cd DSH-Modern-UI && ./scripts/install.sh
~/.dsh-ui/dsh-ui
```

Plugins already present in the profile are skipped. A different installed version, or one declared without its files, is reported and left alone. When something has to be installed, the installer first stops if the profile's `node_modules` was linked from another pnpm store. Re-running is safe: an interrupted install resumes, a finished one is not rebuilt, and the recorded data directory and profile are kept. Node does not need to be preinstalled: the installer fetches the official Node 24.13 release (checked against its SHASUMS256.txt) and pnpm 11.28.5 into the install directory. It needs curl, tar, git or patch, a C compiler (Xcode Command Line Tools or build-essential), glibc on Linux, and about 3 GB of disk. Tested on macOS (Apple silicon) except the dependency install and build of a from-scratch run; Linux and the Windows script are untested.
