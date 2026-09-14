const SQRT3 = Math.sqrt(3);

export const BREAKER_STANDARDS = [16, 20, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
export const BUSWAY_STANDARDS = [160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
export const TRANSFORMER_STANDARDS = [100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150];

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

export function selectCatalogItem(catalog, requiredCurrentA, currentField = 'currentA', filters = {}) {
  const target = Math.max(0, number(requiredCurrentA));
  return catalog
    .filter(item => Object.entries(filters).every(([key, value]) => !value || String(item[key]) === String(value)))
    .filter(item => number(item[currentField]) >= target)
    .sort((a, b) => number(a[currentField]) - number(b[currentField]))[0] || null;
}
