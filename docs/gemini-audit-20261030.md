# Gemini 审计复核与修复（2026-10-30）

复核对象是外部 `DSH_Modern_UI_Audit_Report.md`，基线为 `6b059266dad176198826eb18e7836f7c913cfbfb`。报告的补丁和整改顺序仅作为建议；以下判断依据当前源码、已发布官方包、实际解析器、React 生命周期和浏览器行为。仍采用官方 DSH 成品加独立 UI 插件，不修改官方后端或模块表。

## 基线、架构和兼容性：B1–B9

- **B1：既定产品范围。** 会话级联网开关和 `/web` 已明确退役，见 [迁移记录](plugin-migration.md)。不恢复未经官方事件/SDK支持的网络控制。
- **B2：部分成立，与 L6 合并修复。** 官方标签台账仍包含原 Discover 和展示替代项。隐藏标签的方向键死区已修；不修改官方台账，重复 key/DOM id 的宿主限制仍存在。
- **B3：已知展示差异。** Agent presets 保留官方设置表单，以避免 list slot 产生重复导航；未重新引入被退役的 SettingsForm。见 [展示兼容说明](presentation-parity.md)。
- **B4：既定边界。** Plan review 保留官方审批载体和动作；普通问题才使用 QuestionPresentation。方案侧栏的文件/图片导航缺口单独按 M4 修复。
- **B5：既定边界。** 浏览器插件没有 Electron 主进程拖拽桥；保留已公开说明的 DownloadURL/URI 降级，不注入原生后端。
- **B6：已知外观差异。** Schedule 私有日期选择器/菜单仍是官方样式，迁移文档没有承诺逐个恢复所有内部圆角。
- **B7：版本约束而非当前失效证据。** 样式适配公开声明的精确 rc.2/rc.3/rc.4 宿主集合；将来宿主重新编译后的 hash 漂移需要升级验证，不据此改写当前有效选择器。
- **B8：已记录的答案启发式局限。** 主回答与工具调用同一步、下一步只有简短收尾时，无法仅凭现有记录可靠区分正文与工具旁白。沿用 [真实会话复核后的规则](answer-fold-audit-20261029.md)，不按长度或工具名称猜答案。
- **B9：历史事实，数量和当前测试说明不完整。** 删除旧测试是 `00c143e` 的维护决策；基线已有 4 个 `*.test.mjs` 和独立消费/浏览器/MCP/安装生命周期驱动，不是仅有 3 个测试。为本次实际缺陷新增针对性回归，并纳入现有 CI。

## Markdown 和文本：M1–M5

- **M1：不采纳语法扩张补丁。** [既有约定](main-and-bold-audit-20261029.md) 明确只扩展 CJK 区、全角标点和弯引号，ASCII 保留 CommonMark；全角星号不是强调标记。破折号、省略号、间隔号并非中文专用，新增解释需要产品语义决策。测试保留现行边界。
- **M2：CommonMark 行为，不拆四星分隔符。** 连续 `****` 的 rule-of-three 限制可以用上游解析器复现；强拆会改变普通强调语义。
- **M3：确认并修复。** 状态摘要不再无差别删除 `**`。先按既有 160 grapheme 预览预算截断，只移除能确认的 strong 分隔符；多个 glob、代码、词内幂表达式保留字面星号。截断产生的未闭合标记宁可保留。异常长组合字符超过 512 UTF-16 单位时不运行 Markdown 解析，避免长流式文本引入主线程退化。
- **M4：确认并修复。** PlanPreview 从资源地址确定真实会话/子代理身份，读取同一身份的 workingDirectory 或 catalog cwd，再接入 MarkdownDelegateProvider。图片 URL、文件链接和行号导航正确；未知身份/目录不借用当前会话。普通代码词不猜成文件，产物 fileMentions 需要的 turn 元数据仍不在 PlanDocument 中。
- **M5：确认并修复。** DiffBlock 将 CRLF 与 LF 视为相同的展示行；quote rule 识别两类分隔符并保留原始文本长度和 offsets。

