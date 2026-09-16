const SQRT3 = Math.sqrt(3);

export const BREAKER_STANDARDS = [16, 20, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
export const BUSWAY_STANDARDS = [160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
export const TRANSFORMER_STANDARDS = [100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150];
export const BUSBAR_CONFIGURATION_PRIORITY = ['单片', '双拼', '三拼', '四拼'];
export const CABLE_AIR_SPACING_FACTORS = {
  'S=d': { 1: 1, 2: 0.9, 3: 0.85, 4: 0.82, 5: 0.81, 6: 0.8 },
  'S=2d': { 1: 1, 2: 1, 3: 0.98, 4: 0.95, 5: 0.93, 6: 0.9 },
  'S=3d': { 1: 1, 2: 1, 3: 1, 4: 0.98, 5: 0.97, 6: 0.96 }
};
export const CABLE_AIR_GROUP_FACTORS = CABLE_AIR_SPACING_FACTORS['S=d'];
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

export function calculateApf({ transformerKva, loadRate = 0.8, thdi = 0.3, voltage = 380, safetyFactor = 1.25 }) {
  const s = Math.max(0, number(transformerKva));
  const k = clamp(loadRate, 0, 1);
  const td = Math.max(0, number(thdi));
  const u = Math.max(1, number(voltage, 380));
  const margin = Math.max(1, number(safetyFactor, 1.25));
  const totalCurrentA = s * k * 1000 / (u * SQRT3);
  const harmonicCurrentA = totalCurrentA * td;
  const designCurrentA = harmonicCurrentA * margin;
  return {
    transformerKva: s,
    loadRate: k,
    thdi: td,
    voltage: u,
    safetyFactor: margin,
    totalCurrentA,
    harmonicCurrentA,
    residualHarmonicCurrentA: harmonicCurrentA * 0.03,
    designCurrentA,
    recommendedA: Math.ceil(designCurrentA / 25) * 25
  };
}

export function calculateSvg({ activePowerKw, currentPowerFactor = 0.8, targetPowerFactor = 0.95, powerFactorType = 'lagging' }) {
  const p = Math.max(0, number(activePowerKw));
  const before = clamp(currentPowerFactor, 0.01, 1);
  const target = clamp(targetPowerFactor, before, 1);
  const qBefore = p * Math.tan(Math.acos(before));
  const qTarget = p * Math.tan(Math.acos(target));
  const isLeading = powerFactorType === 'leading';
  const compensationKvar = Math.max(0, isLeading ? qBefore + qTarget : qBefore - qTarget);
  return {
    activePowerKw: p,
    currentPowerFactor: before,
    targetPowerFactor: target,
    powerFactorType: isLeading ? 'leading' : 'lagging',
    initialReactiveKvar: isLeading ? -qBefore : qBefore,
    targetReactiveKvar: qTarget,
    compensationKvar,
    recommendedKvar: Math.ceil(compensationKvar / 25) * 25
  };
}

/**
 * 锂电池容量计算（逐项对应《锂电池-选型模板-A00.xlsx》“锂电池选型”第 2 行）。
 *
 * Excel 对应关系：
 * C2=L2/3.2；F2=IF(B2>100,0.95,0.93)；I2=1/H2；
 * J2=IFS(I2<=1,3.15,AND(I2>1,I2<=3),3.12,AND(I2>=4,I2<=6),3.05,I2>6,3.02)；
 * K2=IF(A2="",B2*E2*1000*H2/(F2*C2*D2*G2*J2),A2*1000*H2/(F2*C2*D2*G2*J2))。
 */
export function calculateLithiumBatteryA00(input = {}) {
  const loadText = input.loadPowerKw === undefined || input.loadPowerKw === null
    ? ''
    : String(input.loadPowerKw).trim();
  const hasLoadPower = loadText !== '';
  const loadPowerKw = hasLoadPower ? Number(loadText) : null;
  const upsPowerKva = Number(input.upsPowerKva);
  const nominalVoltageV = Number(input.nominalVoltageV);
  const groupCount = Number(input.groupCount);
  const powerFactor = Number(input.powerFactor);
  const dischargeTimeH = Number(input.dischargeTimeH);
  const batteryOutputEfficiency = Number(input.batteryOutputEfficiency);

  if (hasLoadPower && (!Number.isFinite(loadPowerKw) || loadPowerKw < 0)) {
    return { error: '负载功率必须为大于或等于 0 的数字，留空时按 UPS 容量计算' };
  }
  if (!Number.isFinite(upsPowerKva) || upsPowerKva <= 0) return { error: '请输入大于 0kVA 的 UPS 容量' };
  if (!Number.isFinite(nominalVoltageV) || nominalVoltageV <= 0) return { error: '请输入大于 0V 的标称电压' };
  if (!Number.isFinite(groupCount) || groupCount <= 0) return { error: '请选择有效的电池组数量' };
  if (!Number.isFinite(powerFactor) || powerFactor < 0.8 || powerFactor > 1) return { error: '功率因数必须在 0.8～1 之间' };
  if (!Number.isFinite(dischargeTimeH) || dischargeTimeH <= 0) return { error: '放电时间必须大于 0 小时' };
  if (!Number.isFinite(batteryOutputEfficiency) || batteryOutputEfficiency < 0.9 || batteryOutputEfficiency > 1) {
    return { error: '电池输出效率必须在 0.9～1 之间' };
  }

  const cellSeriesCount = nominalVoltageV / 3.2;
  const inverterEfficiency = upsPowerKva > 100 ? 0.95 : 0.93;
  const dischargeRateC = 1 / dischargeTimeH;
  let cellPlatformVoltageV = null;
  let platformVoltageRule = '';

  if (dischargeRateC <= 1) {
    cellPlatformVoltageV = 3.15;
    platformVoltageRule = '≤1C';
  } else if (dischargeRateC > 1 && dischargeRateC <= 3) {
    cellPlatformVoltageV = 3.12;
    platformVoltageRule = '>1C 且 ≤3C';
  } else if (dischargeRateC >= 4 && dischargeRateC <= 6) {
    cellPlatformVoltageV = 3.05;
    platformVoltageRule = '≥4C 且 ≤6C';
  } else if (dischargeRateC > 6) {
    cellPlatformVoltageV = 3.02;
    platformVoltageRule = '>6C';
  } else {
    return {
      error: 'A00 Excel 的平台电压公式在 3C～4C 区间没有定义，请调整放电时间或确认平台电压口径',
      dischargeRateC,
      excelFormulaGap: true
    };
  }

  const designPowerKw = hasLoadPower ? loadPowerKw : upsPowerKva * powerFactor;
  const calculatedCapacityAh = designPowerKw * 1000 * dischargeTimeH
    / (inverterEfficiency * cellSeriesCount * groupCount * batteryOutputEfficiency * cellPlatformVoltageV);

  return {
    hasLoadPower,
    sourcePowerLabel: hasLoadPower ? '负载功率' : 'UPS容量 × 功率因数',
    loadPowerKw,
    upsPowerKva,
    nominalVoltageV,
    cellSeriesCount,
    groupCount,
    powerFactor,
    inverterEfficiency,
    batteryOutputEfficiency,
    dischargeTimeH,
    dischargeRateC,
    cellPlatformVoltageV,
    platformVoltageRule,
    designPowerKw,
    calculatedCapacityAh,
    excelDisplayCapacityAh: Math.round(calculatedCapacityAh)
  };
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
  // A03 的“涂层”列没有证明等同于热缩套管；这里只按原数据列选择，
  // 不再把热缩套管作为更高载流量涂层的同义词。
  const surfaceTreatment = input.surfaceTreatment === 'coated' ? 'coated' : 'bare';
  const temperatureRise = input.temperatureRise === 'din30' ? 'din30' : 'iec50';
  const totalFactor = temperatureRise === 'din30' || installationEnvironment === 'sealed' ? 1 : 1.3;
  const lookupCurrentA = loadCurrentA / totalFactor;
  const currentField = surfaceTreatment === 'coated' ? 'coatedCurrentA' : 'bareCurrentA';

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

const STEFAN_BOLTZMANN = 5.670374419e-8;
const DIN_REFERENCE_AMBIENT_C = 35;
const DIN_REFERENCE_RISE_K = 30;
const DIN_REFERENCE_BARE_EMISSIVITY = 0.12;

function airPropertiesAt(temperatureC) {
  const temperatureK = temperatureC + 273.15;
  const dynamicViscosity = 1.716e-5 * (temperatureK / 273.15) ** 1.5 * (273.15 + 111) / (temperatureK + 111);
  const density = 101325 / (287.058 * temperatureK);
  const thermalConductivity = 0.0241 * (temperatureK / 273.15) ** 0.9;
  const specificHeat = 1007;
  const kinematicViscosity = dynamicViscosity / density;
  const thermalDiffusivity = thermalConductivity / (density * specificHeat);
  return {
    temperatureK,
    thermalConductivity,
    kinematicViscosity,
    thermalDiffusivity,
    prandtl: kinematicViscosity / thermalDiffusivity
  };
}

function verticalPlateNusselt(rayleigh, prandtl) {
  if (rayleigh <= 0) return 0;
  return (0.825 + (0.387 * rayleigh ** (1 / 6))
    / (1 + (0.492 / prandtl) ** (9 / 16)) ** (8 / 27)) ** 2;
}

function horizontalPlateNusselt(rayleigh, upward) {
  if (rayleigh <= 0) return 0;
  if (!upward) return 0.27 * rayleigh ** 0.25;
  return rayleigh < 1e7 ? 0.54 * rayleigh ** 0.25 : 0.15 * rayleigh ** (1 / 3);
}

function naturalConvectionAt({ widthMm, temperatureC, ambientTemperatureC, orientation }) {
  const temperatureRiseK = temperatureC - ambientTemperatureC;
  if (temperatureRiseK <= 0) {
    return { coefficient: 0, characteristicLengthM: 0, rayleighNumber: 0, nusseltNumber: 0 };
  }
  const widthM = widthMm / 1000;
  const filmTemperatureC = (temperatureC + ambientTemperatureC) / 2;
  const air = airPropertiesAt(filmTemperatureC);
  const characteristicLengthM = orientation === 'vertical-run'
    ? 1
    : orientation === 'flat-horizontal'
      ? Math.max(widthM / 2, 0.005)
      : Math.max(widthM, 0.005);
  const rayleighNumber = 9.80665 * (1 / air.temperatureK) * temperatureRiseK * characteristicLengthM ** 3
    / (air.kinematicViscosity * air.thermalDiffusivity);
  const nusseltNumber = orientation === 'flat-horizontal'
    ? (horizontalPlateNusselt(rayleighNumber, true) + horizontalPlateNusselt(rayleighNumber, false)) / 2
    : verticalPlateNusselt(rayleighNumber, air.prandtl);
  return {
    coefficient: nusseltNumber * air.thermalConductivity / characteristicLengthM,
    characteristicLengthM,
    rayleighNumber,
    nusseltNumber
  };
}

function radiationLoss({ emissivity, viewFactor, surfaceAreaM2PerM, surfaceTemperatureC, surroundingsTemperatureC }) {
  return emissivity * viewFactor * STEFAN_BOLTZMANN * surfaceAreaM2PerM
    * ((surfaceTemperatureC + 273.15) ** 4 - (surroundingsTemperatureC + 273.15) ** 4);
}

/**
 * 按铜排规格反算载流量。
 *
 * 保留 I²R=Pconv+Prad 的稳态热平衡骨架，但不再把 h=5 当成所有规格的通用常数。
 * 默认用同规格 DIN 30K 裸排数据反求参考等效 h，再按自然对流近似 h∝ΔT^0.25
 * 外推到项目温差；无同规格数据时回退到自然对流关联式。设计裕量独立于热极限值。
 */
export function calculateBusbarAmpacity(catalog, input = {}) {
  const widthMm = number(input.widthMm, NaN);
  const thicknessMm = number(input.thicknessMm, NaN);
  const roomTemperatureC = number(input.roomTemperatureC, NaN);
  const permittedTemperatureRiseK = Number.isFinite(number(input.permittedTemperatureRiseK, NaN))
    ? number(input.permittedTemperatureRiseK, NaN)
    : number(input.maximumTemperatureC, NaN) - roomTemperatureC;
  const maximumTemperatureC = roomTemperatureC + permittedTemperatureRiseK;
  const internalTemperatureRiseC = number(input.internalTemperatureRiseC, NaN);
  const requestedConvectionModel = ['din-calibrated', 'natural-correlation', 'custom'].includes(input.convectionModel)
    ? input.convectionModel
    : 'din-calibrated';
  const orientation = ['edgewise-horizontal', 'vertical-run', 'flat-horizontal'].includes(input.orientation)
    ? input.orientation
    : 'edgewise-horizontal';
  const convectionCoefficient = number(input.convectionCoefficient, NaN);
  const emissivity = number(input.emissivity, NaN);
  const radiationViewFactor = number(input.radiationViewFactor, 0.8);
  const exposedSurfaceFactor = number(input.exposedSurfaceFactor, 1);
  const resistivity20OhmM = number(input.resistivity20OhmM, NaN);
  const temperatureCoefficient = number(input.temperatureCoefficient, NaN);
  const designFactor = number(input.designFactor, NaN);
  const currentType = input.currentType === 'ac' ? 'ac' : 'dc';
  const acResistanceFactor = currentType === 'ac' ? number(input.acResistanceFactor, NaN) : 1;

  if (!Number.isFinite(widthMm) || widthMm <= 0 || widthMm > 500) return { error: '铜排宽度必须大于 0mm 且不超过 500mm' };
  if (!Number.isFinite(thicknessMm) || thicknessMm <= 0 || thicknessMm > 100) return { error: '铜排厚度必须大于 0mm 且不超过 100mm' };
  if (widthMm < thicknessMm) return { error: '铜排宽度应不小于厚度，请确认规格输入顺序' };
  if (!Number.isFinite(roomTemperatureC) || roomTemperatureC < -50 || roomTemperatureC > 100) return { error: '房间环境温度必须在 -50～100℃ 之间' };
  if (!Number.isFinite(permittedTemperatureRiseK) || permittedTemperatureRiseK <= 0 || permittedTemperatureRiseK > 105) return { error: '工程控制温升必须大于 0K 且不超过 105K' };
  if (!Number.isFinite(internalTemperatureRiseC) || internalTemperatureRiseC < 0 || internalTemperatureRiseC > 100) return { error: '内部环境温升必须在 0～100K 之间' };
  if (!Number.isFinite(maximumTemperatureC) || maximumTemperatureC < -20 || maximumTemperatureC > 250) return { error: '铜排允许最高温度必须在 -20～250℃ 之间' };
  if (requestedConvectionModel === 'custom' && (!Number.isFinite(convectionCoefficient) || convectionCoefficient <= 0 || convectionCoefficient > 100)) return { error: '自定义对流换热系数必须大于 0 且不超过 100W/(m²·K)' };
  if (!Number.isFinite(emissivity) || emissivity < 0 || emissivity > 1) return { error: '表面发射率必须在 0～1 之间' };
  if (!Number.isFinite(radiationViewFactor) || radiationViewFactor <= 0 || radiationViewFactor > 1) return { error: '辐射视角系数必须大于 0 且不超过 1' };
  if (!Number.isFinite(exposedSurfaceFactor) || exposedSurfaceFactor <= 0 || exposedSurfaceFactor > 1) return { error: '有效散热面积系数必须大于 0 且不超过 1' };
  if (!Number.isFinite(resistivity20OhmM) || resistivity20OhmM <= 0 || resistivity20OhmM > 1e-6) return { error: '20℃电阻率必须大于 0 且不超过 1×10⁻⁶Ω·m' };
  if (!Number.isFinite(temperatureCoefficient) || temperatureCoefficient < 0 || temperatureCoefficient > 0.02) return { error: '电阻温度系数必须在 0～0.02/℃ 之间' };
  if (!Number.isFinite(designFactor) || designFactor < 0.5 || designFactor > 1) return { error: '设计裕量系数必须在 0.5～1 之间' };
  if (!Number.isFinite(acResistanceFactor) || acResistanceFactor < 1 || acResistanceFactor > 5) return { error: '交流电阻修正系数必须在 1～5 之间' };

  const internalAmbientTemperatureC = roomTemperatureC + internalTemperatureRiseC;
  if (maximumTemperatureC <= internalAmbientTemperatureC) {
    return { error: '铜排允许最高温度必须高于房间温度与内部温升之和' };
  }

  const areaMm2 = widthMm * thicknessMm;
  const areaM2 = areaMm2 / 1e6;
  const grossSurfaceAreaM2PerM = 2 * (widthMm + thicknessMm) / 1000;
  const surfaceAreaM2PerM = grossSurfaceAreaM2PerM * exposedSurfaceFactor;
  const effectiveTemperatureRiseK = maximumTemperatureC - internalAmbientTemperatureC;

  const normalizedSpec = `${widthMm} x ${thicknessMm}`;
  const dinMatch = (catalog || []).find(item => item.configuration === '单片'
    && String(item.spec).replace(/×/g, 'x').replace(/\s+/g, ' ').trim() === normalizedSpec) || null;
  const dinCalibrationCurrentA = dinMatch ? number(dinMatch.bareCurrentA) : null;
  const dinReferenceField = input.dinReferenceField === 'coatedCurrentA' ? 'coatedCurrentA' : 'bareCurrentA';
  const dinCurrentA = dinMatch ? number(dinMatch[dinReferenceField]) : null;

  const resistanceAt = (temperatureC, resistanceFactor = acResistanceFactor) => {
    const resistivity = resistivity20OhmM * (1 + temperatureCoefficient * (temperatureC - 20));
    return { resistivity, dcResistance: resistivity / areaM2, usedResistance: resistivity / areaM2 * resistanceFactor };
  };

  let dinReferenceConvectionCoefficient = null;
  if (dinCalibrationCurrentA > 0) {
    const referenceTemperatureC = DIN_REFERENCE_AMBIENT_C + DIN_REFERENCE_RISE_K;
    const referenceResistance = resistanceAt(referenceTemperatureC, 1).dcResistance;
    const referenceTotalLoss = dinCalibrationCurrentA ** 2 * referenceResistance;
    const referenceRadiationLoss = radiationLoss({
      emissivity: DIN_REFERENCE_BARE_EMISSIVITY,
      viewFactor: 1,
      surfaceAreaM2PerM: grossSurfaceAreaM2PerM,
      surfaceTemperatureC: referenceTemperatureC,
      surroundingsTemperatureC: DIN_REFERENCE_AMBIENT_C
    });
    const derivedCoefficient = (referenceTotalLoss - referenceRadiationLoss)
      / (grossSurfaceAreaM2PerM * DIN_REFERENCE_RISE_K);
    if (Number.isFinite(derivedCoefficient) && derivedCoefficient > 0) {
      dinReferenceConvectionCoefficient = derivedCoefficient;
    }
  }

  const convectionModel = requestedConvectionModel === 'din-calibrated' && dinReferenceConvectionCoefficient === null
    ? 'natural-correlation'
    : requestedConvectionModel;
  const convectionAt = (temperatureC, ambientTemperatureC) => {
    const temperatureRiseK = Math.max(temperatureC - ambientTemperatureC, 0);
    if (convectionModel === 'custom') {
      return {
        coefficient: convectionCoefficient,
        characteristicLengthM: null,
        rayleighNumber: null,
        nusseltNumber: null
      };
    }
    if (convectionModel === 'din-calibrated') {
      return {
        coefficient: dinReferenceConvectionCoefficient * (temperatureRiseK / DIN_REFERENCE_RISE_K) ** 0.25,
        characteristicLengthM: null,
        rayleighNumber: null,
        nusseltNumber: null
      };
    }
    return naturalConvectionAt({ widthMm, temperatureC, ambientTemperatureC, orientation });
  };
  const thermalStateAt = (temperatureC, ambientTemperatureC, resistanceFactor = acResistanceFactor) => {
    const temperatureRiseK = temperatureC - ambientTemperatureC;
    const convection = convectionAt(temperatureC, ambientTemperatureC);
    const convectionLoss = convection.coefficient * surfaceAreaM2PerM * temperatureRiseK;
    const radiativeLoss = radiationLoss({
      emissivity,
      viewFactor: radiationViewFactor,
      surfaceAreaM2PerM,
      surfaceTemperatureC: temperatureC,
      surroundingsTemperatureC: ambientTemperatureC
    });
    return {
      ...resistanceAt(temperatureC, resistanceFactor),
      ...convection,
      convectionLoss,
      radiationLoss: radiativeLoss,
      totalDissipation: convectionLoss + radiativeLoss
    };
  };

  const maximumState = thermalStateAt(maximumTemperatureC, internalAmbientTemperatureC);
  const resistivityAtMaximumOhmM = maximumState.resistivity;
  const dcResistanceOhmPerM = maximumState.dcResistance;
  const usedResistanceOhmPerM = maximumState.usedResistance;
  const effectiveConvectionCoefficient = maximumState.coefficient;
  const convectionLossWPerM = maximumState.convectionLoss;
  const radiationLossWPerM = maximumState.radiationLoss;
  const totalDissipationWPerM = convectionLossWPerM + radiationLossWPerM;
  const thermalBalanceCurrentA = Math.sqrt(totalDissipationWPerM / usedResistanceOhmPerM);
  const recommendedCurrentA = thermalBalanceCurrentA * designFactor;
  const currentDensityAmm2 = recommendedCurrentA / areaMm2;
  const designLossWPerM = recommendedCurrentA ** 2 * usedResistanceOhmPerM;

  const heatBalanceAt = temperatureC => {
    const state = thermalStateAt(temperatureC, internalAmbientTemperatureC);
    const generated = recommendedCurrentA ** 2 * state.usedResistance;
    return state.totalDissipation - generated;
  };
  let lowerTemperatureC = internalAmbientTemperatureC;
  let upperTemperatureC = maximumTemperatureC;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const midpointC = (lowerTemperatureC + upperTemperatureC) / 2;
    if (heatBalanceAt(midpointC) >= 0) upperTemperatureC = midpointC;
    else lowerTemperatureC = midpointC;
  }
  const estimatedOperatingTemperatureC = (lowerTemperatureC + upperTemperatureC) / 2;

  // DIN 对照必须统一到 35℃环境、30K 温升，再比较热平衡极限；不能把项目55K
  // 有效散热温差的结果直接与30K表值比较。
  const dinNormalizedState = thermalStateAt(
    DIN_REFERENCE_AMBIENT_C + DIN_REFERENCE_RISE_K,
    DIN_REFERENCE_AMBIENT_C
  );
  const dinNormalizedThermalCurrentA = Math.sqrt(dinNormalizedState.totalDissipation / dinNormalizedState.usedResistance);
  const dinDifferencePercent = dinCurrentA > 0 ? dinNormalizedThermalCurrentA / dinCurrentA - 1 : null;

  return {
    widthMm,
    thicknessMm,
    normalizedSpec,
    maximumTemperatureC,
    roomTemperatureC,
    permittedTemperatureRiseK,
    internalTemperatureRiseC,
    internalAmbientTemperatureC,
    effectiveTemperatureRiseK,
    requestedConvectionModel,
    convectionModel,
    convectionFallback: requestedConvectionModel === 'din-calibrated' && convectionModel !== requestedConvectionModel,
    orientation,
    convectionCoefficient: effectiveConvectionCoefficient,
    dinReferenceConvectionCoefficient,
    dinReferenceBareEmissivity: DIN_REFERENCE_BARE_EMISSIVITY,
    characteristicLengthM: maximumState.characteristicLengthM,
    rayleighNumber: maximumState.rayleighNumber,
    nusseltNumber: maximumState.nusseltNumber,
    emissivity,
    radiationViewFactor,
    exposedSurfaceFactor,
    resistivity20OhmM,
    temperatureCoefficient,
    currentType,
    acResistanceFactor,
    designFactor,
    areaMm2,
    areaM2,
    grossSurfaceAreaM2PerM,
    surfaceAreaM2PerM,
    resistivityAtMaximumOhmM,
    dcResistanceOhmPerM,
    usedResistanceOhmPerM,
    convectionLossWPerM,
    radiationLossWPerM,
    totalDissipationWPerM,
    thermalBalanceCurrentA,
    recommendedCurrentA,
    currentDensityAmm2,
    designLossWPerM,
    estimatedOperatingTemperatureC,
    dinReferenceField,
    dinMatch,
    dinCurrentA,
    dinCalibrationCurrentA,
    dinNormalizedThermalCurrentA,
    dinDifferencePercent,
    requiresAcVerification: currentType === 'ac' && acResistanceFactor === 1,
    requiresShortCircuitCheck: recommendedCurrentA >= 4000
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
