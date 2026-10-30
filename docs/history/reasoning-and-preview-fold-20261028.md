# 模型设置页「按模型声明推理强度」与文件/Plan 预览代码块折叠（2026-10-28）

[2026-10-28 审计复核](audit-20261028.md) 把 F1（模型设置页按模型声明推理强度）和 F2（文件预览与 Plan 预览的代码块折叠）判为「属实但另起」。这一轮把两项回迁到插件，都不改官方 npm 文件，不停用任何官方包。

## F1 声明推理强度：先做实验，再选路

### 要恢复的行为

旧补丁（`patches/dsh-ui.patch` 打在 rc.3 `22ddee37` 上）改了 `ui-settings-models` 的四个文件：目录路由（OpenAI、Anthropic 这类安装目录里有的提供商）上，安装目录没有描述的模型 id（比目录更新的型号）在设置页可以开启推理并声明档位；关闭推理时目录路由显式写 `reasoningEfforts: false`，不是删字段（删了字段就回到目录的档位）。官方 rc.4 的 `ProviderEditor` 只给手写路由的行显示推理控件，目录路由的行没有。

### 两条路

- 整包接管 `ui-settings-models`：停用官方包，迁入补丁版 rc.3 源码（约 3.9k 行 TS、920 行样式、词典），并原样重新声明 `settings.models.provider-card`、`settings.models.footer`、`settings.onboarding` 下 `deepseek-official` 的 `settings.models.sign-in` 子槽（`ui-settings-account` 往它登记）。rc.4 这个包的源码没有公开（master 停在 rc.3），编译产物里已有 rc.3 没有的东西（`listConfigurableProviders`/`joinProviderDirectory`、`nativeAuth`、`credentialChecks`、`materializesNativeProfile`、`baseURLEnv`），接管等于把整页退回 rc.3 再手工补 rc.4 的差异，以后每次官方升级都要重做。
- 轻量：官方页照常，插件在官方页声明的扩展槽里加一块控件，直接读写设置文档里该路由的 `models` 列表。风险只有一个：官方行编辑器整份保存 `models` 时，会不会把它不认识的 `reasoningEfforts` 字段丢掉。

### 实验：官方行编辑器是否保留未知字段

方法（脚本与结果在 `docs/verification/reasoning-efforts-preserve-20261028/`）：用本机已装代际的官方 rc.4 成品另起干净 profile（默认 `web` 复制再装插件），往 profile 的 `cordis.patch.yml`（官方设置写入的用户层）种一行 `llm-pi-ai`：`providers.openai.models` 两行，`probe-newer-model` 带 `reasoningEfforts: {off: null, low: low, high: high}`，`gpt-4.1` 带 `reasoningEfforts: false`。无头 Chrome 打开设置 → 模型 → 编辑 openai → 展开「自定义设置」→「添加模型」填 `probe-added-model` → 保存。官方编辑器这一步产生一条 `set providers.openai.models <整个数组>`。

结果：保存后两行的 `reasoningEfforts` 原样还在（字典和 `false` 都在），新行追加在后面（`result.json` 的 `openai.models`）。这和代码读到的一致：草稿是 `structuredClone(namespace.user)`，`modelDrafts` 明写「不丢隐藏字段」，行编辑全是 `{...model, ...next}` 展开，「获取可用模型」采纳时按 id 保留已有行，目录路由的 `reasoningLevels` 为空所以永远不会走到会删字段的 `withEfforts`；宿主端 `reasoningEfforts` 本来就在 pi-ai 的 Config 里，不算未知字段。

结论：选轻量路。

### 做法

放在 `settings.models.provider-card` 而不是 footer：这个槽按行的设置命名空间分发（官方 `slot-contract.d.ts` 原话：「an adapter family's companion plugin registers one entry under the family's namespace and receives every card of that family」），插件以 key `llm-pi-ai`、priority -100 登记一条，每张 pi-ai 提供商卡片（已保存的行、首次设置的行、新增草稿卡）都会在行头之下、编辑器之上渲染这块，比 footer 离它管的行近。rc.4 没有别的包往这个 key 登记；-100 是插件一贯的遮挡优先级，将来官方若在默认优先级加同 key 的伴侣卡会被遮住而不是冲突，届时再评估。

- `src/vendor/settings-models/client/reasoning-declaration.ts`（改编自补丁版 `ModelListEditor.tsx` 的 `reasoningLevelsFor`、`ModelReasoningEfforts.tsx` 的 `withEfforts`、`store.ts` 的 `reasoningLevelChoices`）：哪些行可声明（安装目录没有描述的 id，或已带声明的行）、开启写 Off 加 low/medium/high（官方 `INITIAL_LEVELS`）、关闭写 `false`、勾选档位按 schema 顺序、档位列表从命名空间 schema 的 `providers.*.models.0.reasoningEfforts` 读（和适配器接受的键同源：off/minimal/low/medium/high/xhigh/max）。
- `controller.ts`：读 `configForms.get('llm-pi-ai')` 快照的 `user` 层，`remote.llm.discoverModels('llm-pi-ai', {provider})` 问安装目录描述了哪些 id（官方 `catalogIds` 同一来源，无网络 IO），写回整份 `models` 数组（和官方编辑器同一种写法），用读到的 `revision` 作围栏，被拒绝显示一行提示并由共享表单自行恢复。
- `ReasoningDeclarationCard.tsx`：手写路由（`provider.declared === true`）不渲染（官方行已有控件）；没有可声明的行不渲染。每行一个开关，开启后每个非 off 档位一个复选框；最后一个档位不可取消（pi-ai 拒绝「只剩 off」的声明）。档位的发送值用档位名（官方默认），已存的自定义拼写在增删别的档位时保留；要改拼写仍需手改设置文档。
- 登记在 `client.tsx` 的 `installPresentation`，`ctx.inject(['remote.llm', 'settingsSchema'])` 作用域内，这两个服务 rc.4 都有（官方 `ui-settings-models` 的 inject 清单）。
- 词典 `modern-reasoning`，八种语言。