## 交互和生命周期：L1–L7

- **L1：修复。** 模型选择 RPC 拒绝由既有错误通知通道显示。
- **L2：修复。** HoverCard 不再在 window 捕获阶段吞掉其他控件的 Escape。
- **L3：修复边界。** blur 的 relatedTarget 非 Node 时不会传入 contains；合成 Window 焦点事件可复现原异常。
- **L4：修复。** 非 JSON HTTP 失败保留 network 文档错误提示。
- **L5：未复现声称的错误。** Portal 节点只在同一 body 内重排，CSS anchor 要求 anchor 在 backing 前。StrictMode、兄弟增删和卸载验证通过，保留实现。
- **L6：修复可见标签键盘导航。** 官方 SegmentedTabs 会按原始数组聚焦隐藏 Discover，实际表现是停留在前一个标签形成死区。仅在存在重复 Discover 的标签栏捕获方向键/Home/End，按可见项聚焦并触发原点击选择；其他标签栏不受影响，插件卸载移除监听器。底层重复 key/id 的限制没有被掩盖成已消除。
- **L7：修复。** 单段翻译失败后保留已译段落，未译段显示原文，原文/译文切换和重试仍可用。

## 布局：U1–U8

- **U1：部分成立并修复。** inherited overflow-wrap 使原 inline-flex 不一定撑宽，但它是独立原子盒。普通行内代码改 inline 并复制分行装饰，可参与父段落换行。
- **U2：阅读宽度设计。** 正文 65ch、代码/表格全宽是显式设计，保留。
- **U3：修复。** 原表格 hover 在真实 Edge 中令后文 y 从 67 变到 62；保留 overflow-x:auto，去除假设 5px 滚动条高度的切换。
- **U4：修复。** 移动导航使用 44px/正文/44px 三列，即使没有新建按钮仍物理居中。390px 视口基线标题中心为 221px，修复为 195px。
- **U5：修复。** 异步/快捷键打开官方或 Modern 模态框时，用官方共享 isBehindModal 关闭背景 Menu、ModelSelect 和 HoverCard；模态框内菜单保留。无 z-index 改写，也不创建第二套模态栈。观察器只看 body 直接 portal 插入，不监听聊天子树流式变化。
- **U6：修复。** 锚点当前侧空间不足时向空间更多的一侧翻转，超大面板仍保留视口顶部/左侧边距。
- **U7：修复。** 240px 附件允许收缩并限制最大宽度。180px 容器基线卡片向左溢出 60px，修复后在容器内。
- **U8：确认局部覆盖并修复。** 折叠过程将 sidebar 内容裁在缩小的轨道内；macOS/Windows 原生零宽轨道移除 16px 左 padding。保留固定 caption 控件与普通 Web 的 68px 图标轨道，不取消正常展开动效。

## 性能：P1–P12

- **P1：体积结论不成立。** SiteGlyph 独立 CJS 产物 41,034 bytes，simple-icons 实际贡献 39,366 bytes，并未因读取 5 MB 输入就全部保留。保留包的版本/许可，不复制静态图标字典。构建元数据新增最终输出的 bytesInOutput，避免混淆输入文件大小。
- **P2：确认并修复。** Lexical 默认 wrapper 同时静态导入 dev/prod，随后选择 namespace；构建显式 production condition 只选生产入口。并非报告所称的 development 条件优先命中。

