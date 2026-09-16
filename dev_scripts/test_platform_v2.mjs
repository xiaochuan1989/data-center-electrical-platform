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
  calculateSmartBuswayBranch,
  calculateSmartBuswayDesign,
  createSmartBuswayDesign,
  calculateSvg,
  nextStandard
} from '../src/modules/engineering-calculators.js';
import { createProject, normalizeProject } from '../src/platform/project-schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const blankProject = createProject('验收项目');
assert.equal(blankProject.schemaVersion, 2);
assert.equal(blankProject.name, '验收项目');
assert.deepEqual(normalizeProject({ name: '旧项目', legacy: null }).legacy, {});
const migratedProject = normalizeProject({ schemaVersion: 1, name: '旧母线项目', busbars: { smartBusway: { plugBoxes: 12 } } });
assert.equal(migratedProject.schemaVersion, 2);
assert.equal(migratedProject.busbars.smartBuswayDesign, null);
assert.equal(migratedProject.legacy.smartBuswayV1.plugBoxes, 12);

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

const smartDesign = createSmartBuswayDesign({
  row1: { cabinets600: 2, cabinets800: 1, ac300: 1, ac600: 0 },
  row2: { cabinets600: 1, cabinets800: 0, ac300: 0, ac600: 1 },
  defaultPowerKw: 10,
  touchscreen: false
});
assert.equal(smartDesign.rows[0].items.filter(item => item.kind === 'rack').length, 3);
assert.equal(smartDesign.rows[0].items[2].kind, 'ac');
assert.equal(calculateSmartBuswayBranch({ powerKw: 0, phase: 'single' }).breakerA, 16);
assert.equal(calculateSmartBuswayBranch({ powerKw: '', phase: 'three' }).baseCurrentA, 0);
assert.equal(calculateSmartBuswayBranch({ powerKw: 10, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25 }).breakerA, 20);
assert.equal(calculateSmartBuswayBranch({ powerKw: 8, phase: 'single', powerFactor: 0.95, safetyFactor: 1.25 }).warning.includes('建议采用三相'), true);
assert.equal(calculateSmartBuswayBranch({ powerKw: 25, phase: 'single', powerFactor: 0.95, safetyFactor: 1.25 }).breakerA, null);

const smartResult = calculateSmartBuswayDesign(smartDesign);
assert.equal(smartResult.paths.length, 2);
assert.equal(smartResult.paths[0].normalPowerKw, 20);
assert.equal(smartResult.paths[0].failurePowerKw, 40);
assert.equal(smartResult.paths[0].ratedCurrentA, 160);
assert.equal(smartResult.design.rows[0].exactLengthM, 2.3);
assert.equal(smartResult.design.rows[0].orderLengthM, 3);
assert.equal(smartResult.accessories.startBoxes, 4);
assert.equal(smartResult.neutralRecommendation, '100% N');
assert.ok(smartResult.bom.some(item => item.code === 'IPL-160-T2-1'));
assert.equal(smartResult.bom.filter(item => item.code === 'IPL-160-T2-1').length, 2);
assert.deepEqual(smartResult.bom.filter(item => item.code === 'IPL-160-T2-1').map(item => item.path).sort(), ['A', 'B']);
assert.ok(smartResult.bom.every(item => !('price' in item)));

const boundaryDesign = createSmartBuswayDesign({ row1: {}, row2: {}, defaultPowerKw: 1 });
boundaryDesign.rows[0].items = [{ id: 'edge', kind: 'rack', name: '边界机柜', widthMm: 600, powerKw: 600, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: 'AB' }];
const overLimit = calculateSmartBuswayDesign({ ...boundaryDesign, demandFactor: 1, safetyFactor: 1, harmonicFactor: 1 });
assert.equal(overLimit.paths[0].configurable, false);
assert.equal(overLimit.bomBlocked, true);
assert.deepEqual(overLimit.bom, []);
assert.match(overLimit.warnings.join('\n'), /超过 800A/);

const asymmetric = createSmartBuswayDesign({ row1: { cabinets600: 1 }, row2: { cabinets800: 2 }, defaultPowerKw: 5, harmonicFactor: 0.85 });
const asymmetricResult = calculateSmartBuswayDesign(asymmetric);
assert.equal(asymmetricResult.design.rows[0].exactLengthM, 0.6);
assert.equal(asymmetricResult.design.rows[1].exactLengthM, 1.6);
assert.equal(asymmetricResult.accessories.buswayLengthM, 6);
assert.equal(asymmetricResult.neutralRecommendation, '200% N');
assert.equal(calculateSmartBuswayDesign(createSmartBuswayDesign({ topology: 'single', row1: { cabinets600: 1 }, row2: {} })).paths.length, 1);

function smartBuswayAtCurrent(currentA) {
  const design = createSmartBuswayDesign({ row1: {}, row2: {}, defaultPowerKw: 1, powerFactor: 0.95 });
  design.rows[0].items = [{ id: `edge-${currentA}`, kind: 'rack', name: '边界柜', widthMm: 600, powerKw: currentA * Math.sqrt(3) * 380 * 0.95 / 1000, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: 'AB' }];
  design.demandFactor = 1; design.safetyFactor = 1; design.harmonicFactor = 1;
  return calculateSmartBuswayDesign(design).paths[0];
}
assert.equal(smartBuswayAtCurrent(159).ratedCurrentA, 160);
assert.equal(smartBuswayAtCurrent(160).ratedCurrentA, 160);
assert.equal(smartBuswayAtCurrent(161).ratedCurrentA, 250);
assert.equal(smartBuswayAtCurrent(630).ratedCurrentA, 630);
assert.equal(smartBuswayAtCurrent(631).ratedCurrentA, 800);
assert.equal(smartBuswayAtCurrent(799).ratedCurrentA, 800);
assert.equal(smartBuswayAtCurrent(800).ratedCurrentA, 800);
assert.equal(smartBuswayAtCurrent(801).ratedCurrentA, null);

const feedDesign = createSmartBuswayDesign({ row1: {}, row2: {}, defaultPowerKw: 1 });
feedDesign.rows[0].items = [
  { id: 'a-only', kind: 'rack', name: 'A柜', widthMm: 600, powerKw: 10, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: 'A' },
  { id: 'b-only', kind: 'rack', name: 'B柜', widthMm: 600, powerKw: 20, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: 'B' },
  { id: 'ab', kind: 'rack', name: '双路柜', widthMm: 600, powerKw: 30, phase: 'three', powerFactor: 0.95, safetyFactor: 1.25, feed: 'AB' }
];
const feedResult = calculateSmartBuswayDesign(feedDesign);
assert.equal(feedResult.paths[0].normalPowerKw, 25);
assert.equal(feedResult.paths[1].normalPowerKw, 35);
assert.equal(feedResult.paths[0].failurePowerKw, 40);
assert.equal(feedResult.paths[1].failurePowerKw, 50);

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
const smartCatalog = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'smart-busway-catalog.json'), 'utf8'));
assert.deepEqual(smartCatalog.busways.map(item => item.ratedCurrentA), [160, 250, 400, 630, 800]);
assert.equal(smartCatalog.terminalBoxes.at(-1).code, 'IPL-TB800');
assert.ok(smartCatalog.plugBoxes.some(item => item.code === 'IPL-DB-63T-2'));
assert.doesNotMatch(JSON.stringify(smartCatalog), /价格|price/i);

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
assert.match(appShell, /navButton\('busway', '智能母线'/);
assert.match(appShell, /智能母线设计/);
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
