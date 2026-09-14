#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

function extractFunction(name) {
  const pattern = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const match = pattern.exec(source);
  assert(match, `未找到函数 ${name}`);

  let depth = 1;
  let index = match.index + match[0].length;
  let quote = null;
  let escaped = false;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
    index += 1;
  }
  assert.equal(depth, 0, `函数 ${name} 花括号不平衡`);
  return source.slice(match.index, index);
}

function extractConst(name) {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  assert(start >= 0, `未找到常量 ${name}`);

  let index = start + marker.length;
  let quote = null;
  let escaped = false;
  let round = 0;
  let square = 0;
  let curly = 0;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") round += 1;
    else if (char === ")") round -= 1;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === ";" && round === 0 && square === 0 && curly === 0) {
      return source.slice(start, index + 1);
    }
    index += 1;
  }
  throw new Error(`常量 ${name} 未找到结束分号`);
}

function extractVarDecl(name) {
  const marker = `var ${name} =`;
  const start = source.indexOf(marker);
  assert(start >= 0, `未找到变量 ${name}`);

  let index = start + marker.length;
  let quote = null;
  let escaped = false;
  let round = 0;
  let square = 0;
  let curly = 0;
  while (index < source.length) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "(") round += 1;
    else if (char === ")") round -= 1;
    else if (char === "[") square += 1;
    else if (char === "]") square -= 1;
    else if (char === "{") curly += 1;
    else if (char === "}") curly -= 1;
    else if (char === ";" && round === 0 && square === 0 && curly === 0) {
      return source.slice(start, index + 1);
    }
    index += 1;
  }
  throw new Error(`变量 ${name} 未找到结束分号`);
}

const names = [
  "getNextBreakerSize",
  "isTwoVoltBatteryType",
  "getBatteryCellMultiplier",
  "getBatteryMonitorSlaveCode",
  "getMonitorHostCalculation",
  "resolveSwitchCalculationPower",
  "calculateBatteryElectricals",
  "selectCurrentSensor",
  "getVoltLevel",
  "getUpsProductType",
  "parseModularUpsModel",
  "getUpsCatalogSummaryDefaults",
  "getUpsCalculationModelError",
  "getUpsCatalogCodeDisplayEntries",
  "formatUpsCatalogCodeDisplay",
];
const program = [
  extractConst("STANDARD_BREAKER_SIZES"),
  extractConst("CURRENT_SENSOR_OPTIONS"),
  extractConst("UPS_POWER_MODULE_CODES"),
  ...names.map(extractFunction),
  `globalThis.rules = { ${names.join(", ")} };`,
].join("\n");

const context = {};
vm.createContext(context);
vm.runInContext(program, context);
const rules = context.rules;

assert.equal(rules.getUpsCalculationModelError("standard", "", null), "");
assert.equal(rules.getUpsCalculationModelError("custom", "", null), "");
assert.equal(rules.getUpsCalculationModelError("standard", "600", null), "请从匹配结果中选择完整的 UPS 型号，再计算当前配置");
assert.equal(rules.getUpsCalculationModelError("standard", "太行 UR-0600TPL", { 型号: "太行 UR-0600TPL" }), "");

const labeledCatalogCodes = rules.formatUpsCatalogCodeDisplay({
  "产品编码": "01020391；01020401；01021107",
  "目录价": "高效型机柜 ¥265,940；标准型机柜 ¥233,590；50kVA模块 ¥82,690/个",
});
assert.equal(labeledCatalogCodes, "高效型机柜：01020391\n标准型机柜：01020401\n50kVA功率模块：01021107");
assert.equal(rules.formatUpsCatalogCodeDisplay({ "产品编码": "01020446" }), "01020446");

assert.equal(rules.getNextBreakerSize(62), 63);
assert.equal(rules.getNextBreakerSize(63), 80);
assert.equal(rules.getNextBreakerSize(100), 125);
assert.equal(rules.getNextBreakerSize(1600), 2000);
assert.equal(rules.getNextBreakerSize(1904.8), 2000);
assert.equal(rules.getNextBreakerSize(2000), 2500);
assert.equal(rules.getNextBreakerSize(2499.9), 2500);
assert.equal(rules.getNextBreakerSize(3199.9), 3200);
assert.equal(rules.getNextBreakerSize(3999.9), 4000);
assert.throws(() => rules.getNextBreakerSize(-1), /非负/);

