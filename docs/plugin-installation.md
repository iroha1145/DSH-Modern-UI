# 官方 DSH + Modern UI 安装预览（V2）

当前使用真实本地 `npm pack` 插件，尚未发布 npm / Release。官方后端固定 `@deepseek-ai/dsh@0.2.1-rc.4`，Node `24.22.1`、pnpm `11.28.5`。新会话使用官方插件配置管理联网工具；Modern UI 自定义会话联网按钮、命令和协议已取消，不是安装前提。

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

预览根入口已经携带 `modern-ui.tgz` 路径和实际 SRI；源码对应 `scripts/distribution/install-existing.mjs` / `.ps1`。它调用官方正常 profile / plugin 管理，不改写官方包。未发布前只能使用真实本地 tgz，不能把待定包名当成已发布 registry 包。

可选 `-Root` 指定程序目录，`-DataHome` 指定独立数据目录。默认程序位于 LocalAppData 的 DSH-Modern-UI/program；首次数据目录使用新 UUID，不自动读取真实 `~/.dsh`、旧聊天或其他 profile。再次更新同一程序目录时，只沿用它自己 current.json 中记录的数据目录。`-Node` 可指定已有精确 Node；PATH 上 Node 不匹配时自动使用私有 bootstrap，不修改系统 Node。已有精确 Node 时不重新下载它，pnpm 仍私有准备。

官方 `dsh plugin --profile <name> add <tgz>` 会初始化未知 profile，但默认只有 base bundle；`--from-default-profile` 属于启动/配置命令，不属于 plugin add。仅一条裸 add 不足以初始化完整 Web UI，因此薄 wrapper 先安全建立独立 Web profile，再执行官方 plugin add 和自检。它不覆盖其他 profile。若显式在已知数据目录使用 `--from-profile`，只读复制该 profile 配置到新 generation，源文件前后摘要保持一致；不转换会话。

POSIX 对应入口（候选平台，本机未运行）：

```sh
sh ./install-existing.sh /absolute/official/package.json '/path/to/program' '/path/to/data'
```

要求已有精确 Node，或使用新用户 bootstrap；`DSH_MODERN_NODE` 可指定 Node 路径。没有声明五个平台都已经验收，也不要求五套完整便携包。

