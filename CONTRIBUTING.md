# 参与贡献

## 本地环境

- Node.js 24（CI 使用 `24.22.1`），仓库用 npm 与 `package-lock.json`。
- `npm ci --ignore-scripts` 安装依赖，`npm run build` 编译插件，`npm run preview` 生成 `.artifacts/plugin-preview`。
- `npm run dev:layout` 构建当前插件并启动真实 DSH 布局预览，终端会打印本地地址。预览使用仓库的官方 rc.4 依赖、本地示例模型和本仓库独立的 `.artifacts/layout-preview/home`，不调用外部模型、不使用日常 DSH 数据；发送任意普通消息可查看中文长文、代码和表格。`npm run dev:layout -- --demo surfaces` 展示卡片、输入控件、表格、图表、Popover 和 HtmlView；可用 `--repo <工作副本>` 与 `--root <独立目录>` 并行比较不同版本，root 会记录所属仓库以防串用。Ctrl+C 停止。
- 提交前：
  ```bash
  node node_modules/playwright-core/cli.js install --with-deps chromium firefox webkit
  npm run lint
  npm run typecheck
  npm run build
  COMPAT_BACKEND_PACKAGE=node_modules/@deepseek-ai/dsh/package.json npm test
  ```
  `npm run format` 按 Biome 配置改写 `scripts/`、`tests/` 和自有产品 TS/TSX。产品源码都纳入 lint；`vendor/` 与 `host-compat/` 保留上游格式，只启用配置中列出的基础规则。其 Hook factory、依赖捕获、按位置构造的静态子节点和经过边界处理的 HTML 各有原实现契约，暂不批量套用对应规则；修改时仍须行为审查、严格类型检查和回归测试。`provenance.json` 按原始字节记录登记文件的摘要，修改后须同步更新。

构建会写入 `packages/modern-ui/lib/build-metrics.json`（原始字节、gzip level 9 / mtime 0、实际包版本与输出贡献）和 `.artifacts/build-metafiles/`（未丢失嵌套依赖位置的原始元数据），PR CI 保存这些附件。`scripts/client-budget.json` 分别限制首包为 4,500,000 原始字节与 1,250,000 gzip 字节、全部客户端分块合计为 10,000,000 原始字节与 2,200,000 gzip 字节；嵌入的 Worker 源码也计入总量。超过时构建失败，调整预算须给出贡献分析与原因。KaTeX 每个字体保留 WOFF2，删除支持浏览器不会使用的重复 WOFF/TTF 内联副本；所有高亮语言仍随插件安装，按需加载。

## 测试分层

| 层 | 位置 | 命令 | 内容 | 何时跑 |
| --- | --- | --- | --- | --- |
| unit | `tests/unit/*.test.ts` | `npm run test:unit` | 纯函数：openui-lang 代码块识别与「发给助手」消息拼接、生成的提示词是否最新、markdown 语法、高亮，会话组装器与聊天快照构建器等 | 每次提交，PR 门禁 |
| audit | `tests/audit/*.test.mjs` | `npx vitest run --project audit` | 先 `npm run build`；打包体积、jsdom、真实 Chromium 中的交互和布局，以及 Chromium/Firefox/WebKit 的高亮回归 | PR 门禁 |
| compat（单元） | `tests/compat/*.test.mjs` | `npx vitest run --project compat` | 安装器选择、profile 迁移、聊天契约，翻译与 MCP 替代插件的行为基线；先 `npm run build`，需要 `COMPAT_BACKEND_PACKAGE` | PR 门禁 |
| compat（隔离消费者） | `tests/compat/run.mjs` | `npm run test:compat -- --preview .artifacts/plugin-preview --host <版本> --root <隔离目录>` | 装一套独立的官方宿主，跑 MCP、生命周期、浏览器、升级失败回滚等 9 层 | 改到安装或兼容逻辑时；CI 在手动触发和 `v*` tag 时跑 |

[`pr.yml`](.github/workflows/pr.yml) 跑前三层；[`plugin-preview.yml`](.github/workflows/plugin-preview.yml) 跑已验证宿主 × Linux/Windows 的隔离消费者矩阵与五平台安装矩阵；[`upstream-canary.yml`](.github/workflows/upstream-canary.yml) 每天对上游新版本跑隔离消费者。

仅测试脚本变化、已有同产物完整证据时，可手动填写 `host` / `runner` 定点重验并启用 `skip_consumers` 复用安装检查；默认手动运行和所有版本 tag 仍执行完整矩阵，`host` 必须在已验证清单内。

## 约束

- 不放宽 OpenUI 组件边界（见 [SECURITY.md](SECURITY.md)）；不引入对宿主的 monkey patch。
- `packages/modern-ui/src/vendor/` 里从官方 DSH 源码复制来的拷贝只减不增：可以删掉不再需要的拷贝、改为使用官方公开导出，但不新增；删掉文件时同步删掉它在 `provenance.json` 里的条目，其余记录不删不简化。第三方上游的拷贝（`vendor/openui/` 的 OpenUI 组件库、厂商标志）各自用 `*-upstream.json` 记录来源与逐文件哈希，改动后同步刷新。
- 改了 `packages/modern-ui/src` 下登记过的文件，要刷新它在各清单里的 `targetSha256`；原样副本（`adapted: false`）改动后改为 `adapted: true`。`provenance.json` 的 `host` 段和 `src/host-compat/PROVENANCE.json` 记的是同一批文件，两处都要改。`tests/unit/provenance-digests.test.ts` 会逐条核对摘要与文件的原始字节。
- 安装依赖用 `npm ci --ignore-scripts`（CI 同样如此）：`@openuidev/lang-core` 的安装脚本默认会发一次匿名安装统计，也可以设 `DO_NOT_TRACK=1` 关掉。改了 `vendor/openui/` 的组件或提示词选项后运行 `npm run prompt:openui`。
- 用户可见的改动写进 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased`。
- 提交信息格式：`feat|fix|docs|chore|test(scope): 中文描述`，一个工作包一个分支。首次格式化提交记在 `.git-blame-ignore-revs`，本地可用 `git config blame.ignoreRevsFile .git-blame-ignore-revs`。

## 接纳新的官方宿主版本

插件声明的是宿主**范围**（`compatibility.json#hostRange`，写进 `engines.dsh`、`dsh.compatibleHost` 和 `@deepseek-ai/dsh-*` peers）；范围内但没验证过的版本可以安装，安装器会打印警告。`verifiedHosts` 记录真正跑过完整兼容套件的版本。

