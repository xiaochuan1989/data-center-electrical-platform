import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CABLE_AIR_SPACING_FACTORS,
  CABLE_TRAY_LAYER_FACTORS,
  calculateApf,
  calculateBranch,
  calculateBusbarAmpacity,
  calculateBusbarSelection,
  calculateCableSelection,
  calculateBusway,
  calculateLoadSummary,
  calculateLithiumBatteryA00,
  calculateSmartBusway,
  calculateSvg,
  nextStandard
} from '../src/modules/engineering-calculators.js';
import { createProject, normalizeProject } from '../src/platform/project-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const blankProject = createProject('验收项目');
assert.equal(blankProject.schemaVersion, 1);
assert.equal(blankProject.name, '验收项目');
assert.deepEqual(normalizeProject({ name: '旧项目', legacy: null }).legacy, {});

assert.equal(nextStandard(63, [16, 32, 63, 100]), 63);
assert.equal(nextStandard(64, [16, 32, 63, 100]), 100);
assert.equal(nextStandard(101, [16, 32, 63, 100]), null);

const load = calculateLoadSummary([
  { name: 'IT', quantity: 10, unitPowerKw: 10, demandFactor: 0.9, powerFactor: 0.9 }
], { voltage: 380, safety: 1.2, transformerLoadRate: 0.8 });
assert.ok(Math.abs(load.activePowerKw - 90) < 1e-9);
assert.ok(Math.abs(load.apparentPowerKva - 100) < 1e-9);
assert.ok(Math.abs(load.currentA - 151.934) < 0.01);
assert.equal(load.breakerA, 200);
assert.equal(load.transformerKva, 160);

const branch = calculateBranch({ powerKw: 30, phase: 'three', voltage: 380, powerFactor: 0.9, safety: 1.2 });
assert.ok(Math.abs(branch.baseCurrentA - 50.64) < 0.02);
assert.equal(branch.breakerA, 63);

const busway = calculateBusway({ activePowerKw: 500, voltage: 380, powerFactor: 0.9, demandFactor: 0.9, safety: 1.2, harmonicFactor: 1 });
assert.equal(busway.buswayA, 1000);

const apf = calculateApf({ transformerKva: 1250, loadRate: 0.8, thdi: 0.3, voltage: 380 });
assert.ok(Math.abs(apf.totalCurrentA - 1519.34) < 0.1);
assert.ok(Math.abs(apf.harmonicCurrentA - 455.80) < 0.1);
assert.equal(apf.recommendedA, 575);

const svg = calculateSvg({ activePowerKw: 800, currentPowerFactor: 0.8, targetPowerFactor: 0.95 });
assert.ok(Math.abs(svg.compensationKvar - 337.05) < 0.1);
assert.equal(svg.recommendedKvar, 350);
const leadingSvg = calculateSvg({ activePowerKw: 1000, currentPowerFactor: 0.92, targetPowerFactor: 0.99, powerFactorType: 'leading' });
assert.ok(leadingSvg.compensationKvar > 300);
assert.equal(leadingSvg.initialReactiveKvar < 0, true);

