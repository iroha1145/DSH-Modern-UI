# PR #5 macOS / Linux 复核与修复

复核日期：2026-10-27，基线 `65a6ef283f4008041318682132419d69d37a02bb`。PR 在 Windows 上开发，五平台消费 CI 已通过；本轮在 macOS arm64（macOS 27.0.1）本机补做 CI 没有覆盖的路径：从仓库构建预览包、用一份**真实已有数据目录的副本**（含自定义 `web` profile、第三方插件、`!!js` 表达式、会话与工作区记录）安装、再做升级 / 状态 / 校验 / 回退 / 卸载。Linux 没有本机容器环境，以当前提交的 Linux x64/arm64 消费 CI 产物和下文代码核验为准。

## 发现并修复

| 条目 | 触发条件 | 后果 | 处理 |
| --- | --- | --- | --- |
| 入口脚本经符号链接路径调用时静默退出 | `manager.mjs`、`lifecycle.mjs`、`install-existing.mjs`、`native-probe.mjs`、`verify-release.mjs`、`modern-ui-data` 以 `node <路径>` 直接运行，且路径含符号链接（macOS 的 `/tmp`、`/var`、`os.tmpdir()`，或链接过来的预览目录 / 家目录） | Node 会把主入口解析成真实路径，`process.argv[1]` 与 `import.meta.url` 的字面比较失败，脚本什么都不做并以 0 退出；`bootstrap.sh` 据此把空输出当作核心阶段结果继续执行。macOS 本机 `npm test` 因此有 3 项失败（CI 的 Linux 临时目录不是链接，没有暴露） | 新增 `scripts/distribution/entrypoint.mjs`，用 `realpathSync` 两边取真实路径再比较；六处入口统一改用。`install-existing-roots.test.mjs` 新增经符号链接目录分别调用 Shell 与 JS 入口的回归，在任何平台都会执行 |
| 网页自检把官方「跳过 bundle」警告当成致命错误 | 数据目录里的 `web` profile 选择了固定官方版本不再发布的 bundle（本机实例：`@deepseek-ai/dsh-personalized-recommendations`，来自旧补丁构建） | 官方加载器只打印一行 `dsh: skipping profile bundle "...": Error: ...` 并正常启动，但 `web-self-test.mjs` 的正则匹配到其中的 `Error:`，整个安装失败 | 抽出 `auditStartupOutput()`：先摘出并去掉这一类警告行，再做原有的致命错误判断；结果新增 `skippedBundles` 与提示文字，安装成功但明确报告哪些 bundle 被跳过。新增 `web-self-test.test.mjs`，用官方原文验证警告放行、其他错误仍失败 |
| 终端 Ctrl+C 让官方进程收到两次 SIGINT | 在终端里运行 `dsh-ui` 后按 Ctrl+C（或关闭窗口的 SIGHUP） | 终端把信号发给整个前台进程组，启动器又转发一次；官方退出控制器把第二次信号当作「立即强制退出」，跳过最长 5 秒的有序清理（会话写入、子进程回收）。独立审查用进程组投递复现：子进程 3 次都收到 2 次 SIGINT | `launch` 在 POSIX 上以 `detached: true` 让官方进程独占一个进程组，信号只经启动器转发一次。`launch-lifecycle.test.mjs` 新增「进程组投递只到达一次」用例（去掉修复时该用例失败），夹具改为记录每一次投递 |
| 启动环境把安装开关漏给代理的 shell | 用 `dsh-ui` 启动后，代理在用户项目里运行 `npm install`、`pnpm i` 等 | `npm_config_ignore_scripts=true` 让 npm/pnpm/yarn 静默跳过所有安装脚本，`npm_config_store_dir` 把用户项目的 pnpm 仓库改到程序目录，私有 Node 排在 PATH 最前遮住用户的 Node，`NODE_OPTIONS`/`NODE_PATH` 被清空。官方 bash 工具只过滤含 KEY/TOKEN 等的变量，其余照单继承 | 新增 `launchEnvironment()`：只设 `DSH_HOME`，PATH 前面只放固定版本 pnpm 的包装目录（官方插件管理器按 PATH 找 `pnpm`），私有 Node 放到 PATH 末尾；安装器自己的 spawn 仍用原来的 `runtimeEnvironment()`。为保证运行时官方插件管理器与安装时用同一个 pnpm 仓库，新建 profile 的 `pnpm-workspace.yaml` 没写 `storeDir` 时补上 `<程序目录>/store`（已写的不动）。回归：`launchEnvironment` 不含安装开关、store 只在缺省时固定 |
| 每次启动全量摘要核对耗时 | 每次 `dsh-ui` 启动 | 567 个包逐文件串行读取，本机 7.2 秒；审查者用开发依赖闭包量到 20 秒以上 | `integrity.mjs` 的 `snapshot()` 改为 32 路并发读取并计算摘要（遍历顺序与符号链接拒绝不变），本机 `verify` 从 7.2 秒降到 1.7 秒。全量核对本身保留 |
| 自检可能触发并打断到期的定时提醒 | 数据目录里有已到期的 `dsh-schedule` 提醒时安装或升级 | 自检在真实数据目录上启动官方进程约几秒，调度器会立即投递到期提醒并开始一轮对话，随后被 SIGTERM 打断，提醒已标记投递而丢失，还产生模型费用 | 自检附带 `--patch` 覆盖层停用 `schedule` 条目，并对这次运行设置 `DSH_TELEMETRY_DISABLED=1`；正常启动不带覆盖层 |
| 安装失败后残留本轮目录 | 任何在创建代际目录之后的失败（上一条就是实例） | 程序目录多出一个无人引用、约 1.3 GB 的 `versions/<uuid>`，数据目录多出一个带 node_modules 的 `profiles/modern-ui-<uuid>`；重试一次就再多一份 | `manager.mjs` 的 `install` 把分阶段安装包进 `try`，失败时只删除本轮新建的代际目录和暂存 profile；`release-cache`、`store`、既往代际、来源 profile 与旧选择一律不动。`integrity.test.mjs` 新增回归 |