assert.equal(rules.getBatteryCellMultiplier("2v"), 1);
assert.equal(rules.getBatteryCellMultiplier("jyc2v"), 1);
assert.equal(rules.getBatteryCellMultiplier("jyc2vhr"), 1);
assert.equal(rules.getBatteryCellMultiplier("normal"), 6);
assert.equal(rules.getBatteryCellMultiplier("custom"), 6);
assert.equal(rules.getBatteryMonitorSlaveCode("jyc2v"), "88091146");
assert.equal(rules.getBatteryMonitorSlaveCode("jyc2vhr"), "88091146");
assert.equal(rules.getBatteryMonitorSlaveCode("jyc"), "88091145");

const monitorByGroups = rules.getMonitorHostCalculation({ basis: "groups", totalGroups: 4, upsNum: 2 });
assert.equal(monitorByGroups.qty, 1);
assert.equal(monitorByGroups.label, "按总电池组数（每6组1套）");
assert.equal(rules.getMonitorHostCalculation({ basis: "groups", totalGroups: 7, upsNum: 2 }).qty, 2);
const monitorByUps = rules.getMonitorHostCalculation({ basis: "ups", totalGroups: 4, upsNum: 2 });
assert.equal(monitorByUps.qty, 2);
assert.equal(monitorByUps.formula, "2台UPS × 1套/台");
assert.equal(rules.getMonitorHostCalculation({ basis: "ups", totalGroups: 20, upsNum: 3 }).qty, 3);
assert.throws(
  () => rules.getMonitorHostCalculation({ basis: "unknown", totalGroups: 4, upsNum: 2 }),
  /未知的监控主机\/显示屏计算方式/
);

const switchByUps = rules.resolveSwitchCalculationPower({
  basis: "ups", loadKw: 120, upsCap: 200, pf: 0.9,
});
assert.equal(switchByUps.watts, 180000);
assert.equal(switchByUps.label, "UPS容量 × 功率因数");
const switchByLoad = rules.resolveSwitchCalculationPower({
  basis: "load", loadKw: 120, upsCap: 200, pf: 0.9,
});
assert.equal(switchByLoad.watts, 120000);
assert.equal(switchByLoad.label, "负载功率");
assert.throws(
  () => rules.resolveSwitchCalculationPower({ basis: "load", loadKw: 0, upsCap: 200, pf: 0.9 }),
  /负载功率/
);
assert.throws(
  () => rules.resolveSwitchCalculationPower({ basis: "ups", loadKw: 120, upsCap: 0, pf: 0.9 }),
  /UPS容量/
);

const twoGroups = rules.calculateBatteryElectricals({
  loadW: 180000,
  switchW: 180000,
  cellsPerGroup: 32,
  groups: 2,
  battType: "normal",
  endV: 1.75,
  eff: 0.95,
});
assert.ok(Math.abs(twoGroups.reqPower - 493.4210526) < 1e-6);
assert.ok(Math.abs(twoGroups.maxCurrent - 563.9097744) < 1e-6);
assert.equal(twoGroups.groupCurrent, twoGroups.maxCurrent);
assert.equal(twoGroups.sensorCurrent, twoGroups.groupCurrent);

const oneGroup = rules.calculateBatteryElectricals({
  loadW: 90000,
  switchW: 90000,
  cellsPerGroup: 32,
  groups: 1,
  battType: "2v",
  endV: 1.75,
  eff: 0.95,
});
assert.equal(oneGroup.groupCurrent, 0);
assert.equal(oneGroup.sensorCurrent, oneGroup.maxCurrent);
assert.throws(
  () => rules.calculateBatteryElectricals({
    loadW: 1, switchW: 1, cellsPerGroup: 0, groups: 1,
    battType: "normal", endV: 1.75, eff: 0.95,
  }),
  /cellsPerGroup/
);

assert.equal(rules.selectCurrentSensor(100).code, "88091139");
assert.equal(rules.selectCurrentSensor(100.01).code, "88091140");
assert.equal(rules.selectCurrentSensor(800).code, "88091143");
assert.equal(rules.selectCurrentSensor(801).code, "88091144");

assert.equal(rules.getVoltLevel(16, "normal").level, "250VDC");
assert.equal(rules.getVoltLevel(32, "normal").level, "500VDC");
assert.equal(rules.getVoltLevel(40, "normal").level, "750VDC");
assert.equal(rules.getVoltLevel(100, "2v").level, "250VDC");

