# UPS与配电选型助手——工程开发手册

> 当前版本：v2.12.0
> 更新日期：2026-10-04（用户要求冻结新增、先发布试用版，再新对话只读审核；部署实际状态见发布记录）
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
| 负荷、电缆、铜排、智能母线、APF/SVG 公式 | `src/modules/engineering-calculators.js` |
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

电缆当前核对源为 `工具模板/B-电缆选型-A00.xlsx`：`F4` 并联根数允许 1～4，`G4` 并列根数允许 1～6。铜排有三个互不覆盖的核对源：`工具模板/铜排载流量-A03.xlsx` 用于按电流选规格，`工具模板/铜排载流量工程计算器-A00.xlsx` 用于单片规格热平衡反算，根目录 `铜排载流量.xlsx` 用于 25/35/40℃及平放/竖放离散查表；对应纯函数为 `calculateBusbarSelection()`、`calculateBusbarAmpacity()` 和 `calculateBusbarTableLookup()`。规格反算测试必须覆盖原表默认值、DIN 同规格对照、交直流修正、温度关系和参数上下界；离散查表测试必须覆盖合并单元格、单片/多根筛选、放置方式和无满足规格边界。锂电池当前核对源为 `工具模板/锂电池-选型模板-A00.xlsx`，纯函数为 `calculateLithiumBatteryA00()`；测试必须覆盖 100kVA 逆变器效率边界、1/3/4/6C 平台电压边界、负载功率空值回退及原表 3C～4C 未定义区间。

智能母线有三个互补核对源：`数据中心母线电流计算-A00.xlsx` 负责电流公式和档位，`智能母线配置与选型.xlsx` 负责数量与附件规则，`XGM-智能母线-商务成本-A11.xlsm` 只用于提取确认型号，任何价格不得写入 `src/data/smart-busway-catalog.json`。Excel 输出的是推荐依据，`runSelections` 与持久化 `plugBoxGroups` 中的人工采用值才是最终方案值。主要接口为 `createSmartBuswayDesign()`、`calculateSmartBuswayDesign()`、`recommendSmartBuswayGroups()`、`validateSmartBuswayGroups()` 和兼容包装 `calculateSmartBusway()`；测试必须覆盖逐柜支路、每排每路工况、人工降档、分组持久化、单相相序、不同回路能力、160/630/800A边界、801A BOM 阻断及 schema v2 迁移。

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
- “温度/放置查表”按原表 25/35/40℃与平放/竖放列离散选择，不对空白工况插值；原表合并单元格值必须同时映射到两个放置方向。
- 默认采用“DIN同规格30K反校”模型；没有DIN完全同规格数据时自动回退到自然对流 Nu/Ra 关联式，不得对全部规格固定套用 `h=5`。
- `40 × 6mm` 在DIN参考表面条件、35℃环境、30K温升下应反校得到 `528A`；项目默认新亮镀锡、视角系数0.8、有效散热温差55K时热平衡值约 `699A`、80%建议值约 `559A`。
- 温度链路显示并校验 `Tmax = 外部环境 + 工程控制温升`、`Tamb = 外部环境 + 柜内空气温升` 和 `ΔT = Tmax - Tamb`；默认对应 `35 + 70 = 105℃`、`35 + 15 = 50℃`、有效散热温差 `55K`。
- 用户界面使用“50K 温升修正（通风 × 1.3）”和“30K 温升基准（DIN 原值）”；A03 只作为核对源版本记录，不得作为工程口径名称，也不得使用“IEC 增强”等可能误解为统一标准限值的表述。
- 交流模式可启用交流电阻修正系数；系数为 1.00 时必须显示附加损耗未计入提示。
- 同规格 DIN 对照必须先统一到35℃环境和30K温升；不得直接比较项目55K热平衡结果与DIN 30K表值。
- 表面状态可选择 Excel 历史参数0.35、新亮镀锡参考0.05、电镀铜保守值0.03或自定义；预设值锁定输入，自定义模式解锁输入。
- 辐射视角系数、有效散热面积系数、安装方向和最终采用的等效 `h` 均可查看或按适用模式调整。

