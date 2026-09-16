# 数据中心电气设计与选型平台——工程开发手册

> 当前版本：v2.6.3
> 更新日期：2026-09-15
> 文档职责：说明开发环境、目录职责、修改流程、测试、浏览器回归和发布。

## 1. 开发原则

1. 成熟 UPS/电池功能优先兼容，新模块按“先等价、后优化”迁移。
2. Excel 是核对来源，不直接发布；网页公式必须能由纯函数测试。
3. 同一业务能力只保留一个正常入口，旧版本进入治理清单或归档。
4. 用户数据默认只保存在当前浏览器；不得擅自增加云端上传。
5. UI 修改必须进行真实浏览器回归，不能只依赖静态检查。
6. 商务成本模板不内置价格，公开构建不包含原始工具目录。
7. “编码与交付”当前只隐藏入口，不删除底层实现和项目字段。

## 2. 环境要求

- Node.js 22 或更高版本。
- Python 3.8 或更高版本；推荐 3.13。
- Chromium 浏览器。

Windows 的 `py` 启动器提示没有 Python，不等于电脑没有安装 Python。先检查：

```powershell
Get-Command python -ErrorAction SilentlyContinue
py -0p
```

Codex 工作区也提供独立 Python 运行时，可从工作区依赖信息取得实际 `python.exe` 路径。

## 3. 目录职责

```text
UPS选型助手_开发包/
├── index.html                         成熟功能、内置产品数据和应用入口
├── package.json / package-lock.json   Vite 构建与 Node 测试
├── README.md                          项目入口和版本摘要
├── UPS选型助手_开发文档.md             当前产品与技术文档
├── UPS选型助手_开发说明.md             当前工程开发手册
├── src/
│   ├── main.js                        Vite 入口
│   ├── platform/                      外壳、项目、存储、工具注册
│   ├── modules/                       纯计算函数
│   ├── data/                          工程基础数据 JSON
│   └── css/                           平台样式
├── dev_scripts/                       测试、构建审计、数据提取
├── docs/                              架构和工具治理资料
├── tests/                             成熟功能回归
└── 工具模板/                          本地核对源，不发布
```

## 4. 常用命令

首次安装：

```powershell
npm install
python -m pip install -r requirements-dev.txt
```

开发和测试：

```powershell
npm run dev
npm test
npm run test:build
python dev_scripts/test.py --quick
python dev_scripts/test.py --all
```

`npm run test:build` 会先生成 `dist/`，再检查公开构建边界。提交前至少运行 `npm test`、`npm run test:build` 和 `python dev_scripts/test.py --all`。

## 5. 本地访问

Vite 默认地址通常为 `http://localhost:5173/`，也可固定端口：

```powershell
npm run dev -- --port 4173
```

不要用双击 `index.html` 作为 v2 的主要验证方式，因为 ES modules、IndexedDB 和浏览器安全策略在 `file://` 下行为可能不同。

## 6. 修改入口

| 需求 | 主要文件 |
|---|---|
| 平台导航、项目页面、工程工具界面 | `src/platform/app-shell.js` |
| 工具中心分组和状态 | `src/platform/tool-registry.js` |
| 项目数据格式 | `src/platform/project-schema.js` |
| IndexedDB、导入导出、旧数据迁移 | `src/platform/project-store.js` |
| 负荷、电缆、铜排、母线、APF/SVG 公式 | `src/modules/engineering-calculators.js` |
| 平台布局和响应式 | `src/css/platform-v2.css` |
| 成熟 UPS/电池、产品库、导出 | `index.html` |
| 工程数据 | `src/data/*.json` |

## 7. Excel 核对流程

1. 在 `docs/tool-inventory.md` 确认该业务唯一当前核对版。
2. 只读检查工作表、公式、数据验证、隐藏表、定义名称和外部链接。
3. 记录输入、下拉范围、条件公式、边界值和显示精度。
4. 将公式实现为纯函数，再连接 UI。
5. 建立正常、空值、零值、边界、超限和下拉组合测试。
6. 原工作簿不复制到 `src/` 或 `dist/`。

电缆当前核对源为 `工具模板/B-电缆选型-A00.xlsx`：`F4` 并联根数允许 1～4，`G4` 并列根数允许 1～6。铜排有两个互不覆盖的核对源：`工具模板/铜排载流量-A03.xlsx` 用于按电流选规格，`工具模板/铜排载流量工程计算器-A00.xlsx` 用于单片规格热平衡反算；对应纯函数为 `calculateBusbarSelection()` 和 `calculateBusbarAmpacity()`。规格反算测试必须覆盖原表默认值、DIN 同规格对照、交直流修正、温度关系和参数上下界。锂电池当前核对源为 `工具模板/锂电池-选型模板-A00.xlsx`，纯函数为 `calculateLithiumBatteryA00()`；测试必须覆盖 100kVA 逆变器效率边界、1/3/4/6C 平台电压边界、负载功率空值回退及原表 3C～4C 未定义区间。

## 8. 版本更新

发布版本需同步修改：

- `index.html` 的 `APP_VERSION`。
- `package.json` 与 `package-lock.json` 的项目版本。
- `README.md` 当前版本和更新摘要。
- 本开发文档、开发手册及受影响的 `docs/` 文件。
- 自动测试中的版本断言。

版本不一致时，Python/Node 测试必须失败。

## 9. 浏览器回归清单

通用：

