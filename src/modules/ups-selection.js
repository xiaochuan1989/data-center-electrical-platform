// UPS 选型的确定性校核。未知参数不推断为满足，AI 只能补充文字解释。
import { normalizeEvidence } from './ups-evidence.js';
export const UPS_SELECTION_RULE_VERSION = '1.1';
export const BUILTIN_CATALOG = Object.freeze({ source: '常用UPS速查表-V8.0.xlsx', version: 'V8.0' });

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const firstNumber = value => number(String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
const text = value => String(value ?? '').trim();
const isMissing = value => !value || /^(?:\/|—|-|无资料|未提供|待确认)$/i.test(text(value));

export function parseUpsRequirement(source = '') {
  const raw = text(source).replace(/[，：]/g, ':');
  const capture = pattern => firstNumber(raw.match(pattern)?.[1]);
  const capacity = capture(/(?:UPS|单机|额定|设备)\s*(?:容量|功率)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*kVA/i);
  const loadKw = capture(/(?:IT\s*负荷|有功负荷|负载功率|负荷功率|负载|负荷)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*kW/i);
  const loadKva = capture(/(?:视在负荷|负载容量|负荷容量)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*kVA/i);
  const backupMinutes = capture(/(?:后备时间|备用时间|续航时间)\s*(?:不少于|不低于|至少|≥|>=)?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:分钟|min)/i);
  const parallelUnits = capture(/(?:并机(?:数量|台数)?|并联(?:数量|台数)?)\s*[:=]?\s*(\d+)\s*台?/i);
  const batteryCells = capture(/(?:每组|单组)?\s*电池\s*(?:节数|数量)\s*[:=]?\s*(\d+)\s*节?/i);
  const outputPowerFactor = capture(/(?:输出功率因数|UPS\s*功率因数)\s*(?:≥|>=|不低于)?\s*[:=]?\s*(0?\.\d+|1(?:\.0+)?)/i);
  const phase = raw.match(/(?:单进单出|三进单出|三进三出|单进三出|1\s*[:/]\s*1|3\s*[:/]\s*1|3\s*[:/]\s*3)/)?.[0] || '';
  const phaseMap = { 单进单出: '1:1', 三进单出: '3:1', 三进三出: '3:3', 单进三出: '1:3' };
  const normalizedPhase = phaseMap[phase] || phase.replace(/\s/g, '').replace('/', ':') || null;
  const batteryType = /磷酸铁锂|锂电/.test(raw) ? 'lithium' : /铅酸/.test(raw) ? 'lead-acid' : null;
  const installation = /机架式/.test(raw) ? '机架式' : /落地式|塔式/.test(raw) ? '塔式' : null;
  const redundancy = /2\s*N/i.test(raw) ? '2N' : /N\s*\+\s*1/i.test(raw) ? 'N+1' : null;
  return { capacityKva: capacity, loadKw, loadKva, backupMinutes, parallelUnits, batteryCells, outputPowerFactor,
    inputOutputPhase: normalizedPhase, batteryType, installation, redundancy,
    needsSnmp: /SNMP/i.test(raw), sourceText: source };
}

export function normalizeUpsRequirement(value = {}) {
  return {
    capacityKva: number(value.capacityKva), loadKw: number(value.loadKw), loadKva: number(value.loadKva),
    backupMinutes: number(value.backupMinutes), parallelUnits: number(value.parallelUnits),
    batteryCells: number(value.batteryCells), outputPowerFactor: number(value.outputPowerFactor),
    inputOutputPhase: ['1:1', '3:1', '3:3', '1:3'].includes(value.inputOutputPhase) ? value.inputOutputPhase : null,
    batteryType: ['lead-acid', 'lithium'].includes(value.batteryType) ? value.batteryType : null,
    installation: ['机架式', '塔式'].includes(value.installation) ? value.installation : null,
    redundancy: ['N', 'N+1', '2N'].includes(value.redundancy) ? value.redundancy : null,
    needsSnmp: Boolean(value.needsSnmp), sourceText: String(value.sourceText ?? ''), confirmedAt: value.confirmedAt || null,
    ...normalizeEvidence(value)
  };
}

