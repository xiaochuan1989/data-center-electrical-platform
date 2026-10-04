# 非标售前数据契约 v1（N1定稿）

> 日期：2026-10-01。范围：配电柜、PDU、智能母线；面向售前方案，不作生产设计。
> 本契约用于独立纯逻辑模块及N2/N3基础版，尚非完整工程方案包或正式提取报告。父计划：[实施计划](nonstandard-presales-roadmap.md)。

## 1. 关系与版本

`资料Source → 技术要求Requirement → 设备Equipment → 采用方案Scheme → 配置清单BOM`

一个包含多个设备；每个要求只明确关联一个设备（未分配时为null），共用条款必须经人工分配后逐设备建项，不能默认为全部适用。方案只能关联一个设备，可包含多个组件。清单按设备/方案分开，不跨设备自动合并。说明与清单由同一个采用配置快照生成；推荐结果不直接替代采用方案。

| 对象 | v1字段与约束 |
|---|---|
| Package | `contractVersion=1, id, title, revision, sources[], equipment[], requirements[], schemes[], revisions[]`；无价格、绝对路径及自动工程合格标记 |
| Source | `id, type(text/pdf/docx/xlsx/manual), name, text, segments[], warnings?`；位置`start/end`为源文本字符偏移，PDF页序、DOCX解析段落、XLSX表/单元格按解析结果保存，不推测。segment可带`forbiddenDeviation/role/contextTitle/contextCell`；内容标题必须匹配同表对应单元格原文 |
| Equipment | `id, category(cabinet/pdu/busway), label, quantity, unit`；quantity未知为null，不默认1，零值及非法值不能当有效供货数量 |
| Requirement | `id, equipmentId, field, candidates[], confirmedValue, reviewStatus, forbiddenDeviation, response, decisionReason`；候选有value与evidence；未知/按图/占位保持null |
| Evidence | `sourceId, start, end, quote`；须与对应source的segment范围及原文完全匹配；自动候选值还须在片段中有文字依据 |
| Scheme | `id, equipmentId, name, config, components[], assumptions[], exclusions[], requirementIds[], origin, reviewStatus, assistant?`；config只接受本品类字段；组件数量为每设备数量，生成总量时乘设备数量；可选assistant用于cabinet-assistant、pdu-assistant或busway-assistant来源 |
| Component | `id, name, specification, quantity, unit, brand, model, code, modelStatus(pending/verified), reference, requirementIds[], risk, role?`；verified须有model或code及核对依据，缺值不补造；role为v1可选扩展，缺省other，仅本品类注册用途合法 |
| Revision | `revision, kind, targetId, reason, at, detail`；新增、确认、清空、修改、来源替换均记录；人工修订必须原因，变更detail保存前后值/对象 |
| Snapshot | `contractVersion=1, packageRevision, package`；独立深拷贝，备份往返后须重新验证结构与关系，不自动确认 |

不改现有项目schemaVersion=2、UPS evidenceVersion=1、UPS历史version=1及IndexedDB。v1纯模块不读写存储；N2界面使用独立可选localStorage键`nonstandard_presales_working_v1`，初始不保存客户资料。旧键不变，快照恢复回到待复核。以上可选来源元数据为v1兼容扩展。

## 2. 各品类字段（配置字段注册表）

字段全部允许未知；数值有限、非负，额定值需大于0；数量为整数，备用量允许0。三相负荷推导、短路/温升/保护配合不在v1自动计算。额定单位明确，文本不得当数值导入。

