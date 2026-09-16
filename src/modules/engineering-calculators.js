const SQRT3 = Math.sqrt(3);

export const BREAKER_STANDARDS = [16, 20, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600];
export const BUSWAY_STANDARDS = [160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
export const SMART_BUSWAY_STANDARDS = [160, 250, 400, 630, 800];
export const SMART_BUSWAY_BREAKERS = [16, 20, 32, 40, 50, 63, 80, 100, 125];
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

export const SMART_BUSWAY_PLUG_PRODUCTS = [
  { phase: 'single', ratedCurrentA: 32, outputs: 1, code: 'IPL-DB-32S-1', modelStatus: 'confirmed' },
  { phase: 'single', ratedCurrentA: 32, outputs: 3, code: 'IPL-DB-32S-3', modelStatus: 'confirmed' },
  { phase: 'single', ratedCurrentA: 63, outputs: 3, code: 'IPL-DB-63S-3', modelStatus: 'confirmed' },
  { phase: 'three', ratedCurrentA: 32, outputs: 1, code: 'IPL-DB-32T-1', modelStatus: 'confirmed' },
  { phase: 'three', ratedCurrentA: 32, outputs: 3, code: 'IPL-DB-32T-3', modelStatus: 'confirmed' },
  { phase: 'three', ratedCurrentA: 40, outputs: 2, code: 'IPL-DB-40T-2', modelStatus: 'confirmed' },
  { phase: 'three', ratedCurrentA: 40, outputs: 3, code: '', modelStatus: 'pending' },
  { phase: 'three', ratedCurrentA: 50, outputs: 2, code: 'IPL-DB-50T-2', modelStatus: 'confirmed' },
  { phase: 'three', ratedCurrentA: 63, outputs: 2, code: 'IPL-DB-63T-2', modelStatus: 'confirmed' }
];

function smartBuswayId(prefix = 'item') {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function distributeCooling(racks, cooling) {
  if (!cooling.length) return racks;
  const slots = cooling.length + 1;
  const base = Math.floor(racks.length / slots);
  const extra = racks.length % slots;
  const result = [];
  let cursor = 0;
  for (let slot = 0; slot < slots; slot += 1) {
    const count = base + (slot < extra ? 1 : 0);
    result.push(...racks.slice(cursor, cursor + count));
    cursor += count;
    if (slot < cooling.length) result.push(cooling[slot]);
  }
  return result;
}

function normalizeProfile(profile = {}, defaults = {}) {
  const powerKw = Math.max(0, number(profile.powerKw, defaults.powerKw));
  const phaseSetting = ['single', 'three'].includes(profile.phase) ? profile.phase : 'auto';
  return {
    id: profile.id || smartBuswayId('profile'),
    quantity: Math.max(0, Math.floor(number(profile.quantity))),
    widthMm: number(profile.widthMm) === 800 ? 800 : 600,
    powerKw,
    phase: phaseSetting,
    feed: ['A', 'B'].includes(profile.feed) ? profile.feed : 'AB'
  };
}

function rowProfiles(row = {}, defaults = {}) {
  if (Array.isArray(row.profiles)) return row.profiles.map(profile => normalizeProfile(profile, defaults)).filter(profile => profile.quantity > 0);
  const profiles = [];
  const count600 = Math.max(0, Math.floor(number(row.cabinets600)));
  const count800 = Math.max(0, Math.floor(number(row.cabinets800)));
  if (count600) profiles.push(normalizeProfile({ quantity: count600, widthMm: 600, powerKw: defaults.powerKw, phase: defaults.phase, feed: defaults.feed }, defaults));
  if (count800) profiles.push(normalizeProfile({ quantity: count800, widthMm: 800, powerKw: defaults.powerKw, phase: defaults.phase, feed: defaults.feed }, defaults));
  return profiles;
}

function makeLayoutRow(row, rowIndex, defaults) {
  const racks = [];
  const cooling = [];
  const profiles = rowProfiles(row, defaults);
  profiles.forEach(profile => {
    for (let index = 0; index < profile.quantity; index += 1) {
      const sequence = racks.length + 1;
      racks.push({
        id: smartBuswayId('rack'), kind: 'rack', name: `机柜${sequence}`, widthMm: profile.widthMm,
        powerKw: profile.powerKw, phase: profile.phase === 'auto' ? (profile.powerKw >= 8 ? 'three' : 'single') : profile.phase,
        powerFactor: defaults.powerFactor, safetyFactor: defaults.branchSafetyFactor,
        feed: defaults.topology === 'single' ? 'A' : profile.feed, manualSplit: false, profileId: profile.id
      });
    }
  });
  const counts = { ac300: Math.max(0, Math.floor(number(row?.ac300))), ac600: Math.max(0, Math.floor(number(row?.ac600))) };
  [300, 600].forEach(widthMm => {
    for (let index = 0; index < counts[`ac${widthMm}`]; index += 1) {
      cooling.push({ id: smartBuswayId('ac'), kind: 'ac', name: `列间空调${cooling.length + 1}`, widthMm });
    }
  });
  return { id: `row-${rowIndex + 1}`, name: `第${rowIndex + 1}排`, items: distributeCooling(racks, cooling) };
}

/** @returns {SmartBuswayDesign} */
export function createSmartBuswayDesign(input = {}) {
  const powerKw = Math.max(0, number(input.defaultPowerKw, 10));
  const defaults = {
    powerKw,
    phase: input.defaultPhase || (powerKw >= 8 ? 'three' : 'single'),
    powerFactor: clamp(input.powerFactor ?? 0.95, 0.01, 1),
    branchSafetyFactor: Math.max(1, number(input.branchSafetyFactor, 1.25)),
    feed: input.defaultFeed === 'A' || input.defaultFeed === 'B' ? input.defaultFeed : 'AB',
    topology: input.topology === 'single' ? 'single' : 'dual'
  };
  const quickRows = [input.row1 || {}, input.row2 || {}].map(row => ({
    profiles: rowProfiles(row, defaults),
    ac300: Math.max(0, Math.floor(number(row?.ac300))),
    ac600: Math.max(0, Math.floor(number(row?.ac600)))
  }));
  return {
    version: 2,
    topology: input.topology === 'single' ? 'single' : 'dual',
    installation: input.installation === 'ceiling' ? 'ceiling' : 'cabinet-top',
    aisleWidthMm: Math.max(600, number(input.aisleWidthMm, 1200)),
    voltage: Math.max(1, number(input.voltage, 380)),
    demandFactor: clamp(input.demandFactor ?? 1, 0, 1),
    powerFactor: defaults.powerFactor,
    safetyFactor: Math.max(1, number(input.safetyFactor, 1.15)),
    harmonicFactor: Math.max(0.01, number(input.harmonicFactor, 1)),
    neutralMode: input.neutralMode === '100' || input.neutralMode === '200' ? input.neutralMode : 'auto',
    touchscreen: Boolean(input.touchscreen),
    quickConfig: { rows: quickRows },
    rows: [makeLayoutRow(quickRows[0], 0, defaults), makeLayoutRow(quickRows[1], 1, defaults)],
    runSelections: {},
    plugBoxGroups: [],
    selectedItemId: null,
    selectedPlugBoxId: null,
    result: null
  };
}

/** @returns {SmartBuswayDesign} */
export function generateSmartBuswayLayout(input = {}) {
  return createSmartBuswayDesign(input);
}

/** @returns {{baseCurrentA:number,designCurrentA:number,breakerA:number|null,voltage:number,phase:string,warning:string|null}} */
export function calculateSmartBuswayBranch(item = {}) {
  const phase = item.phase === 'single' ? 'single' : 'three';
  const voltage = phase === 'single' ? 220 : 380;
  const powerKw = Math.max(0, number(item.powerKw));
  const powerFactor = clamp(item.powerFactor ?? 0.95, 0.01, 1);
  const safety = Math.max(1, number(item.safetyFactor, 1.25));
  const baseCurrentA = phase === 'single'
    ? powerKw * 1000 / (voltage * powerFactor)
    : powerKw * 1000 / (SQRT3 * voltage * powerFactor);
  const designCurrentA = baseCurrentA * safety;
  const breakerA = nextStandard(designCurrentA, SMART_BUSWAY_BREAKERS);
  let warning = null;
  if (!breakerA && designCurrentA > 0) warning = '支路选型电流超过 125A，现有插接箱型号无法覆盖';
  else if (phase === 'single' && powerKw >= 8) warning = '8kW 及以上机柜建议采用三相供电';
  return { baseCurrentA, designCurrentA, breakerA, voltage, phase, warning };
}

function recommendedPlugRating(phase, breakerA) {
  if (!breakerA) return null;
  const standards = phase === 'single' ? [32, 63] : [32, 40, 50, 63];
  return nextStandard(breakerA, standards);
}

function maximumPlugOutputs(phase, ratedCurrentA) {
  if (phase === 'single') return ratedCurrentA <= 63 ? 3 : 1;
  if (ratedCurrentA <= 40) return 3;
  if (ratedCurrentA <= 63) return 2;
  return 1;
}

function resolvePlugProduct(phase, ratedCurrentA, usedOutputs, requestedOutputs = null) {
  if (!ratedCurrentA) return { outputs: Math.max(1, requestedOutputs || usedOutputs), code: '', modelStatus: 'pending' };
  const candidates = SMART_BUSWAY_PLUG_PRODUCTS.filter(item => item.phase === phase && item.ratedCurrentA === ratedCurrentA && item.outputs >= usedOutputs);
  const exact = requestedOutputs ? candidates.find(item => item.outputs === requestedOutputs) : null;
  const product = exact || candidates.sort((a, b) => a.outputs - b.outputs)[0];
  if (product) return { outputs: product.outputs, code: product.code, modelStatus: product.modelStatus };
  return { outputs: Math.max(usedOutputs, requestedOutputs || usedOutputs), code: '', modelStatus: 'pending' };
}

function groupSignature(rowId, path, memberIds) {
  return `${rowId}:${path}:${memberIds.join(',')}`;
}

/** Generate recommendation groups without overwriting persisted manual groups. */
export function recommendSmartBuswayGroups(rows, paths, excludedMemberships = new Set()) {
  const groups = [];
  const phaseNames = ['L1', 'L2', 'L3'];
  rows.forEach((row, rowIndex) => {
    paths.forEach(path => {
      // Each row/path is an electrically independent run, so phase balancing
      // starts independently rather than leaking the cursor into another run.
      let phaseCursor = 0;
      const racks = row.items.filter(item => item.kind === 'rack'
        && (item.feed === 'AB' || item.feed === path)
        && !excludedMemberships.has(`${row.id}:${path}:${item.id}`));
      let cursor = 0;
      while (cursor < racks.length) {
        const first = racks[cursor];
        const phase = first.phase === 'single' ? 'single' : 'three';
        const members = [first];
        let selectedRating = recommendedPlugRating(phase, first.branch.breakerA);
        let capacity = maximumPlugOutputs(phase, selectedRating || 999);
        while (!first.manualSplit && cursor + members.length < racks.length) {
          const candidate = racks[cursor + members.length];
          if (candidate.manualSplit || (candidate.phase === 'single' ? 'single' : 'three') !== phase) break;
          const candidateRating = recommendedPlugRating(phase, candidate.branch.breakerA);
          const trialRating = Math.max(selectedRating || 0, candidateRating || 0) || null;
          const trialCapacity = maximumPlugOutputs(phase, trialRating || 999);
          if (members.length + 1 > trialCapacity) break;
          members.push(candidate);
          selectedRating = trialRating;
          capacity = trialCapacity;
        }
        const product = resolvePlugProduct(phase, selectedRating, members.length);
        const memberIds = members.map(item => item.id);
        const phases = phase === 'single' ? members.map(() => phaseNames[phaseCursor++ % 3]) : members.map(() => 'L1/L2/L3');
        groups.push({
          id: `plug-${groupSignature(row.id, path, memberIds)}`, rowId: row.id, rowIndex, path,
          circuitPhase: phase, phase: phase === 'single' ? phases.join('/') : 'L1/L2/L3', circuitPhases: phases,
          memberIds, memberNames: members.map(item => item.name), currentA: Math.max(...members.map(item => item.branch.designCurrentA)),
          recommendedRatedCurrentA: selectedRating, selectedRatedCurrentA: selectedRating,
          recommendedOutputs: product.outputs, selectedOutputs: product.outputs,
          recommendedProductCode: product.code, productCode: product.code, modelStatus: product.modelStatus,
          selectionMode: 'auto', validationStatus: 'ok', issues: [], capacity
        });
        cursor += members.length;
      }
    });
  });
  return groups;
}

function mergePlugBoxGroups(design, pathNames) {
  const racksById = new Map(design.rows.flatMap(row => row.items).filter(item => item.kind === 'rack').map(item => [item.id, item]));
  const rowById = new Map(design.rows.map((row, rowIndex) => [row.id, { row, rowIndex }]));
  const manual = (Array.isArray(design.plugBoxGroups) ? design.plugBoxGroups : [])
    .filter(group => group?.selectionMode === 'manual' && rowById.has(group.rowId) && pathNames.includes(group.path))
    .map(group => structuredClone(group));
  const claimed = new Set();
  manual.forEach(group => (group.memberIds || []).forEach(id => {
    if (racksById.has(id)) claimed.add(`${group.rowId}:${group.path}:${id}`);
  }));
  // Rebuild recommendations from the remaining cabinets. Filtering whole
  // precomputed groups would orphan the unselected members of a manual split.
  const auto = recommendSmartBuswayGroups(design.rows, pathNames, claimed);
  return [...manual, ...auto];
}

/** Validate and enrich persisted plug-box groups against current cabinet data. */
export function validateSmartBuswayGroups(design, groups, pathNames) {
  const issues = [];
  const assignments = new Map();
  const rowsById = new Map(design.rows.map((row, rowIndex) => [row.id, { row, rowIndex }]));
  const enriched = groups.map(group => {
    const rowEntry = rowsById.get(group.rowId);
    const rowItems = rowEntry?.row.items || [];
    const positions = new Map(rowItems.map((item, index) => [item.id, index]));
    const members = (group.memberIds || []).map(id => rowItems.find(item => item.id === id)).filter(Boolean);
    const groupIssues = [];
    if (!rowEntry || !pathNames.includes(group.path)) groupIssues.push({ severity: 'error', message: '分组所属排或路径已不存在' });
    if (members.length !== (group.memberIds || []).length) groupIssues.push({ severity: 'error', message: '分组包含已删除的机柜' });
    if (!members.length) groupIssues.push({ severity: 'error', message: '插接箱未分配机柜' });
    const phase = group.circuitPhase === 'single' ? 'single' : 'three';
    if (members.some(item => item.phase !== phase)) groupIssues.push({ severity: 'error', message: '同一插接箱不能混合单相与三相机柜' });
    if (members.some(item => !(item.feed === 'AB' || item.feed === group.path))) groupIssues.push({ severity: 'error', message: '存在不属于本供电路径的机柜' });
    members.forEach(item => {
      const key = `${group.rowId}:${group.path}:${item.id}`;
      if (assignments.has(key)) groupIssues.push({ severity: 'error', message: `${item.name} 在本路径重复归组` });
      assignments.set(key, group.id);
    });
    const recommendedBreakerA = members.length ? Math.max(...members.map(item => item.branch?.breakerA || 0)) || null : null;
    const recommendedRatedCurrentA = recommendedPlugRating(phase, recommendedBreakerA);
    const selectedRatedCurrentA = group.selectionMode === 'manual' ? (number(group.selectedRatedCurrentA) || recommendedRatedCurrentA) : recommendedRatedCurrentA;
    const automatic = resolvePlugProduct(phase, recommendedRatedCurrentA, Math.max(1, members.length));
    const requestedOutputs = group.selectionMode === 'manual' ? Math.max(1, Math.floor(number(group.selectedOutputs, automatic.outputs))) : automatic.outputs;
    const selectedProduct = resolvePlugProduct(phase, selectedRatedCurrentA, Math.max(1, members.length), requestedOutputs);
    const maximumOutputs = maximumPlugOutputs(phase, selectedRatedCurrentA || 999);
    if (requestedOutputs > maximumOutputs) groupIssues.push({ severity: 'error', message: `${selectedRatedCurrentA || '未选'}A ${phase === 'single' ? '单相' : '三相'}插接箱最多支持 ${maximumOutputs} 路` });
    if (members.length > maximumOutputs) groupIssues.push({ severity: 'error', message: `已分配 ${members.length} 柜，超过该规格最多 ${maximumOutputs} 路能力` });
    if (members.length > selectedProduct.outputs) groupIssues.push({ severity: 'error', message: `已分配 ${members.length} 柜，超过 ${selectedProduct.outputs} 路输出能力` });
    const currentA = members.length ? Math.max(...members.map(item => item.branch?.designCurrentA || 0)) : 0;
    if (!selectedRatedCurrentA || selectedRatedCurrentA < currentA) groupIssues.push({ severity: 'danger', message: `采用 ${selectedRatedCurrentA || '未选'}A 低于组内最大支路需求 ${currentA.toFixed(1)}A，需工程复核` });
    if (!selectedProduct.code) groupIssues.push({ severity: 'warning', message: `${selectedRatedCurrentA || '超表列'}A ${phase === 'single' ? '单相' : '三相'} ${selectedProduct.outputs}路型号待确认` });
    const indexes = members.map(item => positions.get(item.id)).filter(Number.isFinite).sort((a, b) => a - b);
    if (indexes.some((value, index) => index && value !== indexes[index - 1] + 1)) groupIssues.push({ severity: 'warning', message: '覆盖机柜不连续，请核查电缆长度和走线' });
    const phases = phase === 'single'
      ? members.map((_, index) => group.circuitPhases?.[index] || ['L1', 'L2', 'L3'][index % 3])
      : members.map(() => 'L1/L2/L3');
    const enrichedGroup = {
      ...group, rowIndex: rowEntry?.rowIndex ?? group.rowIndex, circuitPhase: phase,
      memberNames: members.map(item => item.name), currentA, circuitPhases: phases, phase: phase === 'single' ? phases.join('/') : 'L1/L2/L3',
      recommendedRatedCurrentA, selectedRatedCurrentA,
      recommendedOutputs: automatic.outputs, selectedOutputs: selectedProduct.outputs,
      recommendedProductCode: automatic.code, productCode: selectedProduct.code,
      modelStatus: selectedProduct.modelStatus,
      validationStatus: groupIssues.some(item => item.severity === 'error') ? 'error' : groupIssues.some(item => item.severity === 'danger') ? 'danger' : groupIssues.length ? 'warning' : 'ok',
      issues: groupIssues
    };
    groupIssues.forEach(issue => issues.push({ ...issue, groupId: group.id, message: `${rowEntry?.row.name || '未知排'} ${group.path || '?'}路：${issue.message}` }));
    return enrichedGroup;
  });
  return { groups: enriched, issues, assignments };
}

function addBom(map, key, item) {
  const current = map.get(key);
  if (current) current.quantity += item.quantity;
  else map.set(key, { ...item });
}

/** @returns {{design:SmartBuswayDesign,paths:SmartBuswayPathResult[],plugBoxGroups:PlugBoxGroup[],bom:SmartBuswayBomItem[],warnings:string[]}} */
export function calculateSmartBuswayDesign(rawDesign = {}) {
  const design = structuredClone(rawDesign?.rows ? rawDesign : createSmartBuswayDesign(rawDesign));
  design.version = 2;
  design.topology = design.topology === 'single' ? 'single' : 'dual';
  design.rows = Array.isArray(design.rows) ? design.rows.slice(0, 2) : [];
  while (design.rows.length < 2) design.rows.push({ id: `row-${design.rows.length + 1}`, name: `第${design.rows.length + 1}排`, items: [] });
  design.runSelections = design.runSelections && typeof design.runSelections === 'object' ? design.runSelections : {};
  design.plugBoxGroups = Array.isArray(design.plugBoxGroups) ? design.plugBoxGroups : [];
  const issues = [];
  let rackCount = 0;
  design.rows.forEach((row, rowIndex) => {
    row.id ||= `row-${rowIndex + 1}`;
    row.name ||= `第${rowIndex + 1}排`;
    row.items = Array.isArray(row.items) ? row.items : [];
    row.items.forEach((item, itemIndex) => {
      item.id ||= smartBuswayId(item.kind || 'item');
      item.widthMm = item.kind === 'ac' ? ([300, 600].includes(number(item.widthMm)) ? number(item.widthMm) : 600) : ([600, 800].includes(number(item.widthMm)) ? number(item.widthMm) : 600);
      if (item.kind === 'rack') {
        rackCount += 1;
        item.name ||= `机柜${itemIndex + 1}`;
        item.feed = design.topology === 'single' ? 'A' : ['A', 'B'].includes(item.feed) ? item.feed : 'AB';
        item.phase = item.phase === 'single' ? 'single' : 'three';
        item.branch = calculateSmartBuswayBranch(item);
        if (item.branch.warning) issues.push({ severity: 'warning', message: `${row.name} ${item.name}：${item.branch.warning}` });
      }
    });
    row.exactLengthM = row.items.reduce((sum, item) => sum + number(item.widthMm), 0) / 1000;
    row.orderLengthM = Math.ceil(row.exactLengthM);
    row.rackCount = row.items.filter(item => item.kind === 'rack').length;
  });
  if (!rackCount) issues.push({ severity: 'warning', message: '当前布局中没有 IT 机柜' });

  const pathNames = design.topology === 'single' ? ['A'] : ['A', 'B'];
  const calculatePath = (racks, path) => {
    const normalPowerKw = racks.reduce((sum, item) => sum + (item.feed === path ? number(item.powerKw) : item.feed === 'AB' ? number(item.powerKw) / 2 : 0), 0);
    const failurePowerKw = racks.reduce((sum, item) => sum + (item.feed === path || item.feed === 'AB' ? number(item.powerKw) : 0), 0);
    const bus = calculateBusway({
      activePowerKw: failurePowerKw,
      voltage: design.voltage || 380,
      powerFactor: design.powerFactor ?? 0.95,
      demandFactor: design.demandFactor ?? 1,
      safety: design.safetyFactor ?? 1.15,
      harmonicFactor: design.harmonicFactor ?? 1
    });
    const normalizedDesignCurrentA = Number(bus.designCurrentA.toFixed(9));
    const ratedCurrentA = nextStandard(normalizedDesignCurrentA, SMART_BUSWAY_STANDARDS);
    const engineeringRatedCurrentA = nextStandard(normalizedDesignCurrentA, BUSWAY_STANDARDS);
    return {
      path, normalPowerKw, failurePowerKw, currentA: bus.currentA, designCurrentA: bus.designCurrentA,
      ratedCurrentA, engineeringRatedCurrentA, loadRate: ratedCurrentA ? bus.currentA / ratedCurrentA : null, configurable: ratedCurrentA !== null
    };
  };
  const runs = design.rows.flatMap((row, rowIndex) => {
    if (!row.rackCount) return [];
    const racks = row.items.filter(item => item.kind === 'rack');
    return pathNames.map(path => {
      const calculated = calculatePath(racks, path);
      const key = `${row.id}:${path}`;
      const prior = design.runSelections[key] || {};
      const selectionMode = prior.mode === 'manual' ? 'manual' : 'auto';
      const selectedBuswayCurrentA = selectionMode === 'manual' && SMART_BUSWAY_STANDARDS.includes(number(prior.buswayRatedCurrentA))
        ? number(prior.buswayRatedCurrentA) : calculated.ratedCurrentA;
      const terminalLinked = prior.terminalLinked !== false;
      const selectedTerminalCurrentA = terminalLinked ? selectedBuswayCurrentA
        : SMART_BUSWAY_STANDARDS.includes(number(prior.terminalRatedCurrentA)) ? number(prior.terminalRatedCurrentA) : calculated.ratedCurrentA;
      const terminalWithSwitch = Boolean(prior.terminalWithSwitch);
      design.runSelections[key] = { mode: selectionMode, buswayRatedCurrentA: selectedBuswayCurrentA, terminalLinked, terminalRatedCurrentA: selectedTerminalCurrentA, terminalWithSwitch };
      const runIssues = [];
      if (!calculated.configurable) runIssues.push({ severity: 'error', message: `选型电流 ${calculated.designCurrentA.toFixed(1)}A 超过 800A，停止生成智能母线BOM` });
      if (selectedBuswayCurrentA && selectedBuswayCurrentA < calculated.designCurrentA) runIssues.push({ severity: 'danger', message: `人工采用 ${selectedBuswayCurrentA}A 母线槽低于选型电流 ${calculated.designCurrentA.toFixed(1)}A` });
      if (selectedTerminalCurrentA && selectedTerminalCurrentA < calculated.designCurrentA) runIssues.push({ severity: 'danger', message: `人工采用 ${selectedTerminalCurrentA}A 始端箱低于选型电流 ${calculated.designCurrentA.toFixed(1)}A` });
      if (!terminalLinked && selectedTerminalCurrentA !== selectedBuswayCurrentA) runIssues.push({ severity: 'warning', message: `始端箱 ${selectedTerminalCurrentA}A 与母线槽 ${selectedBuswayCurrentA}A 不同档，需确认接口兼容` });
      runIssues.forEach(issue => issues.push({ ...issue, runKey: key, message: `${row.name}${path}路：${issue.message}` }));
      return {
        ...calculated, key, rowId: row.id, rowIndex, rowName: row.name,
        recommendedBuswayCurrentA: calculated.ratedCurrentA, selectedBuswayCurrentA,
        recommendedTerminalCurrentA: calculated.ratedCurrentA, selectedTerminalCurrentA,
        terminalLinked, terminalWithSwitch, selectionMode,
        buswayCode: selectedBuswayCurrentA ? `IPL-${selectedBuswayCurrentA}-T2-1` : '',
        terminalCode: selectedTerminalCurrentA ? `IPL-TB${selectedTerminalCurrentA}${terminalWithSwitch ? '-QF' : ''}` : '',
        selectedLoadRate: selectedBuswayCurrentA ? calculated.currentA / selectedBuswayCurrentA : null,
        validationStatus: runIssues.some(item => item.severity === 'error') ? 'error' : runIssues.some(item => item.severity === 'danger') ? 'danger' : runIssues.length ? 'warning' : 'ok',
        issues: runIssues
      };
    });
  });

  // Compatibility summary: legacy consumers still receive one aggregate result per A/B path.
  const paths = pathNames.map(path => calculatePath(design.rows.flatMap(row => row.items).filter(item => item.kind === 'rack'), path));
  const mergedGroups = mergePlugBoxGroups(design, pathNames);
  const groupValidation = validateSmartBuswayGroups(design, mergedGroups, pathNames);
  const plugBoxGroups = groupValidation.groups;
  design.plugBoxGroups = plugBoxGroups;
  issues.push(...groupValidation.issues);
  const buswayLengthM = runs.reduce((sum, run) => sum + design.rows[run.rowIndex].orderLengthM, 0);
  const startBoxes = runs.length;
  const connectors = runs.reduce((sum, run) => {
    const length = design.rows[run.rowIndex].orderLengthM;
    return sum + Math.floor(length / 3) + Math.floor((length % 3) / 2);
  }, 0);
  const fixingPieces = design.rows.reduce((sum, row) => sum + Math.ceil(row.rackCount * 1.2), 0);
  const accessories = {
    startBoxes, endCovers: startBoxes, buswayLengthM, connectors, dustCovers: Math.ceil(buswayLengthM * 0.7), fixingPieces,
    supports: design.installation === 'cabinet-top' ? Math.ceil(fixingPieces / 2) + startBoxes : 0,
    touchscreen: design.touchscreen ? 1 : 0, serialServer: design.touchscreen ? 0 : 1
  };
  const neutralRecommendation = number(design.harmonicFactor, 1) < 1 ? '200% N' : '100% N';
  const selectedNeutral = design.neutralMode === '100' ? '100% N' : design.neutralMode === '200' ? '200% N' : neutralRecommendation;
  if (selectedNeutral !== neutralRecommendation) issues.push({ severity: 'warning', message: `N 线人工选择 ${selectedNeutral}，与 Kh=${number(design.harmonicFactor, 1)} 的自动建议 ${neutralRecommendation} 不一致` });

  const bomBlocked = runs.some(run => !run.configurable);
  const plugBoxBomBlocked = plugBoxGroups.some(group => group.validationStatus === 'error');
  const bomMap = new Map();
  if (!bomBlocked) {
    runs.forEach(run => {
      const row = design.rows[run.rowIndex];
      const buswayStatus = run.selectedBuswayCurrentA < run.designCurrentA ? 'manual-risk'
        : run.selectionMode === 'manual' && run.selectedBuswayCurrentA !== run.recommendedBuswayCurrentA ? 'manual' : 'ok';
      const terminalStatus = run.selectedTerminalCurrentA < run.designCurrentA ? 'manual-risk'
        : run.selectionMode === 'manual' && (run.selectedTerminalCurrentA !== run.recommendedTerminalCurrentA || run.terminalWithSwitch || !run.terminalLinked) ? 'manual' : 'ok';
      addBom(bomMap, `bus-${run.key}-${run.selectedBuswayCurrentA}`, { category: '母线槽', code: run.buswayCode, description: `${run.selectedBuswayCurrentA}A 智能母线槽`, quantity: row.orderLengthM, unit: 'm', path: `${row.name}${run.path}路`, status: buswayStatus, selectionMode: run.selectionMode, recommendedCurrentA: run.recommendedBuswayCurrentA, selectedCurrentA: run.selectedBuswayCurrentA });
      addBom(bomMap, `terminal-${run.key}-${run.selectedTerminalCurrentA}-${run.terminalWithSwitch}`, { category: '始端箱', code: run.terminalCode, description: `${run.selectedTerminalCurrentA}A 始端箱${run.terminalWithSwitch ? '（带开关）' : '（不带开关）'}`, quantity: 1, unit: '个', path: `${row.name}${run.path}路`, status: terminalStatus, selectionMode: run.selectionMode, recommendedCurrentA: run.recommendedTerminalCurrentA, selectedCurrentA: run.selectedTerminalCurrentA });
    });
    if (!plugBoxBomBlocked) plugBoxGroups.forEach(group => addBom(bomMap, `plug-${group.rowId}-${group.path}-${group.productCode || 'pending'}-${group.selectedRatedCurrentA}-${group.selectedOutputs}`, {
      category: '插接箱', code: group.productCode || '', description: `${group.selectedRatedCurrentA || '超表列'}A ${group.circuitPhase === 'single' ? '单相' : '三相'} ${group.selectedOutputs}路插接箱`, quantity: 1, unit: '个', path: `${design.rows[group.rowIndex]?.name || ''}${group.path}路`, status: group.modelStatus === 'pending' ? 'pending' : group.validationStatus === 'danger' ? 'manual-risk' : group.selectionMode === 'manual' ? 'manual' : group.modelStatus, selectionMode: group.selectionMode, recommendedCurrentA: group.recommendedRatedCurrentA, selectedCurrentA: group.selectedRatedCurrentA
    }));
    [
      ['连接件', '', '母线连接件', accessories.connectors, '个'], ['附件', '', '末端盖', accessories.endCovers, '个'],
      ['附件', '', '插接口防尘盖', accessories.dustCovers, '个'], ['附件', '', '固定件', accessories.fixingPieces, '个'],
      ['安装', '', design.installation === 'cabinet-top' ? '柜顶安装支架' : '吊装支架（工程配置）', accessories.supports, '个'],
      ['监控', '', design.touchscreen ? '触摸屏' : '串口服务器', design.touchscreen ? accessories.touchscreen : accessories.serialServer, '台']
    ].forEach(([category, code, description, quantity, unit]) => { if (quantity) addBom(bomMap, `${category}-${description}`, { category, code, description, quantity, unit, path: '共用' }); });
  }
  const warnings = issues.map(issue => issue.message);
  const result = { runs, paths, plugBoxGroups, accessories, neutralRecommendation, selectedNeutral, issues, warnings, bomBlocked, plugBoxBomBlocked, bom: [...bomMap.values()] };
  design.result = result;
  return { design, ...result };
}

// v1 compatibility wrapper: old count-only callers keep their original return shape.
export function calculateSmartBusway(input) {
  if (input?.rows || input?.topology) return calculateSmartBuswayDesign(input);
  const calculated = calculateSmartBuswayDesign(createSmartBuswayDesign(input));
  return {
    row1LengthM: calculated.design.rows[0].orderLengthM,
    row2LengthM: calculated.design.rows[1].orderLengthM,
    ...calculated.accessories,
    plugBoxes: calculated.plugBoxGroups.length,
    serialServer: calculated.accessories.serialServer,
    touchscreen: calculated.accessories.touchscreen,
    supports: calculated.accessories.supports
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
