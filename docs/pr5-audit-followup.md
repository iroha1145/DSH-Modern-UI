# PR #5 审计复核与 CI 修复

复核日期：2026-10-27。外部审计针对 `18c4e388e00de817e5e7bd2f56919d97c1ed7d96`；建议逐条对照真实源码、已发布 rc.4 API 和运行证据核验，没有直接采纳其优先级或补丁。

## 真实 CI 失败

[首次消费工作流 40476692624](https://github.com/iroha1145/DSH-Modern-UI/actions/runs/40476692624) 的 plugin 构建成功，五个 consumer 失败：

- Linux x64/arm64 和 macOS x64/arm64 已完成官方安装、原生自检、来源核验和官方联网检查；首先失败于浏览器寻找中文“新会话”。失败页实际是英文 `New Session` / `Continue`，不是四个平台的安装都失败。
- Windows 在归档检查阶段失败，旧错误消息没有保留 tar 的 stderr。现在统一使用系统 tar、归档所在目录及相对参数，并保留明确的命令失败详情；Unicode 路径的真实 ZIP 解包回归已通过。跨平台结论仍由修复后的消费工作流决定。

## 审计条目核验

| 条目 | 核验结论 | 实际处理与回归 |
| --- | --- | --- |
| P1-1 主题压缩尾声明 | 成立 | 允许最后一条 CSS 自定义属性无分号。通过真实构建产物和官方 ThemeRuntime 检查 ease-out 与暗色 inset shadow，避免浅色回退覆盖暗色值。 |
| P1-2 E2E/平台 | 部分成立，包含不准确引文 | 固定浏览器 fixture 语言；owners 先通过真实 UI 保存 steer，再测 steering；Edge 默认仅限 Windows；测试在全新独立 profile 中重装原 SRI 归档并保留三个社区包，源数据逐文件 hash 不变。当前源码没有报告所引的 busyEnter 前置 assert，但确有隐含的已保存配置假设。官方 rc.4 没有报告声称的 Linux 默认 Ctrl+Shift+Comma；Linux 走官方菜单的真实键盘操作，Win/macOS 使用真实默认快捷键。 |
| P1-3 重复 Node 下载/临时目录 | 成立 | bootstrap 只下载一次，将已校验归档交给 manager，再校验并解压到持久代际；finally/trap 清理临时启动目录。显式 Node 失败不再引用未定义变量。真实运行时不指向被清理目录；PowerShell strict-mode mock 集成覆盖成功、下载失败及核心失败。 |
| P1-4 卸载与重装 | 部分成立 | 旧实现只删除 current.json，**没有删除 versions 或 runtime-cache**。新增幂等卸载、友好启动提示及带摘要的 recovery receipt；重装自动关联原数据/profile，损坏凭据明确拒绝。保留程序、数据及非本项目文件。 |
| P2-5 翻译/手动压缩 | 成立 | 翻译和“原文”都使用 Modern Markdown 与完整本地化代码折叠标签；补齐 manual-compaction，保留运行中、完整失败输出和成功 checkpoint。真实 DOM 与编译组件回归覆盖。 |
| P2-6 模型目录事件 | 部分成立 | 补齐两种 credentials 更新事件。**裸 `$on` 生命周期泄漏不成立**：官方 Gateway 的订阅绑定到调用者 Cordis Context；使用官方公开 Gateway apply 与真实 fiber 验证卸载及重载，不添加重复生命周期包装。 |
| P2-7 状态递归/跨代 PowerShell | 部分成立 | 新 previous 保存受管 generation receipt 的路径和 SHA256，验证真实目录边界，兼容旧嵌套回滚。11 代回归证明新 current 不递归增长。PowerShell 复用仍受全部代际保留策略保护；没有垃圾回收功能，不为假设的未来删除操作迁移现有运行时。 |
| P2-8 Node 探测/入口参数 | 部分成立 | PS 版本探测捕获失败；POSIX 缺失或版本不符时转 bootstrap；预览 install.ps1 支持并透传 Node。报告所引 HomeDir 参数与实际源码不符，JS 入口原本就要求已有精确 Node，并非自动下载入口。 |
| P2-9 归档/配置合并 | 路径检查成立；配置部分为防御性加固 | 统一拒绝 POSIX/Windows 根、盘符相对路径、`..` 和 alternate-stream 路径。正常安装使用当前组合配置，未复现报告所称字段丢失；新增过期组合快照与阶段副本冲突时的拒绝，避免盲目合并打乱官方覆盖顺序。 |
| P3-10 文档/证据 | 成立 | 修正 LICENSE 相对链接；预览包含完整 docs 与根 LICENSE。历史本地结果明确标为旧制品记录，新增可在源码或预览目录运行的 bundle 生命周期驱动；新消费流程上传 isolation、peers、结果和截图，避免把本机路径当作仓库链接。 |

报告之外，隔离 profile 的浏览器检查发现相对文件链接按错误工作目录解析。Modern Markdown 现在以自己的 owner cwd 解析文件路径，与图片解析保持一致；保留绝对路径与行号。公开 rc.4 helper 支持相对或绝对路径，修复没有改写官方契约。

## 验证和可复现入口

- 精确 Node 24.22.1：整合后 **112 tests / 112 pass / 0 fail**；UI 严格构建通过，864 browser inputs。
- 定向检查包含真实 ThemeRuntime、Gateway fiber、翻译/原文 DOM、手动压缩、Markdown 文件点击，归档路径、发布源字节、配置快照、receipt 边界和 legacy 回滚。
- Windows bootstrap mock 回归验证一次归档下载传递、成功/失败清理和显式 Node 错误；这不冒充真实网络安装测量。
- 新隔离测试用旧已消费 tgz 验证 owners 五项、四个真实工具和源数据不变。**修复后新 tgz 的消费者结果必须以当前提交 CI 为准**，不复用旧制品结论代替。

开发单测：

```sh
npm ci --ignore-scripts
npm run build
npm test
```

预览生成后，其测试驱动只需要独立 Playwright；应用安装不需要测试依赖。用实际安装记录作为只读输入：

```sh
node tests/plugin/browser.e2e.mjs
node tests/plugin/owners.e2e.mjs
node tests/plugin/bundle-lifecycle.e2e.mjs /absolute/program/current.json
```

前两项通过 `MODERN_UI_INSTALLED_STATE` 指定 current.json；`MODERN_UI_BUILD_DEPS` 可指定安装了 playwright-core 的测试目录，`MODERN_UI_BROWSER` 可指定浏览器。driver 从原始完整性已核验 tgz 重装全新官方 profile，不复制活跃会话，也不改变原 profile 语言或卡片设置。每个运行的 `isolation.json` 保留源文件摘要，`peers.json` 记录实际模块身份。

bundle 生命周期驱动覆盖官方四个 owner、主题/style 撤销、刷新后输入、真实包移除和新 Host 恢复，并保留三个社区插件。仅在已声明的 bundle 切换到页面刷新边界内记录精确的 root registration 错误；稳定阶段或其他错误仍失败，不声明无缝热切换。

历史 `18c4e38` 的本地制品和测量仍见 [迁移记录](plugin-migration.md)，不可归因于后续修改。公开 CI 的每个平台 artifact 包含独立安装、浏览器和来源证据；保留期限见 workflow。未通过当前运行的平台不标为已支持。