智能母线：

- 第一步可在每排增删、复制多种机柜类型，同一排混合功率/宽度/相制/供电方式后生成顺序与输入顺序一致。
- 三步流程可完成快速生成、逐柜编辑、前移/后移、拖动排序、插接箱拆分/合并/成员改派、按排×路径选型和清单查看；重新计算不得覆盖人工分组。
- 俯视图中 600/800mm 机柜宽度按真实比例，柜深按 CAD 的 800mm 关系表达；冷通道默认 1200mm 且可编辑。
- 图中插接箱按覆盖机柜范围绘制并显示相制、采用电流和已用/总回路；整排立面显示实际机柜/空调数量、连续 A/B 母线、多个插接箱及下引线；剖面显示两排各自的 A/B 双路，2200mm 高度仅为参考比例。
- 第三步逐项显示推荐/采用母线和始端箱；默认联动，可解锁并选择带开关始端箱。人工降档必须显示红色风险并进入 Excel/PDF/BOM。
- 40A 三相3路允许作为工程能力选择，但必须显示“型号待确认”且编码为空；50A/63A 三相超过2路、成员重复/缺失等结构错误必须阻止插接箱 BOM。
- 1100px 及更窄视口下属性面板落到图纸下方，画布只在自身容器内滚动，不产生页面级横向溢出。
- PNG 下载、浏览器打印 PDF、Excel 三个新增工作表可用；超过 800A 时页面保留计算结果但不输出智能母线 BOM。
- 保存刷新后逐柜顺序和属性保持；旧版结果只进入 `legacy.smartBuswayV1`，不得反推机柜顺序。

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

`npm test` 验证项目格式、标准档位、工程纯函数、97 条 DIN 铜排、75 条温度/放置铜排、224 条电缆、50 条线规、智能母线无价格目录、按排×路径计算、柔性插接箱分组、人工采用风险、典型铜排/电缆/智能母线样例、schema v2 迁移，以及当前版本和入口标识。

`python dev_scripts/test.py --all` 继续覆盖成熟 UPS、电池、产品编码、HTML/JavaScript 结构和公开数据库行为。

## 11. 公开构建门禁

只发布 `dist/`。以下内容不得进入公开构建：

- `工具模板/` 原始 Excel、xlsm、宏和报价文件。
- 用户提供的 DWG、项目图纸、AutoCAD 提取文件和浏览器验收截图。
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

## 15. 分阶段开发与跨对话接续

当前总接续入口为[非标配电售前方案包实施计划](docs/nonstandard-presales-roadmap.md)，已确认用于配电柜、PDU、智能母线售前交流和报价。N0/N1完成：[字段与数据契约v1](docs/nonstandard-presales-contract.md)定稿；N2已按[入口设计](docs/nonstandard-requirement-ui.md)接入需求复核基础版，`nonstandard-requirements.js`、`nonstandard-file-reader.js`及视图负责规则/本机解析/复核。N3按[方案—清单设计](docs/nonstandard-scheme-ui.md)新增`nonstandard-scheme-view.js`、`nonstandard-deliverable.js`和`presales-xlsx.js`，共用原独立包，旧存储键及schema不变。`test_nonstandard_deliverable.mjs`验证用途数量一致性、型号约束、恢复和HTML/XLSX安全，纳入六组`npm test`。不套UPS整机SKU表、不重建工作台；下一步是品类规则/真实案例校准与N4完整方案包，而非重复搭建已实现界面。