完整客户端产物实际从 **9,929,186 bytes** 变为 **9,847,118 bytes**（减少 82,068 bytes，约 **0.83%**），不是报告预测的 66%。最终产物中 simple-icons 贡献 **39,505 bytes**；没有 Lexical dev 输入。大头还包含内嵌 KaTeX 字体/样式、语言数据及语法高亮定义；本次没有将这些必要功能当成死代码删除。
- **P3：误报。** ChatSnapshotBuilder 持有同一个 MutableChatNodeStore。100 次更新及 replace 保持引用，更换 Builder 才换引用；保留 nodeStore 用于重新绑定 keyed hooks。
- **P4：修复。** 锚点/hover 布局测量用 rAF 合并，坐标不变保持 state 引用，并清理待执行帧。
- **P5：优化假设未得到验证。** KaTeX helper 没有独立全局缓存，但 Markdown 组件已有 memo/useMemo 和流式冻结块；没有据此添加未测量的缓存。
- **P6：确认并修复。** Observer 对受影响代码块和新增节点去重，不再对每条 record.target 扫描整棵子树；只有实际移除时清理所有 folds。20 次文本追加的祖先全树扫描从 20 次降为 0 次。
- **P7：确认并修复。** 196 个图标合并一次 XML 解析，逐一验证所有属性和子节点等价，解析从 196 次降为 1 次。
- **P8：不做无收益依据的 memo。** Rows 的 drag/now/callback 等 props 本身会变化，直接 memo 不能证明收益；未扩大为列表架构重写。
- **P9：保留同步语言注册。** 没有启动耗时证据支持改变字典同步可用和切换语义，1.18 MB 输入体积不是主线程耗时测量。
- **P10：修复。** 清理复制反馈定时器，忽略卸载后才完成的 clipboard promise。
- **P11：误报。** syncSpinner 是模块级稳定 ref，不是每 render 创建的回调；重渲染验证没有重复注册。
- **P12：保留 React 状态语义。** 条件 render-phase state adjustment 保持最后已提交 cap；Suspense 放弃一次并发展开不会污染关闭状态。未采用 render 时写 ref 的建议。

## 清理：D1–D6

- **D1：清理。** 删除无使用的 SettingsForm/form-model 及其类型重导出、formLabels；报告中的 SettingsForm.module.css 在基线实际不存在。
- **D2：清理。** 删除三份没有外部引用的旧 chat model，共 292 行；不是报告所称 307 行。
- **D3：7 项均有活跃引用或类型增补。** 全部保留。
- **D4：清理。** 9 个文件的 18 个未使用符号；CI 增加 noUnusedLocals/noUnusedParameters 检查。
- **D5：部分成立。** 清理 HeroShell 8 类、ChatView 2 类、SidebarRoot 4 类；保留全局 md-table-wide、跨组件 archiveActivity 和传给 DraftEditor 的 grow/inputDisabled。报告其余多项只有注释命中，不能视为真实选择器。
- **D6：收窄导出。** 8 个符号仍在本模块使用，只去掉冗余 export，不删除函数、不宣称运行时提速。

## 验证方法与边界

新增回归位于 `tests/audit/`；现有 `tests/compat/` 继续验证官方会话、配置和安装契约。Node 固定为 24.22.1。测试覆盖真实 Markdown parser、React/jsdom 生命周期、官方发布的模态栈和标签组件代码、真实 Chromium/Edge 布局与焦点。少量外围显示组件使用替身，不能将这些单测当成完整宿主运行证据。

已保存的修复前证据：Markdown 初轮 6 项失败，交互初轮 7 项失败，异步模态 2 项失败，布局 3 项失败，Discover 导航 1 项失败，PlanPreview DOM 1 项失败，Observer/SVG 2 项失败。不是简单修改断言使测试变绿；独立审查还发现并修正了初版 M3 的跨 glob 删除和无界解析回归。

本地整合验证：现有兼容性回归 **26/26**、新增审计回归 **48/48**，均 0 failed、0 skipped；客户端严格 unused 检查、宿主类型检查、完整插件构建通过。P1/P2 最终回归读取实际构建元数据，不只在独立示例里验证 esbuild 选项。

官方消费 CI 的最终结果记录在 PR。Windows 的 CSS 平台模拟不等于原生 macOS vibrancy 验证；未声称 Firefox、付费模型、所有外部提供商或长期会话 profiling 已验证。
