# Host 兼容修复

消费基线是官方 npm `0.2.1-rc.4`。旧补丁来自 Modern UI `a9f4c370`，其源基线为 `22ddee37`。下面区分已实现的显式插件替代、真实测试和仍未保留的依赖差异。

## 明确选择的替代插件

`@iroha1145/dsh-modern-ui/translator` 与 `@iroha1145/dsh-modern-ui/mcp-client` 是本项目的 Host 入口。它们由旧修复后的相应小插件提取，保留 MIT、来源及公开配置接口，未复制整个后端。所有 DSH/Cordis 服务均 external/peer；MCP SDK 是插件自身固定的正常依赖 `2.3.0`。

安装器读取实际组合后的配置，在新 profile 的用户 patch 中禁用被替换的原条目，再以新 id 插入替代插件，保留配置和条目 metadata。官方 `name` patch 字段是匹配条件，不能用它直接改模块名；`tests/migration/profile-settings.test.mjs` 用真实 `applyEntryPatches` 核对了禁用和插入。显式禁用的功能不会被打开。嵌套/自定义 preset 中的目标或动态 activation 目前要求单独审阅，自动安装会拒绝这类不确定转换。

没有模块别名劫持、原型修改、加载器拦截或官方文件覆盖。默认没有翻译/MCP 实例的官方 Web profile 不会为此凭空启用它们；存在这些顶层实例的配置副本才选择替代。

## 已运行行为检查

`node --test tests/host-compat/host.test.mjs`，固定 Node `24.22.1`，10 项通过：

- Google 和 Bing：非空原文得到空白译文时拒绝；合法译文原样返回；失败后可以重试。
- 正常官方翻译器生成旧空白缓存，再使用替代插件与真实 JSONL/Agent 恢复：追加有效结果、旧事件及文件前缀不改，第二次读取和完整 Host 重启后均复用有效缓存，不再发送 HTTP 请求。
- 官方 `CotTranslationController` 能识别替代插件抛出的公开 `TranslationError` 并启动冷会话。没有复制第二个错误类来破坏 `instanceof` 契约。
- MCP 直接回环端点正常连接；同源/跨源 307 和 308 都在到达目标前失败，目标访问计数为零。请求头和正文只包含合成夹具内容。

`scripts/host-compat/probe.mjs <官方消费者>` 对未修改的官方成品给出对照：rc.4 接受空白译文，MCP 的四种重定向都到达目标。因此不能把这两项旧修复说成已被官方 rc.4 吸收。

Host 严格 TypeScript 检查通过。构建先用 TypeScript emit，再 bundle，以内联已发布 Cordis 只有类型声明、没有 JavaScript 导出的 const enum。所有被引用宿主模块来自公开 exports，不读取 `src/*` 或上游 checkout。

付费翻译提供方未消耗真实额度；其完整端到端路径仍未验收。上述 Host 检查也不等于浏览器翻译 UI 的接线验证，后者在 UI 地图单列。

## 依赖修复差异

旧 `pnpm-workspace.yaml` 的安全版本地板不能通过改写官方依赖树补回。初次真实官方 npm 消费闭包中观察到：

| 旧约束 / 改动 | 官方 rc.4 实际依赖 | 当前结论 |
| --- | --- | --- |
| Node 24.22.1 | 私有运行时已固定并验证 | 保留 |
| MCP client 2.3.0、拒绝 HTTP 重定向 | 官方 client 2.2.0、会跟随重定向 | 显式替代入口恢复这项行为；不修改原包 |
| Undici 8.12.2 地板 | `dsh-http-proxy` 与 `dsh-web-fetch-http` 精确依赖 8.11.2 | 未保留旧依赖修复，需官方合适发行版；不做 overrides/替包 |
| Zod 4.6.6 地板 | 多个官方包精确依赖 4.4.3 | 未保留，不能把整个宿主依赖替换后声称仍是正常官方发行依赖 |
| fflate 0.8.3 地板 | 正常 0.8.3 和 libreoffice-kit 自带的 0.8.2 | 未全覆盖；本插件自己的预检 bundle 使用 0.8.3 |
| http-cache-semantics 4.3.0、fast-uri 3.1.9 | 实际分别为 4.3.0、3.1.9 | 本次已见版本达到旧地板 |
| 浏览器与开发库 / Electron / 外部 SDK 修补 | 并非都作为该 CLI 消费闭包的独立 npm 包出现 | 不从“没发现目录”推断已修复；本轮不是 Electron 发行验收 |

这里是在核对旧补丁的依赖修复是否保留，不是新的全面安全认证。官方 bundle 内联的浏览器库、所有外部模型 SDK 和所有平台仍需要更广的发行核验；不把开发依赖表或一次审计结果扩大为完整无风险结论。
