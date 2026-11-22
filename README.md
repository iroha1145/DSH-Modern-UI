<div align="center">

# DSH Modern UI

给官方 DeepSeek Harness（DSH）换上一套更清爽、更顺手的现代界面

简体中文 · [English](README.en.md)

<p>
  <a href="https://www.npmjs.com/package/@iroha1145/dsh-modern-ui"><img src="https://img.shields.io/npm/v/@iroha1145/dsh-modern-ui?style=for-the-badge&logo=npm&logoColor=white&color=4D6BFE" alt="npm"/></a>
  <img src="https://img.shields.io/badge/DSH-0.2.x-4D6BFE?style=for-the-badge" alt="DSH 0.2"/>
  <img src="https://img.shields.io/badge/语言-8%20种-0F9D58?style=for-the-badge" alt="8 种界面语言"/>
  <img src="https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT"/>
</p>

[界面预览](#-界面预览) · [功能特性](#-功能特性) · [安装](#-如何安装三选一) · [常见问题](#-常见问题) · [兼容矩阵](docs/compatibility.md) · [更新记录](CHANGELOG.md) · [问题反馈](https://github.com/iroha1145/DSH-Modern-UI/issues)

</div>

<p align="center">
  <img src="docs/assets/readme/conversation-light.webp" width="1200" alt="对话页：思考过程分组、工具调用卡片与内联代码改动">
</p>

npm 包名：[`@iroha1145/dsh-modern-ui`](https://www.npmjs.com/package/@iroha1145/dsh-modern-ui)。它**只升级界面外观与交互体验**，不改动官方底层程序，也不会动你的历史对话和原有配置——装上刷新就能用，随时可以一键切回官方原版界面。

## 📸 界面预览

下面是桌面浏览器里的完整窗口，左列浅色、右列深色。除首页外，截图来自本地隔离实例：模型是脚本化的测试模型，对话内容和数字都是示例，没有调用外部服务。

| 界面 | 浅色 | 深色 |
| --- | --- | --- |
| 首页 | ![首页 · 浅色](docs/assets/home-light.webp) | ![首页 · 深色](docs/assets/home-dark.webp) |
| 对话页 | ![对话页 · 浅色](docs/assets/readme/conversation-light.webp) | ![对话页 · 深色](docs/assets/readme/conversation-dark.webp) |
| 改动对比 | ![侧栏改动对比 · 浅色](docs/assets/readme/diff-preview-light.webp) | ![侧栏改动对比 · 深色](docs/assets/readme/diff-preview-dark.webp) |
| 编队视图 | ![编队视图 · 浅色](docs/assets/readme/fleet-light.webp) | ![编队视图 · 深色](docs/assets/readme/fleet-dark.webp) |
| 设置 | ![通用设置 · 浅色](docs/assets/readme/settings-presentation-light.webp) | ![通用设置 · 深色](docs/assets/readme/settings-presentation-dark.webp) |

### 组件特写

| 组件 | 浅色 | 深色 |
| --- | --- | --- |
| 模型面板 | ![模型选择器 · 浅色](docs/assets/readme/closeup-model-light.webp) | ![模型选择器 · 深色](docs/assets/readme/closeup-model-dark.webp) |
| 提问卡片 | ![提问卡片 · 浅色](docs/assets/readme/closeup-ask-light.webp) | ![提问卡片 · 深色](docs/assets/readme/closeup-ask-dark.webp) |
| 问答时间轴 | ![问答时间轴 · 浅色](docs/assets/readme/closeup-timeline-light.webp) | ![问答时间轴 · 深色](docs/assets/readme/closeup-timeline-dark.webp) |
| 划词引用 | ![划词引用 · 浅色](docs/assets/readme/closeup-quote-light.webp) | ![划词引用 · 深色](docs/assets/readme/closeup-quote-dark.webp) |

## ✨ 功能特性

### 阅读更清爽，长对话不迷路

- **思考过程自动收纳**：AI 的长篇思考按「分析 / 搜索 / 编辑」等阶段分组折叠，回答结束后自动收起，只留正文；需要时点开任意一步查看细节。配合官方翻译插件可以直接对照查看译文。
- **问答时间轴**：对话右侧有一列轮次标记，鼠标移上去能预览那一轮的问题和回答开头，点一下直接跳过去。
- **对话宽度可调**：在「设置 → 通用 → 对话宽度」选「阅读 / 标准 / 宽屏」，或选「自定义」后拖动两侧细线，松手即保存。
- **长内容一键折叠**：超长代码块、代码改动对比（Diff）、数学公式，以及侧栏里的文件和方案预览都能折叠、展开。

| 标准宽度 | 自定义宽度 | 宽度设置 |
| --- | --- | --- |
| ![标准宽度](docs/assets/conversation-width-standard.jpg) | ![拖动两侧细线自定义宽度](docs/assets/conversation-width-custom.jpg) | ![对话宽度设置项](docs/assets/conversation-width-settings.jpg) |

### 把文字回答变成可交互的卡片

- **可视化组件**：开启后，AI 可以直接用数字卡片、图表（柱状、折线、饼图、散点，可展开原始数据表）、流程图、对比表格、步骤条、闪卡，甚至带滑块的小计算器来回答。组件跟随界面的字体和明暗主题。
- **智能追问**：回答末尾附带推荐的下一个问题，点一下就接着聊。
- **分段交付成果**：复杂任务先交出已经完成的部分，不必干等最后一步。

| 浅色 | 深色 |
| --- | --- |
| ![数字卡片与折线图 · 浅色](docs/assets/readme/visual-chart-light.webp) | ![数字卡片与折线图 · 深色](docs/assets/readme/visual-chart-dark.webp) |
| ![流程图、滑块计算器与推荐追问 · 浅色](docs/assets/readme/visual-flow-light.webp) | ![流程图、滑块计算器与推荐追问 · 深色](docs/assets/readme/visual-flow-dark.webp) |
| ![纸感玻璃组件 · 浅色](docs/assets/openui-paper-glass-light.png) | ![纸感玻璃组件 · 深色](docs/assets/openui-paper-glass-dark.png) |

### 工具调用与改动一目了然

- **清晰的过程卡片**：终端命令、文件读写、代码搜索、网页搜索、待办清单都有独立的行和图标；文件编辑直接在对话里显示增删行，点开「已编辑」卡片可以在右侧栏左右对照查看完整改动。
- **任务清单**：AI 列出的待办步骤固定在输入框上方，每一步完成后打勾。
- **AI 向你提问与方案确认**：遇到需要你拍板的地方，AI 会弹出带选项的提问卡片（可以多题翻页、跳过或自己填写），侧栏里的会话会标出「待回答」；AI 拿出的执行方案也以卡片展示，等你确认。

### 子智能体「编队」视图

主对话派出多个子助手同时干活时，切到顶部的「编队」标签，能像看组织架构图一样看到每个子任务的模型、用量、耗时和完成状态，点开任意一个查看详情。

### 输入与选模型更顺手

- **模型与思考强度面板**：模型按厂商分组，每个模型下有一句用途说明，右侧用色条对比速度、质量和成本；鼠标移到哪个模型，底部就显示它大约几秒出首字和每百万 token 的价格。同一个面板里还能选推理等级；第三方模型插件提供的专属开关（比如上下文长度、极速模式）会自动收纳到输入框旁边。
- **划词引用**：选中聊天里的任意文字，点「引用文本」就能带着这段话继续追问。
- **原图直传与排队发送**：支持截图粘贴、原图拖入输入框或拖出保存；AI 回复途中可以继续输入，下一条消息会排队发送。

### 多语言、多主题与手机端

内置 **8 种界面语言**（中、英、日、西、法、德、俄、葡）和浅色 / 深色 / 跟随系统主题。手机窄屏专门重排了抽屉侧栏、输入框和全屏设置页，可视化组件会按屏幕宽度自动换行。在插件市场里还能直接阅读插件的完整图文说明。

<table>
  <tr><th>首页</th><th>侧栏抽屉</th><th>对话</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/readme/mobile-home-light.webp" width="240" alt="手机首页 · 浅色" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-drawer-light.webp" width="240" alt="手机侧栏抽屉 · 浅色" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-chat-light.webp" width="240" alt="手机对话 · 浅色" /></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/readme/mobile-home-dark.webp" width="240" alt="手机首页 · 深色" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-drawer-dark.webp" width="240" alt="手机侧栏抽屉 · 深色" /></td>
    <td align="center"><img src="docs/assets/readme/mobile-chat-dark.webp" width="240" alt="手机对话 · 深色" /></td>
  </tr>
</table>

---

## 🚀 如何安装（三选一）

### 方式一：已经装好官方 DSH 网页版（最推荐）

> **准备条件**：已安装官方 DSH（`0.2.1-rc.2` 及以上的 `0.2` 系列版本）和 `pnpm`，且至少启动过一次 `dsh web`。

1. 打开终端，执行这一行命令：
   ```bash
   dsh plugin --profile web add @iroha1145/dsh-modern-ui
   ```
2. **刷新浏览器页面**，新界面即可生效。

- **离线安装**：从 [Releases](https://github.com/iroha1145/DSH-Modern-UI/releases) 下载 `modern-ui.tgz`，运行 `dsh plugin --profile web add ./modern-ui.tgz`（不支持直接用 Git 仓库地址安装）。

### 方式二：电脑还没装 DSH，或想单独隔离安装（一键包）

适合零基础新用户，或希望程序与数据都放在独立文件夹、不影响电脑现有环境的用户：

1. 前往 [Releases](https://github.com/iroha1145/DSH-Modern-UI/releases) 下载 `installer.zip` 并解压，进入解压后的 `plugin-preview` 文件夹。
2. 执行安装脚本（把路径换成你想存放的空文件夹，安装器会自动配齐运行环境并备份数据）：
   - **Windows（PowerShell）**：
     ```powershell
     powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH-Modern/program' -DataHome 'D:/DSH-Modern/data'
     ```
   - **macOS / Linux**：
     ```bash
     sh ./install.sh '/path/to/program' '/path/to/data'
     ```

更多进阶用法（复用已有后端、回滚、迁移配置等）见[安装详情](docs/install.md)。

### 方式三：官方桌面客户端 Desktop（部分支持）

1. 先打开一次官方 Desktop，然后**完全退出**。
2. 在 Desktop 菜单「应用 → 管理 dsh 命令…」中将自带的 `dsh` 加入终端，然后执行：
   ```bash
   dsh plugin --profile desktop add @iroha1145/dsh-modern-ui
   ```
3. 重新打开 Desktop 即可。（注：桌面版首次引导会自动跳过，多窗口、原生文件拖出等桌面专有能力仍在逐步适配，详见 [Desktop 验收记录](docs/compatibility/desktop-0.2.1-rc.5.md)。）

---

## 💡 首次使用小贴士

- **想让 AI 画图表和交互卡片？**
  安装后默认不改动模型提示词；请打开左下角 **「设置 → 通用」**，开启 **「回答可视化组件」**（会向模型附加组件使用说明；需要 Chrome/Edge 111+、Safari 16.2+ 或 Firefox 121+ 浏览器）。同一页还可以按需开启 **「分段交付成果」**；如果你有 [TypeSafe](https://typesafe.ai) 的 `TYPESAFE_API_KEY`，也可以在同一页填入以启用可选的「Jev 呈现建议」。
- **找不到原来的界面设置？**
  用命令行直接安装时，官方原有的界面设置会原封不动保留给原版界面使用；你可以在 Modern UI 的「设置 → 通用 / 外观」里重新选一次喜欢的主题、语言和折叠方式。

---

## 🔄 切回原版界面或卸载

- **临时切回官方界面**：打开「插件管理」，关闭**整个 `@iroha1145/dsh-modern-ui` 插件包**（注意不要只关里面的单个子项），然后刷新浏览器即可恢复原版界面。
- **彻底卸载**：在终端运行以下命令后刷新浏览器（桌面版把 `web` 换成 `desktop` 并重启客户端）：
  ```bash
  dsh plugin --profile web remove @iroha1145/dsh-modern-ui
  ```

---

## ❓ 常见问题

- **装完之后界面没变化？**
  请先刷新浏览器页面（桌面版需完全退出重开）；若仍未生效，请检查安装命令里的 `--profile` 是否与你当前运行的一致（网页版为 `web`，桌面版为 `desktop`），并确认「插件管理」里整个 `@iroha1145/dsh-modern-ui` 处于启用状态。
- **能和其他社区插件一起用吗？**
  按官方标准扩展接口开发的插件通常都能共存（已完整验证 `dsh-context@0.75.1` 与 `dsh-better-sidebar@0.28.0`）。但如果另一个插件也要整体替换聊天或页面主布局，则会产生冲突。
- **官方 DSH 更新后还能用吗？**
  仓库每天会自动检测官方新版本兼容性，遇到不兼容会自动创建 `upstream` 提醒 [Issue](https://github.com/iroha1145/DSH-Modern-UI/issues)；升级前可先查看[兼容矩阵](docs/compatibility.md)。

---

## 🛠️ 本地构建（开发者）

需要 Node.js 24：

```bash
npm ci --ignore-scripts
npm run build      # 编译插件到 packages/modern-ui/lib
npm run preview    # 生成离线包与一键安装器到 .artifacts/plugin-preview
```

参与开发请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)，各版本详细改动见 [CHANGELOG.md](CHANGELOG.md)。

## 📚 详细文档

[安装详情](docs/install.md) · [兼容矩阵](docs/compatibility.md) · [系统架构](docs/architecture.md) · [旧数据迁移](docs/data-migration.md) · [宿主兼容层](docs/host-compat.md)

## License

[MIT](LICENSE)。从 DeepSeek Harness 派生的部分保留上游版权，详见 [`THIRD_PARTY_NOTICES.md`](packages/modern-ui/THIRD_PARTY_NOTICES.md)。

## 友情链接

- [LINUX DO](https://linux.do/)
