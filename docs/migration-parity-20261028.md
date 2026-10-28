# 旧完整编译版的迁移缺口补齐

功能基线为 Modern UI `a9f4c370fa480c9a17d5c9a79cb83aeba26bdf0d`，即 upstream `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` 加固定旧补丁。消费宿主继续固定为官方 npm `@deepseek-ai/dsh@0.2.1-rc.4`；本轮没有改写官方包、注入模块别名或替换全局 dispatcher。

本文说明补齐后的实现；[首轮迁移记录](plugin-migration.md)中的包摘要、计时和测试数量属于历史快照，不能代替本轮产物。最终平台结果以本 PR 对应提交的 `Plugin preview` CI 为准。

## 恢复的行为

- **继承偏好。** 安装器读取官方组合后的配置，迁移实际生效的模型卡片、价格和聊天偏好；保留用户已编辑的 Modern 值，并给早期 patch-only 迁移增加独立回执。原配置及回执都有备份与摘要。[分发与配置](distribution-parity.md)
- **完整推理声明。** 目录模型可编辑各档 API 值、增删 Off、保留扩展字段，继承模型列表在首次保存时完整物化；取消、只读和 revision 冲突保持官方设置语义。[模型兼容](model-parity.md)
- **标准模型标签。** Modern 模型座位恢复 `conversation.input.model.label`，官方 1017 标签及第三方贡献使用同一个公开槽。选择和 `/model` 共用一个客户端目录，操作官方 Host/session/remote API，不再硬编码标签。
- **选中文字引用。** assistant 消息中的选择可加入原输入引用队列，发送后保留引用呈现；与普通输入、重复引用和撤销一起验证。[聊天交互](chat-interactions-parity.md)
- **插件长文档。** Installed 和 Discover 页面恢复本地化 `meta.detail`、README、仓库回退、相对图片、错误与重试。Host 路由沿官方鉴权和 owner 检查，只读已安装或已列入目录的包；本地文件拒绝越界符号链接，图片限制大小并带 sandbox CSP。插件管理器和市场控制器继续由官方提供。
- **Markdown 折叠。** 提问正文与预设指南增加旧版代码块折叠，业务动作仍使用官方 face/store。默认 `dsh-better-sidebar@0.28.0` 的 Markdown 编辑器通过局部 DOM 适配增加折叠，并保留原编辑、复制和导航。[展示兼容](presentation-parity.md)、[样式与社区预览](official-style-parity.md)
- **原图转移。** 恢复原始文件字节、浏览器 DownloadURL 和应用内图片 token；聊天、Markdown、图片集与输入端接线一致。普通拖入上传保留。[聊天交互](chat-interactions-parity.md)
- **工具与官方页面表现。** 自有工具展示 owner 覆盖 generic/MCP/自动拒绝结果并保留标准工具子槽。官方控件使用限定到固定版本样式的适配；启动／失败页通过公开 index 注入补齐样式。[工具兼容](tool-parity.md)、[样式说明](official-style-parity.md)
- **完整数据目录备份。** 对非空 data home，在 staging 或 DSH 写入前生成并校验整树快照，覆盖会话、附件、profiles、隐藏文件和空目录。托管安装/启动共享 home 租约；程序 rollback 仍不隐式恢复数据。[分发与配置](distribution-parity.md)

HTTP 抓取额外提供独立入口，固定插件自己的 Undici `8.12.2`，保留 rc.4 的 DNS、公网地址、NAT64、重定向与大小检查。安装后新增的受支持顶层 translator/MCP/HTTP 实例在下一次托管启动时重新绑定，配置和启停状态不变。

## 实现和验证边界

官方 UI 的七个展示入口由 bundle 明确选择：layout、sidebar、workspace、conversation、chat、model-selection、tool。公开 session、remote、命令执行、配置、插件管理、上传和 Host 模型目录服务继续使用官方实例。Model 的客户端目录适配器随其展示 owner 打包，因为停用官方展示入口后该浏览器模块不再进入 boot graph；其行为与固定 rc.4 实现对照验证。

新增定向测试覆盖真实 SlotCore/renderer、HostConnectionService、配置 patch 组合、备份与锁生命周期，以及浏览器原图转移。`browser.e2e.mjs` 保留原浏览器断言，并在实际安装模式下保持三个默认社区插件启用，检查 Markdown 折叠、Installed README 和真实引用发送。`owners.e2e.mjs` 另行停用社区文件查看器，保留官方文件预览替换的独立验收。

独立审查还发现并修复了本地 README 同版本更新的缓存问题，以及旧文档来源和仓库限制配置的衔接。文档请求沿用旧版允许的仓库 URL 与用户 Git 路由设置，不把它称为额外网络沙箱。测试只使用受控模型提供方，不消耗真实付费额度。

真实默认社区消费发现 `dsh-better-sidebar` 会把相对文件路径按 Git 仓库根解释，导致仓库子目录中的工作区打开错文件。Modern 现在把解析后的绝对路径保留在标准 Session 作用域的资源 URI 中；测试明确建立嵌套工作区，并检查真实文件读取请求。此前已打开的相对地址与新绝对地址可能并存为两个标签页，刷新或关闭旧标签后使用新地址。

本地 Windows x64、Node `24.22.1` 的整合回归为 202 项：191 通过、11 项平台条件跳过、0 失败。最终文件地址变更后的相关定向检查再次通过。严格前端/Host 构建通过（1097 个浏览器输入）；Host 构建现在同时拒绝未在插件清单声明的外部运行依赖。

隔离消费者完成实际安装与升级，三个固定社区插件保持选中。最后一次完整数据快照校验 583,341,441 字节、33,710 个条目；消费自检与后续复核确认官方依赖闭包 616 包未修改。源环境浏览器 24 项、最终安装包浏览器 28 项、输入/队列专项 7 项和官方联网 5 阶段检查通过；本地检查使用合成会话与独立 data home。

最终安装包浏览器在三个社区插件全部启用时验证：嵌套 Git 工作区的相对聊天链接实际请求绝对文件路径，社区 Markdown 全文/折叠/原编辑器及双向 Markdown 导航，真实文本选择引用进入模型请求并在刷新后唯一显示，以及官方 Installed 页面中的 Modern README 首尾全文与代码折叠。console/page errors 为空，fixture 的隔离校验确认原消费者数据及 profile 字节不变。

以下边界仍保留：

- 会话联网按钮、`/web on|off` 和旧 `web/search` 策略已明确取消，不恢复；旧快照继续保留原件，不做自动转换。
- 官方启动器的 `dsh-http-proxy` 仍依赖 Undici `8.11.2`；其余官方依赖也未通过 overrides 改写。独立抓取入口不等于全宿主依赖升级，Zod 等版本差异仍见 [Host 记录](plugin-host-compat.md)。
- rc.4 没有可复用的原生 Electron 文件拖出桥。本轮验证浏览器字节和应用内链路，不宣称所有操作系统与外部应用原生拖出都等价。
- 整树备份要求停机。旧启动器、直接官方 CLI 与远程主机不遵守新 home 租约；快照不是在线数据库备份。
- bundle 切换后需要刷新页面；真实触屏、WebKit、Electron 多窗口以及全部第三方私有组件组合没有全面验收。
