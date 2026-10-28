# 分发与旧配置衔接

安装器继续使用未经改写的官方 rc.4 与独立 Modern UI 插件。本文描述本轮补齐的行为和边界。

## 继承配置

安装器在添加新插件前读取官方 `--dump-config`，按实际模块名找到模型选择器与聊天条目，将其继承自基础 profile、preset 或 bundle 的配置复制到 `modern-ui`。目标已有的 Modern 配置优先；用户 patch 明确保存的空模型/价格表也优先。仅由 Modern bundle 提供且未显式保存的默认空表可由旧模型配置填充。多个同模块条目或待迁移字段的计算表达式要求人工处理，不猜测优先级、不执行表达式。

独立的 `modern-ui-effective-preferences-v1.json` 回执使旧 patch-only 迁移过的 profile 仍得到一次补齐。该兼容文件名保持不变，当前 `conversionVersion` 为 2，原 YAML 保存在 `modern-ui-effective-preferences-before-v2.yml` 并记录摘要；已有 v1 回执先验证旧备份，再只补文档设置，不重放模型/聊天迁移。完成后不会再次用旧 namespace 覆盖用户编辑。Conversation 继续复用独立的现有迁移路径。

## 文档来源和旧限制配置

`modern-plugin-documents` 的 `bundle` 和 `market` 分别保存原 plugin-manager 与 plugin-market 的文档策略，旧来源的不同值不会互相覆盖。两个 scope 都支持 `maxDocumentBytes`、`maxImageBytes`、`fetchTimeoutMs` 和有序 `npmFileSources`（仅 `jsdelivr`、`unpkg`、`npmmirror`）。`market` 另支持 `cacheTtlMs`、`gitlabHosts`、`maxRepositoryBytes`、`maxCacheBytes`、`cacheDir` 和 `gitTimeoutMs`；相对缓存目录仍相对当前 profile 解析。

安装器从真实组合配置按模块名迁移原 `detailMaxBytes`、`detailImageMaxBytes`、`detailNpmFileSources` 等显式值。manager 的 `detailFetchTimeoutMs` 和 market 的 `fetchTimeoutMs` 分开保留。Modern 文档 scope 已有值优先；此前扁平的 Modern 文档大小/超时字段也作为明确覆写保留。缺失的旧选项不凭空写入新网络来源。多个同模块旧实例或必须搬移的计算表达式会拒绝自动转换。

本地已安装/开发链接包每次重新读取正文，同版本修改或修复立即可见；图片身份仍稳定。远程版本保留缓存与明确重试行为。bundle/market 使用分离的图片身份空间，因此一个 scope 的较宽图片限额不会覆盖另一个 scope 的限制。原有 owner 认证、路径 containment、图像 CSP 和仓库读取防护不变。

## 数据目录备份

采用或升级非空数据目录前，先停止所有正在使用该目录的 DSH，包括旧版启动器与直接启动的官方 CLI。安装器在运行任何 staging/DSH 命令前，将整个数据目录复制到程序目录的 `data-backups/home-<uuid>/data`，包含会话、附件、profiles、隐藏文件与空目录。`backup.json` 记录来源、文件 SHA-256、权限及链接目标。新空目录无需备份。

使用目录快照而非压缩归档，是为了直接逐文件验证副本，无需第二份解压空间。复制不跟随符号链接或 junction；外部链接目标仍是外部数据，恢复前要保证其存在。硬链接展开，空间按逻辑文件大小加目录元数据与余量预检。复制或空间检查失败不会进入 staging，不切换当前代际。仅删除本次 `.pending` 副本；已完成备份、原目录和旧程序代际保留。空间预检不能预留磁盘，运行中耗尽空间仍按同一失败路径处理。

备份前后核对源树内容、文件身份和修改时间，并与副本内容比较；发现变化则拒绝。安装、启动和其他托管修改复用现有内核 operation lease，同时锁定数据 home，防止两个托管程序根并发使用同一 home。旧版、直接 CLI、远程主机与其他写入者不遵守这个锁，因此这是停机条件下校验的文件树副本，不是在线原子快照。跨主机共享文件系统不提供协调保证。

恢复时先停止 DSH，将备份的 `data` 复制到新空目录，用与该数据格式匹配的运行时读取。程序 rollback 仍只回退程序/profile，不回写共享会话，也不会隐式恢复备份。

## 安装后新增 Host 实例

每次通过托管入口启动前重新读取组合配置，使用原有公开 profile patch 路径选择 translator/MCP/HTTP fetch 替代入口。安装后添加的顶层官方实例在下一次托管启动时得到相同修复；配置、metadata 和禁用状态保留，重复启动幂等。运行中即时添加的实例不被拦截，下一次启动前应完成替换；直接官方入口不执行该管理步骤。嵌套/计算 activation 仍明确拒绝自动转换，不静默声称已保护。

## 依赖边界

独立 `web-fetch-http` 入口派生自官方 rc.4 公开 `lib/index.js`，原文件 SHA-256 为 `489fef91b0c11c063029ea7aed27b312817570b9c3177aeaa44983b9a25aedcd`。保留完整 public-IP、DNS pinning、NAT64、重定向、大小限制与异常恢复逻辑；仅改插件名与代理请求的 dispatcher 所有权。普通请求已有独立 Agent，代理请求现在也用插件固定 Undici 创建私有 ProxyAgent，读取 Host 的公开 `proxyRouteFor` 路由策略并在请求结束后关闭。差异约束测试核对其余全部代码和官方原件一致，不使用旧 rc.3 较弱的网络防护覆盖新版本。

`dsh-http-proxy` 是启动器使用的进程级库，在插件启动前安装 dispatcher，并非可切换插件。独立 HTTP provider 不等于覆盖所有出站请求；其他官方调用仍保留官方依赖。只读 npm 元数据确认 `0.2.2-alpha.2` 的 HTTP provider 和 proxy 仍依赖 Undici 8.11.2，且引入 alpha Cordis/Schemastery 与精确 alpha DSH peers，因此本轮不升级整个宿主。没有 overrides、加载器劫持、全局 dispatcher 事后替换或官方文件覆盖，也不从版本号差异推断漏洞。
