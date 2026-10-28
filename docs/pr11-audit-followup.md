# PR #11 限定审计修复

复现基线为 `bb606b3058e7e4556d0bd259d82f1e1f4321e517`。本轮只处理下列五项，继续使用未修改的官方 rc.4 后端、独立预编译插件和官方联网配置／插件启停机制。

1. **QuestionFlow 键盘激活。** 原选项 Enter handler 阻止原生 click，并把闭包中的旧 drafts 交给提交函数。删除该拦截后，Enter 和鼠标点击都经过原 `choose` 路径，再由原提交入口发送。真实浏览器先复现推荐项、无预选、多选和跨问题的四项失败；修复后五项回归精确核对最终 Remote answer，包括多选添加和取消。
2. **自动写入的旧模型空表。** 回归固定基线代码，调用真实 Conversation writer，并在第二条路径继续调用旧 effective writer 生成 v2 回执；两条路径都先复现漏项。恢复只接受完整的原备份与回执摘要链，区分自动默认值和用户空值。对应迁移文件覆盖新旧回执、证据缺失／损坏、人工修改、显式清空及修复后不重放。
3. **超限 blob 的累计缓存。** Git 按需下载完整对象后，文件大小拒绝仍需执行总量淘汰。将既有 `evict` 提前到 `FileTooLarge` 抛出前，不改变锁或错误语义。真实 loopback Git daemon 与 `blob:none` partial clone 先证明六个大对象缺失，再连续读取超限对象；基线在 163,840 字节预算下增长至 403,772 字节。修复后等待全部任务和清理结束，各次实际缓存均在预算内，并验证正常读取、并发串行和取消清理。
4. **启动预检信号。** 测试先行提交 `3f65043` 保留基线生产实现，[Linux 复现运行](https://github.com/iroha1145/DSH-Modern-UI/actions/runs/40671455702) 的 SIGTERM、SIGINT、SIGHUP 三项全部失败：父进程已退出，预检仍活着，root/home 租约均可重新取得。异步预检现在与运行阶段共用信号生命周期，捕获 stdout、转发信号并等待 `close`；阶段间中断也不能启动下一子进程。回归经过真实 `manager main launch`，核对两把锁、正常与非零退出、输出溢出、预检和运行阶段的信号及进程组转发。Windows 的真实 POSIX 信号项明确跳过，由 Linux CI 执行。
5. **可消费的引用类型入口。** 旧真实 tgz 在仓库外消费时出现 TS2307。新增纯类型 `@iroha1145/dsh-modern-ui/quotes` export，生成四个声明文件，保留 TextInteraction 类型、注册表类型和官方 Context/InputActions/SlotMap 合并。新真实 tgz 在独立消费目录用 NodeNext 与 Bundler 编译；不使用仓库别名或源码路径。入口没有 JavaScript 导出，不能执行 `installQuotes` 或重复注册运行时能力。

CI 构建 job 显式准备 Chromium，键盘测试在配置了浏览器却找不到可执行文件时失败，不静默跳过。消费 job 仍仅下载预编译产物，不 checkout 源码。当前提交的最终结果以 PR 检查页为准；上面的失败运行仅记录修复前的复现证据。

本地整合构建通过；Windows 上 229 项测试中 213 通过、16 项按平台跳过、0 失败。类型消费随后进一步改为直接打包实际构建目录，禁止测试临时补出声明，再次运行 1/1 通过。真实 POSIX 信号与进程组结论只取后续 Linux CI，不把 Windows 跳过项标为通过。

## 完整旧安装流水线的模型／价格恢复

后续复核基线为 `a3da03fc9871208ec444e87d7117a5869324122f`，范围仅为 `recoverConversationPickerDefaults`。旧安装器的真实顺序为 `preserveLegacySettings → preserveConversationPreferences → preserveChatPreferences → bindHostCompatibility → bindPowerShell`。Conversation 自动写入默认空表后，后两步继续改变整个 patch 的摘要，却没有修改模型或价格。旧恢复器只接受 settings／conversation／chat／effective 回执，所以不能跨过这段正常自动写入；effective v2 已存在时也会遇到同一问题。

`tests/migration/picker-pipeline.test.mjs` 使用冻结旧版本的真实函数生成 profile、备份和回执，再由官方 `applyEntryPatches` 合成配置。测试先在基线执行：Host、PowerShell、两者组合 × 有／没有旧 effective v2 的六项全部失败；无额外绑定的控制组成功。正例没有手工拼接摘要。

修复在内存中重建严格已知的尾部追加写入，验证完整前缀摘要，并对 Host 核对其旧前镜像备份，再与原回执图连接。每条路径仍检查 Modern 空表未变，只恢复已证明由 Conversation 自动引入的字段。原证据文件保持原样，独立恢复回执记录本次采用的追加写入证据。

回归检查最终有效模型与价格，同时核对相邻 Host／PowerShell 条目、聊天偏好、原回执和备份不变；覆盖原显式空表、后续用户编辑、重复升级、修复后主动清空及证据损坏。PowerShell 测试运行真实旧绑定函数并验证其 YAML 效果，不启动 PowerShell 进程；这部分在各平台都可执行。POSIX 信号的实际结论仍来自 Linux CI，Windows 不将这些跳过项记为通过。

本轮新增 36 项流水线回归，包含可信前缀末尾已有 Host／PowerShell 绑定、没有 Chat 实际写入，以及 15 项绑定或前镜像异常检查。Windows 本地迁移测试合计 76/76 通过；已有键盘、真实 Git 缓存、启动生命周期与 quotes 类型／运行时回归复验 30 项：18 通过、12 项 POSIX 条件跳过、0 失败。完整 Linux 与五个平台消费结果以本轮提交的 PR 检查为准，不沿用上一提交的绿色结果。
