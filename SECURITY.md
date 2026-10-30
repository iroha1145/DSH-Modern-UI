# 安全策略

## 报告漏洞

请**不要**在公开 issue 里披露漏洞。使用 GitHub 的 [私密漏洞报告](https://github.com/iroha1145/DSH-Modern-UI/security/advisories/new)，写明受影响的插件版本、官方 DSH 版本、复现步骤与影响。后续沟通在该 advisory 里进行。

仅支持最新发布的插件版本；修复会以 patch 版本发布并在 [CHANGELOG](CHANGELOG.md) 中注明。

## 范围

本插件只替换和扩展官方 DSH 的 Web 前端，不修改官方后端、官方 JS、前端 dist 或原生模块。官方宿主自身的问题请报告给 DeepSeek Harness 上游。

## `openui` 沙箱边界

模型可以在回答里写 `openui` 代码块，插件会把其中的 HTML / CSS / JavaScript 渲染成交互式组件。这是**不可信内容**，按以下边界隔离：

- 两层嵌套 iframe，均只有 `sandbox="allow-scripts"`（没有 `allow-same-origin`、`allow-top-navigation`、`allow-popups`、`allow-forms`），运行在不透明源中，读不到 DSH 页面的 DOM、Cookie、存储或 API 凭据。
- 内层文档的 CSP 为 `default-src 'none'`，禁止网络请求、外部脚本与样式、字体、表单提交、嵌套 frame、插件和 worker；图片只允许 `data:`。
- 权限策略拒绝摄像头、麦克风、剪贴板、地理位置、全屏、支付等全部能力。
- 与宿主之间只通过带每次挂载随机 token 的 `postMessage` 交换四种消息：就绪、出错、高度（限制在 24–2400 px）和打开链接。链接只接受 `http(s)`、不含用户名密码、长度不超过 2048，并且由宿主再次确认后才打开。
- 内容总长不超过 128,000 字符，未完成的流式内容不会执行。

能突破上述任何一条的问题都属于安全漏洞。降低这些限制的改动不会被接受。

## 供应链

npm 包带 [provenance](https://docs.npmjs.com/generating-provenance-statements) 发布。一键安装器核验官方 `@deepseek-ai/dsh` 依赖闭包中每个包的 npm `integrity` 与文件字节，详见 [docs/install.md](docs/install.md)。
