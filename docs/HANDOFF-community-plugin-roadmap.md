# DSH Modern UI → 长期维护的社区分发插件：改造规划（Hand-off）

- 基线提交：`179598e`（main，2026-10-30，PR #19 合入后）
- 评审日期：2026-10-30
- 文档用途：拆成若干个独立工作包（WP），每个 WP 可以在一个单独的对话里完成。执行对话只需读本文件的「通用约定」与自己的 WP 章节，再读该章节列出的文件。
- 不在本文件范围内：功能新增、视觉调整、Bug 修复。那些照常走 PR。

---

## 0. 现状事实（执行者不必重新调研）

### 0.1 仓库形态

| 项 | 现状 | 证据 |
|---|---|---|
| 插件包 | `packages/modern-ui`，名 `@iroha1145/dsh-modern-ui`，版本 `0.1.0-migration.1` | `packages/modern-ui/package.json` |
| 源码体量 | `src` 589 文件 / 约 77,300 行；其中 `src/vendor` 约 72,300 行（从官方 UI 包复制改造）；`src/host-compat` 约 4,100 行；`src/*.ts` 顶层胶水约 1,900 行 | `wc` 统计 |
| 接管方式 | `packages/modern-ui/cordis.patch.yml` 把 7 个官方 client owner 设 `disabled: true`（ui-layout / ui-sidebar / ui-conversation / ui-workspace / ui-chat / ui-model-selection / ui-tool），再 insert `modern-ui` 与 `modern-plugin-documents` 两行 | 同文件 |
| 宿主侧代码 | `src/index.ts` 注册 Config、注入 boot 页 CSS、向系统提示词追加 `PRESENTATION_PROMPT`（约 3 KB，默认启用，无独立开关） | `src/index.ts`、`src/vendor/intelligent/presentation-prompt.ts` |
| 额外宿主入口 | `./translator`、`./mcp-client`、`./web-fetch-http`、`./plugin-documents`、`./migration`（bin `modern-ui-data`）五个 exports，由 `scripts/build-host.mjs` 构建 | `package.json#exports`、`scripts/build-host.mjs` |
| 兼容声明 | `compatibleHost`、`engines.dsh`、36 个 `@deepseek-ai/dsh-*` peer 全部为精确枚举 `0.2.1-rc.4 \|\| 0.2.1-rc.3 \|\| 0.2.1-rc.2`；`engines.node` 精确 `24.22.1`；`react` peer 精确 `18.3.1` | `package.json`；由 `scripts/build-plugin.mjs` 从 `scripts/distribution/compatibility.json` **生成**，手改会被覆盖 |
| 上游节奏 | 10 月 9 日至 30 日发了 10 个预发布版；rc.5 于 10 月 30 日发布，0.2.2-alpha.2 于 10 月 28 日发布。本插件在 rc.5 发布当天即不兼容最新宿主 | github.com/deepseek-ai/deepseek-harness/releases |
| 分发渠道 | 仅 GitHub Actions artifact `modern-ui-precompiled-preview`（保留 7 天）。npm 未发布，Releases 为空 | `.github/workflows/plugin-preview.yml`、README |
| 安装方式 | `scripts/distribution/` 约 2,300 行安装器：下载私有 Node 24.22.1、pnpm 11.28.5、Windows 私有 PowerShell 7.6.5、官方 `@deepseek-ai/dsh` tgz，建独立 program/data 目录与独立 profile，再调官方 `dsh plugin add` 装 tgz，并默认附装 `dsh-context@0.75.1`、`dsh-better-sidebar@0.28.0` | `scripts/distribution/manager.mjs`（命令 status / install / uninstall / verify / rollback / community / launch）、`bootstrap.*`、`install-existing.*` |
| 遗留路线 | 根目录 `dsh-ui.json`（指向上游 rc.3 提交 `22ddee37`）+ `patches/dsh-ui.patch`（2.8 MB，改动 498 个上游文件）+ `scripts/install.sh`/`install.ps1`/`launch.*`/`plugins.mjs` + `.github/workflows/verify.yml`：旧的"下载源码打补丁再编译"路线，与新插件路线并存于 main | 各文件 |
| 构建产物 | `/packages/modern-ui/lib/` 在 `.gitignore`；包内无 `scripts` 字段（无 `prepare`）；构建依赖（esbuild、lightningcss、typescript）在仓库根 devDependencies | `.gitignore`、`package.json` |
| 包管理 | 根 `package.json` 写 `packageManager: pnpm@11.28.5`，但提交的是 `package-lock.json`，CI 用 `npm ci` | 根目录 |
| 测试 | 包内零单测。仓库级 `tests/audit/*.test.mjs`（8 个，node:test + esbuild 现场打包源码）与 `tests/compat/`（真实宿主安装 + Playwright 浏览器验收，约 3,100 行合计） | `tests/` |
| 静态检查 | 无 eslint / prettier / biome 配置；仅 `tsc --noEmit --noUnusedLocals` 在 CI | 根目录 |
| 社区文件 | 无 CHANGELOG、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、issue/PR 模板、Dependabot/Renovate | 根目录 |
| 许可 | 根 `LICENSE` 为 `Copyright (c) 2026 DeepSeek`（上游原文，无作者声明）；包内 `THIRD_PARTY_NOTICES.md` + 240 KB `provenance.json`（533 条文件记录，258 改造 / 275 原样）+ `licenses/` 完整 | `packages/modern-ui/` |
| 文档 | `docs/` 共 30 篇。面向用户/维护者的只有：`plugin-installation.md`、`backward-compatibility.md`、`plugin-ui-map.md`、`plugin-data-migration.md`、`plugin-host-compat.md`、`legacy-patch-installation.md`。其余 24 篇是日期命名的审计复核与 PR 跟进日志 | `docs/` |
| 历史 | 84 次提交集中在 10 月 25 日至 30 日；3 个作者身份（iroha1145、yayoi、`Codex <codex@local.invalid>`）；21 个 PR 全部自提自合；0 star | `git log` |

### 0.2 vendor 目录体量（WP5 评估依据）

| 子目录 | 行数 | 对应官方包 | 备注 |
|---|---|---|---|
| conversation | 18,760 | ui-conversation | 含 Lexical 编辑器、assembler、location-index |
| chat | 17,862 | ui-chat | 含 chat-snapshot-builder、viewport、折叠逻辑 |
| primitives | 15,233 | ui-primitives | Markdown 渲染、shiki、KaTeX、图标 |
| tool | 8,724 | ui-tool | 工具卡片、toolviews、3,183 行字典 |
| workspace | 7,766 | ui-workspace | WorkspaceBrowser、rows、tree |
| model | 5,543 | ui-model-selection | 模型卡、settings controller |
| subagent | 2,991 | ui-subagent | agent-tree、header lineage |
| theme | 2,122 | ui-theme | 样式表 + 图标雪碧图 |
| sidebar | 1,751 | ui-sidebar | |
| intelligent | 1,471 | OpenIntelligentUI 改造 | openui/followups 渲染，含双层 sandbox |
| questions | 1,372 | ui-user-questions | |
| layout | 1,257 | ui-layout | |
| plugin-market | 1,179 | ui-plugin-market | |
| settings-models | 1,114 | ui-settings-models | |
| 其余 11 个 | 各 < 500 | | file-drag、plan、translation、documentpreview、message-quotes、settings-shell、attachment 等 |

### 0.3 做得好、必须保留的部分

