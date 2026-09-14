const SQRT3 = Math.sqrt(3);

export const BREAKER_STANDARDS = [16, 20, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
export const BUSWAY_STANDARDS = [160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
export const TRANSFORMER_STANDARDS = [100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150];
export const BUSBAR_CONFIGURATION_PRIORITY = ['单片', '双拼', '三拼', '四拼'];
export const CABLE_AIR_GROUP_FACTORS = { 1: 1, 2: 0.9, 3: 0.85, 4: 0.82, 5: 0.81, 6: 0.8 };
export const CABLE_TRAY_LAYER_FACTORS = {
  梯架: { 1: 0.8, 2: 0.65, 3: 0.55, 4: 0.5 },
  托盘: { 1: 0.7, 2: 0.55, 3: 0.5, 4: 0.45 }
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, number(value, min)));
}

export function nextStandard(value, standards) {
  const target = number(value);
  return standards.find(item => item >= target) ?? null;
}

export function calculateLoadSummary(rows, options = {}) {
  const voltage = number(options.voltage, 380);
  const safety = number(options.safety, 1.2);
  const transformerLoadRate = clamp(options.transformerLoadRate ?? 0.8, 0.1, 1);
  const normalized = rows.map((row, index) => {
    const quantity = Math.max(0, number(row.quantity, 1));
    const unitPowerKw = Math.max(0, number(row.unitPowerKw));
    const demandFactor = clamp(row.demandFactor ?? 1, 0, 1);
    const powerFactor = clamp(row.powerFactor ?? 0.9, 0.01, 1);
    const activePowerKw = quantity * unitPowerKw * demandFactor;
    const reactivePowerKvar = activePowerKw * Math.tan(Math.acos(powerFactor));
    return { ...row, index, quantity, unitPowerKw, demandFactor, powerFactor, activePowerKw, reactivePowerKvar };
  });
  const activePowerKw = normalized.reduce((sum, row) => sum + row.activePowerKw, 0);
  const reactivePowerKvar = normalized.reduce((sum, row) => sum + row.reactivePowerKvar, 0);
  const apparentPowerKva = Math.hypot(activePowerKw, reactivePowerKvar);
  const currentA = voltage > 0 ? apparentPowerKva * 1000 / (SQRT3 * voltage) : 0;
  const designCurrentA = currentA * safety;
  const transformerRequiredKva = apparentPowerKva / transformerLoadRate;
  return {
    rows: normalized,
    activePowerKw,
    reactivePowerKvar,
    apparentPowerKva,
    currentA,
    designCurrentA,
    breakerA: nextStandard(designCurrentA, BREAKER_STANDARDS),
    transformerRequiredKva,
    transformerKva: nextStandard(transformerRequiredKva, TRANSFORMER_STANDARDS),
    voltage,
    safety,
    transformerLoadRate
  };
}

export function calculateBranch({ powerKw, phase = 'three', voltage = 380, powerFactor = 0.9, safety = 1.2 }) {
  const p = Math.max(0, number(powerKw));
  const pf = clamp(powerFactor, 0.01, 1);
  const u = Math.max(1, number(voltage, phase === 'single' ? 220 : 380));
  const baseCurrentA = phase === 'single' ? p * 1000 / (u * pf) : p * 1000 / (SQRT3 * u * pf);
  const designCurrentA = baseCurrentA * number(safety, 1.2);
  return { baseCurrentA, designCurrentA, breakerA: nextStandard(designCurrentA, BREAKER_STANDARDS) };
}

export function calculateBusway({ activePowerKw, voltage = 380, powerFactor = 0.9, demandFactor = 1, safety = 1.2, harmonicFactor = 1 }) {
  const p = Math.max(0, number(activePowerKw));
  const u = Math.max(1, number(voltage, 380));
  const pf = clamp(powerFactor, 0.01, 1);
  const currentA = p * clamp(demandFactor, 0, 1) * 1000 / (SQRT3 * u * pf);
  const designCurrentA = currentA * number(safety, 1.2) / Math.max(0.01, number(harmonicFactor, 1));
  return { currentA, designCurrentA, buswayA: nextStandard(designCurrentA, BUSWAY_STANDARDS) };
}

