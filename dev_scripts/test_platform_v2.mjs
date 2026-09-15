import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CABLE_AIR_SPACING_FACTORS,
  CABLE_TRAY_LAYER_FACTORS,
  calculateApf,
  calculateBranch,
  calculateBusbarSelection,
  calculateCableSelection,
  calculateBusway,
  calculateLoadSummary,
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
assert.ok(Math.abs(apf.harmonicCurrentA - 436.58) < 0.1);
assert.equal(apf.recommendedA, 450);

const svg = calculateSvg({ activePowerKw: 800, currentPowerFactor: 0.8, targetPowerFactor: 0.95 });
assert.ok(Math.abs(svg.compensationKvar - 337.05) < 0.1);
assert.equal(svg.recommendedKvar, 350);

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
  surfaceTreatment: 'bare-or-tinned',
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
  surfaceTreatment: 'bare-or-tinned',
  temperatureRise: 'iec50'
}).totalFactor, 1);
assert.equal(calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 2400,
  installationEnvironment: 'sealed',
  surfaceTreatment: 'bare-or-tinned',
  temperatureRise: 'din30'
}).selected.configuration, '双拼');
const largeBusbar = calculateBusbarSelection(busbarCatalog, {
  loadCurrentA: 4000,
  installationEnvironment: 'ventilated',
  surfaceTreatment: 'bare-or-tinned',
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
assert.match(index, /const APP_VERSION = "v2\.4\.0"/);
assert.match(index, /数据中心电气设计与选型平台/);
assert.match(index, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
const appShell = fs.readFileSync(path.join(root, 'src', 'platform', 'app-shell.js'), 'utf8');
assert.match(appShell, /navButton\('busbar'/);
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