- 登录后平台名称、版本和左侧导航正确。
- 侧栏可收起/展开，刷新后保留偏好。
- 项目工作台和工具中心入口一致。
- 控制台无 error。

电缆：

- 并联根数 1～4、并列根数 1～6 均可操作。
- 不适用并列系数的条件显示解释，不禁用下拉。
- 推荐线径、基础载流量、修正系数和负载率与样例一致。
- 三张参考表可切换、搜索和横纵向滚动。

铜排：

- “按电流选铜排”与“按规格算载流量”可独立切换，前者结果不因新增功能改变。
- 默认采用“DIN同规格30K反校”模型；没有DIN完全同规格数据时自动回退到自然对流 Nu/Ra 关联式，不得对全部规格固定套用 `h=5`。
- `40 × 6mm` 在DIN参考表面条件、35℃环境、30K温升下应反校得到 `528A`；项目默认新亮镀锡、视角系数0.8、有效散热温差55K时热平衡值约 `699A`、80%建议值约 `559A`。
- 温度链路显示并校验 `Tmax = 外部环境 + 工程控制温升`、`Tamb = 外部环境 + 柜内空气温升` 和 `ΔT = Tmax - Tamb`；默认对应 `35 + 70 = 105℃`、`35 + 15 = 50℃`、有效散热温差 `55K`。
- 用户界面使用“50K 温升修正（通风 × 1.3）”和“30K 温升基准（DIN 原值）”；A03 只作为核对源版本记录，不得作为工程口径名称，也不得使用“IEC 增强”等可能误解为统一标准限值的表述。
- 交流模式可启用交流电阻修正系数；系数为 1.00 时必须显示附加损耗未计入提示。
- 同规格 DIN 对照必须先统一到35℃环境和30K温升；不得直接比较项目55K热平衡结果与DIN 30K表值。
- 表面状态可选择 Excel 历史参数0.35、新亮镀锡参考0.05、电镀铜保守值0.03或自定义；预设值锁定输入，自定义模式解锁输入。
- 辐射视角系数、有效散热面积系数、安装方向和最终采用的等效 `h` 均可查看或按适用模式调整。

产品数据库：

- 卡片占满剩余视口，不出现大块页面空白。
- 上下两个表格都有独立纵向滚动条，并能显示最后一行。
- 分隔条、列宽、Shift 横移、收藏、搜索和详情可用。
- 全景浮窗可拖动/缩放；独立窗口可拖到另一显示器。

当前可见范围：

- 侧栏、项目流程和工具中心不显示“编码与交付”。
- 模板中心仍可进入。

至少覆盖 1366×768、1920×1080 和约 900px 平板宽度。

## 10. 自动测试说明

`npm test` 验证项目格式、标准档位、工程纯函数、97 条铜排、224 条电缆、50 条线规、典型铜排/电缆样例、新增数据无价格字段，以及当前版本和入口标识。

`python dev_scripts/test.py --all` 继续覆盖成熟 UPS、电池、产品编码、HTML/JavaScript 结构和公开数据库行为。

## 11. 公开构建门禁

只发布 `dist/`。以下内容不得进入公开构建：

- `工具模板/` 原始 Excel、xlsm、宏和报价文件。
- 未批准的供应商价格、商务价格或历史成交价。
- 本机路径、临时文件、测试截图和调试输出。
- 用户项目或浏览器导出的 JSON。

商务成本仅允许空白价格列和格式。模板中心的工作簿必须检查隐藏工作表、宏、外部链接、定义名称和价格残留。

## 12. GitHub Pages 发布

仓库：`xiaochuan1989/data-center-electrical-platform`
线上地址：<https://xiaochuan1989.github.io/data-center-electrical-platform/>

推送 `master` 后 GitHub Actions 会执行质量检查、构建并发布 `dist/`。发布完成后：

1. 查看 Actions 状态。
2. 打开线上地址并核对版本号。
3. 使用 `?v=版本号` 绕过旧缓存再次检查关键入口。
4. 区分“本地完成、已提交、已推送、线上已更新”四个状态后再交付。

## 13. 故障排查

### Python 被误判为未安装

先用 `Get-Command python` 或 `py -0p` 查看解释器。Windows Store 占位符、PATH 未配置或 `py` 未登记，都会造成“未安装”假象。直接使用已安装解释器的绝对路径即可。

### 页面仍是旧版本

检查 Git 提交、远端分支、Actions 部署和浏览器缓存。用带版本参数的网址验证，但不能只靠参数替代线上内容核对。

### 产品数据库滚不到最后

检查 `body.db-view-active`、`.platform-layout`、`.platform-workspace`、`.container`、`#data-table-panel` 和 `.db-split-layout` 的高度链是否都有 `min-height: 0`；表格滚动必须发生在 `.db-table-scroll`，而不是整个页面。

### 下拉框看得到但不能选

先检查 Excel 数据验证是否本来允许选择，再检查网页是否错误设置 `disabled`。业务“不参与当前公式”应优先用提示说明，不应在原表允许输入时直接锁定。

## 14. 发布完成标准

- [ ] 用户需求已实现。
- [ ] Excel 口径有证据并进入测试。
- [ ] Node、完整 Python 和公开构建门禁通过。
- [ ] 真实浏览器主流程通过，控制台无 error。
- [ ] README、开发文档、开发说明和相关 `docs/` 已同步。
- [ ] Git 已提交并推送，GitHub Pages 已核对。

v1.8.39 Git 标签是平台化升级前的回退基线；更细历史以 Git 提交记录为准。
