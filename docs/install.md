# 官方 DSH + Modern UI 安装

主渠道是 npm：在已有的官方 DSH 上执行 `dsh plugin --profile web add @iroha1145/dsh-modern-ui` 并刷新浏览器（见 [README](../README.md)）。下文是可选的一键隔离环境安装器，适用于没有现成 DSH 或想隔离数据的场景。安装器默认新装使用官方 `@deepseek-ai/dsh@0.2.1-rc.4`；已有后端保留实际版本，支持的宿主范围、已验证版本和平台见[向后兼容说明](compatibility.md)。安装器的私有运行时固定 Node `24.22.1`、pnpm `11.28.5`。新会话使用官方插件配置管理联网工具；Modern UI 自定义会话联网按钮、命令和协议已取消，不是安装前提。

## 优先：已有官方 DSH 一条命令

在已准备的安装器目录运行（路径替换为实际文件）：

已有 Node 24.22.1 时，在解压的预览根目录执行：

```powershell
node ./install-existing.mjs --backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json'
```

可加 `--root 'D:/DSH Modern/program' --home 'D:/DSH Modern/data'`；Node 不匹配时明确拒绝。没有精确 Node 时使用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install-existing.ps1 -Backend 'D:/official/node_modules/@deepseek-ai/dsh/package.json'
```

PowerShell 参数只对这个进程生效，解决 Windows 默认 Restricted 对本地脚本的限制；不修改系统或用户执行策略。

预览根入口已经携带 `modern-ui.tgz` 路径和实际 SRI；源码对应 `scripts/distribution/install-existing.mjs` / `.ps1`。它调用官方正常 profile / plugin 管理，不改写官方包。安装器只使用预览目录自带的 `modern-ui.tgz`，不从 npm registry 拉取插件包；要用 npm 包请走 README 的一行安装。

可选 `-Root` 指定程序目录，`-DataHome` 指定独立数据目录。默认程序位于 LocalAppData 的 DSH-Modern-UI/program；首次数据目录使用新 UUID，不自动读取真实 `~/.dsh`、旧聊天或其他 profile。再次更新同一程序目录时，只沿用它自己 current.json 中记录的数据目录。`-Node` 可指定已有精确 Node；PATH 上 Node 不匹配时自动使用私有 bootstrap，不修改系统 Node。已有精确 Node 时不重新下载它，pnpm 仍私有准备。

官方 `dsh plugin --profile <name> add <tgz>` 会初始化未知 profile，但默认只有 base bundle；`--from-default-profile` 属于启动/配置命令，不属于 plugin add。仅一条裸 add 不足以初始化完整 Web UI，因此薄 wrapper 先安全建立独立 Web profile，再执行官方 plugin add 和自检。它不覆盖其他 profile。若显式在已知数据目录使用 `--from-profile`，只读复制该 profile 配置到新 generation，源文件前后摘要保持一致；不转换会话。

POSIX 对应入口：

```sh
sh ./install-existing.sh /absolute/official/package.json '/path/to/program' '/path/to/data'
```

`install-existing.sh` 和直接运行 `install-existing.mjs` 的默认程序目录一致：`${XDG_DATA_HOME:-$HOME/.local/share}/dsh-modern-ui/program`。如果只有旧版大写 `DSH-Modern-UI` 目录存在，两种入口均沿用它及其安装记录中的数据目录；若大小写两套目录同时存在且实际是不同目录，安装会在下载或写入之前拒绝，必须通过 `PROGRAM_ROOT` 位置参数或 `--root` 明确选择。符号链接或大小写不敏感文件系统指向同一目录时不会误判，也不会合并、迁移或删除数据。

`DSH_MODERN_NODE` 可指定 Node 路径；Shell 入口找不到精确 Node 时自动使用私有 bootstrap，JS 入口要求已有精确 Node。生成的预览入口沿用同一目录选择规则。平台验收以当前提交的 CI 为准，本地 Windows 运行不代表已经执行 POSIX 信号和 Shell 检查。

「已有精确 Node」路径会把该 Node 的真实路径写进 `current.json` 和启动器（Homebrew 的真实路径带版本号的 Cellar 目录、nvm 的版本目录）；之后升级或卸载这个 Node 会让启动器找不到解释器，需要重新安装。要避免这一点，用 bootstrap 入口让安装器准备私有 Node。POSIX 的 bootstrap 需要 `curl` 和 `tar`；Linux 的 Node 归档已改用 gzip 格式，不再依赖 `xz`。

## 指向已有数据目录

`DATA_HOME`（或 `--home`）可以是已经在用的 DSH 数据目录。安装器只读取其中的 `profiles/web`（或上一代际记录的 profile），复制成新的 `profiles/modern-ui-<uuid>` 再装插件；会话、工作区记录和原 profile 原样保留，安装结束会按文件摘要核对原 profile 没有被改动。复制的 profile 如果选择了固定官方版本不再发布的 bundle，官方加载器会跳过它并打印一行警告，安装照常完成，`webSelfTest.skippedBundles` 列出被跳过的名字；要去掉这行警告，从新 profile 的 `package.json` 的 `dsh.profile.bundles` 里删掉它。`cordis.patch.yml` 里的 `!!js` 表达式按原文搬运，不会被求值写回。旧 profile 里 `ui-chat` 的 `foldedReplies`（补丁独有）会搬进 `modern-ui` 行，回执 `modern-ui-chat-migration.json`；已经迁移过的 profile 下次升级时补做。复制的 `pnpm-workspace.yaml` 若写了 `storeDir`，官方 profile 管理器安装依赖时以它为准。

聊天偏好：复制出的 profile 里 `ui-chat` 行的 transcriptView、collapseTiming、foldedReplies、performanceUsage、linkOpening 会搬进 `modern-ui` 行（已有值不覆盖，原行保留；回执 `modern-ui-chat-migration.json`，conversionVersion 2，备份 `modern-ui-chat-before-migration-v2.yml`；2026-10-28 之前只搬过 foldedReplies 的 profile 会在下一次升级时补搬其余四项）。

回答可视化提示词：0.1.0 起 `modern-ui` 行的 `presentation.prompt` 默认关闭（Intelligent UI 不再默认向系统提示词追加约 3 KB 指令）。安装器发现复制来源里已经有 Modern UI 且没有 `presentation` 配置时，视为从旧版本升级，在 `modern-ui` 行写入 `presentation.prompt: true` 保持原行为；已显式选择过的不覆盖。回执 `modern-ui-presentation-migration.json`（新安装也会写一份 `changed: false` 的回执，所以只判断一次），改动时备份 `modern-ui-presentation-before-migration.yml`。之后可在「设置 → 通用 → 回答可视化组件」随时切换。

安装在创建代际目录之后失败时，只删除本轮新建的 `versions/<uuid>` 和 `profiles/modern-ui-<uuid>`；`release-cache`、`store`、既往代际、原 profile 和旧的 `current.json` 不动，重试直接复用缓存。入口脚本可以经符号链接路径调用（例如 macOS 上 `/tmp`、`/var` 下的目录）。

## 新用户

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH Modern/program' -DataHome 'D:/DSH Modern/data'
```