const modularProduct = { "系列": "祁连UM", "模块数量": "≤12" };
const modularFromSpace = rules.parseModularUpsModel(
  "祁连UM-6000TAL-FF/5-1 祁连UM-0500TFL-M",
  modularProduct
);
const modularFromNewline = rules.parseModularUpsModel(
  "祁连UM-6000TAL-FF/5-1\r\n祁连UM-0500TFL-M",
  modularProduct
);
assert.equal(modularFromSpace.frame, "祁连UM-6000TAL-FF/5-1");
assert.equal(modularFromSpace.module, "祁连UM-0500TFL-M");
assert.equal(modularFromSpace.maxModules, 12);
assert.equal(JSON.stringify(modularFromNewline), JSON.stringify(modularFromSpace));

const multiFrameModel = "祁连UM-6000TFL-FS/100\r 祁连UM-6000TFL-FF/100\r 祁连UM-6000TFL-F/100\r 祁连UM-1000TFL-M";
const multiFrameProduct = { "系列": "祁连UM", "模块数量": "≤6" };
assert.equal(rules.getUpsProductType(multiFrameModel, "祁连UM").type, "system");
const multiFrameModular = rules.parseModularUpsModel(multiFrameModel, multiFrameProduct);
assert.equal(JSON.stringify(multiFrameModular.frames), JSON.stringify([
  "祁连UM-6000TFL-FS",
  "祁连UM-6000TFL-FF",
  "祁连UM-6000TFL-F",
]));
assert.equal(multiFrameModular.frame, "祁连UM-6000TFL-FS；祁连UM-6000TFL-FF；祁连UM-6000TFL-F");
assert.equal(multiFrameModular.module, "祁连UM-1000TFL-M");
assert.equal(multiFrameModular.maxModules, 6);

const catalogDefaults = rules.getUpsCatalogSummaryDefaults({
  "产品编码": "01020393；01020403；01021107",
  "目录价": "高效型机柜 ¥373,330；标准型机柜 ¥327,980；50kVA模块 ¥82,690/个",
  "目录价备注": "保留两组机柜目录编码"
}, modularFromSpace);
assert.equal(catalogDefaults.frameCode, "01020393；01020403");
assert.equal(catalogDefaults.framePrice, 0, "多机柜版本不能擅自选择单一价格");
assert.equal(catalogDefaults.moduleCode, "01021107");
assert.equal(catalogDefaults.modulePrice, 82690);
assert.equal(catalogDefaults.note, "保留两组机柜目录编码");

const multiFrameCatalogDefaults = rules.getUpsCatalogSummaryDefaults({
  "产品编码": "01021116；01021117；01021115",
  "目录价": "维修旁路机柜 ¥327,000；四开关机柜 ¥353,330；100kVA模块 ¥149,500/个",
}, multiFrameModular);
assert.equal(multiFrameCatalogDefaults.frameCode, "01021116；01021117");
assert.equal(multiFrameCatalogDefaults.moduleCode, "01021115");
assert.equal(multiFrameCatalogDefaults.modulePrice, 149500);