- `openui` 的隔离：双层嵌套 `sandbox="allow-scripts"` iframe、无 `allow-same-origin`、CSP、Permissions Policy 全拒绝、一次性 token、链接需宿主确认（`src/vendor/intelligent/client/sandbox.ts`、`frame-content.ts`）。任何 WP 不得削弱。
- `scripts/build-plugin.mjs` 的 `shared-runtime-boundary` 插件：拒绝未声明的 `@deepseek-ai/*` 导入，保证 React / Cordis / slots 单实例。
- `provenance.json` + `THIRD_PARTY_NOTICES.md` + `licenses/` 的来源与许可链。WP5 会把它从"记录"升级为"漂移检测输入"。
- 所有下载带 SRI 校验；五平台 consumer CI；真实宿主 + 真实浏览器的兼容回归。

---

## 1. 目标状态（一句话）

用户在任何受支持的官方 DSH 宿主上执行

```bash
dsh plugin --profile web add @iroha1145/dsh-modern-ui
```

刷新浏览器即得 Modern UI；上游发新 rc 后，插件在 48 小时内有兼容结论（自动）与补丁版本（人工），维护者每月投入可控。

## 2. 改造原则（所有 WP 共同遵守）

1. **扩展优先于替换。** 新代码一律走 slot / overlay / CSS 变量 / 公开服务；不新增 vendored 官方源码。已有 vendored 代码只减不增。
2. **一个真相源。** 版本、兼容范围、运行时版本只写在 `scripts/distribution/compatibility.json`，其余由脚本生成；手改生成物的 PR 直接拒。
3. **UI 插件只做 UI。** 宿主侧逻辑（MCP、翻译、HTTP 抓取、文档读取、数据迁移）移出主包。
4. **行为改变默认关闭、可见、可关。** 任何影响模型输出或改写用户配置的功能必须有独立开关并在 README 列出。
5. **npm 是主渠道。** 私有运行时安装器降为可选附件，不再是唯一入口；社区插件不再由本项目捆绑安装。
6. **删除要留痕。** 遗留路线移到 tag / 分支并在 README 留一行指引，不直接从历史抹掉。

---

## 3. 通用约定（每个执行对话开头先读）