export function calculateApf({ transformerKva, loadRate = 0.8, thdi = 0.3, voltage = 380 }) {
  const s = Math.max(0, number(transformerKva));
  const k = clamp(loadRate, 0, 1);
  const td = Math.max(0, number(thdi));
  const u = Math.max(1, number(voltage, 380));
  const harmonicCurrentA = s * k * td * 1000 / (u * SQRT3 * Math.sqrt(1 + td * td));
  return { harmonicCurrentA, recommendedA: Math.ceil(harmonicCurrentA / 25) * 25 };
}

export function calculateSvg({ activePowerKw, currentPowerFactor = 0.8, targetPowerFactor = 0.95 }) {
  const p = Math.max(0, number(activePowerKw));
  const before = clamp(currentPowerFactor, 0.01, 1);
  const target = clamp(targetPowerFactor, before, 1);
  const compensationKvar = Math.max(0, p * (Math.tan(Math.acos(before)) - Math.tan(Math.acos(target))));
  return { compensationKvar, recommendedKvar: Math.ceil(compensationKvar / 25) * 25 };
}

export function calculateSmartBusway(input) {
  const rowLength = row => Math.ceil((600 * number(row?.cabinets600) + 800 * number(row?.cabinets800) + 300 * number(row?.ac300) + 600 * number(row?.ac600)) / 1000);
  const row1LengthM = rowLength(input.row1);
  const row2LengthM = rowLength(input.row2);
  const row1Cabinets = number(input.row1?.cabinets600) + number(input.row1?.cabinets800);
  const row2Cabinets = number(input.row2?.cabinets600) + number(input.row2?.cabinets800);
  const startBoxes = 4;
  const buswayLengthM = (row1LengthM + row2LengthM) * 2;
  const plugBoxes = (Math.ceil(row1Cabinets / 3) + Math.ceil(row2Cabinets / 3)) * 2;
  const fixingPieces = Math.ceil(row1Cabinets * 1.2) + Math.ceil(row2Cabinets * 1.2);
  return {
    row1LengthM,
    row2LengthM,
    startBoxes,
    buswayLengthM,
    plugBoxes,
    endCovers: startBoxes,
    dustCovers: Math.ceil(buswayLengthM * 0.7),
    fixingPieces,
    serialServer: input.touchscreen ? 0 : 1,
    touchscreen: input.touchscreen ? 1 : 0,
    supports: input.installation === 'cabinet-top' ? Math.ceil(fixingPieces / 2) + startBoxes : 0
  };
}

export function calculateBusbarSelection(catalog, input = {}) {
  const loadCurrentA = Math.max(0, number(input.loadCurrentA));
  if (loadCurrentA <= 0) return { error: '请输入大于 0A 的负载电流' };

  const installationEnvironment = input.installationEnvironment === 'sealed' ? 'sealed' : 'ventilated';
  const surfaceTreatment = input.surfaceTreatment === 'heat-shrink' ? 'heat-shrink' : 'bare-or-tinned';
  const temperatureRise = input.temperatureRise === 'din30' ? 'din30' : 'iec50';
  const totalFactor = temperatureRise === 'din30' || installationEnvironment === 'sealed' ? 1 : 1.3;
  const lookupCurrentA = loadCurrentA / totalFactor;
  const currentField = surfaceTreatment === 'heat-shrink' ? 'coatedCurrentA' : 'bareCurrentA';

  const selected = catalog
    .filter(item => number(item[currentField]) >= lookupCurrentA)
    .sort((a, b) => number(a[currentField]) - number(b[currentField]))[0] || null;

  let prioritySelected = null;
  for (const configuration of BUSBAR_CONFIGURATION_PRIORITY) {
    prioritySelected = catalog
      .filter(item => item.configuration === configuration && number(item[currentField]) >= lookupCurrentA)
      .sort((a, b) => number(a[currentField]) - number(b[currentField]) || number(a.areaMm2) - number(b.areaMm2))[0] || null;
    if (prioritySelected) break;
  }

  if (!selected) {
    return {
      error: '当前数据表中没有满足条件的规格',
      loadCurrentA,
      totalFactor,
      lookupCurrentA,
      currentField
    };
  }

  const ratedCurrentA = number(selected[currentField]);
  const areaMm2 = number(selected.areaMm2);
  const loadRate = ratedCurrentA > 0 ? loadCurrentA / (ratedCurrentA * totalFactor) : 0;
  const peAreaMm2 = areaMm2 <= 16 ? areaMm2 : areaMm2 <= 35 ? 16 : areaMm2 <= 800 ? areaMm2 / 2 : areaMm2 / 4;
  const loadWarning = loadRate > 1
    ? '危险：负载率超过 100%'
    : loadRate > 0.92
      ? '警告：负载率超过 92%'
      : '负载率处于合理范围';

  return {
    loadCurrentA,
    installationEnvironment,
    surfaceTreatment,
    temperatureRise,
    totalFactor,
    lookupCurrentA,
    currentField,
    selected,
    prioritySelected,
    ratedCurrentA,
    areaMm2,
    loadRate,
    peAreaMm2,
    loadWarning,
    isInterpolated: selected.note === '根据插入法计算',
    requiresShortCircuitCheck: loadCurrentA >= 4000
  };
}