const lithiumA00 = calculateLithiumBatteryA00({
  loadPowerKw: 500,
  upsPowerKva: 600,
  nominalVoltageV: 512,
  groupCount: 2,
  powerFactor: 0.8,
  dischargeTimeH: 0.25,
  batteryOutputEfficiency: 0.95
});
assert.equal(lithiumA00.cellSeriesCount, 160);
assert.equal(lithiumA00.inverterEfficiency, 0.95);
assert.equal(lithiumA00.dischargeRateC, 4);
assert.equal(lithiumA00.cellPlatformVoltageV, 3.05);
assert.ok(Math.abs(lithiumA00.calculatedCapacityAh - 141.90999500476818) < 1e-10);
assert.equal(lithiumA00.excelDisplayCapacityAh, 142);
const lithiumFallback = calculateLithiumBatteryA00({ ...lithiumA00, loadPowerKw: '', upsPowerKva: 100, nominalVoltageV: 512, groupCount: 2, powerFactor: 0.8, dischargeTimeH: 1, batteryOutputEfficiency: 0.95 });
assert.equal(lithiumFallback.inverterEfficiency, 0.93);
assert.equal(lithiumFallback.designPowerKw, 80);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, loadPowerKw: '', upsPowerKva: 100.1, nominalVoltageV: 512, groupCount: 2, powerFactor: 0.8, dischargeTimeH: 1, batteryOutputEfficiency: 0.95 }).inverterEfficiency, 0.95);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, loadPowerKw: 0 }).designPowerKw, 0);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, dischargeTimeH: 1 }).cellPlatformVoltageV, 3.15);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, dischargeTimeH: 0.5 }).cellPlatformVoltageV, 3.12);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, dischargeTimeH: 0.2 }).cellPlatformVoltageV, 3.05);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, dischargeTimeH: 0.1 }).cellPlatformVoltageV, 3.02);
assert.equal(calculateLithiumBatteryA00({ ...lithiumA00, dischargeTimeH: 0.3 }).excelFormulaGap, true);
assert.match(calculateLithiumBatteryA00({ ...lithiumA00, groupCount: '' }).error, /电池组/);

const smartBusway = calculateSmartBusway({
  row1: { cabinets600: 10, cabinets800: 0, ac300: 0, ac600: 2 },
  row2: { cabinets600: 10, cabinets800: 0, ac300: 0, ac600: 2 },
  installation: 'cabinet-top', touchscreen: true
});
assert.equal(smartBusway.row1LengthM, 8);
assert.equal(smartBusway.buswayLengthM, 32);
assert.equal(smartBusway.startBoxes, 4);
assert.equal(smartBusway.touchscreen, 1);

const busbarCatalog = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'busbar-catalog.json'), 'utf8'));
assert.equal(busbarCatalog.length, 97);
assert.deepEqual(Object.fromEntries(['单片', '双拼', '三拼', '四拼'].map(configuration => [configuration, busbarCatalog.filter(item => item.configuration === configuration).length])), {
  单片: 36, 双拼: 25, 三拼: 25, 四拼: 11
});
const busbar = calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 1600,
  installationEnvironment: 'ventilated',
  surfaceTreatment: 'bare',
  temperatureRise: 'iec50'
});
assert.equal(busbar.totalFactor, 1.3);
assert.ok(Math.abs(busbar.lookupCurrentA - 1230.7692) < 0.001);
assert.equal(busbar.selected.spec, '80 x 10');
assert.equal(busbar.selected.configuration, '单片');
assert.equal(busbar.ratedCurrentA, 1240);
assert.equal(busbar.areaMm2, 800);
assert.equal(busbar.peAreaMm2, 400);
assert.ok(Math.abs(busbar.loadRate - 0.9925558) < 0.00001);
assert.equal(calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 1600,
  installationEnvironment: 'sealed',
  surfaceTreatment: 'bare',
  temperatureRise: 'iec50'
}).totalFactor, 1);
assert.equal(calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 2400,
  installationEnvironment: 'sealed',
  surfaceTreatment: 'bare',
  temperatureRise: 'din30'
}).selected.configuration, '双拼');
const largeBusbar = calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 4000,
  installationEnvironment: 'ventilated',
  surfaceTreatment: 'bare',
  temperatureRise: 'iec50'
});
assert.equal(largeBusbar.selected.spec, '4 x 100 x 5');
assert.equal(largeBusbar.selected.configuration, '四拼');
assert.equal(largeBusbar.prioritySelected.spec, '3 x 100 x 10');
assert.equal(largeBusbar.ratedCurrentA, 3190);
assert.equal(largeBusbar.areaMm2, 2000);
assert.equal(largeBusbar.peAreaMm2, 500);
assert.ok(Math.abs(largeBusbar.loadRate - 0.964552) < 0.00001);
assert.match(calculateBusbarSelection(busbarCatalog, { loadCurrentA: 0 }).error, /大于 0A/);