- 一个对话只做一个 WP。需要跨 WP 的改动，先在本文件对应 WP 的「待决策」里登记，不要顺手改。
- 开工前：`git checkout -b wp<N>/<slug>`，读本文件 §0 与自己的 WP 章节，再读 WP 列出的文件。
- 每个 WP 的「验收」是 PR 合并条件；验收命令要真实跑过并把输出贴进 PR 描述。
- 本地验证基线：Node 24.22.1（`.node-version`）、`npm ci --ignore-scripts`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm test`（vitest；compat 层需 `COMPAT_BACKEND_PACKAGE=node_modules/@deepseek-ai/dsh/package.json`，WP6 起）。`npm run test:compat` 很重（会装一个隔离宿主），只在改到安装/兼容逻辑时跑。
- 提交信息沿用现有风格：`feat|fix|docs|chore|test(scope): 中文描述`。
- 不要在 WP 里"顺手"修 UI Bug；发现了记进 issue。
- 改 `package.json` 的兼容字段前先看 `scripts/build-plugin.mjs` 第 10 至 20 行：它会从 `compatibility.json` 重写这些字段。

---

## 4. 里程碑与顺序

| 里程碑 | 含义 | 包含 WP | 依赖 |
|---|---|---|---|
| **M1 可一行安装** | npm 上有包，README 首屏一行命令，旧路线归档 | WP0 → WP1 | 无 |
| **M2 可跟上上游** | 兼容范围声明 + 每日对上游最新 rc 自动验收 + 行为开关 | WP2、WP3、WP6（部分） | M1 |
| **M3 可持续维护** | 宿主侧拆包、vendor 体量下降、上游漂移可检测、工程基线齐全 | WP4、WP5、WP6（全部）、WP7、WP8 | M2 |

WP0 与 WP6 的 lint 部分可以并行；WP2 与 WP3 可以并行；WP4 与 WP5 可以并行但都在 M2 之后。WP8 需要 M1 的可安装包和一台装有官方 Desktop 的机器，建议排在 WP7 之前，FAQ 依赖它的结论。

---

## 5. 工作包

### WP0 仓库整理（M1 前置，1 个对话，小）

**现状**：§0.1「遗留路线」「包管理」「许可」「文档」四行。

**目标**：main 只剩插件路线；版本与锁文件一致；文档分层。

**步骤**
1. 打 tag `legacy-patch-final` 指向当前 main；新建分支 `legacy-patch` 同指向。
2. 从 main 删除：`dsh-ui.json`、`patches/`、`scripts/install.sh`、`scripts/install.ps1`、`scripts/launch.sh`、`scripts/launch.ps1`、`scripts/plugins.mjs`、`scripts/export-patch.mjs`、`scripts/verify-release.mjs`、`.github/workflows/verify.yml`、`docs/legacy-patch-installation.md`。已核对 `scripts/distribution/*` 与 `tests/` 不引用这些文件，可直接删；`scripts/distribution/verify-release-source.mjs` 名字相近但内容独立，保留。
3. `.gitattributes` 删去 `*.patch` 与 `old-conversation-writer.mjs` 之外已无对象的行。
4. 根 `package.json`：决定用 npm 还是 pnpm（建议保留 npm，因 CI 与安装器都基于 npm），删掉 `packageManager` 字段或改为 `npm@<版本>`。
5. 根 `LICENSE`：保留 MIT，版权行改为 `Copyright (c) 2026 iroha1145 and contributors`，并加一行说明 `packages/modern-ui/licenses/DeepSeek-Harness-host.txt` 保留上游版权。
6. `docs/` 分层：新建 `docs/history/` 并移入 24 篇日期/PR 命名的审计日志；保留并重命名用户文档为 `docs/install.md`、`docs/compatibility.md`、`docs/architecture.md`（原 plugin-ui-map）、`docs/data-migration.md`、`docs/host-compat.md`。`scripts/create-preview.mjs` 第 28 行会把 `docs/` 整目录拷进预览包，改为只拷用户文档；同文件第 35 行与第 122 行写死了 `docs/backward-compatibility.md`，随重命名一起改。
7. README 删除「项目结构」里对 patch 的描述，加一行"旧补丁路线见 tag `legacy-patch-final`"。

**验收**
- `npm run build && npm run preview` 成功；`node --test tests/audit/*.test.mjs` 通过。
- `git grep -n 'dsh-ui.json\|dsh-ui.patch'` 在 main 为空（`docs/history/` 除外）。
- CI `plugin-preview.yml` 绿。

**待决策**：是否保留 `scripts/distribution/verify-release-source.mjs`（它校验旧补丁来源，插件路线下可能无用）。

> **WP0 执行记录**：保留。`scripts/distribution/manager.mjs` 第 12 行导入 `verifyReleaseSources`，它校验的是 npm 官方 registry 上的宿主与运行时来源，而非旧补丁。17 个 vendored 文件头注释 `22ddee37 + dsh-ui.patch` 是 provenance 来源描述，改动会使 `provenance.json#targetSha256` 失配，故保留，属于 grep 验收的已知例外（旧补丁内容见 tag `legacy-patch-final`）。

---

### WP1 发布管线（M1 核心，1 至 2 个对话，中）

**现状**：§0.1「分发渠道」「构建产物」。

**目标**：每个 Git tag `v*` 自动发 npm + GitHub Release（附 `modern-ui.tgz`、`preview.json`、可选安装器 zip）；README 首屏为一行安装命令。

**步骤**
1. 版本：`compatibility.json#runtimeVersions.plugin` 改为 `0.1.0`。后续遵守 semver：宿主兼容范围变化 = minor；仅修复 = patch。
2. 新建 `.github/workflows/release.yml`，触发 `push: tags: ['v*']`：
   - `npm ci --ignore-scripts && npm run build && npm run preview`
   - 校验 tag 版本 == `compatibility.json` 版本 == `packages/modern-ui/package.json` 版本，不一致即失败。
   - `npm publish ./packages/modern-ui --provenance --access public`（需 `NPM_TOKEN` secret；推荐改用 npm Trusted Publishing，则无 token）。
   - `gh release create` 附 `.artifacts/plugin-preview/modern-ui.tgz`、`preview.json`、以及 `installer.zip`（把 `.artifacts/plugin-preview` 整目录打包，作为可选的私有运行时安装器）。
3. `plugin-preview.yml` 保持为 PR 验证；artifact 保留天数可以不变。
4. 包内 `packages/modern-ui/README.md` 重写为 npm 页面：一行安装、切回官方 UI 的方法、兼容范围链接、已知限制。
5. 根 README 首屏改为：

   ```bash
   dsh plugin --profile web add @iroha1145/dsh-modern-ui
   ```

   随后"刷新浏览器"、"停用 bundle 即恢复官方 UI"、"兼容矩阵"链接。私有运行时安装器挪到「可选：一键隔离环境」章节，并明确它的适用场景（没有现成 DSH、想隔离数据）。
6. 市场元数据（deepseek.stream 上架条件）：`package.json#dsh` 增加 `name: "Modern UI"`、`category: "ui"`（市场示例值为 `tools`，UI 类别以市场实际枚举为准）；确认 `dsh.bundle.patch` 指向的 `cordis.patch.yml` 在 `files` 内（已在）。
7. Git 源安装（`dsh plugin add github:...`）明确**不支持**并写进 README：构建依赖在仓库根、pnpm 10+ 默认禁止 Git 依赖的 build script。不要为此加 `prepare`。
8. 安装器瘦身决策（见待决策）：至少把默认附装社区插件改为 opt-in（`compatibility.json#hosts.*.communityPlugins` 保留为"已验证组合"，安装器默认不装）。

**验收**
- 在一台干净机器或 CI job 上：官方 `npx @deepseek-ai/dsh@<支持版本>` 建 web profile → `dsh plugin --profile web add @iroha1145/dsh-modern-ui@0.1.0` → 启动 → 浏览器看到 Modern UI；停用 bundle 后恢复官方 UI。把这个流程写成 `tests/compat/npm-install.e2e.mjs` 并纳入 `release.yml` 的 post-publish 检查。
- npm 页面可见、Release 页有 tgz 与 preview.json。
- `npm pack ./packages/modern-ui --dry-run` 列出的文件与 `files` 字段一致，无 `src/`。

**待决策**
- 包名是否保留 `@iroha1145/` scope（需要 npm 用户 iroha1145 或同名 org）；若换名要同步 `compatibility.json#plugin.name`、`cordis.patch.yml`、`scripts/build-plugin.mjs` 第 47 行 `id`、`tsconfig.client.json#paths`。
- 私有运行时安装器是否长期维护。建议：保留但标注"社区维护、尽力支持"，CI 的 `consumer` 矩阵从每个 PR 降为 release 时跑。

> **WP1 执行记录**
> - 采用建议：保留 `@iroha1145/` scope；社区插件改为 opt-in（`-WithCommunity` / `DSH_MODERN_WITH_COMMUNITY=1` / `--with-community true`），旧的 skip 开关仍被接受；consumer CI 显式 opt-in 以继续验证已验证组合。consumer 矩阵降频留给 WP6 第 3 步。
> - 新发现：官方 `dsh plugin` 转发给 pnpm，用户需 PATH 上有 pnpm；对从未启动过的 web profile，裸 `plugin add` 只会初始化 base bundle，需先 `dsh web`（或 `dsh --profile web --dump-config`）。README 已写明，`tests/compat/npm-install.e2e.mjs` 也先做这一步。
> - 市场指南（deepseek.stream/guide）的示例写 `dsh.bundle.patch` 指向 `patches/bundle.yaml`，且未列出插件 `category` 枚举；本包沿用 `./cordis.patch.yml`、`category: "ui"`，WP7 提交市场时以实际审核为准。
> - 未做（需要 owner 操作）：推送 tag 与分支、配置 `NPM_TOKEN` 或 npm Trusted Publishing、首次 `v0.1.0` 发布。本地已用 `.artifacts/plugin-preview/modern-ui.tgz` 跑通 `npm-install.e2e.mjs`（rc.4，Windows x64，Edge）；add 时 pnpm 报一条 peer 警告，留给 WP2 放宽 peer 范围时复核。

---

### WP2 兼容策略（M2，1 至 2 个对话，中）

**现状**：§0.1「兼容声明」「上游节奏」。精确枚举在 `compatibility.json#hosts`，由 `scripts/build-plugin.mjs`、`scripts/create-preview.mjs`、`tests/compat/run.mjs`、`scripts/distribution/compatibility.mjs` 消费。

**目标**：声明范围而非枚举；每日自动对上游最新 rc 跑兼容；文档有矩阵。

**步骤**
1. `compatibility.json` 结构改为：
   ```json
   {
     "hostRange": ">=0.2.1-rc.2 <0.3.0",
     "verifiedHosts": { "0.2.1-rc.4": {...}, "0.2.1-rc.3": {...}, "0.2.1-rc.2": {...} },
     "knownBroken": { "0.2.2-alpha.2": "Cordis/Schemastery alpha peers 不匹配" }
   }
   ```
   `verifiedHosts` 保留现有每宿主的 platforms / officialSource / communityPlugins 结构。
2. `scripts/distribution/compatibility.mjs`：`supportedHostVersions` 改为 `Object.keys(verifiedHosts)`，新增 `hostRange`；`getHostCompatibility(version)` 对不在 `verifiedHosts` 但满足 `hostRange` 的版本返回"未验证但允许"状态（安装器打印警告而非拒绝；`knownBroken` 仍拒绝）。
3. `scripts/build-plugin.mjs`：`compatibleHost`、`engines.dsh`、`@deepseek-ai/dsh-*` peers 写 `hostRange`；`engines.node` 改 `>=24.0.0`；`react` / `react-dom` peer 改 `^18.3.0`。`@deepseek-ai/cordis`、`@deepseek-ai/schemastery` 的 peer 改为 `^4.0.5` / `^3.18.5`（先确认 rc.2 至 rc.4 实际版本一致，`tests/compat` 的 ledger 里有）。
4. `scripts/create-preview.mjs` 第 12 行与 `tests/compat/run.mjs` 对 Node 的精确断言改为 major 匹配。
5. 新建 `.github/workflows/upstream-canary.yml`：`schedule: cron '17 3 * * *'` + `workflow_dispatch`。步骤：`npm view @deepseek-ai/dsh versions --json` 取最新预发布与最新正式版 → 对每个不在 `verifiedHosts` 的版本跑 `node tests/compat/run.mjs --preview <当前 main 构建> --host <版本>` → 失败则用 `gh issue create` 开 issue（标题 `upstream: <版本> 兼容失败`，去重：已有同标题 open issue 则评论）。只跑 linux-x64，控制时长。
6. 新宿主通过 canary 后的人工流程写进 `CONTRIBUTING.md`：把版本加进 `verifiedHosts`（含 integrity，从 `npm view <pkg>@<v> dist.integrity` 取）→ 发 patch 版本。
7. `docs/compatibility.md` 顶部加表：插件版本 ↔ 验证通过的宿主 ↔ 平台 ↔ 日期。

**验收**
- `npm run build` 后 `packages/modern-ui/package.json` 的 peers 为范围字符串；`npm pack --dry-run` 无 engines 警告在 Node 24.x 任意 patch 上。
- `tests/compat/run.mjs --host 0.2.1-rc.4` 仍通过。
- 手动 `workflow_dispatch` 一次 canary，对 rc.5 得到明确结论（通过或开出 issue）。

**风险**：rc.5 若改了 `ChatTurnProcessPresentation` 等公开契约，canary 会红；那是 WP5 的输入，不在本 WP 修。

> **WP2 执行记录**
> - `compatibility.json` 升为 `schemaVersion: 2`，`hosts` 改名 `verifiedHosts`，加 `hostRange` 与 `knownBroken`。安装器不带 node_modules，范围判断在 `compatibility.mjs` 里自带一个 SemVer 比较与 npm 预发布规则（预发布只匹配同 major.minor.patch 上带预发布的比较器），所以 `0.2.2-alpha.2` 本来就不在范围内，`knownBroken` 让拒绝理由更明确。加载时断言所有已验证宿主与默认宿主都满足范围。
> - 未验证宿主：`getHostCompatibility` 返回 `status: 'unverified'` 与警告，平台取已验证宿主平台的并集，不附装社区插件。新装时没有记录的 SRI，manager 从 `registry.npmjs.org/@deepseek-ai%2Fdsh/<版本>` 取 `dist.tarball` / `dist.integrity` 再走原有的 `verifyReleaseSources` 逐包核验；已有后端则沿用其依赖闭包核验。
> - Node 断言在 `create-preview.mjs`、`tests/compat/run.mjs` 与 manager 的运行时检查里都改为 major 匹配（pnpm 仍精确）。私有 bootstrap 仍下载 `24.22.1`，`install-existing.*` 对已有 Node 的检查仍是精确版本，它决定是否需要下载私有 Node，不属于插件声明。
> - `tests/compat/run.mjs` 不再要求 `--host` 属于精确集合，而是用预览里的 `installer/compatibility.mjs` 判定，结果 JSON 带 `hostStatus`。canary 每个目标版本跑 `run.mjs`（隔离消费者 + 浏览器）和 `npm-install.e2e.mjs`（一行 npm 路径）。目标由 `scripts/upstream-targets.mjs` 从 registry 元数据挑最新的未验证预发布版与正式版（只取比最新已验证版更新的），当前结果 `["0.2.1-rc.5"]`。
> - 未推送，无法手动 `workflow_dispatch`；改为本地对 rc.5 跑同一条 `run.mjs`（Windows x64，Edge）：第一次 browser 层 3 项失败（`installed-loader-shared-instances`、`sidebar-read-edit-save-and-markdown-fold`、`context-real-statistics`），原因是未验证宿主不附装 `dsh-context` / `dsh-better-sidebar`，而这三项检查依赖它们，不是 rc.5 契约变化。于是 `run.mjs` 对未验证宿主改为用 `community --manifest` 装默认宿主的社区组合作为候选（结果 JSON 记 `communityCandidate`）；在同一消费者上补装后用 `--state` 重跑，installation / officialBefore / mcp / lifecycle / webConfiguration / browser（12 项）/ failedUpgrade / unrelatedData / officialAfter 全部通过。结论：rc.5 兼容，矩阵记为「范围内未验证、canary 通过」；按 CONTRIBUTING 写进 `verifiedHosts` 需要 Linux x64 CI 证据与插件 patch 发布，留给 owner 推送后由 canary 补齐。
> - 验收第 2 条：改动后对 `0.2.1-rc.4` 跑完整 `run.mjs`（Windows x64，Edge），9 层全部通过；`npm pack --dry-run` 无 engines 警告。

---

### WP3 行为边界与配置（M2，1 个对话，小）

**现状**：`src/index.ts` 的 `Config` 只有 `enabled`、`collapsedViews`、`foldedReplies` 加上官方 Picker / Conversation / Chat 的字段；`PRESENTATION_PROMPT` 在 `enabled` 为真时无条件注入。

**目标**：模型可见行为可独立开关、默认关闭、文档可见。

**步骤**
1. `Config` 增加 `presentation: z.object({ prompt: z.boolean().default(false), openui: z.boolean().default(true), followups: z.boolean().default(true) })`。
2. `apply()` 仅在 `config.presentation.prompt` 为真时注册 systemPrompt section。
3. 客户端 `client.tsx` 第 123 至 136 行的 `openui` / `followups` slot 注册读取对应开关（配置通过 `ctx.configForms` 或现有 remote 配置通道下发；参考 `foldedReplies` 的传递方式）。
4. 设置页（`settings.general.item` 槽，已有 `TranscriptViewRow` 等）加一行"回答可视化组件（会向模型追加提示词）"开关。
5. `cordis.patch.yml` 的 insert 行 `config` 增加 `presentation: { prompt: false }` 显式默认。
6. 安装器迁移：已有用户若原来启用（即任何已安装版本），迁移时写 `prompt: true` 保持行为不变，并在 `modern-ui-chat-migration.json` 回执里记录。
7. README「核心特性」的 Intelligent UI 条目补一句：默认不改变模型提示词，开启后会追加约 3 KB 指令。

**验收**
- 默认配置下 `dsh --profile <scratch> --dump-config` 的 systemPrompt 无 `modern-ui:response-presentation` 节；开启后有。
- `tests/audit` 新增一个用例覆盖开关三态。

> **WP3 执行记录**
> - `presentation` 标为 `.volatile()`：官方 settings forms 只接受 volatile 节点下的写入，客户端快照也只投影 volatile 字段；不标则设置行写入被 Host 拒绝并回滚（实测 rc.4）。因此 Host 侧不再按 apply 时的值条件注册，而是在 `enabled` 时始终注册 `modern-ui:response-presentation` 节，`text` 为每次 assembly 读取 `presentation.get().prompt` 的 provider，关闭时返回空串（官方 assembler 丢弃空节）。切换开关下一轮对话生效，无需重载。
> - 验收第 1 条的 `--dump-config` 只输出配置不输出提示词，改为：dump 中 `modern-ui` 行默认含 `presentation.prompt: false`（实测）；节内容由 `tests/audit/presentation-switch.test.mjs` 覆盖缺省 / false / true 三态、运行时切换与 `enabled: false`。
> - 实测（rc.4，Windows x64，Edge，`.artifacts/plugin-preview/modern-ui.tgz`）：设置页出现「回答可视化组件」行；选「开启」后 profile `cordis.patch.yml` 写入 `presentation.prompt: true`；选「关闭」后官方写入器删掉与 bundle 默认相同的覆盖，dump 回到 `prompt: false`。
> - `openui` / `followups` 只做配置开关（无设置行），客户端订阅 `configForms.get('modern-ui')`，变化时注销或重新注册对应 code-fence presenter。设置行代码在 `src/presentation-settings.tsx`，纯数据（类型、默认值、8 语言文案、`readPresentation`）在 `src/presentation-switches.ts`，locale 命名空间 `modern-presentation-settings`（`modern-presentation` 已被 presentation-parity 占用）。
> - 偏离第 6 步：迁移没有并入 `modern-ui-chat-migration.json`，而是独立回执 `modern-ui-presentation-migration.json`。chat 回执带 conversionVersion 2 的补跑语义，并入会让已是 v2 的 profile 需要再升版本号才能触发。判定条件：安装前的 effective 配置里已有 `@iroha1145/dsh-modern-ui` 且该行没有 `presentation` 键，即视为旧版本升级，写 `prompt: true`；用户行已显式写过 `presentation.prompt` 则不动。单测在 `tests/compat/profile-settings.test.mjs`。
> - 未覆盖：只走一行 `dsh plugin add` 升级（不经安装器）的旧用户不会被迁移，会变成默认关闭。0.1.0 之前没有发布过 npm 包，这类用户应该不存在；如有，在设置里手动开启。

---

### WP4 宿主侧拆包（M3，2 至 3 个对话，中到大）

**现状**：`src/host-compat/{mcp-client,translator,web-fetch-http,plugin-documents}` 约 4,100 行 + `scripts/migration/preflight.mjs`，经 `scripts/build-host.mjs` 打成 `lib/{translator,mcp-client,web-fetch-http,plugin-documents,migration}.js`；`package.json#dependencies` 因此带 `@modelcontextprotocol/client`、`undici`、`ipaddr.js`、`hosted-git-info`、`execa`。安装器在 profile patch 里用这些入口替换官方同名实例（见 `docs/plugin-host-compat.md`「明确选择的替代插件」）。

**目标**：主包 `@iroha1145/dsh-modern-ui` 只剩 `./`（Config + boot CSS）与 `./client`，`dependencies` 为空；宿主侧功能各自成包或上游化。

**步骤**
1. 逐模块决定去向（建议）：
   - `mcp-client`（拒绝重定向）与 `translator`（拒绝空白译文）：先向上游 deepseek-harness 提 PR；上游合并前以独立包 `@iroha1145/dsh-mcp-client-strict`、`@iroha1145/dsh-translator-strict` 发布。
   - `web-fetch-http`（Undici 8.12.2）：同上，独立包或上游 PR；注意它是从 rc.4 的 `lib/index.js` 派生，上游每版都可能变，是最该上游化的一个。
   - `plugin-documents`（插件文档读取路由）：这是 Modern UI 自有功能的宿主端，保留，但移入 `packages/modern-ui-host-documents` 独立包，主包 client 侧通过 `/api/modern-ui/plugin-document` 路由对接，缺失时降级（不显示文档）。
   - `migration` bin：移入安装器目录 `scripts/distribution/`，不随 npm 包发布。
2. 仓库改为 npm workspaces：根 `package.json#workspaces: ["packages/*"]`；新包各自 `package.json`、`cordis.patch.yml`（如需）、README。
3. `scripts/build-host.mjs` 按包拆分或参数化；`package.json#exports` 删除五个宿主入口；`files` 相应收缩。
4. `src/host-compat/PROVENANCE.json` 与 `THIRD_PARTY_NOTICES.md` 对应段落随代码迁移到新包。
5. 安装器（若保留）：`profile-settings.mjs` 里替换官方实例的逻辑改为"若用户装了对应独立包才替换"，默认不替换。
6. `release.yml` 扩展为多包发布（按 tag 前缀或 changesets）。

**验收**
- 主包 `npm pack --dry-run` 不含 `lib/translator.js` 等五个文件；`dependencies` 为空对象或不存在。
- `tests/compat` 的 Host MCP / 翻译检查改为针对新包运行并通过。
- 主包单独安装（不装任何新包）时 UI 完整可用，插件文档面板显示"未安装文档服务"而非报错。

**待决策**：上游 PR 的提交由谁负责；若上游在 rc.5+ 已修复其中某项，直接删除该模块。

---

### WP5 架构减肥：从替换回到扩展（M3，长期，多个对话）

**现状**：§0.2。7 个 owner 整体替换是兼容只能精确钉死的根因；每个上游 UI 改动都要人工 diff 进 vendor。

**目标**：vendor 行数持续下降；能自动知道上游改了哪些被 vendored 的文件；最终只有真正重写的面（Markdown 渲染、折叠、模型卡、主题）留在包内，其余通过官方 owner + slot 注入实现。

**步骤（按收益排序，每步可独立成 PR）**
1. **漂移检测脚本**（先做，1 个对话）：`scripts/vendor-drift.mjs`，读 `provenance.json` 的 `source` + `sourceSha256`，对指定上游版本的 npm tgz（`@deepseek-ai/dsh-client-ui-*` 各包的 `src/` 若随包发布；否则从 GitHub tag 拉源码）比对，输出"上游已改动且本地为 adapted:true 的文件清单"。接入 WP2 的 canary，作为新 rc 兼容失败时的第一手线索。
2. **owner 逐个评估**，每个 owner 一个对话，产出一页评估文档 `docs/architecture/owner-<name>.md`：列出 Modern 相对官方的实际差异点（功能 / 样式 / 行为），每个差异点标注可否用 slot / CSS 变量 / overlay / 公开服务实现。评估顺序建议：`layout`（1,257 行，差异最可能只是样式）→ `sidebar` → `theme` → `workspace` → `model` → `tool` → `conversation` → `chat`。`primitives` 最后，因为它是其余 owner 的依赖。
3. **按评估结果回收**：差异可注入的 owner，从 `cordis.patch.yml` 删掉对应 `disabled: true`，改为在 `client.tsx` 注入 slot；删除 vendor 子目录；更新 `provenance.json`、`THIRD_PARTY_NOTICES.md`、`plugin-ui-map` 文档。每回收一个 owner 发一个 minor 版本。
4. **必须保留重写的面**（预期：Markdown 渲染与折叠、模型卡、主题、intelligent），把它们从"官方包副本"重构为"Modern 自有实现 + 明确的公开契约依赖"，即不再追随上游文件结构，用自己的测试保护行为；此后上游改动只影响契约层。
5. 每回收一步，在 `docs/compatibility.md` 记录 vendor 行数变化，作为进度指标。

**验收（每步）**
- `tests/compat` 浏览器检查通过；`tests/audit` 通过。
- vendor 行数下降且 `provenance.json` 条目同步删除。
- 第三方 slot 注入（至少用 `dsh-better-sidebar`、`dsh-context` 两个真实插件）在该 owner 面上仍可见。

**待决策（项目方向性，建议 owner 本人拍板后再开 WP5）**：是否接受"最终形态保留 2 至 3 个重写面、其余回归官方"的目标。若不接受（想长期维持全套替换），则 WP5 只做第 1 步，并把 WP2 的 canary 升级为"每个 rc 必跑 + 人工合并上游 diff"的常规流程，预估每个 rc 半天到两天的维护量。

> **WP5 第 1 步执行记录（`wp5/vendor-drift`）**
> - `scripts/vendor-drift.mjs --host <版本>`：npm 上的 `@deepseek-ai/dsh-client-ui-*` 不带 `src/`，源码取自上游 GitHub tag `dsh-v<版本>` 的 codeload 归档（每份约 35 MB，流式解压只留 `provenance.json` 里的源文件）；`npm:<包>@<版本>/<文件>` 来源取自 npm registry。源文件来自 `files`、`adapters`、`translations`（含 `{ja,es,…}` 展开），共 601 个。
> - 实测基线：383 个源文件与 `provenance.json#commit`（`22ddee37`）逐字节一致、172 个不同（本地改写或抓取时已带旧 Modern 补丁）、46 个基线里没有；与 rc.4 tag 一致的只有 251 个，说明 vendor 是按 `22ddee37` 抓的、迁到 rc.4 时没有重新同步。所以报告分两段：相对上一个已验证宿主（canary 线索）与相对抓取基线（累计）。
> - rc.4 → rc.5：5 个需人工合并（`ReasoningContent.tsx`、`ReasoningRow.tsx`、`chat/contract/slots.ts`、`process-activity.ts`、`TranslationBody.tsx`），同目录新增 `ui-chat/src/client/reasoning-text.ts`。`22ddee37` → rc.5 累计：改动 221（需人工合并 181、未打补丁可直接重新复制 40）、删除或改名 41、旧补丁新增 45。
> - 「可直接重新复制」只给 `adapted: false` 且抓取时与基线逐字节一致的文件；抓取时已带旧补丁的原样副本归入需人工合并，避免重新复制时丢掉补丁。
> - 接入 `upstream-canary.yml`：每个宿主一步（`continue-on-error`），报告进步骤摘要与 artifact；失败 issue 引用「相对上一个已验证宿主」一段。单测 `tests/compat/vendor-drift.test.mjs`（不联网，测试内生成 tar.gz 覆盖 ustar 前缀、pax 长路径与全局注释）。

---

### WP6 工程基线（M2 起并行，1 至 2 个对话，小到中）

**现状**：§0.1「测试」「静态检查」「社区文件」。

**步骤**
1. 格式与 lint：选 Biome（单工具、快）；根加 `biome.json`，CI 加 `biome ci .`；首次格式化单独一个提交，便于 blame。
2. 单测：`vitest` 加到根 devDependencies；为纯函数模块补测，优先 `src/vendor/primitives/markdown/{parse,render,highlight}`、`src/vendor/chat/client/conversation-nodes/chat-snapshot-builder.ts`、`src/vendor/conversation/client/conversation/assembler.ts`、`src/vendor/intelligent/client/{sandbox,frame-content,schema}.ts`。现有 `tests/audit/*.test.mjs` 可迁到 vitest 或保留 node:test，二选一，不要两套。
3. CI 分层：`pr.yml`（lint + typecheck + unit + build + audit，目标 < 8 分钟）；`plugin-preview.yml` 保留但 compatibility / consumer 矩阵改为 `workflow_dispatch` + release 触发。
4. 社区文件：`CHANGELOG.md`（Keep a Changelog 格式，从 0.1.0 开始）、`CONTRIBUTING.md`（本地构建、测试分层、兼容矩阵更新流程、vendor 只减不增原则）、`SECURITY.md`（报告渠道、openui 沙箱边界声明）、`.github/ISSUE_TEMPLATE/{bug,compat}.yml`（compat 模板必填宿主版本与 `--dump-config` 片段）、`.github/PULL_REQUEST_TEMPLATE.md`。
5. 依赖更新：`.github/renovate.json`，`@deepseek-ai/*` 单独分组且仅开 PR 不自动合并；其余 devDependencies 按周合并。
6. `.gitattributes` 中 `packages/modern-ui/src/** -text` 是为 provenance 字节一致而设；WP5 回收 vendor 后可逐步收窄。

**验收**：`pr.yml` 绿且时长 < 8 分钟；`npx vitest run` 有 ≥ 40 个用例；上述文件齐全。

> **WP6 执行记录**
> - 单测选 vitest 5，现有 `tests/audit` 与 `tests/compat` 的 node:test 用例一并迁过去，不保留两套：`vitest.config.mjs` 分 `unit` / `audit` / `compat` 三个 project，共 125 个用例（unit 41、audit 55、compat 29）。vitest 5 依赖 vite，而 vite 8 要求 esbuild ≥0.27 的 peer，与仓库钉死的 esbuild 0.25.12 冲突，所以显式钉 vite 7.3.7（自带嵌套 esbuild 0.27）。
> - 新单测覆盖 `intelligent/client/{schema,parse-followups,frame-content,sandbox}`（内容校验、序列化不能闭合 script、嵌套沙箱属性）、`primitives/markdown/{parse,highlight}` 与几个展示小工具。`chat-snapshot-builder.ts`、`assembler.ts` 体量大且依赖宿主 store，本轮没补，留作后续。
> - Biome 2.6 只管 `scripts/`、`tests/` 与根配置：`packages/modern-ui/src` 的字节由 `provenance.json` 记录摘要，`tests/compat/fixtures` 也按原始字节做摘要，都排除。首次格式化单独一个提交（记在 `.git-blame-ignore-revs`）。关掉的规则：`useTemplate`（仓库惯用拼接）、`useDomNodeTextContent`（Playwright 检查有意读可见文本 innerText）、`useIterableCallbackReturn`（`forEach(fn => fn())` 惯用法）；tests 下另关 `noComponentHookFactories`、`noThenProperty`（测试替身）。
> - `pr.yml`：lint、typecheck（client + host）、unit、装 Chromium、build、audit + compat，本地全套 vitest 约 17 秒，预计 CI 总时长在 8 分钟内（未在 CI 实测）。`plugin-preview.yml` 去掉与 pr.yml 重复的回归步骤，触发改为 `workflow_dispatch` 与 `v*` tag：release.yml 用 `GITHUB_TOKEN` 创建的 Release 不会触发其他工作流的 `release` 事件，所以不用 `release: published`。
> - 社区文件：`CHANGELOG.md`、`SECURITY.md`（私密漏洞报告需要 owner 在仓库设置里开启 Private vulnerability reporting）、`.github/ISSUE_TEMPLATE/{bug,compat,config}.yml`、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/renovate.json`（需要 owner 安装 Renovate GitHub App）。
> - 第 6 步（收窄 `.gitattributes` 的 `-text`）依赖 WP5，未动；只新增 `tests/**/*.ts text eol=lf`。

---

### WP7 社区与文档（M3，1 个对话，小）

**步骤**
1. 仓库 topic：`dsh-plugin`、`deepseek-harness`、`cordis-plugin`。
2. README 双语（中文主体 + `README.en.md`），首屏放 2 张截图或 1 个 GIF（明暗主题各一）。
3. FAQ：安装后看不到变化（需刷新 / bundle 未启用）、与 better-sidebar 等插件共存、如何切回官方 UI、宿主升级后插件失效怎么办（指向兼容矩阵与 canary issue）。
4. 提交 deepseek.stream 市场（依赖 WP1 第 6 步）。
5. `docs/architecture.md` 用一张图说明"官方 owner 被禁用 / Modern owner 接管 / slot 注入"的关系，给第三方插件作者看。

**验收**：README 首屏在 GitHub 默认宽度下无需滚动即可看到安装命令与截图。

> **WP7 执行记录（`wp7/docs`）**
> - 第 1 步：npm `keywords` 早已含 `dsh-plugin`、`deepseek-harness`、`cordis-plugin`；GitHub 仓库 topic 属于仓库设置，留给 owner（见 §9.3）。
> - 第 2 步：`README.md` 首屏加语言切换和明暗两张截图，新增 `README.en.md`。截图由 `tests/compat/readme-screenshots.mjs` 生成：在隔离消费者里装预览包与演示模型（`tests/compat/fixtures/demo-provider.mjs`），模型输出推理、调用官方 `grep` / `read` 读演示工作区，再给出带代码块、表格和 `followups` 的回答，无头 Chromium 1280×800 拍亮色（本轮开头，过程展开）与暗色（回答结尾）。不调用任何真实模型。
> - 第 3 步：FAQ 五条（看不到变化、社区插件共存、切回官方界面、宿主升级后失效、是否支持 Desktop），中英文 README 各一份。Desktop 条目引用 WP8 结论：部分支持，原生桥未验证。
> - 第 4 步：按 owner 指示暂不提交市场。核对结果：市场指南（deepseek.stream/guide）只对 Skill 列出 8 个分类（`academic`、`security`、`reverse`、`workflow`、`dev`、`ops`、`prompt`、`tools`），插件 `dsh.category` 只有示例值 `tools`；官方 `dsh-plugin-market-index` 的分类是市场索引自行声明的不透明 id，宿主不校验包里的 `dsh.category`，官方包也都没有声明。`"ui"` 暂不改，提交时以审核为准，必要时改为 `tools`。
> - 第 5 步：`docs/architecture.md` 新增 Mermaid 接管关系图与插件作者约定（只走公开槽位、`modern.*` 槽位不对外、两种状态下各自测一遍）。

---

### WP8 Desktop 双端支持验收（M3，1 至 2 个对话，中；需要一台装有官方 Desktop 应用的机器）

**现状**（复审 §9.4 的展开）

- 插件 `dsh.client.platform` 为 `"web"`；rc.4 宿主的 `@deepseek-ai/dsh-client-modules` 只把 platform 为 `web` 的客户端插件编进模块表。`dsh` CLI 没有终端聊天界面，官方 profile 模板只有 `web`、`acp`、`headless`、`sdk`、`sdk-minimal`；所以"CLI 端"就是 `dsh web` 的浏览器 Web Client，本插件已经覆盖，不存在另一个 CLI 界面需要支持。
- 官方 Desktop 应用是 Electron 外壳，不在 npm 发布，使用保留 profile `desktop`。宿主 CLI（`@deepseek-ai/dsh/lib/plugin-*.js`）对它的处理与 web 不同：不创建、不初始化目录，要求 Desktop 自己先初始化过（`requireDesktopProfile`，否则报错让用户"打开一次 Desktop 再完全退出"），在 profile `package.json` 上加文件锁后走同一条 `runProfilePnpm`；`allow-version` / `revoke-version` 兼容豁免命令同样适用。即 `dsh plugin --profile desktop add @iroha1145/dsh-modern-ui` 在机制上可行。
- Desktop 渲染的是同一套 Web Client：Electron preload 在 `<html>` 上写 `data-platform="darwin"`（Windows 写 `data-windows-titlebar`），官方 layout 样式据此改标题栏留白与菜单底色。Modern 的 vendored 代码已经带着这些分支：`src/vendor/primitives/darwin-desktop.ts`（`isDarwinDesktop`）、`src/vendor/layout/AppFrame.{tsx,module.css}`、`sidebar/SidebarRoot.module.css`、`primitives/Menu*.module.css`，`docs/history/main-and-bold-audit-20261029.md` 还修过一处只在 macOS 外壳出现的菜单透明问题。也就是说代码"知道"桌面外壳，但 Modern 的构建从未在 Desktop 里实际运行过。
- 已知缺口：Electron 专有桥（原生文件拖出 `prepare/start/release`、多窗口）rc.4 没有公开接口，Modern 按 Web 路径降级并在 `docs/architecture.md`、`docs/history/chat-interactions-parity.md` 声明为 unverified；`docs/compatibility.md` 把 Electron 列在 unverified。官方 `ui-open-in-app`、`directory-picker-native` 等 owner 没有被 bundle 停用，理论上在 Desktop 内照常工作，但同样没验过。
- Desktop 内嵌的 DSH 版本由应用自己决定，发布节奏独立于 npm 上的 rc；它是否落在 `hostRange` 内、是否在 `verifiedHosts` 里，每个 Desktop 版本都要单独看。Desktop 不在 npm，WP2 的 canary 无法覆盖它。
- 安装器与 `tests/compat`（含 `npm-install.e2e.mjs`）只建 web profile；README、包 README、兼容矩阵目前都只写 Web Client。

**目标**：对 Desktop 给出三选一的明确结论并落到文档：「支持」「部分支持（列出不工作的面）」「不支持」。不留"理论上可以"。

**步骤**
1. 盘点 Desktop 宿主：在目标机器安装官方 Desktop，打开一次并完全退出；用 Desktop 自带的 `dsh`（`resources/runtime/cli/bin/dsh`，菜单「应用 → 管理 dsh 命令…」加入终端）的 `--version` 确认内嵌 `@deepseek-ai/dsh` 版本，profile 目录以 `DSH_HOME/profiles/desktop` 下出现的 `package.json` 为准。（2026-10-30 实测更正：`--profile desktop --dump-config` 无论 npm 的 `dsh` 还是 Desktop 自带的 `dsh` 都拒绝，报 `profile "desktop" is managed exclusively by the Electron application`；npm 的 `dsh plugin --profile desktop …` 同样被拒，`plugin-*.js` 里的 desktop 分支只经 Desktop 自带的 `dsh` 可达。）核对该版本是否满足 `hostRange`、是否在 `verifiedHosts`；不满足时先按 CONTRIBUTING 评估是否要扩范围，不要用 `allow-version` 硬装来做结论。
2. 安装：用 Desktop 自带的 `dsh` 执行 `dsh plugin --profile desktop add @iroha1145/dsh-modern-ui@<版本>`（M1 未发布前用 Release 的 `modern-ui.tgz`）。记录 CLI 的兼容告警、pnpm peer 警告与退出码；重启 Desktop（Desktop 没有"刷新浏览器"，bundle 切换对应的是重启应用，文档要写清）。
3. 手动验收清单（Desktop 不在 npm，无法进 CI；以人工清单加截图为证据）。把 `tests/compat/browser.mjs` 的 12 项浏览器检查逐条翻成人工步骤作为基线，再加 Desktop 专项：
   - macOS：hiddenInset 标题栏留白、菜单底色（`isDarwinDesktop` 分支）、减少透明度设置、全屏；
   - Windows：自定义标题栏（`data-windows-titlebar`）、最大化/全屏下的覆盖层位置；
   - 两端共有：多窗口同时开两个会话、原生拖出文件到系统、「Open In…」打开工作区目录、原生目录选择器、系统深浅主题切换跟随、窗口缩到窄视口、设置页「回答可视化组件」开关写入后重启仍生效、在插件管理停用 bundle 并重启后官方界面完整恢复。
   每项记"通过 / 降级（说明表现）/ 不工作"，截图与 `--dump-config` 片段放进 `docs/compatibility/desktop-<Desktop 版本>.md`。
4. 可选的半自动化：若 Desktop 支持 `--remote-debugging-port` 或 Playwright `_electron.launch` 能启动它，给 `tests/compat/browser.mjs` 加一个"接到已有 CDP 端点"的入口（例如 `--cdp <url>`），复用现有检查函数；做不到就只保留第 3 步的人工清单。不为此新增任何 Electron 专有代码或 vendored 文件（原则 1）。
5. 文档落地：README 与包 README 加「Desktop」小节（命令、先打开再完全退出的前提、用重启代替刷新、已知不工作的面）；`docs/compatibility.md` 矩阵加 Desktop 行（Desktop 版本、内嵌 DSH 版本、平台、人工验收日期、结论），Electron 相关条目从笼统的 unverified 改为逐项结论；WP7 的 FAQ 引用这里的结论。
6. 发现的问题分流：能用 slot / CSS 变量 / 公开服务修的，走独立 `fix` PR（不在本 WP 内顺手改）；依赖 Electron 桥的，记为"降级"或"不支持"，不伪造 native 调用（§6）。

**验收**
- 至少一台 Desktop（macOS 或 Windows）上第 3 步清单全部有结论，证据文档已提交。
- README、包 README、`docs/compatibility.md` 对 Desktop 的描述一致，且与证据文档逐项对得上；没有"理论上可以"这类表述。
- 本 WP 不改变 `npm pack` 的内容；若第 4 步改了 `tests/compat/browser.mjs`，`npx vitest run` 与现有 web 路径的 `run.mjs` 仍通过。

**依赖**：M1（需要可安装的包或 tgz）；WP2 的 unverified 机制（Desktop 内嵌版本大概率不在 `verifiedHosts`）。建议排在 WP7 之前，FAQ 需要它的结论。

**待决策**
- 是否把 Desktop 纳入承诺的支持范围。纳入意味着每个 Desktop 版本都要重跑一次人工清单（canary 覆盖不到），维护成本按每版半天估。
- 证据平台：只做 macOS、只做 Windows，还是两者都做；Linux Desktop 是否存在以实际发布为准。
- 若 Desktop 内嵌版本长期落在 `verifiedHosts` 之外，是否接受"Desktop 永远是 unverified 宿主"的定位，还是把 Desktop 版本也加进 `verifiedHosts` 的人工接纳流程。

---

## 6. 明确不做的事

- 不重写安装器为"更好的安装器"。它的问题是定位而非质量。
- 不在 WP 里顺带升级 vendored 代码到 rc.5 的实现；那属于 WP2 canary 发现问题后的独立修复 PR。
- 不把 `provenance.json` 删掉或简化；WP5 依赖它。
- 不引入新的宿主侧 monkey patch、模块别名或加载器拦截（现有代码没有，保持）。
- 不削弱 `openui` 沙箱的任何一项限制。

## 7. 待 owner 决策汇总

| # | 决策 | 影响 WP | 建议 |
|---|---|---|---|
| 1 | npm 包名 / scope | WP1 | 保留 `@iroha1145/`，注册同名 npm 用户即可 |
| 2 | 私有运行时安装器是否长期维护 | WP1、WP4 | 保留为可选附件，CI 降频 |
| 3 | 社区插件是否继续默认捆绑 | WP1 | 不捆绑，改为文档推荐 |
| 4 | 架构终态：保留少数重写面 vs 长期全套替换 | WP5 | 前者；后者意味着每个 rc 半天到两天的同步成本 |
| 5 | 宿主侧四个模块上游化由谁推进 | WP4 | owner 本人提 PR，独立包作为过渡 |
| 6 | 根包管理器 npm 或 pnpm | WP0 | npm |
| 7 | Desktop 是否纳入承诺的支持范围 | WP8、WP7 | 先完成 WP8 的人工验收再定；未验收前所有文档只写 Web Client |

## 8. 参考

- 官方 Extension Cookbook：https://deepseek-harness.github.io/deepseek-harness/reference/cookbook/extension-cookbook.md
- 社区插件规范（dsh-plugin-development SKILL）：https://github.com/NanmiCoder/dsh-agent-teams/blob/v0.1.15/skills/dsh-plugin-development/SKILL.md
- 社区插件开发指南（含安装与 Profile 机制）：https://github.com/moneka123/deepseek-harness-plugin-dev-guide
- 市场上架条件：https://deepseek.stream/guide
- 成熟社区插件参照：https://github.com/omdsh-dev/DSH-better-sidebar （`^0.2.1-rc.1` 范围声明 + 旧宿主版本对照表）、https://github.com/bowenliang123/dsh-context （`>=0.2.0-rc.2` + `docs/compatibility.md`）
- 上游 Releases：https://github.com/deepseek-ai/deepseek-harness/releases

---

## 9. 复审记录与待办（2026-10-30，基于 `wp6/engineering-baseline`）

### 9.1 复审结论

WP0、WP1、WP2、WP3、WP6 对照 §2 原则与各 WP 验收逐项核对，均达标。本地 `npm run lint`、`npm run typecheck`、`npm run build`、`npm test`（125 个用例）通过；构建后 `git status` 干净，生成物与提交一致；`npm pack --dry-run` 134 个文件、无 `src/`。相对基线 `179598e`，`src/vendor`、`provenance.json`、`THIRD_PARTY_NOTICES.md`、`licenses/` 零改动（原则 1 与 §6）。WP2 第 3 步要求的前提已核实：rc.2 至 rc.5 四个宿主都钉 `@deepseek-ai/cordis ~4.0.5`、`@deepseek-ai/schemastery ~3.18.5`。

### 9.2 复审修正（已提交）

- 原则 2：`react` / `react-dom` / `cordis` / `schemastery` 的 peer 范围原写死在 `scripts/build-plugin.mjs`，现移入 `compatibility.json#platformPeers`，由 `compatibility.mjs` 导出、构建脚本读取；生成的 `package.json` 不变。
- `docs/host-compat.md`：`tests/migration/...` 改为现存的 `tests/compat/profile-settings.test.mjs`；`node --test tests/host-compat/host.test.mjs` 改为历史记录，并写明「空白译文拒绝」「MCP 重定向拒绝」目前没有自动化回归（原套件在 `00c143e` 随旧测试目录删除）。
- `docs/install.md`：删去「未发布前只能使用真实本地 tgz」的过时表述。
- 根 README：按原则 4 补列 `presentation.openui` / `presentation.followups` 配置项。
- `docs/compatibility.md`、`CONTRIBUTING.md`：写明平台 peers 的来源字段与核对命令。
- `biome migrate`：`biome.json` 的 `recommended: true` 迁为 `preset`。

