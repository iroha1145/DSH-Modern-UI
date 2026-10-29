# Store 0.1.4 的当前 profile 限制

`dsh-plugins-store@0.1.4` 不能作为 Modern 独立 profile 的已兼容配套插件。它可以在官方 rc.3、rc.4 Host 中激活，但库存和移除固定指向 `web`，安装计划也固定为 `web`；其 HTTP 安装入口还存在计划归一化后的二次校验缺陷。本项目不通过改写其安装文件、抢占同名工具/路由、模块拦截或伪造进程参数掩盖这些问题。已有用户安装保留，不自动升级、降级或卸载。

## 发布物与验证范围

2026-10-29 从 [npm 0.1.4 元数据](https://registry.npmjs.org/dsh-plugins-store/0.1.4) 下载并核验了以下原始发布物；当时 npm `latest` 仍为 `0.1.4`。

- 包：[dsh-plugins-store-0.1.4.tgz](https://registry.npmjs.org/dsh-plugins-store/-/dsh-plugins-store-0.1.4.tgz)
- SRI：`sha512-px/wYb6dBGoXE+8qpNrdm7b5H/pg7Ov65Ic16wROJxUZPV44wEy+eYIRR7eQ3vyJJxcCsyy28toWrumVt9lABw==`
- 实测：Windows x64、Node `24.22.1`、pnpm `11.28.5`，分别使用只正常安装各自官方 DSH 的 rc.3 和 rc.4 独立依赖树。
- 原 Store 经真实 Loader 准入且 `fiberPhase=active`；实际模块导出只有 `apply`、`inject`、`name`，没有 profile Config 或公开的操作适配入口。
- 这是 Host、HTTP 与真实包操作证据，未将其计为 Store 浏览器兼容成功，也不据此新增 Linux/macOS 支持声明。

浏览器的 React、slots、client-store 来自对应官方 `dsh-web-frontend` 的共享编译产物，并非这些模块都应在 DSH-only 安装下作为独立 Node 包存在。本测试不借用仓库 `node_modules`、`NODE_PATH` 或指向另一宿主的 symlink；Host 记录真实 Cordis 解析来源与实例身份，前端共享实例由浏览器兼容验收另行检查。

## 两个独立缺陷

### 当前 profile 被固定为 web

原发布物 `lib/index.js` 是单行压缩产物。以下上游源码位置便于审阅同一逻辑，测试执行的仍是 npm 原包：

- [installed-plugins.js:5](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installed-plugins.js#L5)：库存参数固定为 `plugin --profile web list --depth=0 --json`。
- [installer.js:20](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installer.js#L20)：可执行计划只接受 `args[2] === 'web'`；后续执行直接使用这组参数。
- [plugin-manager.js:13](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/plugin-manager.js#L13) 与 [plugin-manager.js:32](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/plugin-manager.js#L32)：Windows 移除命令固定 `--profile web`；POSIX 路径和清单写入固定为 `DSH_HOME/profiles/web`。
- [index.js:15](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/index.js#L15) 与 [index.js:35](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/index.js#L35)：工具和 HTTP handler 都关闭在同一套硬编码 runner 上，没有消费 `ctx.profileContext` 或 `ctx.pluginManager`。客户端槽位也未提供操作 provider 的替换契约。

在同一隔离数据目录中，`web` 与 `modern-ui-store-fixture` 各装一个不同的本地标记包，实际启动后者。两个宿主均观察到：Store 库存返回 web 标记、漏掉当前 profile 标记；经官方 CLI 仅向隔离 web 种入移除夹具后，Store 移除的确是 web 中的该包，实际启动 profile 的配置文件保持不变。HTTP 安装先被下面的独立缺陷阻止，因此不把静态的 web 安装参数描述为一次成功安装的动态证据。

### HTTP 安装计划在第二次校验失败

[installer.js:38](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installer.js#L38) 的 `assertInstallPlan()` 返回 `source`、`target`、`args`，丢失 `executable: true`。[HTTP handler:168](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installer.js#L168) 先归一化计划，然后在 [184 行](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installer.js#L184) 交给 `installPlan()`；[第二次校验:125](https://github.com/ZASENJC/dsh-plugins-store/blob/c5c6dbc4c9770954031a9faaa405b1bd21b0471c/packages/dsh-plugins-store/src/installer.js#L125) 又要求该标志为 true。

真实 rc.3、rc.4 请求均返回 HTTP 502、`{"ok":false,"message":"安装计划不可执行"}`。两个 profile 均未写入，loopback 夹具 registry 未收到包请求。该结论限于测试过的 HTTP 安装路径，未用伪造 Agent execution 测试工具安装路径。

## 可复现入口与公开 API 对照

维护者先分别正常安装精确官方后端，例如在两个新目录执行 `npm install --ignore-scripts --save-exact @deepseek-ai/dsh@0.2.1-rc.3` 和 rc.4 对应命令。准备上述原 Store tgz 和精确 pnpm `11.28.5`，然后从本仓库运行：

```powershell
& $node tests/compat/store-profile.e2e.mjs `
  --consumer $rc3Backend `
  --pnpm $pnpmCli `
  --store $store014Tgz `
  --output .artifacts/compat-store/rc3

& $node tests/compat/store-profile.e2e.mjs `
  --consumer $rc4Backend `
  --pnpm $pnpmCli `
  --store $store014Tgz `
  --output .artifacts/compat-store/rc4
```

`$node` 指向实际运行的 Node 24.22.1，`$pnpmCli` 指向 pnpm 的 `bin/pnpm.cjs`，`$rc3Backend`／`$rc4Backend` 是各自含独立 `package.json` 和正常依赖的目录。脚本只使用新建数据目录和无依赖本地夹具包；可选 `--modern <预编译tgz>` 用于最终候选组合，不要求消费者编译。

`result.json` 明确输出 `store.compatibility: "unsupported-current-profile"`。脚本退出 0 表示已复现上述限制并通过公开 API 对照，不能计为 Store 已适配。初次实测证据目录为 `.artifacts/compat-store/rc3-final` 与 `rc4-final`。

对照夹具由实际 Loader 加载，使用这两个宿主均公开提供的接口：

1. `ctx.profileContext.name/dir/installAnchor` 取得真实启动上下文。
2. `readProfilePlugins({binName:'dsh',profileDir,installAnchor})` 读取该 profile 的直接依赖和原始 manifest spec。
3. `ctx.pluginManager.installBundle(localTgz, {saveExact:true})` 与 `removeBundle(name)` 在同一当前 profile 完成真实安装和移除。

对照中的 web `package.json`、`pnpm-lock.yaml`、`cordis.patch.yml`、`pnpm-workspace.yaml` 和 `.npmrc` 哈希保持不变，nullable、显式 false 与未知嵌套 metadata 保留。这证明宿主已有正确能力，未证明旧 Store 通过未提供的入口调用了这些能力。

## 可独立提交给上游的最小修复

该方案尚未发送消息、创建上游 PR 或发布包，也未应用到用户安装的 0.1.4：

1. 在 `src/index.js` 的 `inject` 声明加入 `profileContext`、`pluginManager`，在 `apply(ctx)` 中创建一份当前 profile 操作对象。工具和三条 HTTP handler 共用该对象，移除 `runnerOptions()` 对 `process.argv[1]` 和固定 profile 的依赖。
2. 用一个小型 `src/current-profile.js` 封装公开接口。库存使用 `readProfilePlugins()`，保留直接依赖名称、版本及 manifest spec；安装与移除分别委托 `ctx.pluginManager.installBundle()`／`removeBundle()`，遵守其锁、卸载、失败恢复、取消与重启结果。不另写 web 清单或 bundle 列表。
3. 修复 `assertInstallPlan()`，使合法计划归一化后仍保留 `executable:true`，并测试归一化结果可再次验证。继续核验目录来源、target 与 spec；执行目标 profile 来自宿主上下文，不能来自浏览器提交或远端目录的 `args[2]`。
4. 删除 `src/plugin-manager.js` 中固定 web 的命令和 `resolveWebProfileDir()` 手动清单写入。若暂留旧 CLI 路径供其他用途，也不能作为当前 profile 操作的静默 fallback。
5. `build.mjs` 将使用到的 `@deepseek-ai/dsh-app-boot` 保持为宿主 external；不打包另一份 Cordis 或宿主服务。界面及工具文本展示实际 profile，按真实 `application` 结果决定是否提示重启。新版本声明须以该发布物的加载和浏览器验证为准。
6. 为三个共享操作加入真实双 profile 回归：固定版本的官方宿主、本地夹具包、工具与 HTTP 使用相同 provider；验证库存、安装、移除都针对实际 profile，web 五个配置文件逐字节保留，并覆盖取消、失败及卸载。原 HTTP 二次校验缺陷应有独立的最小回归。

在上游提供并验证此类版本之前，Modern 默认配套排除 0.1.4；用户仍可通过官方当前 profile 插件管理入口管理依赖。本项目不把停用或升级用户已有 Store 当作兼容修复。
