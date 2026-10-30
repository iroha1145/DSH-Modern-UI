# 参与贡献

## 本地环境

- Node.js 24（CI 使用 `24.22.1`），仓库用 npm 与 `package-lock.json`。
- `npm ci --ignore-scripts` 安装依赖，`npm run build` 编译插件，`npm run preview` 生成 `.artifacts/plugin-preview`。
- 回归测试：
  ```bash
  node --test tests/audit/*.test.mjs
  COMPAT_BACKEND_PACKAGE=node_modules/@deepseek-ai/dsh/package.json node --test tests/compat/*.test.mjs
  node node_modules/typescript/bin/tsc --project tsconfig.client.json --noEmit --noUnusedLocals --noUnusedParameters
  ```

## 约束

- 不弱化 `openui` 沙箱；不引入对宿主的 monkey patch。
- `packages/modern-ui/src/vendor/` 只减不增；不删除或简化 `provenance.json`。
- 提交信息格式：`feat|fix|docs|chore|test(scope): 中文描述`，一个工作包一个分支。

## 接纳新的官方宿主版本

插件声明的是宿主**范围**（`compatibility.json#hostRange`，写进 `engines.dsh`、`dsh.compatibleHost` 和 `@deepseek-ai/dsh-*` peers）；范围内但没验证过的版本可以安装，安装器会打印警告。`verifiedHosts` 记录真正跑过完整兼容套件的版本。

每天的 [Upstream canary](.github/workflows/upstream-canary.yml) 对最新的未验证预发布版和正式版跑 `tests/compat/run.mjs` 与 `tests/compat/npm-install.e2e.mjs`，失败时开 issue `upstream: <版本> 兼容失败`。安装器不给未验证宿主附装社区插件；canary 则把默认宿主的社区组合作为候选装上（结果 JSON 的 `communityCandidate`），通过即说明该组合可以写进新宿主的 `communityPlugins`。通过后按下面的步骤接纳：

1. 取官方包的完整性：
   ```bash
   npm view @deepseek-ai/dsh@<版本> dist.tarball dist.integrity
   ```
2. 在 `scripts/distribution/compatibility.json#verifiedHosts` 加一项，复制相邻宿主的结构：`platforms`（只写实际有 CI 证据的平台）、`officialSource`（`name`、`version`、`channel: "exact npm release"`、`url`、`integrity`）、`communityPlugins`（只写和该宿主一起验证过的组合）。
3. 如果新宿主要成为默认新装版本，同时改 `defaultHostVersion`。
4. 版本落在 `hostRange` 之外（例如 `0.3.0`）时，先确认 peers（`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`react`）仍匹配，再改 `hostRange`；已知不兼容的版本写进 `knownBroken` 并注明原因。
5. `npm run build`，跑上面的回归测试，在 [`docs/compatibility.md`](docs/compatibility.md) 顶部矩阵加一行（插件版本、宿主、平台、日期）。
6. 递增 `runtimeVersions.plugin` 的 patch 位（同步根 `package.json` 与 `package-lock.json`），提交后打 `v<版本>` tag，由 release 工作流发布。