const aggregationContext = {
  window: {
    editingUpsConfigurationId: null,
    savedSummaryRowTargets: new Map(),
    savedUpsConfigurations: [
      {
        id: "config-1",
        name: "配置 1",
        rows: [{
          key: "ups-module",
          category: "功率模块",
          code: "100kVA模块 01021115",
          model: "祁连UM-1000TFL-M",
          desc: "每台6个模块（最多6个）",
          unit: "个",
          qty: 36,
          unitPrice: 149500,
          note: "6台 × 6个/台",
        }, {
          key: "switchBox",
          category: "电池开关箱/柜",
          model: "750VDC 电池开关箱/柜",
          desc: "合资开关 | 总开关:1600A 分开关:630A × 4路; UPS无中性线",
          unit: "套",
          qty: 6,
        }, {
          key: "batteryRack",
          category: "电池架",
          model: "电池架",
          desc: "安装40节/架，电池型号：SPG12750b",
          unit: "架",
          qty: 24,
        }],
      },
      {
        id: "config-2",
        name: "配置 2",
        rows: [{
          key: "ups-module",
          category: "功率模块",
          code: "100kVA模块 01021115",
          model: "祁连UM-1000TFL-M",
          desc: "每台8个模块（最多8个）",
          unit: "个",
          qty: 16,
          unitPrice: 149500,
          note: "2台 × 8个/台",
        }, {
          key: "switchBox",
          category: "电池开关箱/柜",
          model: "750VDC 电池开关箱/柜",
          desc: "合资开关 | 总开关:2000A 分开关:630A × 4路; UPS无中性线",
          unit: "套",
          qty: 2,
        }, {
          key: "batteryRack",
          category: "电池架",
          model: "电池架",
          desc: "安装44节/架，电池型号：SPG12890b",
          unit: "架",
          qty: 8,
        }],
      },
      {
        id: "config-3",
        name: "配置 3",
        rows: [{
          key: "switchBox",
          category: "电池开关箱/柜",
          model: "750VDC 电池开关箱/柜",
          desc: "合资开关 | 总开关:1600A 分开关:630A × 4路; UPS无中性线",
          unit: "套",
          qty: 1,
        }, {
          key: "batteryRack",
          category: "电池架",
          model: "电池架",
          desc: "安装40节/架，电池型号：SPG12750b",
          unit: "架",
          qty: 4,
        }],
      },
    ],
  },
};
vm.createContext(aggregationContext);
vm.runInContext([
  extractFunction("normalizeSummaryRow"),
  extractFunction("hashSummaryIdentity"),
  extractFunction("getSavedSummaryAggregationIdentity"),
  "function getSavedUpsConfigurations() { return window.savedUpsConfigurations; }",
  extractFunction("collectSavedConfigurationRows"),
  "globalThis.aggregateRows = collectSavedConfigurationRows();",
].join("\n"), aggregationContext);
assert.equal(aggregationContext.aggregateRows.length, 5, "不同规格的配置型物料必须拆行");
const aggregatedModule = aggregationContext.aggregateRows.find(row => row.category === "功率模块");
const aggregatedSwitches = aggregationContext.aggregateRows.filter(row => row.category === "电池开关箱/柜");
const aggregatedRacks = aggregationContext.aggregateRows.filter(row => row.category === "电池架");
assert.equal(aggregatedModule.qty, 52, "相同功率模块数量必须求和");
assert.equal(
  aggregatedModule.desc,
  "配置 1：每台6个模块（最多6个）\n配置 2：每台8个模块（最多8个）",
  "不同配置说明必须换行完整保留"
);
assert.equal(aggregatedSwitches.length, 2, "不同开关规格的电池开关柜不得合并");
assert.equal(
  aggregatedSwitches.find(row => row.desc.includes("1600A")).qty,
  7,
  "完全相同规格的电池开关柜才允许数量求和"
);
assert.equal(
  aggregatedSwitches.find(row => row.desc.includes("2000A")).qty,
  2,
  "不同总开关规格的电池开关柜必须保留独立数量"
);
assert.equal(aggregatedRacks.length, 2, "不同装载节数或电池型号的电池架不得合并");
assert.equal(aggregatedRacks.find(row => row.desc.includes("40节/架")).qty, 28, "相同电池架规格才允许数量求和");
assert.equal(aggregatedRacks.find(row => row.desc.includes("44节/架")).qty, 8, "不同电池架规格必须保留独立数量");
assert.equal(source.includes('summary-config-source'), false, "产品名称列不得重复显示配置来源");

const summarySortContext = {};
vm.createContext(summarySortContext);
vm.runInContext([
  extractConst("MONITOR_PRODUCTS"),
  extractFunction("getSummaryCategoryPriority"),
  extractFunction("getSummaryMonitorPriority"),
  extractFunction("sortSummaryRowsByBusinessOrder"),
  "globalThis.sortSummaryRows = sortSummaryRowsByBusinessOrder;",
].join("\n"), summarySortContext);
const unorderedSummaryRows = [
  { key: "frame-1", category: "UPS机框", model: "600kVA机框" },
  { key: "sensor-800", category: "电池监控", code: "88091143", model: "SBMS-CS800EK2T5" },
  { key: "battery-rack", category: "电池架", model: "电池架" },
  { key: "battery", category: "电池", model: "SPG12750b" },
  { key: "frame-2", category: "UPS机框", model: "800kVA机框" },
  { key: "battery-module", category: "电池监控", code: "88091145", model: "SBMS-PBAT51-12" },
  { key: "switch", category: "电池开关箱/柜", model: "750VDC 电池开关箱/柜" },
  { key: "module", category: "功率模块", model: "祁连UM-1000TFL-M" },
  { key: "monitor-main", category: "电池监控", code: "88091156", model: "SBMS-PBMS6000" },
  { key: "sensor-600", category: "电池监控", code: "88091142", model: "SBMS-CS600EK2T5" },
];
const orderedSummaryKeys = summarySortContext.sortSummaryRows(unorderedSummaryRows).map((row) => row.key);
assert.equal(
  JSON.stringify(orderedSummaryKeys),
  JSON.stringify([
    "frame-1", "frame-2", "module", "battery", "switch", "battery-rack",
    "monitor-main", "sensor-600", "sensor-800", "battery-module",
  ]),
  "汇总清单必须按 UPS、模块、电池、开关柜、电池架、电池监控排列，监控产品保持定义顺序"
);