预览根 install.ps1 已携带本地插件及其摘要，不必手填内部 manager 参数。bootstrap 下载并校验私有运行时、精确官方 npm 成品和预编译 UI，不克隆上游，不构建 DSH / UI。程序与数据目录必须分开。Windows 入口不需要符号链接权限。

bootstrap 默认只安装核心；社区插件为可选的已验证组合，PowerShell `-WithCommunity`、POSIX `DSH_MODERN_WITH_COMMUNITY=1`、JS 入口 `--with-community true` 才会在核心成功后安装清单中的两个固定社区插件。输出 core/community/timing 结构化结果；社区失败不撤销已成功核心，可用 `community --root <程序目录>` 独立重试。旧的 `-SkipCommunity`／`DSH_MODERN_SKIP_COMMUNITY=1` 仍被接受且优先。安装脚本不调整系统 PATH。显式旧宿主选择使用 `-BackendVersion`／`DSH_MODERN_BACKEND_VERSION`；初次采用非 web profile 使用 `-FromProfile`、JS 入口 `--from-profile` 或 POSIX `DSH_MODERN_FROM_PROFILE`，原 profile 不改。

## 原生组件与辅助程序

Windows 私有 PowerShell 固定微软官方 **7.6.5 x64 自包含 ZIP**，来源与 SHA256 写在 runtime-lock.json：

