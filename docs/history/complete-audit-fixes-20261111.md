# 2026-11-11 综合审计修复

对应附件《DSH Modern UI 完整综合审计报告》，基线为 `74b08dcc02c44699582953b3a78136ca84f7d139`（0.1.15）。本次覆盖 F01–F12、C01、H01–H08。N01–N05 按报告的非缺陷边界保留，不将本次检查扩写为所有浏览器、平台或辅助技术已验证。

## 用户界面与键盘操作

- **F01/F02**：Badge 和 Button 使用可收缩的独立标签节点，完整长文本可换行；保留图标、原始动作值和原生按钮操作。实际 Renderer 的 Card、Row、Grid、Form 覆盖长英文单词、长句、中文、德文、不同按钮尺寸/变体、禁用及 streaming 状态。
- **F03**：模型表头和每行评级共用列宽；取消全大写和单行裁字，按完整翻译自动增高。真实浏览器检查 320/380/390/1000px、英/中/德/俄/葡及三种字体，共 60 个组合，检查列对齐、全文绘制和菜单边界。既有动效测试改为验证布局高度稳定，不再固定旧表头的像素高度。
- **F04**：Toast 以 border-box 限制外框宽度和长动作换行，按实际宽度夹取锚点中心；挂载期间跟踪位置，覆盖只移动、不变宽的分栏变化。定位独立于计时，保持 portal、动作焦点/悬停暂停、剩余寿命和一次完成回调。真实 InputBar 的 notice/promptError 两条生产入口另外覆盖 320/800px、变换后的 composer 容器及位置/宽度变化。
- **F05**：Carousel 每次分页都读取当前减少动态效果偏好；reduce 请求 `instant`，普通偏好保留 `smooth`。浏览器检查运行中切换、首末边界和连续帧滚动位置。
- **F06**：工作区与会话菜单增加复制原始完整路径/标题的入口，不依赖重命名权限。复用剪贴板帮助函数，保留指针 HoverCard；反馈和焦点归还独立于菜单卸载，空值没有复制动作。
- **F07**：实际可调整的左右侧栏分隔条具备本地化名称、vertical separator、焦点样式及当前/最小/最大宽度。方向键、Shift 加速和 Home/End 使用同一宽度动作；右侧最大值计入当前中栏让位限制。折叠、移动端或全屏模式不增加无效停靠点。
- **F08**：Menu 条目显式声明 radio/checkbox，普通动作保持 menuitem；工作区视图设置提供三个具名独立单选组，标签筛选使用 checkbox。导航、收起子菜单和选择后焦点恢复统一识别三种角色。
- **F09**：PreferenceRow 和 EnterBehaviorRow 以实例唯一 ID 关联设置名、当前值与说明，保持原有菜单开关和焦点行为。
- **F10**：QuestionFlow 的单选/多选组关联当前问题标题，标题 ID 加入实例前缀，避免相同请求同时展示时互相引用。
- **F11**：子菜单父项的 Tab 与 ArrowRight 共用进入逻辑，等待 portal 完成定位后聚焦首个可用子项；已打开的子菜单同样推进焦点。顶层菜单触发器保留进入主列表的既有规则。
- **F12**：只在 Carousel item 内收敛卡片阴影并保留 24px 实际绘制空间，保留横向滚动、snap 与分页。轨道不使用覆盖相邻内容的负 margin，并验证上下相邻按钮的真实命中和点击。首末 Pressable(Card)、浅/深主题、选中/未选中、hover/键盘焦点共有 16 张截图，外侧及上下边界像素均回到背景色。

真实组件浏览器回归集中于 `tests/audit/complete-audit-openui.test.mjs`、`complete-audit-keyboard.test.mjs`、`complete-audit-toast.test.mjs`、`complete-audit-toast-composer.test.mjs`；既有菜单、布局、主题、OpenUI 和模型动效检查同时保留。

## 宿主合约

**C01**：`node tests/compat/chat-contract.mjs` 在仓库外为 0.2.1-rc.2/rc.3/rc.4 和 0.2.2-rc.1 分别安装官方宿主，解析其实际聊天依赖，记录版本、路径、发布 JS 的 SHA-256、字段及 lockfile。旧三版保留 `compactAnswer`，rc.1 检查 `hasNonReplyProcess`；未知版本显式失败。

公共投影语义与 Modern 有意保留的后续回复/工具增强分开断言。检查包含对象稳定性、最早回复、后续回复可见性和原始 Markdown 复制。PR CI 新增四版本合约矩阵。Windows x64 / Node 24.18.0 的四个独立消费者各通过 7 项检查；这不是完整宿主生命周期或所有平台验证，`verifiedHosts` 未扩大。

## 维护与异常诊断

- **H01**：路径包含判断合并为 distribution 内部的 `contains-path.mjs`，保留 realpath 的调用顺序及原判断语义。覆盖相同路径、父子、近似名称兄弟目录、`..x` 和 Windows 跨盘；整个 distribution 目录仍随 preview installer 分发。
- **H02**：客户端与预览共用无副作用的 `locale-dictionaries.ts`，显式选择原有八种语言，不注册其他模块导出；命名空间、注册和撤销入口保持不变。
- **H03/H04**：删除仓内零调用、未列入 package exports 的 `launchChild` / `withOperationLock` 便利导出。manager 的多阶段 `createLaunchLifecycle` 和显式 acquire/finally-release 生命周期未改。这两个按脚本路径导入的未声明接口不再提供。
- **H05**：正常 CLI/链接 CLI 仍识别为主入口，eval/stdin 与不存在的 argv 仍按非主入口处理。意外 argv/module 规范化错误传播原始诊断并非零退出，隔离 EIO 注入不执行业务分支。
- **H06**：提示词生成器只把 ENOENT 当作未生成；EIO/EACCES 保留原因并失败，不误报 stale 或最新、不继续写入。缺失、stale、匹配、检查/生成两种模式均覆盖。
- **H07**：预览依赖以 lstat 区分不存在和已占用路径；正确链接复用，错误目标和悬空链接有明确错误，其他 I/O 原因直接传播，不删除未知路径。
- **H08**：Jev 使用 `unavailable` 区分 provider 拒绝与普通未配置；只在状态进入失败时输出固定、不含 provider 正文的诊断。保留 never-rejects、会话创建和恢复后重新注册工具，未配置保持安静。

脚本回归位于 `tests/compat/script-diagnostics.test.mjs`，Jev 的拒绝、去重、恢复和脱敏回归位于 `tests/unit/jev-tool.test.ts`。

## 保留边界

- 不强制内嵌 Geist，不重写 AgentTree 焦点模型，不把 Modal 的可选描述关联升级为强制要求。
- 不改变归档 Undo 的实际保持/淡出时间、暂停行为或永久取消归档入口。
- 不改变 Carousel 以外的 Pressable/Card 组合设计。
- 浏览器检查使用真实组件和真实渲染引擎；未以夹具测试声称真实 Android/iOS 键盘、Safari/Firefox、Electron 或实体屏幕阅读器全部通过。
- 本次未发布 npm 版本，也未执行合并或部署。