const legacyOrderContext = {
  window: {
    projectSummary: {
      rowOrder: ["sensor-800", "frame-1", "battery"],
      rowOrderCustomized: false,
      hiddenRowKeys: [],
    },
  },
};
vm.createContext(legacyOrderContext);
vm.runInContext([
  extractConst("MONITOR_PRODUCTS"),
  extractFunction("getSummaryRowOrder"),
  extractFunction("getHiddenSummaryRowKeys"),
  extractFunction("isSummaryRowHidden"),
  extractFunction("getSummaryCategoryPriority"),
  extractFunction("getSummaryMonitorPriority"),
  extractFunction("sortSummaryRowsByBusinessOrder"),
  extractFunction("getOrderedSummaryRows"),
  `const sampleRows = ${JSON.stringify([
    { key: "frame-1", category: "UPS机框", model: "600kVA机框" },
    { key: "sensor-800", category: "电池监控", code: "88091143", model: "SBMS-CS800EK2T5" },
    { key: "battery", category: "电池", model: "SPG12750b" },
  ])};`,
  "globalThis.migratedOrder = getOrderedSummaryRows(sampleRows).map(function(row) { return row.key; });",
  "window.projectSummary.rowOrder = ['sensor-800', 'frame-1', 'battery'];",
  "window.projectSummary.rowOrderCustomized = true;",
  "globalThis.manualOrder = getOrderedSummaryRows(sampleRows).map(function(row) { return row.key; });",
].join("\n"), legacyOrderContext);
assert.equal(
  JSON.stringify(legacyOrderContext.migratedOrder),
  JSON.stringify(["frame-1", "battery", "sensor-800"]),
  "旧版自动 rowOrder 必须迁移为业务顺序"
);
assert.equal(
  JSON.stringify(legacyOrderContext.manualOrder),
  JSON.stringify(["sensor-800", "frame-1", "battery"]),
  "用户手动微调后的 rowOrder 必须保留"
);

const dragOrderContext = {};
vm.createContext(dragOrderContext);
vm.runInContext([
  extractFunction("getSummaryRowOrderAfterDrop"),
  "globalThis.moveByDrop = getSummaryRowOrderAfterDrop;",
].join("\n"), dragOrderContext);
assert.equal(
  JSON.stringify(dragOrderContext.moveByDrop(["ups", "battery", "switch", "rack", "monitor"], "monitor", "battery", false)),
  JSON.stringify(["ups", "monitor", "battery", "switch", "rack"]),
  "拖到目标行上半部必须插入目标行之前"
);
assert.equal(
  JSON.stringify(dragOrderContext.moveByDrop(["ups", "battery", "switch", "rack", "monitor"], "ups", "rack", true)),
  JSON.stringify(["battery", "switch", "rack", "ups", "monitor"]),
  "拖到目标行下半部必须插入目标行之后"
);

