// 售前数据底座：无DOM、无存储、无价格，不作工程合规结论。
import { calculateSmartBuswayDesign } from './engineering-calculators.js';
import { validateCabinetAssistant, cabinetAssistantProblems, cabinetSchemeNarrative } from './cabinet-rules.js';
import { validatePduAssistant, pduAssistantProblems, pduSchemeNarrative } from './pdu-rules.js';
import { validateBuswayAssistant, buswayAssistantProblems, buswaySchemeNarrative } from './busway-rules.js';

export const PRESALES_CONTRACT_VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto.randomUUID();
const text = value => String(value ?? '').trim();
const unknown = value => value == null || text(value) === '' || /^(?:X{2,}|待确认|待选型|按图|未知)$/i.test(text(value));
const field = (label, type = 'text', unit = '', options = null) => ({ label, type, unit, options });
const common = {
  voltageV: field('额定电压', 'positive', 'V'), frequencyHz: field('频率', 'positive', 'Hz'),
  ratedCurrentA: field('额定电流', 'positive', 'A'), phase: field('相制', 'enum', '', ['single', 'three', 'dc']),
  ipRating: field('防护等级'), installation: field('安装方式'), widthMm: field('宽', 'positive', 'mm'),
  heightMm: field('高', 'positive', 'mm'), depthMm: field('深', 'positive', 'mm'),
  brandRequirement: field('品牌要求'), monitoring: field('监控'), communication: field('通信'), supplyBoundary: field('供货边界')
};
const counts = entries => Object.fromEntries(entries.map(([key, label]) => [key, field(label, 'count')]));
const profiles = {
  cabinet: { label: '配电柜', fields: { ...common,
    ...counts([['incomingCount', '进线数量'], ['tieCount', '母联数量'], ['outgoingCount', '出线数量'], ['spareCount', '备用数量']]),
    cabinetType: field('柜型与用途'), busbarCurrentA: field('主母线电流', 'positive', 'A'),
    neutralRatioPct: field('N线比例', 'positive', '%'), shortCircuitKa: field('短路耐受', 'positive', 'kA'),
    shortCircuitDurationS: field('耐受时间', 'positive', 's'), incomingProtection: field('进线保护'),
    outgoingProtection: field('出线保护'), metering: field('计量'), cableEntry: field('电缆接口'),
    earthing: field('接地'), spdRequirement: field('SPD要求') } },
  pdu: { label: 'PDU', fields: { ...common,
    ...counts([['inputCount', '输入数量'], ['outputCount', '输出数量'], ['branchCount', '保护分路数量'], ['spareCount', '备用数量']]),
    pduType: field('PDU类型', 'enum', '', ['rack', 'cabinet']), inputInterface: field('输入接口'),
    outputInterface: field('输出接口'), branchProtection: field('分路保护'), meteringLevel: field('计量层级'),
    phaseAssignment: field('相别分配'), redundancy: field('冗余方式'), earthing: field('接地'),
    spdRequirement: field('SPD要求'), rackUnits: field('机架高度', 'positive', 'U') } },
  busway: { label: '智能母线', fields: { ...common,
    ...counts([['rackCount', '机柜数量'], ['runCount', '母线路数'], ['terminalCount', '始端箱数量'], ['controllerCount', '主控箱数量'], ['endpointCount', '端口箱数量'], ['plugBoxCount', '插接箱数量'], ['spareCount', '备用数量'], ['plugBoxOutputs', '插接箱输出路数']]),
    pathMode: field('路径', 'enum', '', ['A', 'B', 'AB']), buswayLengthM: field('母线长度', 'positive', 'm'),
    terminalCurrentA: field('始端箱电流', 'positive', 'A'), plugBoxCurrentA: field('插接箱电流', 'positive', 'A'),
    neutralRatioPct: field('N线比例', 'positive', '%'), shortCircuitKa: field('短路耐受', 'positive', 'kA'),
    layoutNote: field('布局说明'), plugBoxGrouping: field('插接箱分组'), antiCondensation: field('防凝露'),
    supports: field('支架'), endAccessories: field('末端附件') } }
};
function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
export const PRODUCT_PROFILES = freeze(profiles);
export const COMPONENT_ROLES = freeze({
  cabinet: { other: '其他/待归类', incoming: '进线', tie: '母联', outgoing: '出线', accessory: '附件' },
  pdu: { other: '其他/待归类', input: '输入接口', output: '输出接口', branch: '保护分路', accessory: '附件' },
  busway: { other: '其他/待归类', busway: '母线段', terminal: '始端箱', controller: '主控箱', endpoint: '端口箱', plugbox: '插接箱（含备用）', accessory: '附件' }
});
function assert(ok, message) { if (!ok) throw new Error(message); }
function quantity(value, integer = false) {
  if (unknown(value)) return null;
  assert(['string', 'number'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) > 0 && (!integer || Number.isSafeInteger(Number(value))), '数量须为明确的正数');
  return Number(value);
}
function valueFor(category, key, value) {
  const definition = key === 'clause' ? field('条款') : PRODUCT_PROFILES[category]?.fields[key];
  assert(definition, `未知品类字段：${key}`);
  if (unknown(value)) return null;
  if (definition.type === 'text') { assert(typeof value === 'string', '文本字段须为文字'); return text(value); }
  if (definition.type === 'enum') { assert(definition.options.includes(value), `${key}枚举值非法`); return value; }
  assert(['string', 'number'].includes(typeof value) && text(value) !== '' && Number.isFinite(Number(value)), `${key}数值非法`);
  const number = Number(value);
  assert(definition.type === 'count' ? Number.isSafeInteger(number) && number >= 0 : number > 0, `${key}数值超出字段范围`);
  return number;
}
function configFor(category, input = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '配置须为字段对象');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    assert(Object.hasOwn(PRODUCT_PROFILES[category].fields, key), `未知配置字段：${key}`);
    return [key, valueFor(category, key, value)];
  }));
}
export function normalizePresalesConfig(category, input = {}) {
  assert(Object.hasOwn(PRODUCT_PROFILES, category), '未知设备品类');
  return configFor(category, input);
}
function equipmentFor(pack, id) { const item = pack.equipment.find(e => e.id === id); assert(item, '设备归属不存在'); return item; }
function schemeFor(pack, id) { const item = pack.schemes.find(e => e.id === id); assert(item, '方案不存在'); return item; }
function integrity(pack) {
  assert(pack?.contractVersion === PRESALES_CONTRACT_VERSION, '不支持的售前数据版本');
  assert(Number.isInteger(pack.revision) && pack.revision >= 0 && text(pack.id), '数据包标识或版本非法');
  for (const key of ['sources', 'equipment', 'requirements', 'schemes', 'revisions']) assert(Array.isArray(pack[key]), `${key}须为数组`);
  const ids = new Set();
  for (const item of [...pack.sources, ...pack.equipment, ...pack.requirements, ...pack.schemes]) {
    assert(text(item.id) && !ids.has(item.id), '标识缺失或重复'); ids.add(item.id);
  }
  for (const item of pack.equipment) {
    assert(PRODUCT_PROFILES[item.category] && text(item.label) && text(item.unit), '未知设备品类或设备信息缺失');
    assert(quantity(item.quantity, true) === item.quantity, '设备数量不是规范化值');
  }
  for (const item of pack.sources) sourceShape(item);
  const fieldKeys = new Set();
  for (const item of pack.requirements) {
    const equipment = item.equipmentId == null ? null : equipmentFor(pack, item.equipmentId);
    assert(item.field === 'clause' || equipment && PRODUCT_PROFILES[equipment.category].fields[item.field], '要求字段/归属非法');
    if (item.field !== 'clause') {
      const key = `${item.equipmentId}/${item.field}`; assert(!fieldKeys.has(key), '设备标量要求重复'); fieldKeys.add(key);
    }
    assert(Array.isArray(item.candidates), '候选须为数组');
    for (const candidate of item.candidates) {
      const value = equipment ? valueFor(equipment.category, item.field, candidate.value) : unknown(candidate.value) ? null : text(candidate.value);
      assert(value === candidate.value && candidate.evidence && typeof candidate.evidence.quote === 'string', '候选值或证据结构非法');
    }
    assert(['pending', 'unknown', 'conflict', 'confirmed', 'stale'].includes(item.reviewStatus), '要求状态非法');
    assert([true, false, null].includes(item.forbiddenDeviation), '禁止偏离标记非法');
    assert(['pending', 'met', 'deviation', 'not-applicable'].includes(item.response), '应答状态非法');
    if (equipment) assert(valueFor(equipment.category, item.field, item.confirmedValue) === item.confirmedValue, '确认值不是规范化值');
    if (item.reviewStatus === 'confirmed') assert(text(item.decisionReason), '要求确认缺少复核原因');
  }
  for (const scheme of pack.schemes) {
    const equipment = equipmentFor(pack, scheme.equipmentId);
    if (scheme.origin === 'cabinet-assistant') {
      validateCabinetAssistant(scheme.assistant, equipment.category, pack.revision);
    } else if (scheme.origin === 'pdu-assistant') {
      validatePduAssistant(scheme.assistant, equipment.category, pack.revision);
      checkRequirementLinks(pack, scheme.equipmentId, scheme.assistant.sourceRequirementIds);
      assert(scheme.assistant.sourceRequirementIds.every(id => scheme.requirementIds.includes(id)), 'PDU助手来源要求未关联方案');
    } else if (scheme.origin === 'busway-assistant') {
      validateBuswayAssistant(scheme.assistant, equipment.category, pack.revision);
      checkRequirementLinks(pack, scheme.equipmentId, scheme.assistant.sourceRequirementIds);
      assert(Array.isArray(scheme.requirementIds) && scheme.assistant.sourceRequirementIds.every(id => scheme.requirementIds.includes(id)), '母线助手来源要求未关联方案');
    } else {
      assert(scheme.assistant == null, '助手来源标记不一致');
    }
    assert(text(scheme.name) && JSON.stringify(configFor(equipment.category, scheme.config)) === JSON.stringify(scheme.config), '方案名称或配置非法');
    assert(['pending', 'confirmed'].includes(scheme.reviewStatus), '方案状态非法');
    assert(Array.isArray(scheme.components) && Array.isArray(scheme.requirementIds) && Array.isArray(scheme.assumptions) && Array.isArray(scheme.exclusions), '方案明细非法');
    checkRequirementLinks(pack, scheme.equipmentId, scheme.requirementIds);
    const componentIds = new Set();
    for (const component of scheme.components) {
      assert(text(component.id) && !componentIds.has(component.id), '组件标识缺失或重复'); componentIds.add(component.id);
      const normalized = componentFor(component);
      assert(normalized.quantity === component.quantity, '组件数量不是规范化值');
      checkRequirementLinks(pack, scheme.equipmentId, component.requirementIds);
      assert(Object.hasOwn(COMPONENT_ROLES[equipment.category], component.role || 'other'), '组件用途不属于本品类');
    }
  }
  return pack;
}
function changed(pack, kind, targetId, reason, equipmentId = null, detail = null) {
  assert(text(reason), '人工变更须填写原因');
  pack.revision += 1;
  pack.revisions.push({ revision: pack.revision, kind, targetId, reason: text(reason), at: new Date().toISOString(), detail: clone(detail) });
  pack.schemes.filter(s => equipmentId == null || s.equipmentId === equipmentId).forEach(s => { s.reviewStatus = 'pending'; });
  return pack;
}
export function createPresalesPackage(title = '') {
  return { contractVersion: 1, id: uid(), title: text(title), revision: 0, sources: [], equipment: [], requirements: [], schemes: [], revisions: [] };
}
export function addEquipment(input, item, reason) {
  const pack = clone(integrity(input));
  assert(PRODUCT_PROFILES[item.category] && text(item.label), '设备品类或标签缺失');
  const equipment = { id: uid(), category: item.category, label: text(item.label), quantity: quantity(item.quantity, true), unit: text(item.unit) || '套' };
  pack.equipment.push(equipment); return changed(pack, 'equipment:add', equipment.id, reason);
}
export function updateEquipmentQuantity(input, id, count, reason) {
  const pack = clone(integrity(input)), from = equipmentFor(pack, id).quantity;
  equipmentFor(pack, id).quantity = quantity(count, true);
  return changed(pack, 'equipment:quantity', id, reason, id, { from, to: equipmentFor(pack, id).quantity });
}
function sourceShape(source) {
  assert(text(source.name) && !/[\\/]/.test(source.name), '来源只保存文件名，不保存绝对路径');
  assert(['text', 'pdf', 'docx', 'xlsx', 'manual'].includes(source.type) && typeof source.text === 'string' && text(source.text), '资料为空或类型非法');
  assert(source.text.length <= 800000, '资料文字过多，请拆分');
  assert(Array.isArray(source.segments) && source.segments.length, '缺少可核对的来源范围');
  for (const segment of source.segments) {
    assert(Number.isInteger(segment.start) && Number.isInteger(segment.end) && segment.start >= 0 && segment.end > segment.start && segment.end <= source.text.length, '来源范围非法');
    if (source.type === 'pdf') assert(Number.isInteger(segment.page) && segment.page > 0, 'PDF须提供真实页序');
    if (source.type === 'xlsx') assert(text(segment.sheet) && text(segment.cell), 'XLSX须提供表名和单元格');
    if (segment.forbiddenDeviation != null) assert(typeof segment.forbiddenDeviation === 'boolean', '资料禁止偏离标记非法');
    if (segment.role != null) assert(['requirement', 'context', 'unclassified'].includes(segment.role), '单元格角色非法');
    if (segment.contextTitle) {
      const context = source.segments.find(s => s.sheet === segment.sheet && s.cell === segment.contextCell);
      assert(context && source.text.slice(context.start, context.end) === segment.contextTitle, '表格条款标题无法核对');
    }
    if (source.type === 'docx') assert(Number.isInteger(segment.paragraph) && segment.paragraph > 0 || text(segment.table), 'DOCX须提供段落或表格位置');
  }
}
function makeSource(item, id = uid()) {
  const source = { id, type: item.type, name: text(item.name).split(/[\\/]/).pop(), text: item.text, warnings: (item.warnings || []).map(text),
    segments: (item.segments || []).map(s => ({ start: s.start, end: s.end, ...(s.page != null ? { page: s.page } : {}),
      ...(s.paragraph != null ? { paragraph: s.paragraph } : {}), ...(s.table ? { table: text(s.table) } : {}),
      ...(s.sheet ? { sheet: text(s.sheet) } : {}), ...(s.cell ? { cell: text(s.cell) } : {}),
      ...(s.forbiddenDeviation != null ? { forbiddenDeviation: s.forbiddenDeviation } : {}),
      ...(s.role ? { role: s.role } : {}), ...(s.contextTitle ? { contextTitle: String(s.contextTitle), contextCell: text(s.contextCell) } : {}) })) };
  assert(source.name, '来源名称缺失'); sourceShape(source); return source;
}
export function addPresalesSource(input, source, reason) {
  const pack = clone(integrity(input)), item = makeSource(source); pack.sources.push(item);
  return changed(pack, 'source:add', item.id, reason);
}
export function replacePresalesSource(input, id, source, reason) {
  const pack = clone(integrity(input)), index = pack.sources.findIndex(s => s.id === id); assert(index >= 0, '资料来源不存在');
  const before = clone(pack.sources[index]); pack.sources[index] = makeSource(source, id);
  pack.requirements.filter(r => r.candidates.some(c => c.evidence?.sourceId === id)).forEach(r => { r.reviewStatus = 'stale'; });
  return changed(pack, 'source:replace', id, reason, null, { from: before, to: pack.sources[index] });
}
export function verifyPresalesEvidence(pack, evidence, value) {
  const source = pack.sources.find(s => s.id === evidence?.sourceId);
  const segment = source?.segments.find(s => evidence.start >= s.start && evidence.end <= s.end);
  if (!segment || !Number.isInteger(evidence.start) || !Number.isInteger(evidence.end) || evidence.end <= evidence.start || !text(evidence.quote)
    || source.text.slice(evidence.start, evidence.end) !== evidence.quote) return false;
  if (unknown(value)) return true; // 按图/占位可以有条款证据，但不会得到数值。
  if (typeof value === 'number') return [...evidence.quote.matchAll(/\d+(?:\.\d+)?/g)].some(m => Number(m[0]) === value);
  return evidence.quote.includes(String(value));
}
export function addRequirement(input, item, reason) {
  const pack = clone(integrity(input));
  const equipment = item.equipmentId == null ? null : equipmentFor(pack, item.equipmentId);
  assert(equipment || item.field === 'clause', '未分配条款只能保留文字');
  const candidates = (item.candidates || []).map(c => {
    const value = equipment ? valueFor(equipment.category, item.field, c.value) : unknown(c.value) ? null : text(c.value);
    assert(verifyPresalesEvidence(pack, c.evidence, value), '候选值或原文证据无法核对');
    return { value, evidence: clone(c.evidence) };
  });
  // 标量要求按设备×字段唯一；追加来源必须进入同一个冲突池。
  const prior = item.field === 'clause' ? null : pack.requirements.find(r => r.equipmentId === equipment?.id && r.field === item.field);
  if (prior) {
    const before = clone(prior);
    prior.candidates = prior.reviewStatus === 'stale' ? candidates : [...prior.candidates, ...candidates];
    const distinct = new Set(prior.candidates.filter(c => c.value != null).map(c => JSON.stringify(c.value)));
    prior.reviewStatus = distinct.size > 1 ? 'conflict' : distinct.size ? 'pending' : 'unknown';
    prior.confirmedValue = null; prior.response = 'pending'; prior.decisionReason = '';
    prior.forbiddenDeviation = prior.forbiddenDeviation === (item.forbiddenDeviation ?? null) ? prior.forbiddenDeviation : null;
    return changed(pack, 'requirement:append', prior.id, reason, prior.equipmentId, { from: before, to: prior });
  }
  const distinct = new Set(candidates.filter(c => c.value != null).map(c => JSON.stringify(c.value)));
  const requirement = { id: uid(), equipmentId: equipment?.id || null, field: item.field, candidates,
    confirmedValue: null, reviewStatus: distinct.size > 1 ? 'conflict' : distinct.size ? 'pending' : 'unknown',
    forbiddenDeviation: item.forbiddenDeviation ?? null, response: 'pending', decisionReason: '' };
  assert([true, false, null].includes(requirement.forbiddenDeviation), '禁止偏离标记非法');
  pack.requirements.push(requirement); return changed(pack, 'requirement:add', requirement.id, reason, requirement.equipmentId);
}
export function confirmPresalesRequirement(input, id, decision, reason) {
  const pack = clone(integrity(input)), requirement = pack.requirements.find(r => r.id === id); assert(requirement, '要求不存在');
  assert(requirement.reviewStatus !== 'stale', '来源已替换，请重新提取要求');
  assert(requirement.candidates.length > 0, '缺少原文候选，不能确认要求');
  const equipment = equipmentFor(pack, requirement.equipmentId);
  const value = valueFor(equipment.category, requirement.field, decision.value);
  assert(value != null, '未知要求不能确认');
  assert(requirement.candidates.every(c => verifyPresalesEvidence(pack, c.evidence, c.value)), '证据已失效');
  assert(['met', 'deviation', 'not-applicable'].includes(decision.response), '须明确人工应答状态');
  const forbidden = Object.hasOwn(decision, 'forbiddenDeviation') ? decision.forbiddenDeviation : requirement.forbiddenDeviation;
  assert(typeof forbidden === 'boolean', '须复核禁止偏离标记');
  assert(!(forbidden && decision.response === 'deviation'), '禁止偏离条款不能以偏离方式确认');
  const before = clone(requirement);
  requirement.confirmedValue = value; requirement.response = decision.response;
  requirement.forbiddenDeviation = forbidden; requirement.reviewStatus = 'confirmed'; requirement.decisionReason = text(reason);
  return changed(pack, 'requirement:confirm', id, reason, equipment.id, { from: before, to: requirement });
}
export function revisePresalesRequirement(input, id, value, reason) {
  const pack = clone(integrity(input)), requirement = pack.requirements.find(r => r.id === id); assert(requirement, '要求不存在');
  const equipment = equipmentFor(pack, requirement.equipmentId), before = clone(requirement);
  requirement.confirmedValue = valueFor(equipment.category, requirement.field, value);
  requirement.response = 'pending'; requirement.decisionReason = text(reason);
  requirement.reviewStatus = requirement.reviewStatus === 'stale' ? 'stale' : requirement.confirmedValue == null ? 'unknown' : 'pending';
  return changed(pack, 'requirement:revise', id, reason, equipment.id, { from: before, to: requirement });
}
export function invalidatePresalesRequirement(input, id, reason = '复核输入已修改，需重新确认') {
  const pack = clone(integrity(input)), requirement = pack.requirements.find(r => r.id === id); assert(requirement, '要求不存在');
  if (requirement.reviewStatus !== 'confirmed') return pack;
  const before = clone(requirement); requirement.reviewStatus = 'pending'; requirement.response = 'pending';
  return changed(pack, 'requirement:invalidate', id, reason, requirement.equipmentId, { from: before, to: requirement });
}
export function remapPresalesRequirement(input, id, equipmentId, fieldName, candidates, reason) {
  const pack = clone(integrity(input)), requirement = pack.requirements.find(r => r.id === id); assert(requirement, '要求不存在');
  assert(!pack.schemes.some(s => s.requirementIds.includes(id) || s.components.some(c => c.requirementIds.includes(id))), '条款已关联方案，请先调整方案关联再重分配');
  const before = clone(requirement);
  pack.requirements = pack.requirements.filter(r => r.id !== id);
  const updated = addRequirement(pack, { equipmentId, field: fieldName, candidates, forbiddenDeviation: requirement.forbiddenDeviation }, reason);
  const target = fieldName === 'clause' ? updated.requirements.at(-1) : updated.requirements.find(r => r.equipmentId === equipmentId && r.field === fieldName);
  return changed(updated, 'requirement:remap', id, reason, equipmentId, { from: before, to: target });
}
export function retireStaleSourceRequirements(input, sourceId) {
  const pack = clone(integrity(input)), retired = [];
  for (const requirement of pack.requirements) {
    if (requirement.reviewStatus !== 'stale' || !requirement.candidates.some(c => c.evidence.sourceId === sourceId)) continue;
    assert(!pack.schemes.some(s => s.requirementIds.includes(requirement.id) || s.components.some(c => c.requirementIds.includes(requirement.id))), '失效条款已关联方案，请先调整方案关联再重新提取');
    retired.push(clone(requirement));
    requirement.candidates = requirement.candidates.filter(c => c.evidence.sourceId !== sourceId);
    requirement.confirmedValue = null; requirement.response = 'pending'; requirement.reviewStatus = 'pending'; requirement.decisionReason = '';
  }
  if (!retired.length) return pack;
  pack.requirements = pack.requirements.filter(r => !retired.some(old => old.id === r.id) || r.candidates.length);
  return changed(pack, 'requirement:retire-stale', sourceId, '重新提取资料，失效条款归档至修订记录', null, { retired });
}
function componentFor(item) {
  assert(text(item.name), '组件名称缺失');
  const component = { id: item.id || uid(), name: text(item.name), specification: unknown(item.specification) ? '' : text(item.specification),
    quantity: quantity(item.quantity), unit: text(item.unit), brand: text(item.brand), model: unknown(item.model) ? '' : text(item.model),
    code: unknown(item.code) ? '' : text(item.code), modelStatus: item.modelStatus || 'pending', reference: text(item.reference),
    requirementIds: clone(item.requirementIds || []), risk: text(item.risk), role: item.role || 'other' };
  assert(['pending', 'verified'].includes(component.modelStatus), '型号核对状态非法');
  assert(component.modelStatus !== 'verified' || (component.model || component.code) && component.reference, '型号核对须有型号/编码及依据');
  return component;
}
function checkRequirementLinks(pack, equipmentId, ids) {
  assert(Array.isArray(ids) && new Set(ids).size === ids.length, '要求关联重复或非法');
  for (const id of ids) assert(pack.requirements.some(r => r.id === id && r.equipmentId === equipmentId), '要求关联跨设备或不存在');
}
export function adoptPresalesScheme(input, item, reason) {
  const pack = clone(integrity(input)), equipment = equipmentFor(pack, item.equipmentId);
  const existing = item.id ? schemeFor(pack, item.id) : null;
  assert(item.assistant == null || ['cabinet-assistant','pdu-assistant','busway-assistant'].includes(item.origin), '助手来源标记不一致');
  assert(!existing || existing.equipmentId === equipment.id, '不能更改方案设备归属');
  assert(text(item.name), '方案名称缺失');
  const scheme = { id: existing?.id || uid(), equipmentId: equipment.id, name: text(item.name),
    config: configFor(equipment.category, item.config), components: (item.components || []).map(componentFor),
    assumptions: (item.assumptions || []).map(text), exclusions: (item.exclusions || []).map(text),
    requirementIds: clone(item.requirementIds || []), origin: ['busway-calculator', 'cabinet-assistant','pdu-assistant','busway-assistant'].includes(item.origin) ? item.origin : 'manual', reviewStatus: 'pending',
    ...(item.origin === 'cabinet-assistant' ? { assistant: validateCabinetAssistant(item.assistant, equipment.category, pack.revision) } : {}),
    ...(item.origin === 'pdu-assistant' ? { assistant: validatePduAssistant(item.assistant, equipment.category, pack.revision) } : {}),
    ...(item.origin === 'busway-assistant' ? { assistant: validateBuswayAssistant(item.assistant, equipment.category, pack.revision) } : {}) };
  checkRequirementLinks(pack, equipment.id, scheme.requirementIds);
  scheme.components.forEach(c => checkRequirementLinks(pack, equipment.id, c.requirementIds));
  if (existing) pack.schemes[pack.schemes.indexOf(existing)] = scheme; else pack.schemes.push(scheme);
  changed(pack, 'scheme:adopt', scheme.id, reason, equipment.id, { from: existing, to: scheme }); integrity(pack); return pack;
}
export function schemeReviewProblems(input, id) {
  const pack = integrity(input), scheme = schemeFor(pack, id), equipment = equipmentFor(pack, scheme.equipmentId), problems = [];
  problems.push(...cabinetAssistantProblems(scheme));
  problems.push(...pduAssistantProblems(scheme));
  problems.push(...buswayAssistantProblems(scheme,equipment));
  if (equipment.quantity == null) problems.push('设备数量待确认');
  if (!Object.values(scheme.config).some(v => v != null)) problems.push('配置为空');
  if (!text(scheme.config.supplyBoundary)) problems.push('供货边界待确认');
  if (equipment.category === 'pdu' && !scheme.config.pduType) problems.push('PDU类型待确认');
  const requirements = pack.requirements.filter(r => r.equipmentId === equipment.id);
  if (!requirements.length) problems.push('尚未复核设备技术要求');
  if (pack.requirements.some(r => r.equipmentId == null)) problems.push('存在未分配条款');
  for (const requirement of requirements) {
    const label = PRODUCT_PROFILES[equipment.category].fields[requirement.field]?.label || '全文条款';
    if (!scheme.requirementIds.includes(requirement.id)) problems.push(`${label}未关联采用方案`);
    if (requirement.reviewStatus !== 'confirmed' || requirement.confirmedValue == null || requirement.response === 'pending' || requirement.forbiddenDeviation == null
      || !requirement.candidates.length || requirement.candidates.some(c => !verifyPresalesEvidence(pack, c.evidence, c.value))) problems.push(`${label}要求待复核`);
    if (requirement.forbiddenDeviation && requirement.response === 'deviation') problems.push(`${label}禁止偏离`);
    if (requirement.field !== 'clause' && requirement.response !== 'not-applicable'
      && JSON.stringify(scheme.config[requirement.field] ?? null) !== JSON.stringify(requirement.confirmedValue)) {
      if (requirement.forbiddenDeviation || requirement.response !== 'deviation') problems.push(`${label}采用配置与确认要求不一致`);
    }
  }
  if (!scheme.components.length) problems.push('配置清单为空');
  for (const component of scheme.components) {
    if (component.quantity == null || !component.unit || !component.specification) problems.push(`${component.name}数量/规格/单位待确认`);
    if (component.modelStatus !== 'verified') problems.push(`${component.name}型号待核对`);
    if (component.risk) problems.push(`${component.name}：${component.risk}`);
  }
  const countFields = { cabinet: { incomingCount: 'incoming', tieCount: 'tie', outgoingCount: 'outgoing' },
    pdu: { inputCount: 'input', outputCount: 'output', branchCount: 'branch' },
    busway: { terminalCount: 'terminal', controllerCount:'controller', endpointCount:'endpoint', plugBoxCount: 'plugbox', buswayLengthM: 'busway' } };
  for (const [key, role] of Object.entries(countFields[equipment.category])) {
    const expected = scheme.config[key]; if (expected == null) continue;
    const components = scheme.components.filter(c => c.role === role);
    const units = key === 'buswayLengthM' ? ['m'] : ['个', '台', '只', '路', '套'];
    if (components.some(c => c.quantity == null || !units.includes(c.unit) || key !== 'buswayLengthM' && !Number.isInteger(c.quantity))) {
      problems.push(`${PRODUCT_PROFILES[equipment.category].fields[key].label}清单数量/单位待核对`); continue;
    }
    if (Math.abs(components.reduce((sum, c) => sum + c.quantity, 0) - expected) > 1e-9)
      problems.push(`${PRODUCT_PROFILES[equipment.category].fields[key].label}与清单用途数量不一致`);
  }
  return [...new Set(problems)];
}
export function invalidatePresalesScheme(input, id, reason = '方案编辑输入已修改，需重新保存并复核') {
  const pack = clone(integrity(input)), scheme = schemeFor(pack, id);
  if (scheme.reviewStatus !== 'confirmed') return pack;
  return changed(pack, 'scheme:invalidate', id, reason, scheme.equipmentId);
}
export function confirmPresalesScheme(input, id, reason) {
  const pack = clone(integrity(input)), problems = schemeReviewProblems(pack, id); assert(!problems.length, problems.join('；'));
  changed(pack, 'scheme:confirm', id, reason, schemeFor(pack, id).equipmentId);
  schemeFor(pack, id).reviewStatus = 'confirmed'; return pack;
}
export function buildPresalesDeliverable(input, id) {
  const pack = integrity(input), scheme = schemeFor(pack, id), equipment = equipmentFor(pack, scheme.equipmentId);
  const problems = schemeReviewProblems(pack, id);
  const status = scheme.reviewStatus === 'confirmed' && !problems.length ? 'reviewed-presales' : 'discussion-draft';
  const bom = scheme.components.map(component => {
    const regionInvalid = scheme.origin === 'busway-assistant' && equipment.quantity !== 1;
    const totalQuantity = component.quantity == null || equipment.quantity == null || regionInvalid ? null : component.quantity * equipment.quantity;
    assert(totalQuantity == null || Number.isFinite(totalQuantity), '清单总数量超出数值范围，请核对数量');
    if (scheme.origin === 'cabinet-assistant' && ['incoming', 'tie', 'outgoing'].includes(component.role))
      assert(totalQuantity == null || Number.isSafeInteger(totalQuantity), '清单回路总数量超出安全整数范围');
    if (scheme.origin === 'pdu-assistant')
      assert(totalQuantity == null || Number.isSafeInteger(totalQuantity), 'PDU清单总数量超出安全整数范围');
    if (scheme.origin === 'busway-assistant')
      assert(totalQuantity == null || totalQuantity <= Number.MAX_SAFE_INTEGER && (['busway','accessory'].includes(component.role) || Number.isSafeInteger(totalQuantity)), '母线区域清单总数量超出安全用途范围');
    return { ...clone(component), schemeId: id, equipmentId: equipment.id,
      packageRevision: pack.revision, perEquipmentQuantity: component.quantity, equipmentQuantity: equipment.quantity, totalQuantity };
  });
  return { contractVersion: 1, packageId: pack.id, packageRevision: pack.revision, status, schemeId: id, equipment: clone(equipment),
    title: scheme.name, config: clone(scheme.config), bom, assumptions: clone(scheme.assumptions), exclusions: clone(scheme.exclusions),
    requirements: clone(pack.requirements.filter(r => r.equipmentId === equipment.id)), sources: clone(pack.sources),
    description: [...cabinetSchemeNarrative(scheme),...pduSchemeNarrative(scheme),...buswaySchemeNarrative(scheme,equipment)], origin: scheme.origin,
    clarifications: problems, revisions: clone(pack.revisions), boundary: '仅供售前交流和报价；非生产图纸，非完整工程合规结论。' };
}
export function createPresalesSnapshot(input) { return { contractVersion: 1, packageRevision: input.revision, package: clone(integrity(input)) }; }
export function restorePresalesSnapshot(snapshot) {
  assert(snapshot?.contractVersion === 1 && snapshot.packageRevision === snapshot.package?.revision, '快照版本或修订不一致');
  const pack = clone(integrity(snapshot.package));
  for (const requirement of pack.requirements) assert(requirement.reviewStatus === 'stale' || requirement.candidates.every(c => verifyPresalesEvidence(pack, c.evidence, c.value)), '备份证据不匹配');
  pack.requirements.filter(r => r.reviewStatus === 'confirmed').forEach(r => { r.reviewStatus = 'pending'; });
  return changed(pack, 'snapshot:restore', pack.id, '恢复备份，重新复核采用配置');
}
export function adoptBuswayPresalesScheme(input, equipmentId, rawDesign, reason) {
  const equipment = equipmentFor(integrity(input), equipmentId); assert(equipment.category === 'busway', '仅母线设备可使用母线桥接');
  assert(Array.isArray(rawDesign?.rows) && rawDesign.rows.some(row => row.items?.some(item => item.kind === 'rack')), '母线桥接须提供实际采用布局');
  for (const key of ['voltage', 'powerFactor', 'safetyFactor', 'harmonicFactor']) assert(typeof rawDesign[key] === 'number' && rawDesign[key] > 0, `母线${key}输入不明确`);
  assert(typeof rawDesign.demandFactor === 'number' && rawDesign.demandFactor >= 0, '母线需用系数不明确');
  const result = calculateSmartBuswayDesign(clone(rawDesign));
  assert(!result.bomBlocked && !result.plugBoxBomBlocked && !result.issues.some(i => ['error', 'danger'].includes(i.severity)), '母线校核阻断，不能生成有效清单');
  assert(result.bom.length, '母线清单为空');
  return adoptPresalesScheme(input, { equipmentId, name: `${equipment.label}售前方案`, origin: 'busway-calculator',
    config: { buswayLengthM: result.accessories.buswayLengthM, runCount: result.runs.length, terminalCount: result.accessories.startBoxes,
      plugBoxCount: result.bom.filter(item => item.category === '插接箱').reduce((sum, item) => sum + item.quantity, 0), layoutNote: JSON.stringify(result.design.rows.map(row => ({ name: row.name, rackCount: row.rackCount }))) },
    components: result.bom.map(item => ({ name: item.category, specification: item.description, quantity: item.quantity,
      unit: item.unit, code: item.code, modelStatus: 'pending', reference: '现有智能母线计算目录；仍需人工核对厂家/企业资料',
      role: ({ 母线槽: 'busway', 始端箱: 'terminal', 插接箱: 'plugbox' })[item.category] || 'accessory',
      risk: item.status === 'pending' || item.status === 'manual-risk' ? `母线条目状态：${item.status}` : '' })),
    assumptions: result.issues.map(i => i.message), exclusions: ['短路、保护配合、结构及施工设计需另行复核'],
    requirementIds: input.requirements.filter(r => r.equipmentId === equipmentId).map(r => r.id)
  }, reason);
}
