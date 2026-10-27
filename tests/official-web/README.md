# 官方联网配置消费验收

在仓库目录运行：

```powershell
& '<精确 Node 24.22.1 路径>/node.exe' tests/official-web/run.mjs '<已有安装的 current.json>'
```

驱动只从现有安装读取 Node、官方 CLI 与已安装 Modern 插件入口。每次新建 `.artifacts/official-web/run-*` 下独立 `DSH_HOME`、profile、工作区和会话，不使用原消费者 profile，不改原安装选择。可以用 `MODERN_UI_PLUGIN_ENTRY` 指向另一份**已经安装**的预编译 `lib/index.js`；不要传源码或 tgz。最终候选应先正式安装，再对其 `current.json` 重跑。结果在该 run 的 `result.json`，各阶段保留报告、诊断和新会话事件。

依赖是安装中可运行的官方 `@deepseek-ai/dsh@0.2.1-rc.4`、Node 24.22.1 和已安装插件；测试不需要浏览器、付费模型或网络凭据。模型通过公开 LlmAdapter 产生真实工具调用；搜索使用官方 DeepSeek provider 的可配置端点，请求本地 Anthropic 格式服务及非秘密占位凭据。工具仍走真实官方 AgentLoop、schema、执行与记录路径。

五个独立子进程验证：

1. 用官方 `configEditor.edit` 保存搜索 endpoint/model 和 provider 选择，并编辑**原有** `preset-standard.plugins` 中的 `tool-web` 配置。
2. 重启后新标准会话含 `web_search`/`web_fetch`，执行结果含来源、摘要和可读正文；再保存禁用两项工具。
3. 重启后新标准会话没有这两个 schema，文件工具和模型会话仍正常；恢复工具配置，并用官方 `pluginManager.setPluginEnabled` 关闭搜索 provider。
4. 重启后工具 schema 仍在，搜索返回官方 `WEB_PROVIDER_CONFIGURED_MISSING` 且端点计数不增加；fetch 不受影响；再启用 provider。
5. 再次重启后搜索和 fetch 恢复；额外将 fetch 选择恢复到官方 `http`，验证它拒绝 loopback URL。

默认 Web profile 的根 `tool-web` 行本来停用；工具实际在各个 agent preset 中，因此本测试不把根行 toggle 冒充会话工具控制。只断言修改后的**新 standard 会话**，不声称已有会话或其他 preset 即时改变。报告保留 plugin manager 返回的 applied/restart-required，而验收始终跨进程核对持久化结果。

官方 HTTP fetch provider 禁止私网和 loopback。为避免绕过其保护，本地 fetch 正控通过公开 `ctx.web.registerFetchProvider` 提供明确命名的 `local-fixture`，并验证官方 `web_fetch` 的执行和 HTML 转文本；这不是官方 HTTP transport 的公网成功验收。官方 DeepSeek search provider 的 HTTP 请求则真实经过本地端点。未覆盖真实公网搜索/HTTP、浏览器配置按钮、其他平台、其他 presets 或已有运行会话。

每个新会话断言没有 `web/search`、旧 `/web on|off`、`#web-off` 或 Modern policy 记录，并核对命令表无 `web`。官方 `web/deepseek-search-llm-request` 记录是合法原版事件，保留并与旧自定义事件区分。