## F2 文件预览与 Plan 预览的代码块折叠

折叠本身在插件 primitives 的 `CodeBlock`（`collapsed`、`data-code-collapsed`）里，官方 rc.4 的 `CodeBlock` 没有；补丁对两处预览只是多传 `collapseLabel`/`expandLabel`。做法是按 key 以 priority -100 遮住官方的 keyed 条目，改用插件的 `MarkdownText`：

- 文件预览：`sidebar.right.tab.document`（由官方 documentpreview 的 `sidebar.right.pane.tab` 条目声明，keyed，key 是实现 id `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown`）。迁入 `src/vendor/documentpreview/client/markdown/`：`MarkdownBody.tsx`（改编：换 primitives 来源、frontmatter 字段表改静态引入、词典换插件命名空间）、`MarkdownBody.module.css`、`frontmatter.ts`、`frontmatter-fields.tsx`（依赖 `yaml`，按官方 documentpreview 的版本钉进根 devDependencies 一起打包）、`frontmatter-fields.module.css`、`path-images.ts`（原样）。官方的实现元数据（扩展名、分页加载）、文本预览外壳、工具栏都还是官方的。
- Plan 预览：`sidebar.right.pane.tab`（keyed，key `@deepseek-ai/dsh-client-ui-plan`）。迁入 `src/vendor/plan/client/`：`PlanPreview.tsx`、`PlanPreview.module.css`（只取预览相关规则）、`review-preview.ts`、`failure-line.ts`、`plan.ts`（两个文档类型加 `plan` 资源协议与错误码的类型合并，官方 `.d.ts` 的公开 `./client` 路径没有导出它们）。官方的标签页类型、资源提供者、`PlanTitle`、卡片和芯片都还是官方的。
- 词典：官方 `documentMarkdown`、`plan` 命名空间把代码块标签留给 `common` 兜底，而 rc.4 的 `common` 没有 collapse/expand；插件起 `modern-document-markdown`、`modern-plan` 两个命名空间，八种语言齐全，条目 `locale` 指向它们。
- `sidebar.right.*` 以 -100 遮挡 keyed 条目此前没有先例。官方注册表对同 key 不同 priority 的条目只按 priority 排序取最低者渲染（`entriesOfSlot`），单测已证实插件条目是胜者、官方条目仍在登记表里、插件卸载后官方条目独自恢复；浏览器验收见下。

不做的：提问卡与预设指南要整包接管，不做；插件市场/插件管理详情在 rc.4 没有对应组件。

一个边界：社区插件 dsh-better-sidebar 以 `extension` 优先级认领所有 `dsh-resource://file/**` 地址，并用官方 primitives 的 MarkdownText 自己渲染 Markdown。装着它时（本机正式 profile 与安装器的三个社区插件都含它），从对话点开 .md 文件走的是它的查看器，官方文件预览体（以及插件对它的遮挡）不会被用到；停用它，或在没有它的部署里，文件预览才是插件的。Plan 预览不受影响（它不认领 `dsh-resource://plan/**`）。验收时 `owners.e2e` 用 `--patch` 覆盖层停用了这个社区条目（安装本身仍装齐三个社区包）。另外本机上 dsh-better-sidebar 把会话内相对路径解析到了测试进程所在的仓库根（CI 上没有这个问题，`browser.e2e` 的「Open fixture file」一步本机必败就是它），是社区插件自己的事。

## 验证

- `npm test`：全过（含新增的两条：预览遮挡与折叠按钮/标签、推理档位读写）。单测夹具给 vm 沙箱补了 `performance`、`requestAnimationFrame`、`structuredClone`（Modern 开关的动效和控制器的克隆要用）。
- 干净 scratch 安装（`install-existing.sh` 复用本机官方包缓存）上 `owners.e2e` 通过，其中新增一步：mock 回复按绝对路径链接工作区里的 `m1-guide.md`，点开文件预览，断言 frontmatter 框、`收起代码` 按钮、折叠后 `data-code-collapsed="true"` 且内容 `hidden`、折叠后高度不到展开时一半、再展开；截图 `markdown-preview-expanded.png`、`markdown-preview-collapsed.png` 在运行目录。
- 「声明推理强度」块在真实宿主上的无头浏览器探针（`docs/verification/reasoning-declaration-ui-20261028/`）：设置 → 模型的 openai 卡片里只出现 `probe-newer-model`（带声明）与 `gpt-4.1`（显式 false）两行；打开 gpt-4.1 的开关后设置文档写入 `{off: null, low, medium, high}`，勾 xhigh 后追加，关掉后写回 `false`，另一行原样；复选框是 schema 的 minimal/low/medium/high/xhigh/max；页面无错误。三张截图与 `stages.json` 在同目录。
- 实验记录：`docs/verification/reasoning-efforts-preserve-20261028/`（`probe.mjs`、`result.json`、`after-save.png`）。

## 回滚

停用插件 bundle 即恢复官方预览体与官方模型页；写进设置文档的 `reasoningEfforts` 是 pi-ai 本来就接受的字段，官方页读写照常。
