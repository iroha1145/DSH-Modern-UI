# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。插件版本与官方宿主版本的对应关系见[兼容矩阵](docs/compatibility.md)。

## [Unreleased]

## [0.1.2] - 2026-11-01

### Changed

- 「回答可视化组件」追加的提示词改为更倾向可视化和分段作答，标准、PTC 和创造模式都会收到；极简模式（minimal）按 DSH 的设计只用一句固定的系统提示词（人设设了 `complete: true`，其他提示词段一律不加），所以和以前一样收不到这段提示词：讲解、分析、对比、推荐、计划、调研和科普时，内容有形状（选项、对比、架构或流程、机制、步骤、数字和趋势、真实事物的样子）就优先用组件，长回答可以每部分各配一个；人物、地点、建筑、作品、物种、产品、设备、菜品这类有样子的东西配真实图片，组件卡片里用 SearchImage 按名字找图。需要多次调用工具或分几部分的回答，先把已经确定的一部分（概览、第一段或框架）写出来再继续下一次调用，后面的部分接着前面写，不重复；不需要工具的回答仍是一次写完。组件代码改为逐段写：每个部分的组件后面紧跟它自己用的数据，不再把所有数据留到最后，所以每段在后面还在生成时就已经画完。`jev_presentation_advice` 工具的说明补了一句：Jev 的回答只是参考，最终按模型自己对材料和用户意愿的判断来定（展示提示词本身仍不提 Jev）。纯文字请求、代码、命令和文件内容仍按 Markdown 写。
- 「收起后显示的回复」的「仅最终回答」改名为「最终回答和可视化」：模型分几段作答、段与段之间先查资料再接着画时，前面带可视化组件（完整的 `openui-lang` 代码块）的段落在回合结束后不再折进「已完成」，和最终回答一起留在外面，复制回答时也一并带上；这些段落的思考过程、只有文字的过渡段和工具调用照旧收起。选「全部回复」时显示的内容不变，只是复制回答同样会带上这些段落。

## [0.1.1] - 2026-11-01

### Added

- 可选的 TypeSafe Jev 呈现建议：在「设置 → 通用」里填入 TypeSafe 密钥（存进 DSH 凭据文件，也可以用 `TYPESAFE_API_KEY` 环境变量）并开启「回答可视化组件」后，主会话的模型多一个 `jev_presentation_advice` 工具，拿不准怎么展示时可以请 Jev 参谋。插件不会自动调用 Jev，也不往提示词里加任何建议；调不调用由模型决定，工具说明写明不调用也完全正常，用不用组件不取决于它。调用时插件附上这一轮用户的请求，模型写一段最多 600 字的内容结构概述；每一轮最多问一次，同样的概述再问会重复上次的回答，换了概述不再给新判断。Jev 判断为纯文字表示没有额外建议，判断为某种组件也只是可以考虑的部分候选。密钥、开关或「回答可视化组件」变化时工具随即出现或消失，子代理看不到它；没有密钥、超时或出错时工具只回答这次没有建议，回合照常进行。

### Changed

- 回答里的交互组件改用 [OpenUI](https://github.com/thesysdev/openui)：模型写 `openui-lang` 代码块，插件用 OpenUI 渲染器边生成边画出卡片、流程图、图表、表格、照片和能自己计算的小工具（滑块、输入框改了数值当场重算，不用再问模型）。组件里的「发给助手」按钮只把内容放进输入框，由你确认后发送。组件需要 Chrome/Edge 111、Safari 16.2、Firefox 121 或更新的浏览器（官方 Desktop 内置的 Electron 满足）。组件库取自 thesysdev/open-intelligent-ui，按 DSH 主题配色，补了流程图组件，去掉了地图、视频和 CDN 脚本。原先借鉴 CopilotKit/OpenIntelligentUI 的 HTML 沙箱组件已删除，旧回答里写成 HTML 的 `openui` 代码块改为按普通代码显示。
- 「回答可视化组件」开启后追加的提示词从约 8 KB 增加到约 30 KB（约 7,000 个词元）。
- 组件的圆角和胶囊形徽章与 DSH 界面一致，折线图和单层面积图画成平滑曲线（堆叠面积图保持直线边界），柱子顶部为圆角，图表和滑块里的小数不会显示成 0。一小段代码可能展开出几十万个元素、卡住页面，所以组件在求值和绘制时按实际步数设上限，超出后停下并显示源代码；为此构建时给打包进插件的 `@openuidev/lang-core` 1.0.2 的 `@Each` 加了计数（只改插件里的副本，版本不符时构建直接失败）。

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

[Unreleased]: https://github.com/iroha1145/DSH-Modern-UI/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/iroha1145/DSH-Modern-UI/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/iroha1145/DSH-Modern-UI/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iroha1145/DSH-Modern-UI/releases/tag/v0.1.0