const summaryPasteContext = {};
vm.createContext(summaryPasteContext);
vm.runInContext([
  extractConst("CUSTOM_SUMMARY_PASTE_FIELDS"),
  extractFunction("createCustomSummaryRow"),
  extractFunction("parseSummaryClipboardText"),
  extractFunction("normalizeCustomSummaryPasteValue"),
  extractFunction("applyCustomSummaryPasteMatrix"),
  "globalThis.parsePaste = parseSummaryClipboardText;",
  "globalThis.applyPaste = applyCustomSummaryPasteMatrix;",
].join("\n"), summaryPasteContext);
const pastedRows = [{
  id: "custom-existing",
  category: "自定义",
  code: "",
  model: "",
  desc: "",
  qty: 1,
  unit: "项",
  unitPrice: 0,
  nonStandardDesc: "",
  note: "",
}];
const clipboardMatrix = summaryPasteContext.parsePaste(
  '配电柜\tA001\tXGM-1\t"第一行\n第二行"\t2\t套\t1,234.50\t2469\t非标A\t备注A\r\n' +
  '电缆\tB002\tWDZ-YJY\t动力电缆\t3\t米\t20\t60\t\t备注B\r\n'
);
const pasteResult = summaryPasteContext.applyPaste(pastedRows, 0, 0, clipboardMatrix);
assert.equal(pasteResult.rowsAdded, 1, "Excel 粘贴行数超过现有自定义行时必须自动补行");
assert.equal(pasteResult.cellsUpdated, 18, "小计列必须跳过，其余九个业务字段应写入");
assert.equal(pastedRows[0].desc, "第一行\n第二行", "Excel 单元格内换行必须保留");
assert.equal(pastedRows[0].unitPrice, 1234.5, "带千位分隔符的单价必须转为数值");
assert.equal(pastedRows[0].nonStandardDesc, "非标A", "小计列之后的非标描述不得错位");
assert.equal(pastedRows[0].note, "备注A", "小计列之后的备注不得错位");
assert.equal(pastedRows[1].category, "电缆", "第二行产品名称必须写入自动新增行");
assert.equal(pastedRows[1].qty, 3, "第二行数量必须转为数值");

console.log("✅ 核心业务规则测试通过（断路器、电池电气量、传感器、电压等级、UPS汇总、排序与Excel粘贴）");

// ===== JYC HR12V 高功率电池数据校验 =====
const dataProgram = [
  extractVarDecl("BATTERY_POWER_DATA"),
  extractVarDecl("JYC_2V_BATTERY_SPECS"),
  extractFunction("expandBatteryPowerSpec"),
  "BATTERY_POWER_DATA = BATTERY_POWER_DATA.concat(JYC_2V_BATTERY_SPECS.map(expandBatteryPowerSpec));",
  extractFunction("getBatteryVoltagesForTime"),
  extractFunction("getBatteryRecommendationsByPower"),
  "globalThis.battery = { BATTERY_POWER_DATA, getBatteryVoltagesForTime, getBatteryRecommendationsByPower };",
].join("\n");
const dataContext = {};
vm.createContext(dataContext);
vm.runInContext(dataProgram, dataContext);
const { BATTERY_POWER_DATA, getBatteryVoltagesForTime, getBatteryRecommendationsByPower } = dataContext.battery;

const jycBatteries = BATTERY_POWER_DATA.filter((b) => b.category === "jyc");
assert.equal(jycBatteries.length, 13, "JYC 型号数量应为 13");

const expectedJycVolts = [1.6, 1.67, 1.7, 1.75, 1.8];
const expectedJycTimes = [5, 10, 15, 30, 60, 90, 120, 180, 300, 600];
for (const b of jycBatteries) {
  assert.ok(/^HR12V\d+W$/.test(b.model), `JYC 型号命名异常: ${b.model}`);
  assert.ok(/^\d+Ah$/.test(b.capacity), `JYC 容量格式异常: ${b.model} ${b.capacity}`);
  assert.equal(b.voltages.length, 5, `${b.model} 应有5个终止电压`);
  const volts = b.voltages.map((v) => Number(v.endVoltage)).sort((a, c) => a - c);
  // 注意：vm 上下文里的数组与主 realm 原型不同，用 JSON 字符串比较避免跨 realm 误判
  assert.equal(JSON.stringify(volts), JSON.stringify(expectedJycVolts), `${b.model} 终止电压不匹配`);
  for (const v of b.voltages) {
    const times = v.powers.map((p) => p.time);
    assert.equal(JSON.stringify(times), JSON.stringify(expectedJycTimes), `${b.model}@${v.endVoltage}V 时间点不匹配`);
    for (const p of v.powers) {
      assert.ok(Number.isFinite(p.power) && p.power > 0, `${b.model}@${v.endVoltage}V ${p.time}min 功率无效`);
    }
    for (let i = 1; i < v.powers.length; i += 1) {
      assert.ok(
        v.powers[i].power < v.powers[i - 1].power,
        `${b.model}@${v.endVoltage}V 恒功率应随时间严格递减`
      );
    }
  }
}

