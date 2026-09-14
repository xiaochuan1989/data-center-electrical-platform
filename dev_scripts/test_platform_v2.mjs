import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateApf,
  calculateBranch,
  calculateBusbarSelection,
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
assert.match(calculateBusbarSelection(busbarCatalog, { loadCurrentA: 0 }).error, /大于 0A/);

for (const filename of ['busbar-catalog.json', 'conductor-catalog.json', 'cable-catalog.json']) {
  const file = path.join(root, 'src', 'data', filename);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(data.length > 50, `${filename} 数据量不足`);
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('供应商价'));
  assert.ok(!serialized.includes('目录价'));
}

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(index, /const APP_VERSION = "v2\.1\.1"/);
assert.match(index, /数据中心电气设计与选型平台/);
assert.match(index, /<script type="module" src="\.\/src\/main\.js"><\/script>/);
const appShell = fs.readFileSync(path.join(root, 'src', 'platform', 'app-shell.js'), 'utf8');
assert.match(appShell, /navButton\('busbar'/);
assert.match(appShell, /platform-sidebar-control-text/);
assert.match(appShell, /data-sidebar-toggle/);

console.log('✅ v2 平台计算、数据脱敏与入口检查通过');
