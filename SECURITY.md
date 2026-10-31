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
- 代码块超过 128,000 字符时不解析，只显示源代码。解析后先估算 `@Each` 嵌套展开的总数（嵌套相乘，`$变量` 按声明的值算），超过 20,000 项不求值、只显示源代码；读者点按钮或拖滑块改了状态，就按新值再估一次。估不出长度的循环（长度来自算式、`@函数` 的结果、循环变量或运行中的状态）在求值和绘制时按实际计步：查一次组件、调一次函数、交给函数的列表里的每一项、求值时新建的列表或对象里的每一项各算 1 步；`@Each` 每展开一项、每一趟产出的每个文字、数字或列表（包括组件参数里的，比如表格的行），函数返回列表里的每一项、每绘制一个组件各算约 5 步，一次求值连同绘制超过 100,000 步就停下，同样只显示源代码。展开和新建在动手之前计步，每一趟的产出在交出去绘制、进入下一趟之前计步；超出时运行时返回空值、不抛错，所以按钮里的 `@Set` 超出时也不会留下未处理的 Promise 错误。这些计数靠插件构建时给 OpenUI 运行时（`@openuidev/lang-core` 1.0.2）打的补丁（`scripts/openui-each-counter.mjs`，只改打包进插件的那份，不动 `node_modules`）；运行时的代码有任何一处对不上补丁，构建直接失败。找不到所属组件块的求值，同一轮同步执行里也最多走 100,000 步。`@Range` 最多 1000 项。

能突破上述任何一条的问题都属于安全漏洞。放宽这些限制的改动不会被接受。

## Jev 呈现建议（可选）

只有同时满足三个条件时，主会话的模型才看得到 `jev_presentation_advice` 工具：开启了「回答可视化组件」，`jev.enabled` 为开，且凭据服务能按 `jev.credential`（默认 `TYPESAFE_API_KEY`）解析出密钥。子代理看不到这个工具。插件自己从不联系 TypeSafe，只有模型调用这个工具时才发请求，每一轮最多一次；执行时会重新检查这三个条件。请求发到 `jev.endpoint`（默认 `https://api.typesafe.ai/v1/systemone`），内容只有两样：这一轮正在处理的用户消息的文字（插件按会话和回合绑定，最多四条，每条最多 6,000 字；只有附件的消息记为一句「(attachments without text)」），以及模型写的 `content_summary`（内容结构概述，最多 600 字，超出时整条拒绝、不截断、不发送）。不发送系统提示词、之前回合的消息、工具输出、附件和其他会话的内容。工具说明要求概述里不写个人信息、密钥、代码和资料原文，但这只是对模型的说明，插件不审查概述的内容。在设置页填写的密钥经 DSH 官方凭据接口（`credentials/set`）存进 `~/.dsh/.credentials.yaml` 的 `refs:`，浏览器之后只能查到「是否已配置、来自哪一层」，读不到密钥本身；设置页只写 `jev.credential` 指定的那个名字。密钥只在宿主进程内用于请求头，去掉首尾空白后必须全是可见 ASCII 字符，否则不发请求；失败日志只写错误类别（HTTP 状态、回答不合法、超时、请求失败），不转抄运行时的报错原文，因为那可能包含请求头。密钥不写入配置、日志或浏览器。Jev 的回答必须是预设的选项之一，否则丢弃；它只变成一条普通的工具结果，写明可以忽略、替换或组合，不进系统提示词或运行时上下文，不能执行任何操作。用户中止回合时，请求随之取消。

## 供应链

npm 包带 [provenance](https://docs.npmjs.com/generating-provenance-statements) 发布。一键安装器核验官方 `@deepseek-ai/dsh` 依赖闭包中每个包的 npm `integrity` 与文件字节，详见 [docs/install.md](docs/install.md)。