- 来源：[微软 PowerShell 7.6.5 发行页](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.5)。
- ZIP SHA256：`32eb8f6cdce08f86e987d625a2733e54ac3e289ae7e1621b14c0b5bcec2434ea`。
- 保留完整 LICENSE.txt、ThirdPartyNotices.txt 与运行资源；不安装 MSI，不要求 .NET SDK，不编译。

官方 pwsh resolver 先查 ProgramFiles，再查 PATH，因此安装器同时通过受支持的 profile Config 显式绑定 pwshPath，并在实际 launcher PATH 中加入私有目录。官方 entry patch 会整体替换 config，因此绑定保留有效执行器的 timeoutMs、maxTimeoutMs、cwd、输出/溢出上限、graceMs 等设置，只更新 pwshPath。用户已有不同/计算型 pwshPath 不被覆盖，会明确拒绝需要人工审查的配置。pwsh-sandbox 的启停和沙箱模式保持原样。

已在仅保留 System32 + WindowsPowerShell 的测试 PATH 下真实执行 official agent 的 write/read/pwsh/read，实际 pwsh.exe 位于私有 generation/powershell，非 Codex 缓存；测试清空 PSModulePath、NODE_PATH 和 DOTNET_ROOT。生产环境来自安装后 manager 同一 runtimeEnvironment，测试没有另塞隐藏的 shell 配置。实际沙箱结果为 workspace-write、partial enforcement，不能说 full enforcement。

其他边界：

- node-pty 命中发布物 prebuilds/win32-x64/conpty.node；Koffi 来自发布的 @koromix/koffi-win32-x64 平台包。实际载入文件摘要与发布源 baseline 相同。
- 文件搜索使用 npm 自带 @vscode/ripgrep-win32-x64/bin/rg.exe，已在去除开发 PATH 后运行，其版本为 ripgrep 15.0.0；不依赖系统 rg。
- Git 是 Git 工作区变更/可选 worktree 等功能的前提，不是安装、基础聊天、文件读写或 shell 的必需安装器依赖。未提供 Git 时不宣称 Git 相关功能已验收，也不自动安装大套 Git 开发工具。
- Windows cmd / Windows PowerShell 5.1、System32 系统库是 OS 前提。Linux/macOS 原生执行在本机未验证。

依赖有安装 hook 不等于一定编译。当前消费路径用 --ignore-scripts 防止 node-pty 安装脚本回退 node-gyp，但验收不只依据该标志：另外检查发布的 native/辅助文件、可执行权限，实际执行 JSONL 写锁、PTY、普通进程、ripgrep 和受沙箱 PowerShell 工具。node-pty 正常 postinstall 可能产生的两个 ConPTY helper 副本，只有与发布 prebuild 字节完全一致才被来源检查接受，其他 build 输出不会豁免。不能把“UI 插件免编译”扩大成所有平台的后端都已证明免编译。

## 来源、启动和更新

安装器沿真实声明包 canonical 路径解析依赖闭包，去重 realpath，required 缺失拒绝，未安装 optional 单列。对每个实际包核验精确 npm 发布 tgz 的 integrity 与原始文件字节，同版本预先篡改也拒绝；source-ledger.json 保存来源。正常安装后的文件/权限摘要作为 baseline，插件安装和关键运行后再次比较，不能修改官方 JS、原生模块、前端 dist 或模板。

安装成功运行程序目录的 dsh-ui.cmd / dsh-ui。Windows 的 `.cmd` 与 PowerShell 桥是纯 ASCII，从相邻 UTF-8 JSON 读取私有程序路径；不依赖控制台代码页。私有 pnpm 同样使用自包含桥，不依赖官方插件管理服务会清理掉的额外环境变量。参数以 Windows argv 规则传递，中文、空格、引号和尾反斜杠有真实 CP932 子进程回归。桥只给本次 PowerShell 进程传执行策略，不修改全局设置。

纯 JS manager 随 generation 复制，运行不依赖 checkout、开发 node_modules 或外部 CI store。移除 checkout 后仍可管理：

```powershell
$installedState = Get-Content -Raw -Encoding UTF8 'D:/DSH Modern/program/current.json' | ConvertFrom-Json
& $installedState.node $installedState.manager community --root 'D:/DSH Modern/program' --check true
& $installedState.node $installedState.manager verify --root 'D:/DSH Modern/program'
```