配电柜助手见[设计与验收](docs/cabinet-assistant.md)：`cabinet-assistant.js`解析四列回路表并生成新草稿，`cabinet-rules.js`校验骨架元数据、确认条件和实时说明；核心只增v1可选来源元数据，不改旧schema/存储。`test_cabinet_assistant.mjs`纳入第七组npm回归，覆盖证据、错配、未知、合计与安全整数、兼容/输出。浏览器脚本`verify_cabinet_assistant_browser.mjs`是CLI函数，用独立会话、合成资料及忽略目录`output/playwright/cabinet-assistant/`，验证取消不丢编辑、旧方案不覆盖、草稿保存与型号阻断。仍需独立真实配电柜资料和业务反馈；资料解析依赖本机化及真实文件导入已按[本机化验收](docs/local-file-reading.md)完成，不能据此把业务采用标为完成。

PDU助手见[设计与验收](docs/pdu-assistant.md)：`pdu-rules.js`负责有限语法候选/元数据/动态说明，`pdu-assistant.js`负责本设备条款选取、错配阻断与新草稿。`test_pdu_assistant.mjs`纳入第八组npm回归，浏览器CLI函数为`verify_pdu_assistant_browser.mjs`，独立导出检查为`check_pdu_exports.py`。无新默认额定值、品牌型号、输入数或保护分路；主备区域按独立设备量管理。真实微模块候选产物仅在忽略目录，未替业务人员确认，不升级或发布。

智能母线区域助手见[设计与验收](docs/busway-assistant.md)：`busway-rules.js`注册表/五列表/有限文本提示/元数据/说明、`busway-assistant.js`证据和人工表纯生成，纳入第九组`test_busway_assistant.mjs`回归。`verify_busway_assistant_browser.mjs`为CLI函数，`check_busway_exports.py`独立核对三个下载XLSX、HTML与JSON。字段controllerCount/endpointCount和用途controller/endpoint为v1可选兼容扩展；区域口径显式数量1，误改设备数量不重乘。旧计算器/手工方案不受此口径约束，未知保护/附件/型号不补造。

原N3浏览器脚本初始母线阻断用例要求隔离会话中无已生成布局；原地复跑可能遗留上轮合成布局，优先新建隔离会话。工具包重置不重置旧工具状态。最后验收只认本次新生成且passed=true的结果时间戳；CLI中途返回、旧文件或没有更新不能当通过。

N3浏览器验收使用独立会话`nonstandard-n3`及`verify_nonstandard_scheme_browser.mjs`（CLI函数，不直接node执行）。本机Vite地址为127.0.0.1:5193，仅QA会话设置前端sessionStorage登录；脚本通过公开接口重置该会话独立合成包，旧工具数据不回写。已缓存CLI可用`npx --offline --no-install --package @playwright/cli playwright-cli -s=nonstandard-n3 run-code --filename dev_scripts/verify_nonstandard_scheme_browser.mjs`，等待最终新生成的browser-result.json，不以中途modal回显当作完成。产物在忽略的`output/playwright/nonstandard-n3/`。用捆绑Python执行`dev_scripts/check_nonstandard_exports.py`只读核对五份下载XLSX及JSON/HTML；Artifact工具可只读导入/渲染。新导出不依赖SheetJS，保留静态数值/字符串，不含公式/宏/外链；不能在Excel编辑后回写应用。这是N3阶段历史记录，当时未重跑完整N2。后续2026-10-01已完成解析依赖本机化、完整N2复跑及5份真实文件三环境导入，见[当前读取设计与验收](docs/local-file-reading.md)；完整发布/业务验收仍未完成。

