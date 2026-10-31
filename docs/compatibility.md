# 官方宿主向后兼容

使用未经修改的官方 DSH 发布包，以及同一份预编译 Modern UI 核心。安装器不重建后端，不修改官方 JS、前端 dist 或原生模块，也不要求消费者安装编译器。

## 兼容矩阵

| 插件版本 | 官方宿主 | 状态 | 平台 | 日期 |
| --- | --- | --- | --- | --- |
| 0.1.3 | `0.2.1-rc.4` | 已验证（默认新装） | Linux x64/arm64、macOS x64/arm64、Windows x64 | 2026-11-01 |
| 0.1.3 | `0.2.1-rc.3` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.3 | `0.2.1-rc.2` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.2 | `0.2.1-rc.4` | 已验证（默认新装） | Linux x64/arm64、macOS x64/arm64、Windows x64 | 2026-11-01 |
| 0.1.2 | `0.2.1-rc.3` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.2 | `0.2.1-rc.2` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.1 | `0.2.1-rc.4` | 已验证（默认新装） | Linux x64/arm64、macOS x64/arm64、Windows x64 | 2026-11-01 |
| 0.1.1 | `0.2.1-rc.3` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.1 | `0.2.1-rc.2` | 已验证 | Linux x64、Windows x64 | 2026-11-01 |
| 0.1.0 | `0.2.1-rc.5` | 范围内未验证；canary 全部 9 层通过（含候选社区组合），待 Linux CI 证据后写入 `verifiedHosts` | Windows x64（本地） | 2026-10-30 |
| 0.1.0 | `0.2.1-rc.4` | 已验证（默认新装） | Linux x64/arm64、macOS x64/arm64、Windows x64 | 2026-10-29 |
| 0.1.0 | `0.2.1-rc.3` | 已验证 | Linux x64、Windows x64 | 2026-10-29 |
| 0.1.0 | `0.2.1-rc.2` | 已验证 | Linux x64、Windows x64 | 2026-10-29 |
| — | `0.2.2-alpha.2` | 已知不兼容：Cordis/Schemastery alpha peers 与插件 peers 不匹配，安装器拒绝 | — | 2026-10-30 |

### 官方 Desktop

| 插件版本 | Desktop 版本 | 内嵌 DSH | 平台 | 结论 | 日期 |
| --- | --- | --- | --- | --- | --- |
| 0.1.0（含首次引导修复） | `0.2.1-rc.5`（Electron 44.7.0） | `0.2.1-rc.5`（范围内未验证） | Windows x64 | 部分支持：Web Client 12 项检查、外壳标记、主题跟随、窄视口、移除/重装全部通过；首次引导记为已跳过；原生桥能力未验证 | 2026-10-30 |

Desktop 不在 npm，canary 覆盖不到；每个 Desktop 版本单独运行 `tests/compat/desktop.mjs` 并补人工清单。逐项结论见 [Desktop 0.2.1-rc.5 验收记录](compatibility/desktop-0.2.1-rc.5.md)。