const busbarAmpacityInput = {
  widthMm: 120,
  thicknessMm: 10,
  maximumTemperatureC: 105,
  roomTemperatureC: 35,
  permittedTemperatureRiseK: 70,
  internalTemperatureRiseC: 15,
  convectionModel: 'custom',
  orientation: 'edgewise-horizontal',
  convectionCoefficient: 5,
  emissivity: 0.35,
  radiationViewFactor: 1,
  exposedSurfaceFactor: 1,
  resistivity20OhmM: 1.72e-8,
  temperatureCoefficient: 0.00393,
  currentType: 'dc',
  acResistanceFactor: 1,
  designFactor: 0.8,
  dinReferenceField: 'bareCurrentA'
};
const busbarAmpacity = calculateBusbarAmpacity(busbarCatalog, busbarAmpacityInput);
assert.ok(Math.abs(busbarAmpacity.thermalBalanceCurrentA - 2512.8962295810684) < 1e-9);
assert.ok(Math.abs(busbarAmpacity.recommendedCurrentA - 2010.316983664855) < 1e-9);
assert.equal(busbarAmpacity.areaMm2, 1200);
assert.equal(busbarAmpacity.maximumTemperatureC, 105);
assert.equal(busbarAmpacity.permittedTemperatureRiseK, 70);
assert.equal(busbarAmpacity.internalAmbientTemperatureC, 50);
assert.equal(busbarAmpacity.effectiveTemperatureRiseK, 55);
assert.equal(busbarAmpacity.dinMatch.spec, '120 x 10');
assert.equal(busbarAmpacity.dinCurrentA, 1740);
assert.ok(Math.abs(busbarAmpacity.dinDifferencePercent - 0.08336755224606929) < 1e-12);
assert.ok(busbarAmpacity.estimatedOperatingTemperatureC > busbarAmpacity.internalAmbientTemperatureC);
assert.ok(busbarAmpacity.estimatedOperatingTemperatureC < busbarAmpacity.maximumTemperatureC);
const busbarAmpacityCoated = calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, dinReferenceField: 'coatedCurrentA' });
assert.equal(busbarAmpacityCoated.dinCurrentA, 2110);
const busbarAmpacityAc = calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, currentType: 'ac', acResistanceFactor: 4 });
assert.ok(Math.abs(busbarAmpacityAc.thermalBalanceCurrentA - busbarAmpacity.thermalBalanceCurrentA / 2) < 1e-9);
assert.equal(busbarAmpacityAc.requiresAcVerification, false);
assert.equal(calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, currentType: 'ac', acResistanceFactor: 1 }).requiresAcVerification, true);
assert.match(calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, widthMm: 0 }).error, /宽度/);
assert.match(calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, widthMm: 5, thicknessMm: 10 }).error, /输入顺序/);
assert.match(calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, permittedTemperatureRiseK: 15 }).error, /必须高于/);
assert.match(calculateBusbarAmpacity(busbarCatalog, { ...busbarAmpacityInput, emissivity: 1.1 }).error, /发射率/);

const reviewedTinBusbar = calculateBusbarAmpacity(busbarCatalog, {
  ...busbarAmpacityInput,
  widthMm: 40,
  thicknessMm: 6,
  convectionModel: 'din-calibrated',
  emissivity: 0.05,
  radiationViewFactor: 0.8,
  resistivity20OhmM: 1.7241e-8,
  designFactor: 0.8
});
assert.ok(Math.abs(reviewedTinBusbar.thermalBalanceCurrentA - 699.198097980867) < 1e-9);
assert.ok(Math.abs(reviewedTinBusbar.recommendedCurrentA - 559.3584783846936) < 1e-9);
assert.equal(reviewedTinBusbar.dinCurrentA, 528);
assert.ok(Math.abs(reviewedTinBusbar.dinNormalizedThermalCurrentA - 508.6757450358542) < 1e-9);
assert.ok(Math.abs(reviewedTinBusbar.dinDifferencePercent - (-0.03659896773512461)) < 1e-12);
assert.ok(Math.abs(reviewedTinBusbar.dinReferenceConvectionCoefficient - 7.6190233112694665) < 1e-12);
assert.ok(reviewedTinBusbar.convectionCoefficient > reviewedTinBusbar.dinReferenceConvectionCoefficient);