### 9.3 待办

**owner 操作**
- [ ] 推送并开 PR。五条分支依次叠放（wp0 → wp1 → wp3 → wp2 → wp6），按此顺序合并，或让每个 PR 的 base 指向前一条分支。WP2 对 rc.4 的验收记录提交在 wp6 分支（`6cc6cb4`），wp2 分支本身没有。
- [ ] 配置 `NPM_TOKEN` 或 npm Trusted Publishing，打 `v0.1.0`；发布时把 CHANGELOG 的「未发布」改为日期。
- [ ] 推送后手动 `workflow_dispatch` 一次 canary，取 rc.5 的 Linux x64 结果，按 CONTRIBUTING 写进 `verifiedHosts` 并发 patch 版本。
- [ ] 仓库设置开启 Private vulnerability reporting；安装 Renovate GitHub App。
- [ ] §7 第 4 项（架构终态）拍板后再开 WP5。

**只能在真实 CI 上验证的三项**
- [ ] `pr.yml` 总时长是否在 8 分钟内。
- [ ] canary 的 report job 能否按版本开 issue / 追加评论。
- [ ] `release.yml` 的 `npm publish`：走 Trusted Publishing 时 `NODE_AUTH_TOKEN` 为空串，依赖 npm ≥ 11.5 的 OIDC 流程接管。