## 新用户

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -Root 'D:/DSH Modern/program' -DataHome 'D:/DSH Modern/data'
```

预览根 install.ps1 已携带本地插件及其摘要，不必手填内部 manager 参数。bootstrap 下载并校验私有运行时、精确官方 npm 成品和预编译 UI，不克隆上游，不构建 DSH / UI。程序与数据目录必须分开。Windows 入口不需要符号链接权限。

bootstrap 默认核心成功后安装三个固定社区插件，分别输出 core/community/timing 结构化结果。社区失败不撤销已成功核心，可独立重试。PowerShell `-SkipCommunity`、POSIX `DSH_MODERN_SKIP_COMMUNITY=1` 仅跳过可选社区步骤。安装脚本不调整系统 PATH。

## 原生组件与辅助程序

Windows 私有 PowerShell 固定微软官方 **7.6.5 x64 自包含 ZIP**，来源与 SHA256 写在 runtime-lock.json：

- 来源：[微软 PowerShell 7.6.5 发行页](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.5)。
- ZIP SHA256：`32eb8f6cdce08f86e987d625a2733e54ac3e289ae7e1621b14c0b5bcec2434ea`。
- 保留完整 LICENSE.txt、ThirdPartyNotices.txt 与运行资源；不安装 MSI，不要求 .NET SDK，不编译。

官方 pwsh resolver 先查 ProgramFiles，再查 PATH，因此安装器同时通过受支持的 profile Config 显式绑定 pwshPath，并在实际 launcher PATH 中加入私有目录。用户已有不同/计算型 pwshPath 不被覆盖，会明确拒绝需要人工审查的配置。pwsh-sandbox 的启停和沙箱模式保持原样。

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

community-lock.json 随程序保留三个精确包的真实 URL/SRI：dsh-context@0.75.1、dsh-better-sidebar@0.28.0、dsh-plugins-store@0.1.4。同版本跳过；不同版本保留；声明但缺文件也不擅自覆盖。单包失败继续其他包。

更新仍使用 install-existing / bootstrap。新 generation 下载、校验并自检后才原子切 current.json；先停止使用同一数据目录的进程。程序管理使用 OS 生命周期 TCP 租约，强杀后内核释放；不读取或删除历史 operation.lock 文件。官方会话锁未绕过。

stage 自检包含官方 Web 启动审计、token 到 Cookie 的正常交换、准确 release/插件 boot graph、revisioned 同源插件资源 HTTP200、无 Cookie API401 和恶意 Host403。响应 Cookie / token 不写入报告。

按需执行以下命令中的一项（先读取 current.json；不是要求依次执行所有操作）：

```powershell
& $installedState.node $installedState.manager status --root 'D:/DSH Modern/program'
& $installedState.node $installedState.manager rollback --root 'D:/DSH Modern/program'
& $installedState.node $installedState.manager uninstall --root 'D:/DSH Modern/program'
```

rollback 选择旧程序及旧 profile，不回滚数据格式；uninstall 只移除 Modern UI 当前入口选择，保留官方安装、所有 profile、原始数据和恢复目录。不要把程序回退当成数据兼容证明。若要恢复已保留的某个代际，先停止该数据目录的进程，再将该代际的 `installation.json` 复制为程序目录的 `current.json`，然后执行 verify。不要混用另一个数据目录的 receipt。

## 切换官方界面与移除插件包

在官方插件管理页面停用**整个 `@iroha1145/dsh-modern-ui` bundle**，随后刷新浏览器。这样恢复原 layout/sidebar/workspace/conversation 四个 owner；仅关闭 bundle 内 `modern-ui` 单 entry 会留下四个原 owner 被停用，不能作为切换方式。如果此前手动关过该 entry，重新启用 bundle 后还需重新启用该 entry，再刷新。

真实 `setBundleEnabled` 返回 `application: applied`，但 root owner 交替时当前页面可能报 `renderSlot('root') before any 'root' registration`；刷新是本预览切换步骤的一部分，不承诺无缝热切换。卸载时 90 个 Modern style 全部清除、主题 token 恢复；Lexical 0.49.0 的一个模块级 textInput 时间戳监听器留到页面刷新，刷新后为零。

在没有自定义 Host 兼容绑定的独立测试 profile，官方插件管理的 `removeBundle` 已真实调用 pnpm remove，包依赖和 node_modules 入口均消失；重启后官方 UI、dsh-context 与两个空会话存储文件保持正常。此结果不代表所有第三方组合都已验证。

如果该 Modern profile 已使用 `modern-ui-compat-*` translator/MCP 绑定，不要直接删除仍被其配置引用的包。优先用 manager uninstall 撤销启动选择，再使用保留且未修改的原官方 profile。若必须在同一 profile 继续使用官方 UI，需先按保存的 Host 备份和原条目配置恢复这些绑定；自动反向转换未实现。该边界不影响官方安装或其他 profile。

## 旧数据和测量

新安装使用独立新数据目录。旧 web/search 仅做预检识别和原件保留/隔离；可选副本转换不阻塞新插件与新会话，不重建已取消的开关语义。没有实际转换/读取证明就不宣称全部历史聊天兼容。

bootstrap 输出 startedAt/completedAt/coreElapsedMs/elapsedMs，以及 release-cache、pnpm store 是否已存在、是否下载 Node。POSIX 使用秒级时钟并明确精度。开始计时后的核心、社区均计入总耗时；这些缓存字段不是“完全冷缓存”承诺。

Web 自检还记录新进程到官方 ready URL 和 HTTP 检查完成的时间；明确该指标不包含 launcher 完整性扫描，OS 文件缓存未清空，不等于页面可交互时间或全机器冷启动。最终已有后端安装、新用户安装、实际默认入口冷启动由消费者分别记录环境/缓存与端到端时间。不继承 15 秒、100% 等未经测量的结论。

最终 Windows 证据包括已有官方安装 614 项依赖、新用户私有安装 565 项依赖的来源/文件核验、升级失败恢复、源 profile 保留、独立管理器、原生及私有 pwsh 工具。Gwr tgz 的 23 项浏览器、5 项输入/偏好、5 阶段官方联网及最终代际四工具均已执行；详细计时、路径和限制见主迁移记录与消费 JSON。早期包的结果不能冒充最终版本验收。