// 抽样核对数据表原值（HR12V430W @1.75V/30min = 250W）
const sampleBattery = jycBatteries.find((b) => b.model === "HR12V430W");
const samplePower = sampleBattery.voltages
  .find((v) => Math.abs(v.endVoltage - 1.75) < 0.01)
  .powers.find((p) => p.time === 30).power;
assert.equal(samplePower, 250, "HR12V430W@1.75V/30min 应为 250W");

// 推荐链路必须包含 jyc 分类并能按单体功率选出满足型号
const jycRec = getBatteryRecommendationsByPower(200, 1.75, 30);
assert.ok(jycRec.jyc, "推荐结果应包含 jyc 分类桶");
assert.ok(jycRec.jyc.suitable.length > 0, "200W/单体应能在 JYC 中找到满足型号");
assert.ok(jycRec.jyc.suitable[0].power >= 200, "JYC 首选型号恒功率应满足所需功率");

console.log("✅ JYC HR12V 高功率电池数据校验通过（13型号 / 结构 / 单调性 / 推荐链路）");

// ===== JYC 2V 常规与高倍率电池数据校验 =====
const jyc2vBatteries = BATTERY_POWER_DATA.filter((b) => b.category === "jyc2v");
const jyc2vHrBatteries = BATTERY_POWER_DATA.filter((b) => b.category === "jyc2vhr");
assert.equal(BATTERY_POWER_DATA.length, 91, "电池恒功率型号总数应为 91");
assert.equal(jyc2vBatteries.length, 10, "JYC-GFM-2V 型号数量应为 10");
assert.equal(jyc2vHrBatteries.length, 6, "JYC-HR-2V 高倍率型号数量应为 6");
assert.equal(JSON.stringify(jyc2vBatteries.map((b) => b.model)), JSON.stringify([
  "GFM-100", "GFM-200", "GFM-300", "GFM-400", "GFM-500",
  "GFM-600", "GFM-800", "GFM-1000", "GFM-1500", "GFM-2000",
]));
assert.equal(JSON.stringify(jyc2vHrBatteries.map((b) => b.model)), JSON.stringify([
  "HR-2V500W", "HR-2V750W", "HR-2V1000W", "HR-2V1200W", "HR-2V1500W", "HR-2V2000W",
]));

for (const battery of [...jyc2vBatteries, ...jyc2vHrBatteries]) {
  for (const voltage of battery.voltages) {
    for (const point of voltage.powers) {
      assert.ok(Number.isFinite(point.power) && point.power > 0, `${battery.model} 恒功率必须为正数`);
    }
    for (let index = 1; index < voltage.powers.length; index += 1) {
      assert.ok(
        voltage.powers[index].power < voltage.powers[index - 1].power,
        `${battery.model}@${voltage.endVoltage}V 恒功率应随时间严格递减`
      );
    }
  }
}

const hr500 = jyc2vHrBatteries.find((b) => b.model === "HR-2V500W");
assert.equal(hr500.voltages.find((v) => v.endVoltage === 1.75).powers.find((p) => p.time === 30).power, 321);
const gfm1000 = jyc2vBatteries.find((b) => b.model === "GFM-1000");
assert.equal(gfm1000.voltages.find((v) => v.endVoltage === 1.8).powers.find((p) => p.time === 120).power, 636);
const gfm200 = jyc2vBatteries.find((b) => b.model === "GFM-200");
assert.match(gfm200.sourceNote, /GFM-100.*完全相同.*厂家复核/);

assert.equal(JSON.stringify(getBatteryVoltagesForTime("jyc2v", 120)), JSON.stringify([1.8]));
assert.equal(JSON.stringify(getBatteryVoltagesForTime("jyc2vhr", 30)), JSON.stringify([1.65, 1.7, 1.75, 1.8]));
const jyc2vRec = getBatteryRecommendationsByPower(900, 1.75, 60);
assert.equal(jyc2vRec.jyc2v.suitable[0].model, "GFM-1000");
const jyc2vHrRec = getBatteryRecommendationsByPower(700, 1.75, 30);
assert.equal(jyc2vHrRec.jyc2vhr.suitable[0].model, "HR-2V1200W");

console.log("✅ JYC 2V 电池数据校验通过（10款GFM + 6款HR / 稀疏曲线 / 推荐链路 / 数据源风险）");