**后续 WP 的输入**
- [x] WP4 开工前补回 translator 空白译文拒绝与 MCP 重定向拒绝的自动化回归（见 `docs/host-compat.md`），否则拆包时没有行为基线。→ `wp6b/regression-gaps`：`tests/compat/host-replacements.test.mjs`，10 项。
- [x] WP6 遗留：`chat-snapshot-builder.ts`、`assembler.ts` 单测。→ `wp6b/regression-gaps`：`tests/unit/conversation-assembler.test.ts`（12 项）、`tests/unit/chat-snapshot-builder.test.ts`（7 项），经真实组装器驱动，位置与时间线来自引擎本身。
- [ ] `.gitattributes` 的 `-text` 收窄随 WP5。
- [x] WP7：核对 `dsh.category: "ui"`（市场未给插件分类枚举，暂不改）；README 截图；FAQ「是否支持 Desktop」。→ `wp7/docs`，见 §5 WP7 执行记录。
- [ ] WP7 遗留（owner）：GitHub 仓库 topic 加 `dsh-plugin`、`deepseek-harness`、`cordis-plugin`；发布 npm 后再提交 deepseek.stream 市场。
- [ ] WP4 尚未开始；WP5 只完成第 1 步（漂移检测），架构终态待 §7 第 4 项拍板。

