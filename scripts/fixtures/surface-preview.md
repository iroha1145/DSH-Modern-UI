## 一套清晰、安静的工作表面

这是固定本地样例：消息、卡片、嵌套区域与输入使用相同内容，可比较明暗主题和窄屏。数字仅作演示，不请求外部服务。

```openui-lang
root = Col([summary, controls, data, embedded])
$name = "设计评审"
$mode = "标准"
$volume = 48
$enabled = true
$expanded = false
$reviewDate = "2026-11-14"
$priority = "普通"
summary = Grid([Card([Title("项目概览", "md"), Text("统一表面、边框与阴影的层级。", "sm"), Row([Badge("进行中", "info"), Badge("本地演示", "success")], 2), Box([Caption("嵌套区域"), Text("子区域保持安静，不重复堆叠浮层效果。", "sm")], "col", null, 3, "surface", "md")]), Card([Caption("本周完成"), Title("84%", "xl"), Text("所有数字均为固定模拟数据。", "sm")], "soft")], 2, 220, 3)
controls = Card([Title("交互控件", "md"), Input($name, "项目名称"), Select($mode, ["阅读", "标准", "宽屏"], "显示模式"), DatePicker($reviewDate, "评审日期", "2026-11-01", "2026-12-31"), SegmentedControl($mode, ["阅读", "标准", "宽屏"], true, "视图选择"), RadioGroup($priority, ["普通", "重要", "紧急"], "优先级"), Checkbox($enabled, "启用提醒"), Slider($volume, 0, 100, 1, "提醒强度", "%"), Row([Button("展开更多", @Set($expanded, !$expanded)), Popover("了解层级", Col([Title("表面层级", "sm"), Text("对话、内容与浮层各自使用明确的边界。", "sm")]), "层级说明")], 2), $expanded ? Box([Text("折叠区域已展开。控件状态仅保存在本次演示会话中。", "sm")], "col", null, 3, "info", "md") : null])
data = Card([Title("固定数据", "md"), Table(["阶段", "计划", "完成"], [["发现", 12, 10], ["设计", 18, 16], ["实现", 24, 20]]), Chart("bar", [{phase: "发现", count: 10}, {phase: "设计", count: 16}, {phase: "实现", count: 20}], "phase", ["count"], "number", null, false, null, null, null, "三个阶段完成数量分别为 10、16、20。")])
embedded = HtmlView("<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'></head><body><h3>HtmlView 独立内容</h3><p>这里是固定 HTML；宿主外框遵循统一表面。</p><button type='button'>演示按钮</button></body></html>", 180, "独立 HTML 演示")
```

## 继续阅读

长文需要稳定的阅读节奏。标题、段落和表格沿用同一条内容轴；输入框在消息结束后仍然容易发现。发送任意普通消息即可再次观察这份回答逐段流式出现。

| 检查对象 | 观察重点 | 示例状态 |
| --- | --- | --- |
| 侧栏与对话 | 区分导航和内容 | 桌面与窄屏 |
| 内容卡片 | 边框与阴影层级 | 嵌套区域 |
| 浮层与设置 | 焦点与打开过程 | 模型菜单、设置 |

这段固定说明用于检查较长消息的排版。连续阅读时，正文应该保持清晰、舒适，界面背景不会争夺注意力。可以聚焦输入框、打开模型菜单或调整设置，检查相同表面语言在不同操作中的表现。


## 绘图对照：原始内容

以下两图仅用于核对绘制与响应式布局；文字和数字沿用提供的样例，不作为行情分析。

