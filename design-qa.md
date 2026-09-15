# Design QA — 电缆参考数据表 v2.3.0

## Evidence

- Source visual truth: `C:\Users\woaig\AppData\Local\Temp\codex-clipboard-723f5317-3c96-4ded-892e-16f8fd1de9eb.png`
- Source pixels: 448 × 140；这是 Excel 工作表标签的局部截图，用于确认三个表名和并列关系，不是完整网页视觉稿。
- Implementation screenshot: `D:\Claude 安装\UPS选型助手_开发包\output\playwright\cable-reference-tables-v2.3.0.png`
- Implementation pixels / CSS viewport: 1600 × 900，deviceScaleFactor 1。
- Responsive screenshot: `D:\Claude 安装\UPS选型助手_开发包\output\playwright\cable-reference-tables-1366-v2.3.0.png`
- State: 已登录 → 电缆选型 → 中美线规对照表；另核对了修正系数表和电缆数据库筛选状态。
- Density normalization: 两张图片均按 CSS 1× 查看；源图是标签局部，因此不做像素级版式匹配，只核对信息结构、命名和可发现性。

## Findings

- 无 P0 / P1 / P2 问题。
- 三个来源表均以同级标签呈现，名称与源图一致：电缆修正系数数据表、电缆数据库、中美线规对照表。
- 字体与层级：沿用平台现有字体、字号和深蓝主色；活动标签辨识清晰，小计数不会压过表名。
- 间距与布局：1600×900 和 1366×768 下标签完整可见；数据区不遮挡左侧导航和顶部栏。
- 色彩：沿用平台蓝灰色令牌，不复刻 Excel 红色工作表标签，属于与现有产品设计系统一致的有意调整。
- 图像与资产：该功能没有业务图片或新增图标资产，未使用占位图或近似图形。
- 文案与内容：修正系数完整包含 S=d、S=2d、S=3d 及梯架/托盘 1～4 层；电缆数据库显示 224 条，线规表显示 50 条。
- 交互：四个标签可切换；电缆数据库输入 `630` 后显示 8 / 224 条；表头固定，表格支持横向和纵向滚动。
- 浏览器控制台：0 errors，0 warnings；仅有旧版密码输入框的浏览器 verbose 提示，不影响本功能。

## Focused Comparison

- 源图的有效目标是三个工作表名称及其并列入口。实现截图的标签栏直接呈现相同名称，并在数据型标签上补充条数，符合“方便查看、对照”的目标。
- 重要字段在全视图中可读，无需额外裁剪；修正系数的数值又通过浏览器无障碍快照逐项核对。

## Comparison History

- 初次实现后即完成同状态浏览器检查；未发现需要修复的 P0 / P1 / P2 问题，因此没有视觉修复循环。

## Implementation Checklist

- [x] 三个来源表独立入口
- [x] 完整基础数据展示
- [x] 搜索、筛选、结果计数
- [x] 横向、纵向滚动与固定表头
- [x] 1366×768 和 1600×900 验证
- [x] 计算口径与基础数据明确区分

## Follow-up Polish

- 无阻塞项。

final result: passed