### 9.4 作用面：Web Client 与 Desktop

- **事实**：本插件 `dsh.client.platform` 为 `"web"`。rc.4 宿主的 `@deepseek-ai/dsh-client-modules` 只把 platform 为 `web` 的客户端插件编进 `__DSH_BOOT__` 模块表，其他值直接忽略。`dsh` CLI 本身没有终端聊天界面：官方 profile 模板只有 `web`、`acp`、`headless`、`sdk`、`sdk-minimal`，交互 UI 只有浏览器 Web Client（`dsh web`），其余是 JSONL / headless / ACP / SDK 输出面，UI 插件对它们不起作用。
- **Desktop**：官方 Desktop 应用（Electron 外壳，不在 npm 上发布）使用保留 profile `desktop`，不走上述模板，由应用自己初始化；CLI 支持 `dsh plugin --profile desktop add ...`，前提是先打开过 Desktop 并完全退出（`@deepseek-ai/dsh/lib/plugin-*.js` 的 `requireDesktopProfile`）。官方 layout 样式表含 `html[data-platform=darwin]` 与 `data-windows-titlebar` 规则，说明 Desktop 外壳渲染的是同一套 Web Client。因此 Modern UI 在机制上可以装进 desktop profile，与 web profile 用同一个包。
- **未验收**：没有在 Desktop 上跑过任何一层检查；Electron 专有桥（原生文件拖出、原生目录选择、多窗口、macOS 菜单透明）在 vendored 代码里只按 rc.4 的公开接口降级（见 `docs/architecture.md`、`docs/history/chat-interactions-parity.md`）；安装器与 `tests/compat` 只建 web profile。要宣称「双端支持」，按 WP8 做人工验收并落文档；在此之前文档只应写「Web Client」。
