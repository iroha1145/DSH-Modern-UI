# 官方成品与 Modern UI 插件迁移

更新日期：2026-10-27。状态：**阶段性实现；联网安全关卡被官方 SDK 恢复路径阻塞，尚未达到最终交付标准**。

本文件记录当前工作状态和可重复证据，不把旧补丁版测试结果作为插件版验收结果。原补丁及其维护流程暂时保留用于对照；新架构不得修改官方发布文件。

## 已核验的基线

- Modern UI 最新 `main`：`a9f4c370fa480c9a17d5c9a79cb83aeba26bdf0d`，2026-10-27 通过 GitHub branches API 与独立 clone 一致核验。
- 实施分支：`codex/official-plugin-migration`，独立 checkout，无继承的未提交改动。
- 旧补丁的源码基线：`22ddee3792402c3e70ec5f86a63c3e3e895a2f60`。它不等于官方 rc.3 产品 tag。
- GitHub 最新产品 Release 页为 `dsh-v0.2.1-rc.3`，tag 对应 `1f81c047fc48fa190a683e469daa699857e9afe8`。
- npm 的 `@deepseek-ai/dsh`：`latest=0.2.1-rc.2`，`next=0.2.1-rc.4`，`alpha=0.2.1-alpha.5`。**首个消费候选选择已发布的 `0.2.1-rc.4`**；尚未承诺其满足全部兼容条件。GitHub 同名产品 tag 返回 404，不能用 rc.3 源码代替 rc.4 成品证据。
- `@deepseek-ai/dsh@0.2.1-rc.4`：[npm tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.4.tgz)，integrity `sha512-8gxl6zOi6vx1sDolH+vjh9txrpbXD+t74Z2YfWkEBtR3xP2YEtk0bbLkgLZRnYQgDxCoXitXyXDKn5k0+6iXrg==`。
- 对照用 `@deepseek-ai/dsh@0.2.1-rc.3`：[npm tarball](https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.1-rc.3.tgz)，integrity `sha512-H+E9HLnHf7fJqzen84Z9Bq8ggb5xbrcbyhZjXTJLE9NabHr3zteGvTRvdvGkxPl4ov80is4WLglFmSo+/olJjg==`。
- 开发/消费验证固定 Node `24.22.1`、pnpm `11.28.5`；Windows x64 Node ZIP SHA-256 `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5` 已与官方 `SHASUMS256.txt` 匹配。系统既有 Node `24.18.0`、pnpm `11.25.0` 不作为验收运行时。

## 架构与边界

生产候选只消费官方 npm/官方完整运行包。Modern UI 在本项目开发时构建，消费者只安装实际压缩包，通过官方 bundle/profile、client 和 Host 扩展点加载。React、Cordis 与宿主服务共享官方实例；不覆盖官方前端或运行代码。不在本轮发布 npm、GitHub Release、镜像或部署。

联网关卡先用真实发布物和无密钥模拟调用核验。若官方无法在插件缺失、普通 profile、直接 CLI 及导出导入时保持关闭联网意图或拒绝继续，旧数据不转换为可执行的新会话；保留原件并隔离。此时仍继续 UI、安装和打包的独立工作，但不把整体目标标成完成。

## 阶段

| 阶段 | 状态 | 已知证据 / 下一步 |
| --- | --- | --- |
| M0 基线和地图 | 已建立 | 见本页、[UI 地图](plugin-ui-map.md)、[Host 记录](plugin-host-compat.md)及各项证据 |
| M1 真插件及联网 PoC | 插件已运行；安全关卡失败 | 主执行者完整重跑 15 阶段；官方 SDK profile 在策略插件卸载后仍执行搜索 |
| M2 完整 UI 与 Host | 部分完成 | 真实 Web 的模型/富文本/编队/交互/语言已有证据；完整 UI、翻译槽共存等仍在复核 |
| M3 数据 | 预检/隔离已实现；转换阻塞 | 只读官方 v4 快照、保存原件、拒绝不安全转换；没有安全迁移旧会话的新表示 |
| M4 真实消费安装 | Windows 阶段性通过 | 已有官方实例及下载私有运行时的全新安装都实际执行；其余平台待 CI |
| M5 默认入口与交付 | 未完成 | 根据硬关卡实际结果决定默认路径，不能用 README 代替实现 |

## 平台矩阵

| 平台 | 官方成品与原生资源 | 零编译完整安装 | 真实运行 |
| --- | --- | --- | --- |
| Windows x64 | npm 成品与预编译原生依赖已运行 | 全新私有 Node/pnpm + 官方包 + tgz，安装脚本全部禁用，原生运行通过 | Web 启动/认证、文件锁、子进程和 PTY 已验；最终浏览器复核进行中 |
| Linux x64 glibc | 检查中 | 未验证 | 无本地执行证据，准备 CI |
| Linux arm64 glibc | 检查中 | 未验证 | 无本地执行证据，准备 CI |
| macOS x64 | 检查中 | 未验证 | 无本地执行证据，准备 CI |
| macOS arm64 | 检查中 | 未验证 | 无本地执行证据，准备 CI |
| Windows arm64 / musl | 未纳入支持 | 未验证 | 不声明支持 |

## 已运行检查