const dinNormalizedBusbar = calculateBusbarAmpacity(busbarCatalog, {
  ...reviewedTinBusbar,
  widthMm: 40,
  thicknessMm: 6,
  roomTemperatureC: 35,
  permittedTemperatureRiseK: 30,
  internalTemperatureRiseC: 0,
  convectionModel: 'din-calibrated',
  emissivity: 0.12,
  radiationViewFactor: 1,
  designFactor: 1
});
assert.ok(Math.abs(dinNormalizedBusbar.thermalBalanceCurrentA - 528) < 1e-9);
assert.equal(dinNormalizedBusbar.dinDifferencePercent, 0);

const customBusbarFallback = calculateBusbarAmpacity(busbarCatalog, {
  ...reviewedTinBusbar,
  widthMm: 37,
  thicknessMm: 6,
  convectionModel: 'din-calibrated'
});
assert.equal(customBusbarFallback.convectionModel, 'natural-correlation');
assert.equal(customBusbarFallback.convectionFallback, true);
assert.ok(customBusbarFallback.rayleighNumber > 0);

const cableCatalog = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'cable-catalog.json'), 'utf8'));
assert.equal(cableCatalog.length, 224);
assert.deepEqual(CABLE_AIR_SPACING_FACTORS['S=d'], { 1: 1, 2: 0.9, 3: 0.85, 4: 0.82, 5: 0.81, 6: 0.8 });
assert.deepEqual(CABLE_AIR_SPACING_FACTORS['S=2d'], { 1: 1, 2: 1, 3: 0.98, 4: 0.95, 5: 0.93, 6: 0.9 });
assert.deepEqual(CABLE_AIR_SPACING_FACTORS['S=3d'], { 1: 1, 2: 1, 3: 1, 4: 0.98, 5: 0.97, 6: 0.96 });
assert.deepEqual(CABLE_TRAY_LAYER_FACTORS, { 梯架: { 1: 0.8, 2: 0.65, 3: 0.55, 4: 0.5 }, 托盘: { 1: 0.7, 2: 0.55, 3: 0.5, 4: 0.45 } });
const cableCases = [
  [{ requiredCurrentA: 400, type: 'YJV、YJLV、YJY、YJLY型(铜芯)', coreCount: '单芯', ambientC: 35, parallelCount: 3, groupCount: 6, system: '交流', arrangement: '品字形', trayType: '梯架', stackedLayers: 1 }, 0.8, 35],
  [{ requiredCurrentA: 400, type: 'YJV、YJLV、YJY、YJLY型(铜芯)', coreCount: '三芯/五芯', ambientC: 35, parallelCount: 2, groupCount: 2, system: '交流', arrangement: '不考虑', trayType: '梯架', stackedLayers: 1 }, 0.9, 70],
  [{ requiredCurrentA: 100, type: 'BV、BVR型(铜芯)', coreCount: '单芯', ambientC: 30, parallelCount: 1, groupCount: 1, system: '交流', arrangement: '不考虑', trayType: '梯架', stackedLayers: 1 }, 0.8, 25],
  [{ requiredCurrentA: 800, type: 'YJV、YJLV、YJY、YJLY型(铜芯)', coreCount: '单芯', ambientC: 40, parallelCount: 4, groupCount: 1, system: '交流', arrangement: '水平形', trayType: '托盘', stackedLayers: 3 }, 0.5, 185]
];
for (const [input, expectedFactor, expectedSize] of cableCases) {
  const result = calculateCableSelection(cableCatalog, input);
  assert.equal(result.correctionFactor, expectedFactor);
  assert.equal(result.selected.size, expectedSize);
  assert.ok(result.correctedCurrentA >= input.requiredCurrentA);
}
assert.match(calculateCableSelection(cableCatalog, { requiredCurrentA: 0 }).error, /大于 0A/);
assert.equal(calculateCableSelection(cableCatalog, { requiredCurrentA: 1601 }).useBusway, true);