compatibility.json 按宿主记录社区组合；community-lock.json 由其生成默认组合的 URL/SRI：dsh-context@0.75.1、dsh-better-sidebar@0.28.0。同版本跳过；不同版本保留；声明但缺文件也不擅自覆盖。Store 0.1.4 从新安装默认组合排除，已有用户包保持配置并明确不计兼容通过。单包失败继续其他包。

更新仍使用 install-existing / bootstrap。新 generation 下载、校验并自检后才原子切 current.json；先停止使用同一数据目录的进程。程序管理使用 OS 生命周期 TCP 租约，强杀后内核释放；不读取或删除历史 operation.lock 文件。官方会话锁未绕过。

对非空数据目录，更新或采用前先在程序目录的 `data-backups/home-<uuid>` 保存并校验整树快照；复制、空间或一致性校验失败时不会进入 staging。托管安装和启动同时持有程序根与 data home 租约。旧启动器和直接官方 CLI 不遵守新租约，仍需先停机。`verify`、`rollback`、`uninstall` 不写会话数据，不要求 data home 存在或空闲。快照内容、外部链接及恢复方法见 [分发记录](history/distribution-parity.md)。

POSIX 启动器把官方 DSH 放进自己的进程组启动，并将发给启动器的 SIGTERM、SIGINT 和 SIGHUP 各转发一次，持续持有操作锁直到子进程退出、stdio 关闭。这样终端里按 Ctrl+C 或关闭窗口时，官方进程只收到转发来的那一次信号，按官方逻辑有序退出（官方把连续第二次信号当作「立即强制退出」）。退出后清理信号监听器，保留子进程数值退出码；官方 DSH 自己处理 SIGTERM 和 SIGINT 并以 0 或 130 退出，只有子进程不处理的信号（例如 SIGHUP）才得到 `128 + signal number`（129）。SIGKILL 等无法捕获的强制终止不属于此转发保证，内核会释放已被杀死的启动器所持租约。按 cgroup 整体发信号的管理器（systemd 默认的 `KillMode=control-group`）会让启动器和官方进程各收到一次，再加上转发就是两次；这类环境请只向启动器进程发信号（systemd 用 `KillMode=mixed`）。

启动器以**调用它的目录**为官方进程的工作目录，与直接运行官方 `dsh` 一致；不带工作区的会话创建和沙箱的回退根目录都从这里算。传给官方进程的环境只比调用环境多三样：`DSH_HOME`、PATH 最前面的 `<代际>/bin`（只含固定版本 pnpm 的包装脚本，官方插件管理器按 PATH 找 `pnpm`）和 PATH 末尾的私有 Node 目录；Windows 另加私有 PowerShell 目录。安装器自己用的 `npm_config_ignore_scripts`、`npm_config_store_dir`、`NODE_OPTIONS`/`NODE_PATH` 清空等开关不进入启动环境，因此不会传给代理在用户项目里运行的 shell。代理的 shell 里 `pnpm` 会解析到这个固定版本的包装脚本。

新建的 profile 若 `pnpm-workspace.yaml` 没有写 `storeDir`，安装器会补上 `<程序目录>/store`，使安装时与运行时（官方插件管理器）使用同一个 pnpm 仓库；已经写了 `storeDir` 的 profile 保持原样。

stage 自检包含官方 Web 启动审计、token 到 Cookie 的正常交换、准确 release/插件 boot graph、revisioned 同源插件资源 HTTP200、无 Cookie API401 和恶意 Host403。响应 Cookie / token 不写入报告。 自检在真实数据目录上短暂启动官方进程，为此附带一个只在自检生效的 `--patch` 覆盖层停用 `schedule` 条目（否则到期的定时提醒会在这几秒里被触发又被打断而丢失），并对这次运行关闭遥测；写入代际目录的 `self-test-overlay.yml` 只在自检使用，正常启动不带它。

按需执行以下命令中的一项（先读取 current.json；不是要求依次执行所有操作）：

```powershell
& $installedState.node $installedState.manager status --root 'D:/DSH Modern/program'
& $installedState.node $installedState.manager rollback --root 'D:/DSH Modern/program'
& $installedState.node $installedState.manager uninstall --root 'D:/DSH Modern/program'
```