export function calculateCableSelection(catalog, input = {}) {
  const requiredCurrentA = Math.max(0, number(input.requiredCurrentA));
  if (requiredCurrentA <= 0) return { error: '请输入大于 0A 的电流' };
  if (requiredCurrentA > 1600) {
    return { error: '电流超过工作簿的 1600A 适用上限，建议改用密集母线', requiredCurrentA, useBusway: true };
  }

  const type = input.type || 'YJV、YJLV、YJY、YJLY型(铜芯)';
  const system = input.system === '直流' ? '直流' : '交流';
  const coreCount = system === '直流' || type === 'BV、BVR型(铜芯)' ? '单芯' : (input.coreCount === '三芯/五芯' ? '三芯/五芯' : '单芯');
  const arrangement = type === 'YJV、YJLV、YJY、YJLY型(铜芯)' && coreCount === '单芯'
    ? (['品字形', '水平形'].includes(input.arrangement) ? input.arrangement : '不考虑')
    : '不考虑';
  const ambientC = [25, 30, 35, 40].includes(number(input.ambientC)) ? number(input.ambientC) : 35;
  const parallelCount = Math.round(clamp(input.parallelCount ?? 1, 1, 4));
  const groupCount = Math.round(clamp(input.groupCount ?? 1, 1, 6));
  const trayType = input.trayType === '托盘' ? '托盘' : '梯架';
  const stackedLayers = Math.round(clamp(input.stackedLayers ?? 1, 1, 4));
  const useAirGroupFactor = stackedLayers === 1 && (system === '直流' || (system === '交流' && coreCount === '三芯/五芯'));
  const correctionFactor = useAirGroupFactor
    ? CABLE_AIR_GROUP_FACTORS[groupCount]
    : CABLE_TRAY_LAYER_FACTORS[trayType][stackedLayers];

  const matches = catalog
    .filter(item => item.type === type
      && item.coreCount === coreCount
      && item.installation === '明敷'
      && number(item.ambientC) === ambientC
      && item.arrangement === arrangement)
    .map(item => ({
      ...item,
      correctedCurrentA: number(item.currentA) * correctionFactor * parallelCount
    }))
    .sort((a, b) => number(a.size) - number(b.size));
  const selected = matches.find(item => item.correctedCurrentA >= requiredCurrentA) || null;

  if (!selected) {
    const maximumCurrentA = matches.reduce((maximum, item) => Math.max(maximum, item.correctedCurrentA), 0);
    return {
      error: matches.length ? '当前组合没有满足电流的表列线径，请增加并联根数或调整敷设条件' : '当前组合在工作簿数据库中没有对应数据',
      requiredCurrentA,
      maximumCurrentA,
      correctionFactor,
      correctionMode: useAirGroupFactor ? '空气中单层多根并行' : '桥架多层无间距',
      useBusway: requiredCurrentA >= 1600
    };
  }

  return {
    requiredCurrentA,
    type,
    coreCount,
    installation: '明敷',
    ambientC,
    system,
    arrangement,
    parallelCount,
    groupCount,
    trayType,
    stackedLayers,
    correctionFactor,
    correctionMode: useAirGroupFactor ? '空气中单层多根并行' : '桥架多层无间距',
    selected,
    baseCurrentA: number(selected.currentA),
    correctedCurrentA: selected.correctedCurrentA,
    loadRate: requiredCurrentA / selected.correctedCurrentA,
    workingTemperatureC: type === 'BV、BVR型(铜芯)' ? 70 : 90
  };
}
