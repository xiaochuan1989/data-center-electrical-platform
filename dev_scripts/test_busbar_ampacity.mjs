import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { calculateBusbarAmpacity, calculateBusbarArticleExample, BUSBAR_ARTICLE_REFERENCE } from '../src/modules/engineering-calculators.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/busbar-catalog.json', import.meta.url)));
const input = {
  widthMm: 100, thicknessMm: 10, roomTemperatureC: 35,
  permittedTemperatureRiseK: 30, internalTemperatureRiseC: 0,
  convectionModel: 'article-empirical',
  emissivity: 0.4, radiationViewFactor: 1, exposedSurfaceFactor: 1,
  resistivity20OhmM: 1.7241e-8, temperatureCoefficient: 0.00393,
  currentType: 'dc', designFactor: 1
};
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const calc = overrides => calculateBusbarAmpacity(catalog, { ...input, ...overrides });
const base = calc({});
const article = calculateBusbarArticleExample();
close(article.numerator, 0.0649935);
close(article.fullPrecisionCurrentA, 1763.4445957004896);
close(article.articleCalculationCurrentA, 1762.1756887140218);
assert.equal(Math.round(article.articleCalculationCurrentA), article.reportedCurrentA);
assert.equal(article.resistivityOhmM, 2.09e-8);
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

// Independent guide §2.2.1.1 example: two 100mm vertical faces and two 10mm
// horizontal faces, per metre. This verifies the guide's mm unit convention.
const guide = calc({ convectionModel: 'guide-natural', emissivity: 0.3 });
const guideConvection = 0.2 * 7.66 * 30 ** 1.25 / 100 ** 0.25
  + 0.02 * 5.92 * 30 ** 1.25 / 10 ** 0.25;
close(guide.convectionLossWPerM, guideConvection);
close(guide.radiationLossWPerM, radiation * 0.3 / 0.4);
close(guide.thermalBalanceCurrentA ** 2 * rho / area, guideConvection + radiation * 0.3 / 0.4);
assert.equal(guide.convectionFaces.length, 2);
assert.deepEqual(guide.convectionFaces.map(face => face.lengthMm), [100, 10]);
const flatGuide = calc({ convectionModel: 'guide-natural', orientation: 'flat-horizontal' });
close(flatGuide.convectionLossWPerM, 0.2 * 5.92 * 30 ** 1.25 / 100 ** 0.25
  + 0.02 * 7.66 * 30 ** 1.25 / 10 ** 0.25);