其他按审查意见一并改的小项：启动器的工作目录改为调用它的目录（原来是数据目录，这会让不带工作区的会话创建和沙箱回退根目录落到含凭据的数据目录里），Linux 的 Node 归档改为 gzip（最小化系统不再需要 `xz`），POSIX 上不再因路径含 `$ % " \`` 而拒绝（包装脚本用单引号，这些字符只对 Windows 桥有意义），文档里「SIGTERM 为 143」改为官方进程自己处理 SIGTERM 并以 0 退出。`artifacts.mjs` 的 `download()` 对连接中断、超时和 429/502/503/504 最多重试三次并在报错里写明地址（macOS Intel 的一次消费 CI 在下载官方包时只留下一句「fetch failed」就整个失败）。审查里没有改的：已有精确 Node 路径会把 Homebrew/nvm 的真实路径写进启动器（文档说明）、macOS 上通配地址监听者与回环端口租约不冲突（概率极低，记录）、`npm -g` 安装的官方包依赖解析可能向上找到其他全局包（与 Node 一致）。

## 本机实测（macOS arm64，Node 24.22.1）

数据目录副本来自 `cp -c -R ~/.dsh`（去掉凭据与 `.env`），模型地址指向不可达端口，整个过程不发出模型请求。

- 迁移结果：`modern-ui` 条目得到 `models`、`prices`、`pricesUpdatedAt`、`collapsedViews` 与 `busyEnter`；`mcp-exa` 行的 `headers: !!js '…'` **原样保留**在停用的原行与新的 `modern-ui-compat-mcp-exa` 行里，没有被求值写回，环境变量里的密钥不会落盘。
- 复制的 profile 带着 `pnpm-workspace.yaml` 的 `storeDir`，官方 `dsh plugin install` 以它为准（本机落到 `~/Library/pnpm/store/v11`），没有使用程序目录下的 `store`；依赖安装正常，`github:` 来源的 `dsh-exa-mcp` 与 `dshmarket@1.70.1` 都装上了。这是记录，不是本轮改动。
- 第一次试安装在修复前失败于网页自检（上表第二条），修复后重跑成功：核心阶段约 49 秒（Node 与官方包已在本机缓存），来源核验 567 个包，原生探针（会话写锁、子进程、终端、ripgrep 15.0.0）通过，网页自检 HTTP 200 / API 401 / 403 通过，三个社区插件 `same-skip`（从复制的 profile 里带过来，没有重装）。
- 用生成的 `dsh-ui --no-open --host 127.0.0.1 --port 3091` 启动：从启动器到官方「ready」11 秒，其中约 9 秒是每次启动都做的官方文件全量摘要核对（567 个包），官方进程本身 1.8 秒。无头 Chrome 打开页面：Modern UI 的侧栏、工作区「Kimi」及其会话列表（含「展开其余 13 个会话」）、输入框模型卡片（DeepSeek-V4.1-Flash，推理等级「最高」）都在，控制台无错误；启动器以数据目录为工作目录，没有影响会话列表（工作区来自共享的 `storages/workspace.json`）。
- 向启动器发 SIGTERM，启动器与官方子进程 3 秒内一起退出；运行期间 `status` 可用，`verify` 被操作锁拒绝。
- 同一程序目录第二次安装（升级）：复用上一代的官方包与来源账本，`previousGeneration` 记录正确，profile 从上一代的 `modern-ui-<uuid>` 复制，三项迁移均报告 `alreadyMigrated`，跳过的 bundle 仍被报告。随后 `verify`、`community --check`、`rollback`（回到第一代，启动器 `--help` 正常）、`uninstall`（两次，幂等；启动器给出友好提示并以 1 退出）、再安装（通过 `recovery.json` 复用原数据目录与 profile）全部通过；结束时原 `web` profile 与真实目录逐文件一致。
- 「已有官方包」入口 `install-existing.sh OFFICIAL_PACKAGE_JSON PROGRAM_ROOT DATA_HOME`，`DSH_MODERN_NODE` 指向精确 Node：全新数据目录，72 秒完成，社区插件三项 `installed`，不下载 Node 与官方包。
- 每一代都会在数据目录多一个 `profiles/modern-ui-<uuid>`（含 node_modules），与代际目录一样全部保留；这是既有设计，没有改。

## 没覆盖到的范围

- Linux 仍只有 CI：ubuntu-24.04 x64 / arm64 的新用户安装、来源核验、官方联网配置与浏览器验收通过；本机没有容器或虚拟机，没有在 Linux 上跑过「已有数据目录」路径。
- Windows 不在本轮范围，上一轮记录不变。
- 没有在真实付费模型上发消息。
