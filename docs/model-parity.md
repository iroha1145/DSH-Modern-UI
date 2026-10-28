# 模型选择与推理声明兼容

本轮以 `a9f4c370` 的完整补丁版为功能基线，宿主仍为未修改的官方 rc.4。

## 推理声明

目录路由的设置卡复用补丁版 `ModelReasoningEfforts` 的编辑交互：每档有档位选择、API 参数值和删除操作，可以添加、删除 Off，可以将 `max` 映射为 `ultra`。已有非标准档位和值保留并可修复；只剩 Off、空字典及无效 API 值均不允许保存。关闭推理仍写 `reasoningEfforts: false`，避免恢复目录默认能力。

模型列表先读用户层；用户没有整个 `models` 数组时，读取 composition/base 层。编辑继承行时，在保存动作中将完整有效数组物化到用户层，保留其他行以及当前行未由控件编辑的字段。用户显式保存的空数组不回退到 base。

键入、增删档位与开关操作只更新本地草稿，每行可保存或取消。第一次修改时记录的 revision 一直保留到保存；其他页面或官方提供商编辑器先保存会使旧草稿被拒绝，不能用新 revision 偷换旧草稿。Host 的 mutation 仍使用同一个 revision。只读、保存中以及卸载后的控制器不会写入；传输拒绝保留草稿并显示错误。

手写路由继续使用官方行编辑器，不重复加入另一组控件。

## 标准模型标签槽

rc.4 的组件只能渲染自己声明的 children，不能从 Modern 私有标签槽合法转发到官方选择器拥有的标准槽。因此 bundle 显式停用官方 `ui-model-selection` 展示 owner，由 `src/model-owner.ts` 提供模型座位与原 `/model` 命令。

Modern 选择器声明并渲染标准 `conversation.input.model.label`，不再有 `modern.conversation.input.model.label`，也不再硬编码 1017 标签。官方 1017 插件和第三方标签贡献直接在标准槽内生效，停用贡献立即消失，owner 卸载和重装时遵循正常声明生命周期。联网开关没有恢复。

rc.4 仅为 active Host Loader entry 注册浏览器 descriptor；停用官方 owner 后，其导出的 `ModelDirectoryResolver` 不在浏览器模块图内。声明一条 manifest 依赖边不能使被停用的 descriptor 重新出现，也没有公开的独立资源注册接口。Modern 因此包含 `catalog.ts`、`directory.ts`、`service.ts` 三个最小客户端目录模块，逐段核对官方发布的 rc.4 `lib/client.js`；已有 catalog 逻辑保留，目录与服务使用 rc.4 行为，未带入旧完整构建额外的根页面接口。

插件只提供一个 `modelDirectories` 服务，composer 与 `/model` 使用同一个每会话目录。目录读取原 Session 的 `modelSelection` projection，通过原 Host `modelCatalog` 与 `selectModel` API 工作，不另存 durable Session 状态。catalog 的共享读取、未路由模型的推理标签保留、Host generation 清理、旧请求结算和 Session binding 卸载语义均与实际发布的 rc.4 实现差分验证。官方类型入口仍可用于静态契约；生产 bundle 不再 require 被停用的官方模型 descriptor，也不修改官方安装或加载器。

## 定向验证

`tests/plugin/model-parity.test.mjs` 在内存中打包被测源码，使用官方发布的浏览器 descriptor 和 renderer，不修改官方安装和共享构建产物。运行：

```powershell
& ../runtime/node-v24.22.1-win-x64/node.exe --test tests/plugin/model-parity.test.mjs
```

覆盖继承物化、未知字段和其他行保留、固定 revision、只读与无效声明拒绝、Host/传输拒绝、真实 React API 值编辑、Off 增删、取消、只剩 Off 的校验，以及在官方模型 descriptor 缺席时的 `/model`、子代理限制、标准第三方标签、官方 1017 插件启停和 owner 重装。另以实际发布的 rc.4 resolver 作为差分基准，覆盖共享 catalog、原 Session projection、Session 卸载、Host 换代及旧请求隔离。验证不调用真实付费模型。

此文件描述的是限定测试范围；成品浏览器模块到达与整体 bundle 回退仍需主集成验证。