assert.ok(flatGuide.convectionLossWPerM < guide.convectionLossWPerM);
const verticalGuide = calc({ convectionModel: 'guide-natural', orientation: 'vertical-run', verticalLengthMm: 1000 });
close(verticalGuide.convectionLossWPerM, 0.22 * 7.66 * 30 ** 1.25 / 1000 ** 0.25);
assert.ok(calc({ convectionModel: 'guide-natural', orientation: 'vertical-run', verticalLengthMm: 2000 }).thermalBalanceCurrentA < verticalGuide.thermalBalanceCurrentA);
close(calc({ convectionModel: undefined, emissivity: 0.3 }).thermalBalanceCurrentA, guide.thermalBalanceCurrentA);
const reflectiveWall = calc({ convectionModel: 'guide-natural', emissivity: 0.3, surroundingsEmissivity: 0.1 });
close(reflectiveWall.relativeEmissivity, 0.03 / 0.37);
assert.ok(reflectiveWall.thermalBalanceCurrentA < guide.thermalBalanceCurrentA);
const warmWall = calc({ convectionModel: 'guide-natural', emissivity: 0.3, radiationEnvironmentTemperatureC: 60, designFactor: 0.8 });
assert.ok(warmWall.thermalBalanceCurrentA < guide.thermalBalanceCurrentA);
assert.ok(warmWall.estimatedOperatingTemperatureC < 65);
const wallAtCopperTemperature = calc({ convectionModel: 'guide-natural', radiationEnvironmentTemperatureC: 65 });
close(wallAtCopperTemperature.radiationLossWPerM, 0);
assert.ok(calc({ convectionModel: 'guide-natural', radiationEnvironmentTemperatureC: 70 }).radiationLossWPerM < 0);
assert.match(calc({ convectionModel: 'guide-natural', radiationEnvironmentTemperatureC: 250 }).error, /净散热/);
assert.match(calc({ surroundingsEmissivity: 0 }).error, /周围表面发射率/);
assert.match(calc({ radiationEnvironmentTemperatureC: 'bad' }).error, /辐射环境/);
assert.match(calc({ convectionModel: 'guide-natural', orientation: 'vertical-run', verticalLengthMm: 0 }).error, /竖直散热长度/);
const coldWall = calc({ convectionModel: 'guide-natural', radiationEnvironmentTemperatureC: 10, designFactor: 0.8 });
assert.ok(coldWall.estimatedOperatingTemperatureC > 10 && coldWall.estimatedOperatingTemperatureC < 65);
const guideMargin = calc({ convectionModel: 'guide-natural', emissivity: 0.3, designFactor: 0.8 });
close(guideMargin.recommendedCurrentA, guide.thermalBalanceCurrentA * 0.8);
close(calc({ convectionModel: 'guide-natural', emissivity: 0.3, currentType: 'ac', acResistanceFactor: 4 }).thermalBalanceCurrentA, guide.thermalBalanceCurrentA / 2);
for (const r of [guideMargin, warmWall, coldWall]) {
  const t = r.estimatedOperatingTemperatureC;
  const delta = t - r.internalAmbientTemperatureC;
  const conv = (0.2 * 7.66 / 100 ** 0.25 + 0.02 * 5.92 / 10 ** 0.25)
    * Math.sign(delta) * Math.abs(delta) ** 1.25;
  const rad = r.relativeEmissivity * r.radiationViewFactor * 5.670374419e-8 * 0.22
    * ((t + 273.15) ** 4 - (r.radiationEnvironmentTemperatureC + 273.15) ** 4);
  const resistance = 1.7241e-8 * (1 + 0.00393 * (t - 20)) / 0.001;
  close(conv + rad, r.recommendedCurrentA ** 2 * resistance, 1e-8);
}
const hotProject = calc({ convectionModel: 'guide-natural', permittedTemperatureRiseK: 70, radiationEnvironmentTemperatureC: 120 });
assert.equal(hotProject.dinNormalizedThermalCurrentA, null);
assert.equal(hotProject.dinDifferencePercent, null);
console.log('Guide: face areas/orientation, mm units, wall radiation, length, heat balance and boundaries passed.');

// Exercise the actual view functions with form defaults parsed from its markup.
// This tests event logic/rendering without requiring a live browser connection.
const shell = fs.readFileSync(new URL('../src/platform/app-shell.js', import.meta.url), 'utf8');
const elements = new Map();
for (const match of shell.matchAll(/<(select)\b([^>]*\bid="(busbar-ampacity-[^"]+)"[^>]*)>([\s\S]*?)<\/select>|<(input)\b([^>]*\bid="(busbar-ampacity-[^"]+)"[^>]*)>/g)) {
  const [, selectTag, selectAttributes, selectId, selectContent, inputTag, inputAttributes, inputId] = match;
  const tag = selectTag || inputTag, attributes = selectAttributes || inputAttributes;
  const id = selectId || inputId, content = selectContent || '';
  let value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || '';
  const options = [...content.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
  const selected = options.find(m => /\bselected\b/.test(m[1])) || options[0];
  if (tag === 'select') value = selected?.[1].match(/\bvalue="([^"]*)"/)?.[1] || '';
  elements.set(id, { value, disabled: /\bdisabled\b/.test(attributes), selectedOptions: [{ textContent: selected?.[2] || '' }] });
}
elements.set('busbar-ampacity-result', { innerHTML: '' });
elements.set('busbar-article-reference-result', { innerHTML: '', hidden: true });
elements.set('busbar-ampacity-temperature-note', { textContent: '' });
const context = vm.createContext({
  document: { getElementById: id => elements.get(id) },
  state: { catalogs: { busbars: catalog }, project: { busbars: {} } },
  calculateBusbarAmpacity, calculateBusbarArticleExample
});
const functionSlice = (start, end) => shell.slice(shell.indexOf(`function ${start}`), shell.indexOf(`function ${end}`));
vm.runInContext(functionSlice('htmlEscape', 'statusLabel') + shell.slice(shell.indexOf('function resultCards'), shell.indexOf('async function loadCatalogs'))
  + functionSlice('syncBusbarAmpacityControls', 'quickBuswayInput'), context);
