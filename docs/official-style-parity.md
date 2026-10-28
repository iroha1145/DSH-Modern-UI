# 官方控件与社区 Markdown 的插件适配

## 所有权与固定版本

适配目标为官方 `0.2.1-rc.4` 和 `dsh-better-sidebar 0.28.0`。不改动官方/社区包，不替换 React、模块加载器或事件处理。官方控件的状态、键盘交互和数据保存仍由原组件负责。

`installOfficialControls` 挂载一张插件拥有的样式表，并设置可撤回的 `body[data-modern-official-controls]`。选择器使用真实 rc.4 Web shell CSS Modules 名称，或官方独立 client bundle 的精确已编译名称，没有 `_button` 等模糊匹配。测试将每个名字与已发布资产交叉核对；升级宿主后必须重新核验这些显式兼容映射。

原有 Modern 主题已经提供调色板、圆角与字体 token，因此新表只包含旧补丁尚未覆盖的差异：

- Button 的间距、字重、尺寸、状态色与按压；Input 的 36px 外框与触屏 16px 字体。
- HoverCard 的主题背景/文字/阴影；DisclosureRow 的 padding、hover 与圆角；当前 SettingsValueField 的 8px label/control 间距。
- SegmentedTabs 的 Feel 时间曲线和选中 500 字重；MenuSurface 的 WebKit backdrop-filter 与 forced-colors 边界；Modal 的 dialog 曲线。
- AccountMenu 的 launcher 继续复用已有 settings-shell 规则，只补 avatar 和 portal 菜单；AccountNotice 圆角。
- Trajectory 标签/省略号/错误行字重、边界提示阴影、详情栏 inset stroke 与移动浮层阴影；FontNotice 标题字重。

rc.4 的公开 primitives 中已不再渲染旧 ConfigField，不能给不存在的旧类注入样式；其当前设置表单字段通过真实 SettingsValueField 验证。通用 ToolRow 和已由 Modern 接管的聊天/文件预览等不在此表重复覆盖。

## 官方 Switch 动效

仅为 rc.4 的 `button._switch_1ik0f_5[role=switch][aria-checked]` 创建已有 `createFeelSwitchMotion` 实例。观察官方 `aria-checked` 更新，复用原 spring solver，让 thumb 位移和填充同步。既不捕获点击也不改变受控值；键盘、disabled 与写入行为保持官方实现。节点移除和最终 owner 卸载时取消动画、撤回 CSS 变量；多 owner 共用一份 observer/style。减少动态效果时 solver 立即到达端点。

## 浏览器加载前的启动/失败页

旧 boot-page 补丁只有 wordmark 和 failedTitle 从 600 到 500 的字重差异。`host-compat/official-style.apply` 通过公开 `webserver/index-inject` 增加 `kind: 'style'`，在浏览器客户端运行前就送入 HTML head。没有 raw HTML tap、外部资源、脚本重写或 loader 拦截。Host 插件本身未启用/未能加载时当然不能贡献这张样式表；该边界与任何正常插件一致。

## 社区文件 Markdown 折叠

社区公开 `registerFileViewer` 的组件粒度是整个 viewer，没有 fenced-code renderer/decorator 接口。为了保留编辑器、导航、Mermaid 与文件管理，本实现不注册替代 viewer。

`installCommunityMarkdown` 只处理浮动 `[data-dsh-better-sidebar]` 或原生 `[data-dsh-native-tab-host]` 中的 `.nArs4W_editorMd` 文件预览，再限定到官方 `.md-code-block` 的 `[data-code-block-banner]` 与直接子节点 `[data-code-block-content]`。使用自有 button、aria-expanded/aria-controls 和正文 hidden 状态；复制、换行和代码原节点保持原样。标签使用 `modern-chat` 已有八语言翻译，并订阅官方 locale 的变化。

Mermaid 自己替换 `.md-code-block` 子节点，因此排除 `data-mermaid-processed`；raw HTML segment 与已有 disclosure 控件也排除。源内容重渲染时保留同一 block 的折叠状态，失去预览/移除的节点被清理。卸载删除自有按钮，精确还原原始 hidden、id 和自有 marker；不会触碰文本编辑 buffer，也不保存与社区无关的页面按钮状态。

## 验证

`tests/plugin/official-controls.test.mjs` 使用真实官方 React 控件、真实已发布 CSS 与 headless Edge 计算样式，覆盖输入、单次 switch 回调、tab 键盘、disclosure、深浅主题、减少动态效果、双 owner 撤回、触屏输入，以及剩余页面的已编译 class 合约和实际计算样式。Host 样式使用真实 Cordis 生命周期与公开 index renderer，另验证没有客户端脚本的启动/失败页字重。

`tests/plugin/community-markdown.test.mjs` 使用真实官方 MarkdownText，覆盖 floating/native 容器、原按钮保留、正文不变、编辑/导航节点不变、语言切换、源更新、无代码与重新出现、Mermaid/已有折叠避让和精确卸载恢复。固定社区包存在时交叉验证源码与 compiled class。完整已安装消费者仍应在启用 better-sidebar 时打开真实 Markdown 文件验证，不以停用社区插件作为等价验收。
