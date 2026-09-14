# 数据中心电气设计与选型平台

**版本**：v2.0.0 · **线上地址**：https://xiaochuan1989.github.io/-UPS-Selector/

面向销售、售前和技术工程人员的静态工程工具平台。采用“项目工作台 + 工具中心”双入口，把项目参数沿负荷、UPS与电池、配电、导体、母线、电能质量及成果输出贯通。

平台继续使用免费的 GitHub Pages，不建设服务器、Docker 或账号系统。项目数据、用户填写价格和 AI 配置只保存在本机浏览器；现有访问密码仅作为提示性门槛，不代表真正的数据保密能力。

## v2.0.0 交付范围

- 正式更名为“数据中心电气设计与选型平台”，保留 iTeaQ 艾特网能品牌标识。
- 新增左侧业务导航、项目工作台、工具中心和右侧全局 AI 辅助面板。
- 原样承接现有 UPS 智能选型、UPS 与电池配置、后备时间反算、电池方法一/锂电、数据中心校核及产品数据库。
- 新增模块化工程计算：负荷汇总、变压器初选、支路断路器、母线电流、电缆/导体/铜排查询、智能母线、APF 和 SVG 校核。
- IndexedDB 保存统一项目数据，支持新建、保存、复制、JSON 导入和 JSON 导出。
- 首次打开新版时复制迁移旧版 UPS 配置、历史、收藏和界面偏好；迁移不会删除旧数据，旧产品数据库继续保留。
- 标准 Excel 输出包含项目汇总、负荷计算和商务成本空白表。平台不内置目录价、供应商价或历史成交价。
- 原始 `工具模板/` 只作为公式和版本核对来源，不进入公开构建；模板必须通过宏、隐藏表、外部链接、定义名称和价格残留检查后才可发布。

## 开发与验证

```powershell
npm install
npm run dev
npm test
npm run build
```

完整旧版回归仍使用 Python 测试入口：

```powershell
python -m pip install -r requirements-dev.txt
python dev_scripts/test.py --quick
python dev_scripts/test.py --all
```

如果 Windows 的 `py` 启动器提示 `No installed Python found`，表示启动器未登记解释器，并不一定代表电脑没有 Python。可使用实际 `python.exe` 路径或 Codex 工作区提供的 Python 运行时。

## 目录结构

- `index.html`：保留成熟 UPS/电池功能和内置产品数据，并加载 v2 模块入口。
- `src/main.js`：Vite 应用入口。
- `src/platform/`：平台外壳、项目格式、IndexedDB 存储、工具注册表。
- `src/modules/`：与界面分离的纯计算函数。
- `src/data/`：从当前有效工具提取的无价格工程基础数据。
- `src/css/platform-v2.css`：新版平台布局和响应式样式。
- `dev_scripts/extract_engineering_catalogs.py`：从 Excel 核对源重建非价格基础数据。
- `dev_scripts/build_tool_inventory.mjs`：重建 70 个来源文件的治理主清单。
- `docs/tool-inventory.md`：工具主清单、迁移优先级和首批验收样例。
- `docs/v2-architecture.md`：v2 架构、数据和发布边界。
- `工具模板/`：本地核对来源，不直接发布。

## 发布

GitHub Actions 先运行 Python/Node 质量检查，再执行 `npm ci && npm run build`，仅将 `dist/` 发布到 GitHub Pages。Vite 使用相对资源路径，适配当前仓库子路径部署。

v1.8.39 已建立 Git 标签，作为升级前回退基线。

## 历史文档

- [UPS选型助手_开发文档.md](UPS选型助手_开发文档.md)：v1 成熟 UPS/电池功能与计算说明。
- [UPS选型助手_开发说明.md](UPS选型助手_开发说明.md)：v1 工程维护和回归资料。
