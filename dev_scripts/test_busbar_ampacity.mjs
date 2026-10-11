import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateBusbarAmpacity, BUSBAR_ARTICLE_REFERENCE } from '../src/modules/engineering-calculators.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/busbar-catalog.json', import.meta.url)));
const input = {
  widthMm: 100, thicknessMm: 10, roomTemperatureC: 35,
  permittedTemperatureRiseK: 30, internalTemperatureRiseC: 0,
  emissivity: 0.4, radiationViewFactor: 1, exposedSurfaceFactor: 1,
  resistivity20OhmM: 1.7241e-8, temperatureCoefficient: 0.00393,
  currentType: 'dc', designFactor: 1
};
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const calc = overrides => calculateBusbarAmpacity(catalog, { ...input, ...overrides });
const base = calc({});
assert.equal(base.convectionModel, 'article-empirical');
assert.equal(base.characteristicLengthMm, 100);
close(base.thermalBalanceCurrentA, 1672.8768166579669);
// Independent heat-balance checks: SI areas, kelvin radiation, and resistance.
const area = 0.1 * 0.01;
const surface = 2 * (0.1 + 0.01);
const rho = 1.7241e-8 * (1 + 0.00393 * 45);
const radiation = 0.4 * 5.670374419e-8 * surface * (338.15 ** 4 - 308.15 ** 4);
close(base.radiationLossWPerM, radiation);
close(base.thermalBalanceCurrentA ** 2 * rho / area, base.totalDissipationWPerM);
close(base.thermalBalanceCurrentA, Math.sqrt(base.combinedHeatTransferCoefficient * surface * 30 / (rho / area)));
close(calculateBusbarAmpacity([], input).thermalBalanceCurrentA, base.thermalBalanceCurrentA);
assert.equal(base.dinCurrentA, 1490);
assert.equal(calc({ dinReferenceField: 'coatedCurrentA' }).dinCurrentA, 1810);
assert.equal(BUSBAR_ARTICLE_REFERENCE.reportedCurrentA, 1762);
assert.equal(BUSBAR_ARTICLE_REFERENCE.characteristicLengthMm, 10);
assert.notEqual(base.thermalBalanceCurrentA, BUSBAR_ARTICLE_REFERENCE.reportedCurrentA);
const narrowLength = calc({ characteristicLengthMm: 10 });
assert.equal(narrowLength.characteristicLengthOverridden, true);
assert.ok(narrowLength.thermalBalanceCurrentA > base.thermalBalanceCurrentA);
close(calc({ characteristicLengthMm: '' }).thermalBalanceCurrentA, base.thermalBalanceCurrentA);
for (const characteristicLengthMm of [0, -1, NaN, 'bad', 10001]) {
  assert.match(calc({ characteristicLengthMm }).error, /特征长度/);
}
// Reducing emissivity, exposed area, view factor or increasing air temperature
// must not increase the admissible current.
for (const change of [{ emissivity: 0.05 }, { radiationViewFactor: 0.5 }, { exposedSurfaceFactor: 0.5 }, { internalTemperatureRiseC: 10 }]) {
  assert.ok(calc(change).thermalBalanceCurrentA < base.thermalBalanceCurrentA);
}
assert.ok(calc({ permittedTemperatureRiseK: 50 }).thermalBalanceCurrentA > base.thermalBalanceCurrentA);
close(calc({ currentType: 'ac', acResistanceFactor: 4 }).thermalBalanceCurrentA, base.thermalBalanceCurrentA / 2);
const margin = calc({ designFactor: 0.8 });
close(margin.recommendedCurrentA, base.thermalBalanceCurrentA * 0.8);
close(margin.dinNormalizedThermalCurrentA, base.dinNormalizedThermalCurrentA);
assert.ok(margin.estimatedOperatingTemperatureC > 35 && margin.estimatedOperatingTemperatureC < 65);
close(base.estimatedOperatingTemperatureC, 65);
assert.match(calc({ internalTemperatureRiseC: 30 }).error, /必须高于/);
for (const orientation of ['flat-horizontal', 'vertical-run']) {
  const r = calc({ orientation });
  assert.equal(r.convectionModel, 'natural-correlation');
  assert.equal(r.convectionFallbackReason, 'orientation');
  close(r.thermalBalanceCurrentA, calc({ orientation, convectionModel: 'natural-correlation' }).thermalBalanceCurrentA);
}
const calibrated = calc({ convectionModel: 'din-calibrated' });
close(calibrated.thermalBalanceCurrentA, 1490);
assert.equal(calibrated.dinReferenceBareEmissivity, 0.4);
assert.equal(calc({ convectionModel: 'din-calibrated', widthMm: 37 }).convectionFallbackReason, 'catalog');
assert.match(calc({ dinReferenceEmissivity: 1.1 }).error, /反校参考发射率/);
// A hotter project case is compared at the reference temperature, not directly.
const project = calc({ permittedTemperatureRiseK: 70, internalTemperatureRiseC: 15 });
assert.equal(project.effectiveTemperatureRiseK, 55);
close(project.dinNormalizedThermalCurrentA, base.thermalBalanceCurrentA);
console.log('Busbar ampacity: article model, heat balance, source distinctions, fallback and boundary checks passed.');

