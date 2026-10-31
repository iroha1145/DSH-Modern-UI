## 改动

<!-- 做了什么、为什么。关联 issue 写 `Closes #编号`。 -->

## 验证

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build` 后 `npm test`
- [ ] 改到安装器或兼容逻辑时跑过 `npm run test:compat -- --preview .artifacts/plugin-preview --host <版本> --root <隔离目录>`
- [ ] 界面改动附截图，并在至少一个已验证宿主上实际加载过

## 约束自查

- [ ] 没有放宽 OpenUI 组件边界（见 [SECURITY.md](../SECURITY.md)）
- [ ] 没有新增从官方源码复制的 vendor 文件；`provenance.json` 只删了已删文件的条目；第三方拷贝的 `*-upstream.json` 已同步
- [ ] 没有对官方宿主做 monkey patch
- [ ] 用户可见的改动已写进 [CHANGELOG.md](../CHANGELOG.md) 的 `Unreleased`