for (const filename of ['busbar-catalog.json', 'cable-catalog.json', 'awg-catalog.json']) {
  const file = path.join(root, 'src', 'data', filename);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(data.length >= 50, `${filename} 数据量不足`);
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('供应商价'));
  assert.ok(!serialized.includes('目录价'));
}

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(index, /const APP_VERSION = "v2\.6\.5"/);
assert.match(index, /数据中心电气设计与选型平台/);
assert.match(index, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
assert.match(index, /计算方法说明与 Excel 单元格对应关系/);
assert.match(index, /原表 J2 的 IFS 公式未定义 3C～4C 区间/);
const appShell = fs.readFileSync(path.join(root, 'src', 'platform', 'app-shell.js'), 'utf8');
assert.match(appShell, /navButton\('busbar'/);
assert.match(appShell, /按电流选铜排/);
assert.match(appShell, /按规格算载流量/);
assert.match(appShell, /id="calculate-busbar-ampacity"/);
assert.match(appShell, /新亮全镀锡（ε=0\.05，建议默认）/);
assert.match(appShell, /原 Excel 历史参数（状态未注明，ε=0\.35）/);
assert.match(appShell, /id="busbar-ampacity-rise-limit"/);
assert.match(appShell, /DIN同规格反校（推荐）/);
assert.match(appShell, /自然对流关联式（独立估算）/);
assert.match(appShell, /id="busbar-ampacity-view-factor"/);
assert.match(appShell, /id="busbar-ampacity-surface-factor"/);
assert.match(appShell, /35 \+ 70 = 105℃/);
assert.match(appShell, /50K 温升修正（通风 × 1\.3）/);
assert.match(appShell, /30K 温升基准（DIN 原值）/);
assert.doesNotMatch(appShell, />A03 修正口径/);
assert.match(appShell, /'bright-tin': '0\.05'/);
assert.match(appShell, /'conservative-tin': '0\.03'/);
assert.match(appShell, /100%（热平衡极限，不推荐）/);
assert.doesNotMatch(appShell, /value="heat-shrink"/);
assert.match(appShell, /GB\/T 24276-2025/);
assert.match(appShell, /navButton\('cable', '电缆选型'/);
assert.doesNotMatch(appShell, /conductor-catalog/);
assert.match(appShell, /电缆修正系数数据表/);
assert.match(appShell, /电缆数据库/);
assert.match(appShell, /中美线规对照表/);
assert.match(appShell, /id="cable-catalog-body"/);
assert.match(appShell, /id="awg-catalog-body"/);
assert.match(appShell, /platform-sidebar-control-text/);
assert.match(appShell, /data-sidebar-toggle/);
assert.match(appShell, /id="cable-group-count"/);
assert.match(appShell, /groupCount\.disabled = false/);
assert.doesNotMatch(appShell, /navButton\('delivery'/);
assert.doesNotMatch(appShell, /编码与成果输出/);
const toolRegistry = fs.readFileSync(path.join(root, 'src', 'platform', 'tool-registry.js'), 'utf8');
assert.doesNotMatch(toolRegistry, /id: 'delivery'/);
const platformCss = fs.readFileSync(path.join(root, 'src', 'css', 'platform-v2.css'), 'utf8');
assert.match(platformCss, /db-view-active \.platform-workspace \{ display: flex/);
assert.match(platformCss, /db-view-active \.footer \{ display: none/);

console.log('✅ v2 平台计算、数据脱敏与入口检查通过');
