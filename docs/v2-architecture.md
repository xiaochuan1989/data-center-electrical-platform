# v2 平台架构与数据边界

## 渐进式模块化

v2 不重写已经稳定的 UPS、电池、后备时间和产品数据库。`index.html` 继续承载这些成熟功能，`src/main.js` 通过 Vite 加载新版平台外壳。左侧导航在“项目工作台 / 工具中心 / 新工程模块”和旧功能之间切换，因此升级期间仍可使用全部旧能力。

后续迁移遵守“先等价、后优化”：每个旧计算器先拆出纯计算函数，通过 Excel 样例和边界测试后，再替换旧界面代码。

## 模块边界

| 路径 | 责任 |
|---|---|
| `src/platform/app-shell.js` | 平台导航、项目表单、业务视图和旧功能桥接 |
| `src/platform/project-schema.js` | 统一项目数据格式和版本归一化 |
| `src/platform/project-store.js` | IndexedDB 项目读写、JSON 导入导出、旧数据复制迁移 |
| `src/platform/tool-registry.js` | 工具中心唯一入口、来源和治理状态 |
| `src/modules/engineering-calculators.js` | 无 DOM、可独立测试的工程计算函数 |
| `src/data/*.json` | 从 Excel 提取的无价格载流量/导体数据 |

## 本地数据

- IndexedDB `dc_electrical_platform_db`：项目和迁移元数据。
- IndexedDB `ups_data_db`：旧版 UPS 产品数据，继续由成熟模块维护。
- localStorage：当前项目 ID、旧版兼容数据和界面偏好。
- sessionStorage `ups_auth`：当前前端访问门槛状态。

首次迁移会读取旧键值并复制到项目 `legacy` 字段，写入完成标记后不重复迁移。迁移过程不删除任何旧键值或旧 IndexedDB。

## 公开构建边界

Vite 仅从 `index.html` 和 `src/` 生成 `dist/`。`工具模板/`、原始 Excel、宏、供应商报价和目录价不会进入构建产物。`src/data/` 只包含载流量、规格、环境温度、敷设方式等工程基础数据。

商务成本输出只创建空白价格列。模板中心中的原件默认均为“不发布原件”，必须经过隐藏工作表、VBA、外部链接、定义名称、价格和供应商信息检查后，才能单独加入允许发布清单。

## 验收门禁

1. Node 纯函数测试验证正常值、标准档位边界和数据中不存在目录价/供应商价字段。
2. 原有 Python 回归继续检查 UPS、电池、产品编码、HTML/JS 结构和版本一致性。
3. `npm run build` 必须成功，且部署只上传 `dist/`。
4. 桌面 1366×768、1920×1080 和平板宽度进行真实浏览器回归。
5. Excel 输出可打开，价格列为空，且无 `#REF!`、`#VALUE!`、`#DIV/0!`。