每天的 [Upstream canary](.github/workflows/upstream-canary.yml) 对 `hostRange` 内最新的未验证预发布版和正式版跑 `tests/compat/run.mjs` 与 `tests/compat/npm-install.e2e.mjs`，失败时开 issue `upstream: <版本> 兼容失败`。范围外的最新版本只有比范围内最新的已发布版本（含已验证宿主，排除 `knownBroken`）更新时才自动排进 canary：例如范围内已有 `0.2.2-rc.3` 时，不再反复检查范围外的 `0.2.2-alpha.3`，但仍会检查后续的 `0.2.3-alpha.1` 或 `0.3.0-alpha.1`。范围外版本在范围检查处立即失败，这个 issue 不是兼容结论，而是提醒按下面第 4 步评估要不要扩大 `hostRange`；扩大后再手动运行 canary（`host` 填该版本）验证。显式填写 `host` 仍可探测旧版本，不受自动筛选影响。安装器不给未验证宿主附装社区插件；canary 则把默认宿主的社区组合作为候选装上（结果 JSON 的 `communityCandidate`），通过即说明该组合可以写进新宿主的 `communityPlugins`。

canary 同时对每个宿主跑 `node scripts/vendor-drift.mjs --host <版本>`，列出 `provenance.json` 记录的上游源文件里哪些被这个版本改了（报告进步骤摘要、artifact 和失败 issue）。宿主替代插件（翻译、MCP 客户端、网页抓取、插件文档）另有一份来源清单，canary 再跑一次 `--provenance packages/modern-ui/src/host-compat/PROVENANCE.json`，报告在 artifact 的 `host-drift.md`。npm 包不带 `src/`，所以源码取自上游 GitHub tag `dsh-v<版本>` 的源码归档；`npm:` 来源取自 npm registry。报告分两段：

- **相对上一个已验证宿主**：新 rc 兼容失败时先看这里，通常只有几个文件。
- **相对 vendor 抓取基线**（`provenance.json#commit`）：vendored 拷贝累计没跟上的全部改动。「需人工合并」包括本地改写过的和抓取时已带旧 Modern 补丁的；「可直接重新复制」只有未打补丁的原样副本，重新复制后要同步 `provenance.json` 的两个摘要；「两侧都没有」是旧补丁新增的文件。

本地加 `--cache <目录>` 复用下载的归档，`--json` / `--markdown` 输出到文件。漂移只是信息，不让 canary 失败。

通过后按下面的步骤接纳：

1. 取官方包的完整性：
   ```bash
   npm view @deepseek-ai/dsh@<版本> dist.tarball dist.integrity
   ```
2. 在 `scripts/distribution/compatibility.json#verifiedHosts` 加一项，复制相邻宿主的结构：`platforms`（只写实际有 CI 证据的平台）、`officialSource`（`name`、`version`、`channel: "exact npm release"`、`url`、`integrity`）、`communityPlugins`（只写和该宿主一起验证过的组合）。
3. 如果新宿主要成为默认新装版本，同时改 `defaultHostVersion`。
4. 版本落在 `hostRange` 之外（例如 `0.3.0`）时，先确认 `compatibility.json#platformPeers` 里的 peers（`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`react`）仍与新宿主匹配（`npm view @deepseek-ai/dsh-client-ui-slots@<版本> dependencies`），再改 `hostRange`；已知不兼容的版本写进 `knownBroken` 并注明原因。
5. `npm run build`，跑上面的回归测试（包含 `tests/compat/official-controls.mjs` 对实际官方发布 JS/CSS 的类名和结构契约检查；新宿主给某个官方样式模块换了哈希时，这项检查会一次列出缺的全部类名，按 `packages/modern-ui/src/official-controls.css` 顶部的说明，把新类名并列写进对应规则的 `:is()`），在 [`docs/compatibility.md`](docs/compatibility.md) 顶部矩阵加一行（插件版本、宿主、平台、日期）。独立消费者矩阵的 `COMPAT_TEST_DRIVER` 需同时安装 Playwright 和 TypeScript，后者只用于读取官方发布物的语法结构。
6. 递增 `runtimeVersions.plugin` 的 patch 位（同步根 `package.json` 与 `package-lock.json`），提交后先在 main 上手动运行 [Official runtime plugin preview](.github/workflows/plugin-preview.yml)，五平台安装、隔离消费者与同一 tgz 的 `dsh plugin add` 一行安装全部通过后再打 `v<版本>` tag，由 release 工作流发布。release 工作流不等这些矩阵，tag 一推就会发布到 npm。