1. 独立 clone 最新 Modern UI main，核对 commit 并建立本地分支。
2. GitHub Release/refs 和 npm `view` 查询；发现 npm rc.4 与 Release 页差异，消费验收以真实包为准。
3. Node 官方 ZIP 下载 SHA-256 核对，实际 `node --version` 为 `v24.22.1`；私有 `pnpm --version` 为 `11.28.5`。
4. 初次隔离 npm 安装解析 614 个包、提示 5 个待批准脚本，这一步本身不构成原生验收。后续改用禁止所有生命周期脚本的正式消费安装，并实际调用 JSONL 锁、托管子进程和 PTY。
5. 主执行者在固定 Node 下完整执行 `scripts/compatibility/run-policy-gate.mjs <独立官方消费者>`：15 阶段按断言完成，包括真实 pack/install、Web 关闭联网与重启、缺失/禁用拒绝、官方导出和导入、SDK 绕过、headless 拒绝、实际 npm uninstall 和卸载后重测。进程退出 0 表示**反例成功复现**，结果仍为 `gate: blocked`。
6. Host 替代及数据回归：翻译空白拒绝、Google/Bing 旧空白缓存追加修复/重启命中、官方 Controller 冷会话错误身份、307/308 同源/跨源目标零访问、可读格式/策略历史/待处理命令/ZIP 重名/多帧 Zstd/校验与总大小限制/隔离/恢复/配置副本映射。详见两份专项记录。
7. 安装独立审查修复了依赖闭包遗漏、已有后端来源未证明、路径别名、已安装社区 manifest 丢失及崩溃残留锁。正常 npm 布局的 614 个依赖，以及全新 pnpm 布局的 565 个实际依赖，都已与各自 registry 精确发行 tarball 逐文件比较；数量差异来自布局和重复实例，不能只比较目录相邻包。
8. 全新 Windows 消费实际下载 Node/pnpm/官方 npm 发布物，安装使用 `--ignore-scripts`，随后原生与真实 Web 自检通过。此结果不代表尚未运行的 Linux/macOS 或所有 UI 功能通过。

## 联网安全阻塞与决定

官方 rc.4 不认识必需 `web/search`。纯 `plugin:` 记录可读，但缺失策略时仍可执行搜索。策略插件自己拥有 preset 的方案在普通 Web/headless 有拒绝保护；然而官方内置 `sdk` profile 的 `session/resume` 直接进入 `agents.resume`，忽略记录的 preset。

对关闭联网的原会话、保留全部事件与 preset 的存储 API 副本、官方 canonical JSONL 导出后导入的副本，SDK 均看见 `web_search` 且工具计数为 1。策略包实际卸载后仍复现，运行前后 42,722 个官方文件 SHA-256 不变。没有改校验器或通过 Modern UI 包装器制造该结果。

最小复现、已检查的公开接口、正向工具限制控制和验证边界见 [联网关卡](../scripts/compatibility/README.md)。`packages/web-policy` 是 private 实验复现包，不参与默认插件安装。原有关闭范围是搜索、抓取与指定 MCP 前缀，不是系统网络防火墙。

可审阅路线：

1. 等待官方发布在公共恢复边界强制恢复或拒绝必需 preset/策略的版本，再完整重跑关卡与历史分叉/并发/导入测试。保留当前架构目标；这是继续完成任务的首选路线。
2. 仅验收不导入旧 Modern 会话的 UI 插件预览，显式接受联网功能不等价及视图偏好缺口。这是产品范围变更，**本轮未替用户接受**，不能据此标记目标完成。
3. 继续使用单独标明的旧补丁版作为过渡，对照和数据恢复。它不满足本任务的最终官方成品架构。

## 数据边界

| 输入 / 操作 | 当前结果 |
| --- | --- |
| 无策略扩展的官方 v4 JSONL/压缩日志 | 检查可读性；不自动导入，不声称附件/全部历史格式已验证 |
| 必需 `web/search`，包括最终重新开启 | 保留所有事件次序，拒绝转换 |
| `/web` 运行/结算但尚无状态事件 | 保守阻塞，不能按默认开启执行 |
| 实验策略 record、header 或选择事件中的策略 preset | 即使官方可读仍阻塞 |
| 未知版本、未知必需事件、损坏/未完成日志、重名 ZIP | 明确拒绝，不截断、不删除事件 |
| 隔离与恢复 | 原字节和摘要保留，恢复只写不存在的新文件；不是在线 DSH_HOME 备份 |
| 旧模型资料 / 价格缓存 | 在新 profile 的配置副本映射到 `modern-ui`，冲突拒绝，原配置保留备份 |
| `collapsedViews` | 仅保留字段；缺少已验证的公开共享 pin/store 接口，不能记作已生效 |

详见 [数据预检与回退](plugin-data-migration.md)。本轮没有访问真实用户会话，也没有改变会话原件。

## 下一步与交接

- UI 独立审查与修复、最终 tgz 消费浏览器复核；所有差异保留在 UI 地图中。
- 最终安装代际升级、来源证明复用、社区共存与故障恢复复核；补跨平台 CI，未运行平台仍标未验证。
- 固化最终源码/打包产物/来源清单和本地提交，提供可审阅交付，不自动发布。
- 官方能力升级后先重跑联网关卡，再实现真正的数据转换；不要跳过该关卡。
