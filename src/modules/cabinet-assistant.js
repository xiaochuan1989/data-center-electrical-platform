import { PRODUCT_PROFILES, createPresalesSnapshot, normalizePresalesConfig, verifyPresalesEvidence } from './nonstandard-presales.js';
import { CABINET_TEMPLATES, CABINET_CIRCUIT_FIELDS, CABINET_ROLE_LABELS } from './cabinet-rules.js';

const text = v => String(v ?? '').trim();
const fail = (test, message) => { if (!test) throw new Error(message); };
const roles = { ...Object.fromEntries(Object.keys(CABINET_ROLE_LABELS).map(k => [k, k])),
  ...Object.fromEntries(Object.entries(CABINET_ROLE_LABELS).map(([k, v]) => [v, k])) };
const unknown = v => v == null || /^(?:|未知|待确认|待选型|按图|X{2,})$/i.test(text(v));

export function parseCabinetCircuitTable(value) {
  fail(typeof value === 'string' && value.length <= 100000, '回路表须为不超过100000字符的文字');
  const lines = value.split(/\r?\n/).filter(v => v.trim());
  fail(lines.length, '请粘贴明确的回路表，不能生成空方案');
  const delimiter = lines[0].includes('\t') ? '\t' : '|';
  fail(lines.every(v => delimiter === '\t' ? !v.includes('|') : !v.includes('\t')), '回路表不能混用制表符与竖线');
  const rows = lines.map(v => v.split(delimiter).map(text));
  if (rows[0].join('|') === '用途|名称|功能规格|每套数量') rows.shift();
  fail(rows.length > 0 && rows.length <= 200, '回路表须包含1～200个明确分组');
  return rows.map((cells, index) => {
    fail(cells.length === 4, `回路表第${index + 1}组须为四列：用途、名称、功能规格、每套数量`);
    const [role, name, specification, quantity] = cells;
    return normalizeCircuit({ role, name, specification, quantity }, index);
  });
}

function normalizeCircuit(item, index) {
  fail(item && typeof item === 'object', `回路表第${index + 1}组非法`);
  const role = Object.hasOwn(roles, text(item.role)) ? roles[text(item.role)] : null;
  fail(role, `回路表第${index + 1}组用途只能为进线、母联或出线`);
  fail(typeof item.name === 'string' && text(item.name), `回路表第${index + 1}组名称缺失`);
  fail(unknown(item.specification) || typeof item.specification === 'string', `回路表第${index + 1}组规格须为文字`);
  let quantity = null;
  if (!unknown(item.quantity)) {
    fail(['number', 'string'].includes(typeof item.quantity) && Number.isSafeInteger(Number(item.quantity))
      && Number(item.quantity) > 0, `回路表第${index + 1}组数量须为正整数或留空`);
    quantity = Number(item.quantity);
  }
  return { role, name: text(item.name), specification: unknown(item.specification) ? '' : text(item.specification), quantity };
}

export function createCabinetProposal(input, equipmentId, options) {
  // 先验证现有数据结构，失效或未确认要求不会被自动带入。
  createPresalesSnapshot(input);
  const equipment = input.equipment.find(e => e.id === equipmentId);
  fail(equipment?.category === 'cabinet', '配电柜助手仅用于已登记配电柜设备');
  fail(options && Object.hasOwn(CABINET_TEMPLATES, options.template), '请明确选择配电柜结构骨架');
  fail(Array.isArray(options.circuits) && options.circuits.length > 0 && options.circuits.length <= 200, '回路表须包含1～200个明确分组');
  const circuits = options.circuits.map(normalizeCircuit);
  const config = normalizePresalesConfig('cabinet', options.config || {});
  const requirements = input.requirements.filter(r => r.equipmentId === equipmentId);
  const confirmed = requirements.filter(r => r.field !== 'clause' && r.reviewStatus === 'confirmed' && r.response === 'met'
    && r.confirmedValue != null && r.forbiddenDeviation != null && r.candidates.length
    && r.candidates.every(c => verifyPresalesEvidence(input, c.evidence, c.value)));
  for (const requirement of confirmed) {
    const existing = config[requirement.field];
    fail(existing == null || JSON.stringify(existing) === JSON.stringify(requirement.confirmedValue), `${PRODUCT_PROFILES.cabinet.fields[requirement.field].label}采用输入与已确认满足的要求不一致，请先复核采用值/偏离`);
    config[requirement.field] = requirement.confirmedValue;
  }
  if (options.template === 'distribution') {
    fail(!circuits.some(c => c.role === 'tie') && !(config.tieCount > 0), '不含母联骨架不能含母联回路或正母联数量');
    // 没有母联行不代表已明确数量0，仍需要求或人工输入。
  } else fail(config.tieCount !== 0, '含母联骨架不能明确采用母联数量0');
  for (const [role, key] of Object.entries(CABINET_CIRCUIT_FIELDS)) {
    const rows = circuits.filter(c => c.role === role);
    if (!rows.length || rows.some(c => c.quantity == null)) continue;
    const sum = rows.reduce((total, c) => total + c.quantity, 0);
    fail(Number.isSafeInteger(sum), `${CABINET_ROLE_LABELS[role]}数量合计超出安全整数范围`);
    fail(config[key] == null || config[key] === sum, `${CABINET_ROLE_LABELS[role]}数量与回路表合计不一致`);
    config[key] = sum;
  }
  fail(circuits.every(c => c.quantity == null || equipment.quantity == null || Number.isSafeInteger(c.quantity * equipment.quantity)), '清单回路总数量超出安全整数范围');
  return {
    equipmentId, name: text(options.name) || `${equipment.label}辅助方案讨论稿`, config,
    origin: 'cabinet-assistant', assistant: { version: 1, kind: 'cabinet-circuits', template: options.template, sourceRevision: input.revision },
    requirementIds: requirements.map(r => r.id),
    components: circuits.map(c => {
      const relevant = confirmed.filter(r => r.field === CABINET_CIRCUIT_FIELDS[c.role]
        || r.field === (c.role === 'incoming' ? 'incomingProtection' : c.role === 'outgoing' ? 'outgoingProtection' : 'clause'));
      return { ...c, unit: '路', brand: '', model: '', code: '', modelStatus: 'pending', risk: '',
        reference: `配电柜结构骨架；人工回路表设计输入，非自动原文提取${relevant.length ? `；相关确认要求：${relevant.map(r => r.id).join('、')}` : '；未建立逐行原文依据'}`,
        requirementIds: relevant.map(r => r.id) };
    }),
    assumptions: ['配置骨架仅整理人工回路表；所有分组规格须逐项核对厂家资料，不代表工程合格。'],
    exclusions: ['本草稿不自动补齐柜体、母线及附件清单；供货完整性、短路、温升、保护配合、结构与施工设计需专项复核。']
  };
}
