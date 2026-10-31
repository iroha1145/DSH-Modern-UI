# 安全策略

## 报告漏洞

请**不要**在公开 issue 里披露漏洞。使用 GitHub 的 [私密漏洞报告](https://github.com/iroha1145/DSH-Modern-UI/security/advisories/new)，写明受影响的插件版本、官方 DSH 版本、复现步骤与影响。后续沟通在该 advisory 里进行。

仅支持最新发布的插件版本；修复会以 patch 版本发布并在 [CHANGELOG](CHANGELOG.md) 中注明。

## 范围

本插件只替换和扩展官方 DSH 的 Web 前端，不修改官方后端、官方 JS、前端 dist 或原生模块。官方宿主自身的问题请报告给 DeepSeek Harness 上游。

## OpenUI 组件边界

模型可以在回答里写 `openui-lang` 代码块（旧写法 `openui` 代码块里如果是 openui-lang 也算），插件用 [OpenUI](https://github.com/thesysdev/openui) 的渲染器把它画成交互组件。这是**不可信内容**，按以下边界处理：

- openui-lang 是声明式语言，只能调用插件注册的组件、内置函数和动作，不能写脚本，也不能插入任意 HTML。组件直接画在 DSH 页面里。
- 模型给的颜色、尺寸等样式值会先过滤：带 `url(`、`var(`、`expression(`、`@import`、分号或尖括号的值一律丢弃，所以样式不能加载资源。SVG 的路径、坐标和变换只接受数字与固定格式。
- 链接只接受 `http(s)` 地址，在新标签页打开并带 `noopener noreferrer`，和回答正文里的 Markdown 链接一样直接打开。
- 会让浏览器连外网的组件只有三个：`Image` 按模型给的 `http(s)` 地址加载图片（和 Markdown 图片相同）；`SearchImage` 从浏览器查询维基百科和维基共享资源的公开接口，只用它们返回的 `https` 图片地址；`Link` 和 `@OpenUrl` 由读者点击后打开。地图、视频、CDN 脚本这类组件没有收进来。
- `HtmlView` 是唯一能运行脚本的组件：两层嵌套 iframe，均只有 `sandbox="allow-scripts"`（没有 `allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`），运行在不透明源中，读不到 DSH 页面的 DOM、Cookie、存储或 API 凭据。内层 CSP 为 `default-src 'none'`，不允许任何网络请求；外层 CSP 的 `frame-src 'none'` 让内层无法跳转到任何地址，内层一旦发生跳转就会被移除。权限策略拒绝摄像头、麦克风、剪贴板、地理位置、全屏、支付等能力。与宿主之间只用带每次挂载随机 token 的 `postMessage` 传高度（限制在 80–2400 px）和跳转失败两种消息。
- 「发给助手」按钮（`@ToAssistant`）只把文字放进输入框发送，和读者自己输入一样受会话权限约束，不会绕过确认直接执行工具。
- 代码块超过 128,000 字符时不解析，只显示源代码。

能突破上述任何一条的问题都属于安全漏洞。放宽这些限制的改动不会被接受。

## 供应链

npm 包带 [provenance](https://docs.npmjs.com/generating-provenance-statements) 发布。一键安装器核验官方 `@deepseek-ai/dsh` 依赖闭包中每个包的 npm `integrity` 与文件字节，详见 [docs/install.md](docs/install.md)。