N2浏览器脚本是Playwright CLI函数，不直接用`node`执行。先启动本地Vite，再创建独立CLI浏览器会话`nonstandard-n2`打开本地URL；仅在该测试会话设置`ups_auth=ok`的sessionStorage并重载，清空该会话的独立需求工作稿键，不操作用户浏览器。测试PDF由既有`create_ups_evidence_fixtures.py`生成，库需正常加载。运行`npx --no-install --package @playwright/cli playwright-cli -s=nonstandard-n2 run-code --filename dev_scripts/verify_nonstandard_requirements_browser.mjs`；确认忽略目录`output/playwright/nonstandard-n2/browser-result.json`为本次生成且passed=true后，关闭自己创建的会话/服务。脚本使用合成材料，浏览器下载保存在忽略目录；真客户文件只在私有只读测试中使用，不进入仓库或公开构建。当前解析依赖已取消CDN并同源发出，新入口不调用AI/OCR接口；负例增加dev_scripts/create_local_reader_fixtures.py与dev_scripts/verify_local_reader_browser.mjs，真实私有验收仍放忽略output，详见docs/local-file-reading.md。

条款分页与会话草稿见[定稿和实际验收](docs/requirement-pagination.md)。纯模块`requirement-review-state.js`负责交集筛选/稳定排序/分页/基线草稿，第11组`test_requirement_review.mjs`纳入npm回归。`verify_requirement_review_browser.mjs`是CLI函数：仅隔离QA会话清空存储，使用已有忽略的5来源1196条备份；dev与子目录各跑，默认端口5193/5194。不能直接node执行或在用户当前工作稿跑。`check_requirement_review_exports.py`用openpyxl独立核对两个环境完整要求/证据/修订及草稿不混入导出。产物在忽略`output/playwright/requirement-review/`；只认本次最终passed时间戳，中途modal不是结束。先切回1366宽度再运行，防止上轮900宽度隐藏侧栏影响测试前置。

UPS需求证据与人工修订升级保留[子计划及接续记录](docs/ups-evidence-roadmap.md)。开始时读取两份计划、检查Git状态，从首个未完成阶段继续；结束时记录变更文件、实际验证、遗留问题及下一步。

真实业务试用准备见[执行方案与结果](docs/nonstandard-business-trial.md)。`node dev_scripts/prepare_business_trial.mjs`只读旧私有统一包、生成`output/business-trial/2026-10-04/`副本及同源输出；不确认要求/方案，修改/错误区域口径探针仅纯内存，原包哈希不变。已有反馈任何改动即拒绝重建，保护模块/负例回归为`business_trial_feedback.mjs`及`test_business_trial_feedback.mjs`。真实资料不作为npm固定测试输入，也不进入Git/公开构建。使用新隔离CLI会话、本机服务和`verify_business_trial_browser.mjs`验证恢复/四方案导出后，按顺序运行`check_business_trial_browser.mjs`及捆绑Python的`check_business_trial_exports.py`独立核对；只认本次最终报告，不能把中途modal、旧文件或软件通过当业务采用。本人反馈未收集时停止于待业务复核，不反复重建或擅自采用。

S1～S3已本地实现并通过软件回归；2026-10-01真实样例已复现，发现设备归属/表达提取及条款覆盖缺口，S4业务验收未通过，业务人员试用尚未完成。当前未提升版本、提交或发布。`src/modules/ups-evidence.js`只负责提取、来源范围验证、修订、确认约束和导出行，不参与产品满足性判断。`normalizeUpsRequirement()`保留可选`evidenceVersion=1`，历史与JSON容器继续`version=1`，项目schema不变。旧记录无证据时明确显示缺失，不能自动补造来源。

`npm test`包含证据纯逻辑回归；页面验收先运行`python dev_scripts/create_ups_evidence_fixtures.py`（需reportlab），再运行`node dev_scripts/verify_ups_evidence_browser.mjs`（需本机Chrome及Playwright，可用`UPS_QA_PLAYWRIGHT_PATH`指定已安装模块位置，`UPS_QA_URL`指定本地服务地址）。脚本使用隔离浏览器存储及合成材料，不调用外部AI；输出至Git忽略的`output/playwright/ups-evidence/`。主流程覆盖修订/冲突阻断、新旧备份、PDF页序、替换及追加资料、存储失败和导出。发布前仍须执行本手册完整门禁，真实业务、OCR和系统打印未测试的部分不得标为已完成。