function parseBatteryCells(value) {
  const raw = text(value);
  if (isMissing(raw)) return null;
  const range = raw.match(/^(\d+)\s*[-~至]\s*(\d+)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const values = [...raw.matchAll(/\d+/g)].map(match => Number(match[0]));
  return values.length ? { values } : null;
}

export function normalizeUpsProduct(product = {}) {
  const description = text(product['描述']);
  const model = text(product['型号']);
  const capacityKva = firstNumber(description.match(/(\d+(?:\.\d+)?)\s*kVA/i)?.[1]);
  const pf = firstNumber(product['功率因数']);
  const phase = description.match(/单进单出|三进单出|三进三出|单进三出/)?.[0] || '';
  const phaseMap = { 单进单出: '1:1', 三进单出: '3:1', 三进三出: '3:3', 单进三出: '1:3' };
  const parallelRaw = text(product['并机数量']);
  const parallelMax = /无|不支持/.test(parallelRaw) ? 1 : firstNumber(parallelRaw);
  return {
    model, capacityKva, outputKw: capacityKva && pf ? capacityKva * pf : null,
    outputPowerFactor: pf, inputOutputPhase: phaseMap[phase] || null,
    parallelMax, batteryCells: parseBatteryCells(product['电池']),
    batteryType: /磷酸铁锂|锂电/.test(`${description} ${product['电池'] || ''}`) ? 'lithium'
      : /铅酸/.test(`${description} ${product['电池'] || ''}`) ? 'lead-acid' : null,
    installation: /机架/.test(text(product['安装'])) ? '机架式' : /塔|落地/.test(text(product['安装'])) ? '塔式' : null,
    snmp: /SNMP/i.test(text(product['通讯'])) ? 'compatible' : isMissing(product['通讯']) ? null : 'not-listed',
    description
  };
}

export function assessUpsProduct(product, requirement, catalogEntry = {}) {
  const p = normalizeUpsProduct(product);
  const r = normalizeUpsRequirement(requirement);
  const checks = [];
  const add = (key, label, status, detail) => checks.push({ key, label, status, detail });
  const compareMin = (key, label, actual, minimum, unit = '') => {
    if (minimum == null) return;
    add(key, label, actual == null ? 'unknown' : actual + 1e-9 >= minimum ? 'pass' : 'fail',
      actual == null ? '产品资料缺失' : `${actual.toFixed(2).replace(/\.00$/, '')}${unit} / 要求≥${minimum}${unit}`);
  };

  const units = r.parallelUnits || 1;
  compareMin('capacity', '额定容量', p.capacityKva == null ? null : p.capacityKva * units, r.capacityKva, 'kVA');
  compareMin('loadKva', '视在负荷', p.capacityKva == null ? null : p.capacityKva * units, r.loadKva, 'kVA');
  if (r.loadKw != null) {
    const available = p.outputKw == null ? null : p.outputKw * (r.redundancy === 'N+1' ? units - 1 : units);
    if (r.redundancy === 'N+1' && !r.parallelUnits) add('redundancy', 'N+1 故障容量', 'unknown', '须确认并机台数');
    else compareMin('loadKw', r.redundancy === 'N+1' ? 'N+1 故障容量' : '有功负荷', available, r.loadKw, 'kW');
  }
  if (r.redundancy === '2N') add('redundancy', '2N 独立系统', 'unknown', '需分别核对两套独立 UPS，不能按总台数推断');
  if (r.parallelUnits != null) compareMin('parallel', '并机台数', p.parallelMax, r.parallelUnits, '台');
  if (r.parallelUnits > 1) {
    for (const [key, label, field] of [['parallelCard', '并机卡兼容', '并机卡'], ['parallelCable', '并机线兼容', '并机线']]) {
      const value = text(product[field]);
      add(key, label, isMissing(value) ? 'unknown' : 'pass',
        isMissing(value) ? '产品资料未确认；需核对是否内置或另配' : `${value}；实际数量和长度须人工确认`);
    }
  }
  if (r.inputOutputPhase) add('phase', '输入/输出制式', p.inputOutputPhase == null ? 'unknown' : p.inputOutputPhase === r.inputOutputPhase ? 'pass' : 'fail',
    p.inputOutputPhase == null ? '产品资料缺失' : `${p.inputOutputPhase} / 要求 ${r.inputOutputPhase}`);
  compareMin('pf', '输出功率因数', p.outputPowerFactor, r.outputPowerFactor);
  if (r.installation) add('installation', '安装方式', p.installation == null ? 'unknown' : p.installation === r.installation ? 'pass' : 'fail',
    p.installation == null ? '产品资料缺失' : `${p.installation} / 要求 ${r.installation}`);
  if (r.batteryCells != null) {
    const spec = p.batteryCells;
    const supported = spec && (spec.values?.includes(r.batteryCells) ||
      (spec.min <= r.batteryCells && r.batteryCells <= spec.max));
    add('batteryCells', '电池节数', spec == null ? 'unknown' : supported ? 'pass' : 'fail',
      spec == null ? '产品资料缺失' : `${text(product['电池'])} / 要求 ${r.batteryCells}节`);
  }
  if (r.batteryType) add('batteryType', '电池类型兼容', p.batteryType == null ? 'unknown' : p.batteryType === r.batteryType ? 'pass' : 'fail',
    p.batteryType == null ? '产品资料未确认化学体系兼容性' : p.batteryType);
  if (r.backupMinutes != null) add('runtime', '后备时间', 'unknown', `目标 ${r.backupMinutes}分钟；需结合电池配置与放电曲线校核`);
  if (r.needsSnmp) add('snmp', 'SNMP 监控', p.snmp === 'compatible' ? 'pass' : 'unknown',
    p.snmp === 'compatible' ? '产品资料列为可选/支持；是否随主机配置需另核' : '产品资料未确认');
  const status = text(catalogEntry.status) || 'unverified';
  add('lifecycle', '在售状态', status === 'active' ? 'pass' : status === 'discontinued' ? 'fail' : 'unknown',
    status === 'active' ? `已核对 ${catalogEntry.reviewedAt || ''}`.trim() : status === 'discontinued' ? '已停产/失效' : '尚未核对');
  if (!checks.some(item => item.key !== 'lifecycle')) add('requirements', '技术条件', 'unknown', '尚未确认可校核的硬条件');
  const overall = checks.some(item => item.status === 'fail') ? 'fail'
    : checks.some(item => item.status === 'unknown') ? 'unknown' : 'pass';
  return { model: p.model, product: p, overall, checks, unknownCount: checks.filter(item => item.status === 'unknown').length,
    failCount: checks.filter(item => item.status === 'fail').length,
    source: catalogEntry.source || BUILTIN_CATALOG.source, catalogVersion: catalogEntry.version || BUILTIN_CATALOG.version,
    reviewedAt: catalogEntry.reviewedAt || null, lifecycle: status };
}

export function rankUpsProducts(products, requirement, catalogEntries = {}, limit = 5) {
  const r = normalizeUpsRequirement(requirement);
  const ranked = products.map(product => assessUpsProduct(product, r, catalogEntries[text(product['型号'])] || {}));
  const targetKva = r.capacityKva || r.loadKva || (r.loadKw && r.outputPowerFactor ? r.loadKw / r.outputPowerFactor : null);
  const score = item => {
    const capacity = item.product.capacityKva;
    const delta = targetKva && capacity ? Math.abs(capacity - targetKva) / targetKva : 0;
    return item.unknownCount * 100 + Math.min(delta, 10);
  };
  const sort = (a, b) => score(a) - score(b) || a.model.localeCompare(b.model, 'zh-CN');
  return {
    qualified: ranked.filter(item => item.overall === 'pass').sort(sort).slice(0, limit),
    pending: ranked.filter(item => item.overall === 'unknown').sort(sort).slice(0, limit),
    rejected: ranked.filter(item => item.overall === 'fail').sort(sort),
    counts: { qualified: ranked.filter(item => item.overall === 'pass').length,
      pending: ranked.filter(item => item.overall === 'unknown').length,
      rejected: ranked.filter(item => item.overall === 'fail').length }
  };
}

export function diffUpsCatalog(current = [], incoming = []) {
  const oldByModel = new Map(current.map(item => [text(item['型号']), item]));
  const newByModel = new Map(incoming.map(item => [text(item['型号']), item]));
  const added = [...newByModel.keys()].filter(model => !oldByModel.has(model));
  const removed = [...oldByModel.keys()].filter(model => !newByModel.has(model));
  const comparable = product => Object.fromEntries(Object.entries(product).filter(([key]) =>
    !/价格|目录价|成本|优惠|折扣|供应商/.test(key) && !['序号', '产品编码'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN')));
  const changed = [...newByModel.keys()].filter(model => oldByModel.has(model) &&
    JSON.stringify(comparable(newByModel.get(model))) !== JSON.stringify(comparable(oldByModel.get(model))));
  const unchanged = [...newByModel.keys()].filter(model => oldByModel.has(model) && !changed.includes(model));
  return { added, removed, changed, unchanged };
}
