# 安全策略

## 报告漏洞

请**不要**在公开 issue 里披露漏洞。使用 GitHub 的 [私密漏洞报告](https://github.com/iroha1145/DSH-Modern-UI/security/advisories/new)，写明受影响的插件版本、官方 DSH 版本、复现步骤与影响。后续沟通在该 advisory 里进行。

仅支持最新发布的插件版本；修复会以 patch 版本发布并在 [CHANGELOG](CHANGELOG.md) 中注明。

## 范围

本插件只替换和扩展官方 DSH 的 Web 前端，不修改官方后端、官方 JS、前端 dist 或原生模块。官方宿主自身的问题请报告给 DeepSeek Harness 上游。

## OpenUI 组件边界

模型可以在回答里写 `openui-lang` 代码块（旧写法 `openui` 代码块里如果是 openui-lang 也算），插件用 [OpenUI](https://github.com/thesysdev/openui) 的渲染器把它画成交互组件。这是**不可信内容**，按以下边界处理：

- openui-lang 是声明式语言，只能调用插件注册的组件、内置函数和动作，不能写脚本，也不能插入任意 HTML。组件直接画在 DSH 页面里，但没有任何属性能控制定位或层级，画不到自己的块外面。
- 模型给的颜色、尺寸等样式值会先过滤：带 `url(`、`var(`、`expression(`、`@import`、分号或尖括号的值一律丢弃，所以样式不能加载资源；像素长度不超过 4000，相对长度不超过 300。SVG 的路径、坐标和变换只接受数字与固定格式。
- 按钮不会替读者发消息：「发给助手」（`@ToAssistant`）只把要发的文字（附上所在表单里每个输入框当前显示的值）放进输入框，读者看过后自己发送，因为按钮上的字可以和它要发的内容不一样。「复制」（`@CopyToClipboard`）复制后会在组件下方显示复制的内容。
- 链接只接受 `http(s)` 地址，在新标签页打开并带 `noopener noreferrer`，和回答正文里的 Markdown 链接一样直接打开。
- 会让浏览器连外网的途径：`Image` 按模型给的 `http(s)` 地址加载图片（和 Markdown 图片相同）；`SearchImage` 会**不经点击**把模型写的查询词（最多 200 字）发给 `*.wikipedia.org` 与 `commons.wikimedia.org` 的公开接口，只用它们返回的 `https` 图片地址；`Link` 和 `@OpenUrl` 由读者点击后打开。相比旧的 HTML 沙箱（完全不联网），这是有意的放宽。DSH 回答里的 Markdown 图片本来就能让浏览器访问任意地址，所以这条边界不承诺「模型无法把数据送出去」。
- `HtmlView` 是唯一能运行脚本的组件：两层嵌套 iframe，均只有 `sandbox="allow-scripts"`（没有 `allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`），运行在不透明源中，读不到 DSH 页面的 DOM、Cookie、存储或 API 凭据。内层 CSP 为 `default-src 'none'`，挡住请求、图片、样式和字体加载；外层 CSP 的 `frame-src 'none'` 让内层无法跳转到任何地址，内层一旦重新加载（跳转或 `document.write`）就会被移除。权限策略拒绝摄像头、麦克风、剪贴板、地理位置、全屏、支付等能力。与宿主之间只用带每次挂载随机 token 的 `postMessage` 传高度（限制在 80–2400 px）和跳转失败两种消息。**已知限制**：CSP 管不到 WebRTC，脚本运行前会移除 `RTCPeerConnection` 等构造函数，但脚本另建子框架仍可能拿到它们并连到外部 STUN 服务器。
- `Image` 的地址加载失败时只显示占位，不会拿图片说明去搜索。
- 代码块超过 128,000 字符时不解析，只显示源代码。解析后先估算 `@Each` 嵌套展开的总数（嵌套相乘，`$变量` 按声明的值算），超过 20,000 项不求值、只显示源代码；读者点按钮或拖滑块改了状态，就按新值再估一次。估不出长度的循环（长度来自算式、`@函数` 的结果或运行中的状态）在求值和绘制时按实际计步：查一次组件、调一次函数各算 1 步，绘制一个组件、函数返回列表里的每一项各算约 5 步，一次求值连同绘制超过 100,000 步（约 20,000 个组件）就停下，同样只显示源代码。`@Range` 最多 1000 项。**已知限制**：循环的列表既不是代码里写定的，也不是 `@函数` 直接返回的（例如内层循环的列表就是外层循环变量的值），而且循环体只产出文字或数字时，这层循环既估不出长度也计不到步；循环体里的组件包在 `[...]` 或三元表达式里时，只在绘制时计步。彻底封住需要 OpenUI 运行时在 `@Each` 里提供计数入口。

能突破上述任何一条的问题都属于安全漏洞。放宽这些限制的改动不会被接受。

## 供应链

npm 包带 [provenance](https://docs.npmjs.com/generating-provenance-statements) 发布。一键安装器核验官方 `@deepseek-ai/dsh` 依赖闭包中每个包的 npm `integrity` 与文件字节，详见 [docs/install.md](docs/install.md)。