const previousInputs = [...elements].map(([id, el]) => [id, el.value]);
assert.equal(elements.get('busbar-ampacity-convection-model').value, 'guide-natural');
assert.equal(elements.get('busbar-ampacity-surface-mode').value, 'guide-bright');
vm.runInContext('showBusbarArticleExample()', context);
assert.equal(elements.get('busbar-article-reference-result').hidden, false);
assert.match(elements.get('busbar-article-reference-result').innerHTML, /1,762\.18/);
assert.match(elements.get('busbar-article-reference-result').innerHTML, /1,763\.44/);
assert.deepEqual([...elements].map(([id, el]) => [id, el.value]), previousInputs);
assert.equal(context.state.project.busbars.ampacityCalculation, undefined);
vm.runInContext('loadBusbarGuideExample()', context);
close(context.state.project.busbars.ampacityCalculation.thermalBalanceCurrentA, guide.thermalBalanceCurrentA);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /指南各表面对流散热/);
assert.equal(elements.get('busbar-ampacity-emissivity').value, '0.3');
assert.equal(elements.get('busbar-ampacity-characteristic-length').disabled, true);
elements.get('busbar-ampacity-orientation').value = 'vertical-run';
vm.runInContext('syncBusbarAmpacityControls()', context);
assert.equal(elements.get('busbar-ampacity-vertical-length').disabled, false);
elements.get('busbar-ampacity-radiation-temperature').value = '65';
elements.get('busbar-ampacity-surroundings-emissivity').value = '0.1';
vm.runInContext('calculateBusbarAmpacityResult()', context);
close(context.state.project.busbars.ampacityCalculation.radiationLossWPerM, 0);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /周围表面65℃/);
vm.runInContext('loadBusbarEngineeringExample()', context);
close(context.state.project.busbars.ampacityCalculation.thermalBalanceCurrentA, base.thermalBalanceCurrentA);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /综合散热系数 Kt/);
assert.equal(elements.get('busbar-ampacity-maximum-temperature').value, '65');
assert.equal(elements.get('busbar-ampacity-emissivity').value, '0.4');
assert.equal(elements.get('busbar-ampacity-characteristic-length').disabled, false);
assert.match(elements.get('busbar-ampacity-temperature-note').textContent, /35 \+ 30 = 65℃/);
assert.match(elements.get('busbar-ampacity-result').innerHTML, /不作为误差比较/);
assert.doesNotMatch(elements.get('busbar-ampacity-result').innerHTML, /同条件差异|高于DIN|低于DIN/);
elements.get('busbar-ampacity-rise-limit').value = '65';
elements.get('busbar-ampacity-internal-rise').value = '15';
vm.runInContext('syncBusbarAmpacityControls()', context);
assert.match(elements.get('busbar-ampacity-temperature-note').textContent, /35 \+ 65 = 100℃/);
assert.match(elements.get('busbar-ampacity-temperature-note').textContent, /100 − 50 = 50K/);
vm.runInContext('loadBusbarEngineeringExample()', context);
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