```openui-lang
root = Col([tankCard])
tankCard = Card([Title("三个缓冲垫，同时见底", "sm"), tanks])
tanks = Svg([o1, w1, o2, w2, kink, kinkLabel, o3, w3, v1, v2, v3, n1, n2, n3], "0 0 600 190", "100%", 190, "三个缓冲垫的水位", "ON RRP 接近归零、银行准备金贴近需求曲线陡段、做市商深度大幅收缩，三者同时失去缓冲能力，所以同样的抽水现在冲击更大。")
o1 = Rect(40, 45, 120, 115, "surface", "muted", 1, null, 8)
w1 = Rect(42, 155, 116, 4, "danger")
o2 = Rect(240, 45, 120, 115, "surface", "muted", 1, null, 8)
w2 = Rect(242, 97, 116, 63, "chart1")
kink = Line(240, 108, 360, 108, "danger", 1.5)
kinkLabel = SvgText("陡段临界", 366, 105, 10, "danger", "start")
o3 = Rect(440, 45, 120, 115, "surface", "muted", 1, null, 8)
w3 = Rect(442, 120, 116, 40, "chart3")
v1 = SvgText("≈ $0.15B", 100, 38, 13, "danger", "middle", "semibold")
v2 = SvgText("$2.9T", 300, 38, 13, "ink", "middle", "semibold")
v3 = SvgText("-60~85%", 500, 38, 13, "danger", "middle", "semibold")
n1 = SvgText("ON RRP 缓冲", 100, 178, 11, "muted", "middle")
n2 = SvgText("银行准备金", 300, 178, 11, "muted", "middle")
n3 = SvgText("做市商深度", 500, 178, 11, "muted", "middle")
```

## 绘图对照：修正版样例

沿用现有组件：桌面并排、窄屏纵排，填充色块贴合圆角。原始历史消息未修改。

```openui-lang
root = Col([tankCard])
tankCard = Card([Title("三个缓冲垫，同时见底", "sm"), tanks])
tanks = Grid([tank1, tank2, tank3], 3, 200, 3)
tank1 = Svg([o1, w1, v1, n1], "20 20 160 170", null, null, "ON RRP 缓冲", "ON RRP 接近归零、银行准备金贴近需求曲线陡段、做市商深度大幅收缩，三者同时失去缓冲能力，所以同样的抽水现在冲击更大。")
tank2 = Svg([G([o2, w2, kink, kinkLabel, v2, n2], "translate(-200 0)")], "20 20 160 170", null, null, "银行准备金", "ON RRP 接近归零、银行准备金贴近需求曲线陡段、做市商深度大幅收缩，三者同时失去缓冲能力，所以同样的抽水现在冲击更大。")
tank3 = Svg([G([o3, w3, v3, n3], "translate(-400 0)")], "20 20 160 170", null, null, "做市商深度", "ON RRP 接近归零、银行准备金贴近需求曲线陡段、做市商深度大幅收缩，三者同时失去缓冲能力，所以同样的抽水现在冲击更大。")
o1 = Rect(40, 45, 120, 115, "surface", "muted", 1, null, 8)
w1 = Path("M42.34314575 155H157.65685425A6 6 0 0 1 152 159H48A6 6 0 0 1 42.34314575 155Z", "danger")
o2 = Rect(240, 45, 120, 115, "surface", "muted", 1, null, 8)
w2 = Path("M242 97H358V153A6 6 0 0 1 352 159H248A6 6 0 0 1 242 153Z", "chart1")
kink = Line(240, 108, 360, 108, "danger", 1.5)
kinkLabel = SvgText("陡段临界", 300, 91, 11, "danger", "middle")
o3 = Rect(440, 45, 120, 115, "surface", "muted", 1, null, 8)
w3 = Path("M442 120H558V153A6 6 0 0 1 552 159H448A6 6 0 0 1 442 153Z", "chart3")
v1 = SvgText("≈ $0.15B", 100, 38, 13, "danger", "middle", "semibold")
v2 = SvgText("$2.9T", 300, 38, 13, "ink", "middle", "semibold")
v3 = SvgText("-60~85%", 500, 38, 13, "danger", "middle", "semibold")
n1 = SvgText("ON RRP 缓冲", 100, 178, 11, "muted", "middle")
n2 = SvgText("银行准备金", 300, 178, 11, "muted", "middle")
n3 = SvgText("做市商深度", 500, 178, 11, "muted", "middle")
```