新宿主由每天的 [Upstream canary](../.github/workflows/upstream-canary.yml) 先行验证，通过后按 [CONTRIBUTING.md](../CONTRIBUTING.md#接纳新的官方宿主版本) 加入本表与 `verifiedHosts`。

## 支持范围与唯一清单

[`scripts/distribution/compatibility.json`](../scripts/distribution/compatibility.json) 是版本、平台、官方 URL/SRI、私有运行时和社区组合的唯一清单。构建从它生成插件 engines/peers/compatibleHost、默认 community-lock 和预览元数据。

- 插件声明宿主范围 `hostRange` = `>=0.2.1-rc.2 <0.3.0-0`，写进 `engines.dsh`、`dsh.compatibleHost` 与全部 `@deepseek-ai/dsh-*` peers。安装器、canary 和 pnpm 的 peer 检查按 npm 规则判断，范围内的预发布版只限 `0.2.1-*`；`0.2.2-alpha.*` 之类的其他预发布版不在范围内。官方宿主加载插件时只看 `engines.dsh`，并把预发布版算进范围（`includePrerelease`），所以经 `dsh plugin add` 安装时，`0.2.2-alpha.*` 等其他 `0.2.x` 预发布宿主也会放行，`knownBroken` 拦不住；上界写成 `<0.3.0-0` 是为了让宿主同样拒绝 `0.3.0-alpha.*`。
- `verifiedHosts`（rc.4、rc.3、rc.2）是跑过完整兼容套件、带官方 SRI 与社区组合的版本；默认新装仍为 rc.4。
- 范围内但未验证的版本（例如未来的 `0.2.1` 正式版）可以安装：安装器打印警告，从 npm registry 元数据取官方 tgz 的完整性，只开放已验证宿主出现过的平台，不附装社区插件。
- 安装器对 `knownBroken` 中的版本与范围外的版本（`0.3.0` 起、更早的 rc）直接拒绝。
- rc.4 保留 Linux x64/arm64、macOS x64/arm64、Windows x64 的既有成品安装范围；rc.3、rc.2 限定 Linux x64 与 Windows x64。
- Node 要求 major 24（`engines.node` = `>=24.0.0`，私有运行时下载 `24.22.1`）；pnpm 固定 `11.28.5`。`@deepseek-ai/cordis` / `@deepseek-ai/schemastery` / `react` peers 为 `^4.0.5` / `^3.18.5` / `^18.3.0`，记录在 `compatibility.json#platformPeers`，构建时写入包的 peerDependencies。支持旧 DSH 不等于支持旧 Node、旧浏览器或数据格式降级。
- 真实浏览器核心验收使用 Chromium/Edge。官方 Desktop（Electron）内的 Web Client 检查、Windows 标题栏标记、系统主题跟随、窄视口与 bundle 移除/重装已在 Desktop 0.2.1-rc.5 / Windows x64 通过；原生文件拖出、多窗口、「Open In…」、原生目录选择器、macOS 外壳与最大化/全屏覆盖层只有人工清单，尚为 **unverified**，逐项见 [Desktop 验收记录](compatibility/desktop-0.2.1-rc.5.md)。WebKit、触屏、真实外部收费 provider、旧定制 web/search 会话继续写入均为 **unverified**。

版本清单与当前源提交的 CI 报告共同界定验收。`compatibility-<host>-<platform>` 在 Linux x64 与 Windows x64 分别生成分层 JSON、日志和截图；五个平台的 `consumer-*` 产物只证明实际安装、加载自检和官方文件完整性，不能替代浏览器检查。失败或 unverified 层不能计为通过。

## 已核对的接口边界

首轮源码基线为 main `bcb89a86adc07c86234b58a5eac01dc4b67bb7c3`，包含尚未合并的 PR #14 `27fc449f2aaa8f4b780e2c85f84e8f8a2facc29e` 的答案空白及普通 group 修复。没有回退或覆盖这些修复。开始时没有 Modern UI 的公开 npm 包或 GitHub Release；分发只使用实际 CI/本地预编译产物。

三个官方宿主使用各自的真实发布依赖闭包。rc.3/rc.4 的 306 个已安装官方包未发现 exports 差异；rc.2 缺少后续新增的 `dsh-client-ui-entry-customization`，Modern 不静态导入或声明依赖该模块。关键加载条件由实际官方 loader 验收，不能仅凭该静态对比宣称兼容。

三个版本的公开 `ChatTurnProcessPresentation` 都包含 `compactAnswer`。Modern 现在按公开语义实际派生该字段，并将其纳入对象稳定性比较。`hasNonReplyProcess` 是可选的 Modern 扩展，读取纯官方 snapshot 时回退公开的 `hasExternalProcess`。注册边界不再用 `unknown → never` 抹掉契约差异。最早收尾回复及其后续答案保持可见，工具过程可折叠，整段复制保留原始空白。

Host 绑定接受并保留 `disabled` 的缺失、null、false；true 继续禁用。真正 `!!js` 动态条件不求值，需要明确迁移。普通 `group:false/null`、metadata 和未知字段保留，真正嵌套组仍拒绝自动转换。历史空表恢复仍依赖原备份、完整前缀和摘要链。

## 一个安装入口

解压实际预编译预览目录后，新安装默认选择 rc.4。显式选择已支持的旧宿主：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH/program' -DataHome 'D:/DSH/data' -BackendVersion '0.2.1-rc.3'
```

```sh
DSH_MODERN_BACKEND_VERSION=0.2.1-rc.3 sh ./install.sh '/path/to/program' '/path/to/data'
```

已有官方宿主使用同一预览里的入口，自动读取其实际版本，不升级整个后端：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install-existing.ps1 -Backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json' -Root 'D:/DSH/program' -DataHome 'D:/DSH/data'
```

```sh
sh ./install-existing.sh '/path/to/official/node_modules/@deepseek-ai/dsh/package.json' '/path/to/program' '/path/to/data'
```

已有 managed 安装默认保留原后端版本（不设 `DSH_MODERN_BACKEND_VERSION` 时独立安装入口沿用原宿主，不会顺带升级）。显式版本与实际后端不一致、未知版本或未验收平台会在 staging 前拒绝；`install-existing` 入口只读取所给官方包的实际版本，忽略这个变量。同一 program root 的已选安装不能切换宿主版本：复用已有官方 DSH 时不要原地升级那份官方包，否则启动器的官方文件核对和重装都会拒绝（报错会写出记录版本与实际版本）；`uninstall` 也不清除这层绑定，它把选择存进 `recovery.json`，再次安装会读回。新 program root 不会自动识别其他安装曾写入该 data home 的版本，因此必须使用隔离数据副本，由目标版本的官方读取器核验。下载来源、SRI、依赖真实解析、安装回执和启动诊断均记录实际宿主。

初次采用非 web profile 时显式传 `-FromProfile`、`--from-profile`（JS existing 入口）或 `DSH_MODERN_FROM_PROFILE`；不猜测哪个 profile 正在运行。它只用于初次采用：已托管的 program root 再传一个不同的 profile 会在备份前拒绝，升级时不要保留这个变量。安装前根据候选包实际 owner patch 检查原有效配置。自定义 owner ID、重复或嵌套 owner、计算型 activation 会在停用官方 owner 前拒绝，需要人工适配；不会追加永久 disabled 覆盖来掩盖冲突。

## 社区插件

已验证组合为 `dsh-context@0.75.1` 和 `dsh-better-sidebar@0.28.0`。本项目不再默认捆绑安装它们：npm 用户按需自行 `dsh plugin add`，隔离安装器需显式 `-WithCommunity`／`DSH_MODERN_WITH_COMMUNITY=1`。兼容回归与 consumer CI 仍安装这一组合，分别验收真实会话统计、文件读取/编辑保存。已有用户版本、配置、禁用状态及未知 metadata 保留，不自动升级或降级。清单以外的插件版本和依赖私有 DOM/内部方法的插件不自动承诺兼容；另一套完整聊天/布局 owner 需单独审查。

`dsh-plugins-store@0.1.4` 不再作为新安装默认项。真实双 profile 检查发现它将库存和移除作用于 `web`，安装端点还因安装计划二次校验返回 502。它没有公开的 profile 适配入口，因此未改写该发布包或抢占其路由；已有用户安装保留，但不列为兼容通过。使用官方插件管理界面操作当前 profile。详细证据、可复现入口及独立上游修复方案见 [Store 0.1.4](compatibility/store-0.1.4.md)。

## 可重复验收

维护者使用固定 Node 后运行：

```sh
npm ci --ignore-scripts
npm run test:compat
```

这条命令先构建预编译包，然后在仓库之外建立独立消费者。已有产物可省去维护者构建：

```sh
npm run test:compat -- --preview /path/to/precompiled-preview --host 0.2.1-rc.3 --root /path/to/isolated-test-root --browser /path/to/chromium
```

消费者实际只安装官方发行物和预编译包。`--state` 仅供复用带专用标记的隔离测试安装，不能指向日常使用的数据目录。浏览器驱动可通过 `COMPAT_TEST_DRIVER` 指向只安装 Playwright 的独立工具目录；该目录不用于解析任何 Host API。

报告区分 installation、Host MCP、生命周期、官方联网配置、browser、失败恢复、官方完整性与非目标数据保护。模型和外部服务为本地确定性夹具；Cordis、loader、pluginManager、tools、Session、slots、renderer、React 等都来自对应实际宿主。浏览器同时检查插件真实 active、共享模块身份、消息/工具/答案/附件/模型、标准扩展槽、社区操作、设置保存及真实 Host 重启。

每个消费者保留带摘要校验的 `official-source-ledger.json`，记录官方依赖版本、真实路径、来源和 SRI。浏览器另记录共享模块身份及来源；React/React DOM 的版本取实际运行时导出，未公开版本的内置模块记录所属官方 frontend release。答案验收明确使用 `foldedReplies: final`，要求最早及后续答案可见、工具结果和旁白均随过程折叠；默认保留全部回复的模式不因此改变。

Host 重启会释放官方内存 changes summary。仅在真实重启后，精确 `/api/changes.summary` 返回 404 且正文为 `Change summary unavailable.` 时记录为预期的 missing 状态；其他失败请求不能借此豁免。测试主动停止的旧 origin 断连单独记录。

## 失败与回滚

配置转换发生在新 profile 副本中；切换前检查来源、模块准入和实际启动。失败的升级保留旧 current.json、原 profile 与非目标数据，删除本次失败 generation/profile，并保留已验证的数据备份。验收使用真实会抛错的 staged 插件，要求确认其 apply 已执行，防止把网络失败冒充回滚验收。

取消 Modern bundle 恢复七个官方界面 owner；第三方条目与配置不随之删除。显式 Host 替代绑定仍引用 Modern 包时，不应直接删包，应先通过正常配置恢复对应官方条目。程序/profile 回滚不会降级共享会话数据。联网始终由官方工具配置和插件启停控制，不恢复自定义会话联网开关。