rollback 选择旧程序及旧 profile，不回滚数据格式；uninstall 只移除 Modern UI 当前入口选择，保留官方安装、所有 profile、原始数据和恢复目录。不要把程序回退当成数据兼容证明。若要恢复已保留的某个代际，先停止该数据目录的进程，再将该代际的 `installation.json` 复制为程序目录的 `current.json`，然后执行 verify。不要混用另一个数据目录的 receipt。

PR #5 复核后，uninstall 可重复执行；保留的启动器会明确提示当前没有启用的安装，不再显示原始 ENOENT。`recovery.json` 保存上一选择的受管 receipt 引用与 SHA256；再次使用默认 install-existing 入口会复用原 data home 和 profile 配置。凭据被改写或越界时拒绝恢复，不静默创建新的空数据目录。新代际的 previous 只保存验证过的 receipt 引用，旧嵌套格式仍可回滚。全部代际继续保留，因为后端、Node 或 PowerShell 可能被后续代际复用；不要手动删除仍被引用的目录。

bootstrap 将同一次已校验下载的 Node 归档交给 manager，在持久代际中校验/解压，并在退出时清理临时启动目录。应用使用的 runtime 不依赖该临时目录。Windows 预览入口可显式传 `-Node`；没有可用精确 Node 时，PowerShell/POSIX 安装入口自动准备私有运行时。

## 切换官方界面与移除插件包

在官方插件管理页面停用**整个 `@iroha1145/dsh-modern-ui` bundle**，随后刷新浏览器。这样恢复原 layout/sidebar/workspace/conversation/chat/model-selection/tool 七个展示 owner；仅关闭 bundle 内 `modern-ui` 单 entry 会留下这些原 owner 被停用，不能作为切换方式。如果此前手动关过该 entry，重新启用 bundle 后还需重新启用该 entry，再刷新。

真实 `setBundleEnabled` 返回 `application: applied`，但 root owner 交替时当前页面可能报 `renderSlot('root') before any 'root' registration`；刷新是本预览切换步骤的一部分，不承诺无缝热切换。卸载时 90 个 Modern style 全部清除、主题 token 恢复；Lexical 0.49.0 的一个模块级 textInput 时间戳监听器留到页面刷新，刷新后为零。

在没有自定义 Host 兼容绑定的独立测试 profile，官方插件管理的 `removeBundle` 已真实调用 pnpm remove，包依赖和 node_modules 入口均消失；重启后官方 UI、dsh-context 与两个空会话存储文件保持正常。此结果不代表所有第三方组合都已验证。

如果该 Modern profile 已使用 `modern-ui-compat-*` translator/MCP/HTTP 绑定，不要直接删除仍被其配置引用的包。优先用 manager uninstall 撤销启动选择，再使用保留且未修改的原官方 profile。若必须在同一 profile 继续使用官方 UI，需先按保存的 Host 备份和原条目配置恢复这些绑定；自动反向转换未实现。该边界不影响官方安装或其他 profile。

## 旧数据和测量

新安装使用独立新数据目录。旧 web/search 仅做预检识别和原件保留/隔离；可选副本转换不阻塞新插件与新会话，不重建已取消的开关语义。没有实际转换/读取证明就不宣称全部历史聊天兼容。

bootstrap 输出 startedAt/completedAt/coreElapsedMs/elapsedMs，以及 release-cache、pnpm store 是否已存在、是否下载 Node。POSIX 使用秒级时钟并明确精度。开始计时后的核心、社区均计入总耗时；这些缓存字段不是“完全冷缓存”承诺。

Web 自检还记录新进程到官方 ready URL 和 HTTP 检查完成的时间；明确该指标不包含 launcher 完整性扫描，OS 文件缓存未清空，不等于页面可交互时间或全机器冷启动。最终已有后端安装、新用户安装、实际默认入口冷启动由消费者分别记录环境/缓存与端到端时间。不继承 15 秒、100% 等未经测量的结论。

最终 Windows 证据包括已有官方安装 614 项依赖、新用户私有安装 565 项依赖的来源/文件核验、升级失败恢复、源 profile 保留、独立管理器、原生及私有 pwsh 工具。Gwr tgz 的 23 项浏览器、5 项输入/偏好、5 阶段官方联网及最终代际四工具均已执行；详细计时、路径和限制见主迁移记录与消费 JSON。早期包的结果不能冒充最终版本验收。