// Exercise the actual view functions with form defaults parsed from its markup.
// This tests event logic/rendering without requiring a live browser connection.
const shell = fs.readFileSync(new URL('../src/platform/app-shell.js', import.meta.url), 'utf8');
const elements = new Map();
for (const match of shell.matchAll(/<(input|select)\b([^>]*\bid="(busbar-ampacity-[^"]+)"[^>]*)>([\s\S]*?)(?:<\/select>|(?=<))/g)) {
  const [, tag, attributes, id, content] = match;
  let value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
  const options = [...content.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
  const selected = options.find(m => /\bselected\b/.test(m[1])) || options[0];
  if (tag === 'select') value = selected?.[1].match(/\bvalue="([^"]*)"/)?.[1] || '';
  elements.set(id, { value, disabled: /\bdisabled\b/.test(attributes), selectedOptions: [{ textContent: selected?.[2] || '' }] });
}
elements.set('busbar-ampacity-result', { innerHTML: '' });
const context = vm.createContext({
  document: { getElementById: id => elements.get(id) },
  state: { catalogs: { busbars: catalog }, project: { busbars: {} } },
  calculateBusbarAmpacity
});
const functionSlice = (start, end) => shell.slice(shell.indexOf(`function ${start}`), shell.indexOf(`function ${end}`));
vm.runInContext(functionSlice('htmlEscape', 'statusLabel') + shell.slice(shell.indexOf('function resultCards'), shell.indexOf('async function loadCatalogs'))
  + functionSlice('syncBusbarAmpacityControls', 'quickBuswayInput'), context);
vm.runInContext('loadBusbarArticleExample()', context);
close(context.state.project.busbars.ampacityCalculation.thermalBalanceCurrentA, base.thermalBalanceCurrentA);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /综合散热系数 Kt/);
assert.equal(elements.get('busbar-ampacity-maximum-temperature').value, '65');
assert.equal(elements.get('busbar-ampacity-emissivity').value, '0.4');
assert.equal(elements.get('busbar-ampacity-characteristic-length').disabled, false);
elements.get('busbar-ampacity-convection-model').value = 'din-calibrated';
vm.runInContext('syncBusbarAmpacityControls(); calculateBusbarAmpacityResult()', context);
assert.equal(elements.get('busbar-ampacity-din-emissivity').disabled, false);
assert.equal(elements.get('busbar-ampacity-characteristic-length').disabled, true);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /不构成独立验证/);
elements.get('busbar-ampacity-convection-model').value = 'article-empirical';
elements.get('busbar-ampacity-orientation').value = 'flat-horizontal';
vm.runInContext('syncBusbarAmpacityControls(); calculateBusbarAmpacityResult()', context);
assert.equal(context.state.project.busbars.ampacityCalculation.convectionFallbackReason, 'orientation');
assert.equal(elements.get('busbar-ampacity-characteristic-length').disabled, true);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /当前安装方向不适用/);
elements.get('busbar-ampacity-internal-rise').value = '30';
vm.runInContext('calculateBusbarAmpacityResult()', context);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /必须高于/);
console.log('Busbar form: example action, parameter availability, fallback notices and error rendering passed (simulated DOM).');
