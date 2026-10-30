# PR #5 启动生命周期、执行器配置与默认目录修复

本轮以 `556bd10b6793d2d821f132815ab9f689904178d6` 为产品基线，仅修复安装器行为。继续使用官方 `@deepseek-ai/dsh@0.2.1-rc.4` 成品后端、独立预编译插件和薄安装器；联网仍由官方插件/配置控制，旧 web/search 转换范围不变。

## 先复现

提交 `45042c327be641085db537ea24fdf2a27ce02ba3` 只增加回归测试，保留原生产实现。[Linux 复现工作流 40499234024](https://github.com/iroha1145/DSH-Modern-UI/actions/runs/40499234024) 得到 **128 tests / 116 pass / 10 fail / 2 skipped**。失败是修复前证据，不能作为修复后验收：

- 向真实 manager 进程发送 SIGTERM 或 SIGINT 后，日志分别确认 `childAlive: true`、`operationLockReacquired: true`。测试使用真实子进程及真实 TCP 操作锁，并清理自己创建的进程。
- 子进程退出 7，manager 却退出 1；未处理的 SIGTERM/SIGINT/SIGHUP 也无法完成子进程退出报告。
- 使用锁定依赖 `@deepseek-ai/cordis-plugin-include@1.0.10` 的真实 `applyEntryPatches`，两个 PowerShell 执行器原有 config 字段在合成后丢失。
- POSIX Shell 与 JS 入口实际选中不同大小写目录；两套目录并存时，旧实现仍调用安装核心，没有拒绝歧义。

## 修复行为

- `scripts/distribution/launch-child.mjs` 与 `manager.mjs`：转发 SIGTERM/SIGINT/SIGHUP；等待 child close 后才结束 launch、释放 lease；清理信号监听器，处理 spawn 错误并保留退出状态。正常退出、非零退出、启动失败及子进程持锁均使用真实进程测试。不可捕获的 SIGKILL 不属于转发保证。
- `scripts/distribution/shell-runtime.mjs`：基于有效 config 仅更改 pwshPath。官方合成测试覆盖 local/sandbox 的 timeoutMs、maxTimeoutMs、cwd、maxOutputBytes、maxSpillBytes、graceMs、启停状态、重复绑定的文件幂等性，以及显式路径/动态配置拒绝。
- `scripts/distribution/program-root.mjs` / `.sh` 与两种 install-existing 入口：新 POSIX 安装统一为小写目录；仅有旧大写目录时沿用它；两个不同目录并存时要求显式选择；同一文件系统对象的别名不误判。测试核对已有数据路径，没有执行数据合并。
- 预览生成后，再对实际输出的 `install-existing.mjs` / `.sh` 运行目录回归；只替换临时副本中的安装核心来记录参数，避免测试目录规则时下载或安装真实应用。完整消费工作流另行运行真实安装及官方文件核验。

## 本地验证与 CI 边界

本地 Windows、固定 Node 24.22.1：

- 全部单元/集成测试 **131 tests / 123 pass / 0 fail / 8 skipped**。跳过 5 项 POSIX 信号及 3 项 POSIX Shell/大小写目录测试，不能解释为这些行为在 Windows 上通过。
- 生成真实预览后，包装入口目录测试 **3 tests / 1 pass / 0 fail / 2 POSIX skipped**。
- 新预览中的 Modern UI tgz 仍为 2,578,707 字节，SRI 与本轮基线相同：`sha512-IjUFS37pS39zsE+KJUJl2b6R2uj/IDCAN4xon/UgMwbYlYPdaRXyv/m6r5rWqYv3zN3v5tMplecgeOmvjJD14g==`。本轮没有修改或重新设计 UI 插件。

本机未执行 POSIX 信号/Shell、五平台全新安装或整套浏览器 E2E；对应结果以[当前提交 PR 检查](https://github.com/iroha1145/DSH-Modern-UI/pull/5/checks)和 PR 描述中标明的提交/运行链接为准。Linux plugin job 执行完整回归和生成后的预览包装入口检查；consumer job 执行五平台真实安装、官方来源/文件核验、官方联网及浏览器/owners 验收，Windows 另执行真实工具与 bootstrap 检查。`bundle-lifecycle.e2e.mjs` 是独立驱动，不在当前五平台工作流中，不宣称本轮已经重跑。

附件二审报告中的 run `24922668129` 不是前轮实际核验的 run；前轮 `556bd10` 的六项成功结果在 [40488341978](https://github.com/iroha1145/DSH-Modern-UI/actions/runs/40488341978)。实际联网驱动为 `tests/official-web/run.mjs`，不是报告所称 `verify-web-policy.mjs`。报告的“100% 符合/可合并”不替代执行证据或合并授权。

未发布 npm、GitHub Release、镜像或生产部署；本轮不合并 PR，也不启用自动合并。