| 品类 | 字段及类型/单位 |
|---|---|
| 通用（各品类独立具备） | `voltageV`数值V、`frequencyHz`数值Hz、`ratedCurrentA`数值A、`phase`枚举single/three/dc、`ipRating`文本、`installation`文本、`widthMm/heightMm/depthMm`数值mm、`brandRequirement`文本、`monitoring`文本、`communication`文本、`supplyBoundary`文本 |
| 配电柜 | `cabinetType`文本、`incomingCount/tieCount/outgoingCount/spareCount`整数、`busbarCurrentA`数值A、`neutralRatioPct`数值%、`shortCircuitKa`数值kA、`shortCircuitDurationS`数值s、`incomingProtection/outgoingProtection/metering/cableEntry/earthing/spdRequirement`文本 |
| PDU | `pduType`枚举rack/cabinet、`inputCount/outputCount/branchCount/spareCount`整数、`inputInterface/outputInterface/branchProtection/meteringLevel/phaseAssignment/redundancy/earthing/spdRequirement`文本、`rackUnits`数值U；未明确类型不能形成确认方案 |
| 智能母线 | `pathMode`枚举A/B/AB、`rackCount/runCount/terminalCount/controllerCount/endpointCount/plugBoxCount/spareCount`整数、`buswayLengthM`数值m、`terminalCurrentA/plugBoxCurrentA`数值A、`plugBoxOutputs`整数、`neutralRatioPct`数值%、`shortCircuitKa`数值kA、`layoutNote/plugBoxGrouping/antiCondensation/supports/endAccessories`文本；controllerCount/endpointCount为可选扩展 |

需要分组/多规格出线和PDU接口时，按components多行表示，并用requirementIds逐行关联要求；禁止用单一总回路字段代替实际分路明细。字段未覆盖的功能、试验、品牌等条款使用field=`clause`，不丢原文；新增数值字段需更新注册表及测试。

## 3. 状态与确认规则

- 新增候选为pending；无证据/数值占位为unknown。同设备同field的不同有效候选为conflict；不同设备隔离。不按文件日期、大小或输入顺序自动选值。
- 要求确认须有有效候选及明确选择。人工补录/改值不冒充原文提取，必须原因。引用图纸只记录条款证据，实际参数仍未知。
- `forbiddenDeviation`只有true/false/null三态，null代表是否禁止偏离尚未核对。`response`仅pending/met/deviation/not-applicable；均由人工复核，非计算合格结论。禁止偏离且response=deviation阻止确认。
- 新增/修订要求、替换来源、修改设备数量或方案配置，使对应方案确认失效；替换资料使候选要求回到stale，重新提取/复核后才能确认。不可静默把旧数值绑定新文本。
- 方案确认要求：设备数量已知、至少一条配置字段与一行组件、关联本设备全部要求且确认有效、适用品类字段不为空（PDU至少明确pduType）、组件规格/数量/型号核对完整、无风险标记、至少有已核对的供货边界。否则仅输出“讨论稿/待复核”；缺数据可生成讨论稿，不能伪造正式提取报告。
- 已确认仅表示工程师在本模块复核了售前配置，不代表所有工程校核已通过。说明固定保留“非生产图纸/非完整合规结论”。

v1标量按精确匹配核对采用配置与确认要求；不推断“≥”“≤”或范围的合规性。未匹配需人工明确偏离且条款允许偏离，禁止偏离时阻断确认。后续完整条款解析需扩展比较运算符/单位与测试后才能计算上下限，不能把v1当作完整技术规范校核器。

## 4. 方案—清单生成与母线桥接

组件是配置清单的唯一来源，BOM不从原始要求、推荐值或独立缓存再次推导。每行保存schemeId/equipmentId/packageRevision、每设备数量、设备数量、总数量、单位、核对状态、关联要求与依据。任一数量未知，总数量null；所有来源/假设/风险和澄清问题随输出保留。

N3用途注册表：柜incoming/tie/outgoing/accessory，PDU input/output/branch/accessory，母线busway/terminal/controller/endpoint/plugbox/accessory，各类均有other。已填数量字段与相应用途组件合计精确核对（长度m允许浮点容差1e-9），计数单位和整数明确；缺明细/错误单位/未知数量阻止人工确认。旧缺role组件可读，不偷偷推断用途。设备数量/计数字段须安全整数；组件数量须规范化有限正数，总数量溢出明确拒绝。

