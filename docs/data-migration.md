# 数据预检、隔离与回退

**V2 决定：取消自定义会话联网开关，保留历史聊天原件。** 新会话沿用官方联网插件配置，不再写 `web/search`。旧会话的可选转换不阻塞插件与新安装交付；本轮工具只预检、隔离和恢复快照，没有逐行删除事件或实现转换。

## 已实现的工具

`scripts/migration/preflight.mjs` 同时编译进插件的 `lib/migration.js`，以 `modern-ui-data` bin/`./migration` export 交付。它只处理**已完成的导出快照文件**，不递归扫描或备份活跃 DSH_HOME，也不取得写入会话的权限。

开发目录中可执行：

```text
node scripts/migration/preflight.mjs inspect --source <导出文件> --consumer <精确官方安装目录>
node scripts/migration/preflight.mjs quarantine --source <导出文件> --consumer <精确官方安装目录> --destination <不存在的隔离目录>
node scripts/migration/preflight.mjs restore --quarantine <隔离目录> --destination <不存在的恢复文件>
```

消费者无需源码编译，将上面的脚本路径换成实际已安装插件的 `lib/migration.js`：安装器用户使用安装器提供的固定 Node；npm 发布后用 `dsh plugin --profile web add @iroha1145/dsh-modern-ui` 安装的，插件位于该 profile 的 `node_modules/@iroha1145/dsh-modern-ui/`。`--consumer` 是能正常解析 `@deepseek-ai/dsh` 的实际安装目录，不是上游源码目录。

输入支持官方 v4 JSONL、追加式多帧 `.jsonl.zstd` 和含这类日志的 ZIP。使用真实已发布 codec/持久化验证 exports；Zstd 逐帧检查，不能只解第一个 header frame。读取前后核对文件状态，拒绝改变中的源；这不是活跃数据目录的一致性备份。

输出 `readable-snapshot` 表示日志已经通过精确官方读取器，可交给官方导入路径处理；它不证明附件、外部 preset 或后代关系都已经验收。工具始终带 `automaticImportPermitted: false`、`converted: false`，因为此工具不会替用户自动导入。含旧自定义事件的快照返回 `legacy-web-events`，保留旧环境或只读导出路径。聚合阻塞返回退出码 2，格式/参数等错误返回 1。

## 保守拒绝

- 任意必需 `web/search` 都列出位置，保留原件；不再尝试恢复已取消的开关语义。
- 旧 `/web` command/run/done 仅作为历史信息报告，不再施加会话策略关卡。
- 未知版本、未知必需事件、损坏/未结束 JSONL、ZIP 重名/路径歧义、超限解压与校验失败。

隔离目录内保存 `original.snapshot`、`preflight.json` 和禁止直接导入说明。复制后重新验摘要；重跑只复用相同来源的完整隔离副本，不覆盖不同内容。恢复再次验摘要，用 `wx` 只创建新文件。原件、隔离和恢复副本分别保留，失败不会修改原快照。

## 配置与程序回退

设置转换只在安装器新建的 profile 副本内执行。`ui-model-selection` 的 `models`、`prices`、`pricesUpdatedAt` 原样映射到 `modern-ui`；首次转换发现目标有不同值时拒绝。独立的 conversation 转换读取真实组合后的官方条目（包括自定义 id），将 `busyEnter` 和 `collapsedViews` 的缺失值复制到 `modern-ui`；已有 Modern UI 值优先。保存完整目标 config，遵守官方 patch 的 config 替换语义，避免丢失模型卡片等其他设置。

`collapsedViews` 已接入唯一 Conversation owner 的 pin store；真实浏览器验证隐藏、打开仍隐藏的视图、刷新与新 Host 进程恢复，以及重新显示。Chat 始终可见。旧 v1 receipt 中的历史验收说明不参与行为判断，实际状态见 UI 与消费记录。

转换保留原 YAML 备份和带版本/摘要的 receipt；后续升级不会用旧 namespace 的值覆盖用户已经编辑的新配置。`!!js` 只作为惰性 YAML 数据往返，不执行它；需要转换的字段若是计算表达式则拒绝自动迁移。

程序 rollback 只选回前一程序/profile 代际；共享会话不会倒带。数据回退应先停用相关 DSH，再使用与原数据匹配的旧运行时读取保留原件，或在新空位置恢复已验证备份。不要把切换可执行文件当成数据兼容证明。

## 验证范围

V2 预检 11 项、配置/Host 绑定 9 项通过，包含官方公开 patch 语义、原件不变、重复运行、拒绝覆盖、篡改检测、旧 receipt 升级、完整 config 保留、多帧 Zstd、ZIP 重名与累计大小限制。一个普通 v4 对话夹具通过预检后，使用真实官方 persistence create/append/flush 导入独立新目录，重启读取内容一致、重复 id 拒绝，源快照字节未改。这是公开存储 API 的限定正控，不是浏览器 ZIP/附件/后代导入的完整验收。

预检格式版本升为 2，仍可恢复版本 1 的未改写隔离副本。真实会话原件没有被访问。在线全目录备份、所有旧格式和前端 ZIP 附件导入仍未验收。自定义开关的历史分叉恢复和缺失插件锁定不再属于任务。