N3编辑立即失效，保存需原因；界面未保存编辑不参与交付。`nonstandard-deliverable.js`将同一交付对象映射为预览/Excel/HTML说明，不独立重算采用值；导出是静态快照，编辑需返回应用保存后重新导出。

母线桥接每次调用既有`calculateSmartBuswayDesign(rawDesign)`，从新计算的design和bom取得采用值，不接收外部result/bom作为可信输入；`bomBlocked/plugBoxBomBlocked`及danger/error阻止桥接输出有效清单。整套母线BOM表示一套方案，设备数量由调用者明确指定，不能再默认1。沿用现有目录编码，不生成新型号；目录编码代表已有工具数据，进入新模块仍须厂家/企业资料人工复核，不能因旧status=ok自动verified。

## 5. 本轮实现及验收范围

先实现注册表、独立包/设备/证据/要求/方案、修订失效、清单/说明同源、JSON快照往返及母线纯函数桥接；全部使用显式合成软件用例，不能作客户验收资料。

验收覆盖跨设备隔离、同字段冲突、原文伪证据拒绝、未知/占位、禁止偏离、修改失效、设备数量乘算、空型号/编码保留、快照不回写、未来版本拒绝、旧schema不变及母线超限/分组阻断。N2已补入来源解析、手工重映射、输入修改失效、替换后旧条款归档及需求工作稿UI，见[入口设计](nonstandard-requirement-ui.md)。自动设备识别、完整语义解析、正式方案包界面及真实各品类业务验收仍未完成。

N3已接入[手工方案/清单基础版](nonstandard-scheme-ui.md)，三品类字段编辑、用途数量一致性、母线已生成设计桥接及静态XLSX/HTML/JSON同源输出通过合成验收；无自动元件选型或完整品类工程规则，不替代真实样例业务验收。

## 6. 配电柜助手兼容扩展

新增origin=cabinet-assistant，assistant={version:1, kind:cabinet-circuits, template:distribution/sectional, sourceRevision}。仅柜类允许；版本/模板/来源修订校验，来源修订不能大于包修订。无此字段的旧v1包仍可读，无需改schema/存储键。元数据是生成历史，不是有效原文证据或厂家规则来源。

助手只生成新、未保存草稿；采用仍调用原接口。回路每套数量为正整数或未知，已知分组完整合计并与已声明数量比对；未知行不作部分总量，器件/额定参数不默认，数量乘设备套数须在安全整数范围内。无母联骨架须明确采用母联数量0，含母联骨架须明确母联数量；进/出线明细与型号/技术要求沿用既有确认门槛。

输出新增可选description字符串数组及origin，只从当前保存配置/组件生成。说明进入预览、HTML和Excel澄清与边界表，不建立独立BOM或说明缓存。真实案例与完整元件规则未验收，见[助手设计](cabinet-assistant.md)。

## 7. PDU助手兼容扩展

origin=pdu-assistant，assistant={version:1,kind:pdu-spec,sourceRevision,sourceRequirementIds}，仅本设备PDU要求可作生成来源。旧v1无元数据可读；新字段不改存储键/schema。条款显式选取用于候选草稿，未确认不写成满足；暂定参数保留风险，全文未识别不丢弃。输出插座分组数量为每条PDU数量，总孔数不当保护分路数；设备数量为区域PDU总量，不再乘每柜PDU数。输出说明由已保存配置及清单动态生成。详细映射和门槛见[PDU助手设计](pdu-assistant.md)。

## 8. 智能母线区域助手兼容扩展

origin=busway-assistant，assistant={version:1,kind:busway-region,quantityBasis:region,sourceRevision,sourceRequirementIds,basisNote}。显式区域整套口径且设备数量1，区域箱数/米数按组件保存，不乘通道或A/B等数量。设备数量后来非1/未知则总量null并阻断确认，旧手工及计算器仍沿用原乘算。主控箱/controllerCount与端口箱/endpointCount独立，不默认端口箱=始端箱。数量含未知不局部汇总，附件/保护/型号不补造。见[母线助手设计与验收](busway-assistant.md)。
