import { createPresalesSnapshot, normalizePresalesConfig, verifyPresalesEvidence, PRODUCT_PROFILES } from './nonstandard-presales.js';
import { parsePduSpecClause } from './pdu-rules.js';
const fail = (test, message) => { if (!test) throw new Error(message); };
const text = v => String(v ?? '').trim();

export function createPduProposal(input, equipmentId, options) {
  createPresalesSnapshot(input);
  const equipment = input.equipment.find(e => e.id === equipmentId);
  fail(equipment?.category === 'pdu', 'PDU助手仅用于已登记PDU设备');
  const config = normalizePresalesConfig('pdu', options?.config || {});
  fail(config.pduType === 'rack', '请在采用配置中明确选择机架PDU；首版不套用柜式模板');
  const ids = options?.requirementIds;
  fail(Array.isArray(ids) && ids.length > 0 && ids.length <= 200 && new Set(ids).size === ids.length, '请明确选择1～200条本设备要求');
  const requirements = input.requirements.filter(r => r.equipmentId === equipmentId);
  const selected = ids.map(id => {
    const r = requirements.find(r => r.id === id);
    fail(r && r.reviewStatus !== 'stale' && r.candidates.length
      && r.candidates.every(c => verifyPresalesEvidence(input, c.evidence, c.value)), '选取条款跨设备、失效或证据不匹配');
    fail(r.response !== 'not-applicable' && r.response !== 'deviation', '偏离/不适用条款不能自动作为候选采用输入');
    return r;
  });
  let candidates = {}, outputRows = null;
  const issues = [], tentativeIds = new Set(), origins = new Map();
  for (const r of selected) for (const c of r.candidates) {
    const parsed = parsePduSpecClause(c.evidence.quote);
    fail(!parsed.issues.some(v => v.includes('多组输入')), '存在多组输入候选，请先拆分设备或澄清');
    issues.push(...parsed.issues.map(v => `${r.id}：${v}`));
    if (parsed.tentative) tentativeIds.add(r.id);
    for (const [key,value] of Object.entries(parsed.config)) {
      if (typeof value === 'number') fail(candidates[key] == null || candidates[key] === value, `${PRODUCT_PROFILES.pdu.fields[key].label}有不同原文候选，请先澄清`);
      else if (candidates[key] && candidates[key] !== value) candidates[key] = [...new Set(candidates[key].split('\n').concat(value))].join('\n');
      candidates[key] = typeof value === 'string' && candidates[key] ? candidates[key] : value;
      if (!origins.has(key)) origins.set(key, new Set()); origins.get(key).add(r.id);
    }
    if (parsed.outputs.length) {
      fail(outputRows == null || JSON.stringify(outputRows) === JSON.stringify(parsed.outputs), '存在不同插座组合候选，请先拆分设备或澄清');
      outputRows = parsed.outputs;
    }
  }
  // 存在未完整识别的输出条款时，不把另一条的已知数量当最终完整输出。
  if (issues.some(v => v.includes('输出列表'))) { outputRows = null; delete candidates.outputCount; }
  if (issues.some(v => v.includes('输入规格'))) { delete candidates.voltageV; delete candidates.ratedCurrentA; }
  const confirmed = requirements.filter(r => r.field !== 'clause' && r.reviewStatus === 'confirmed' && r.response === 'met'
    && r.confirmedValue != null && r.forbiddenDeviation != null && r.candidates.length
    && r.candidates.every(c => verifyPresalesEvidence(input,c.evidence,c.value)));
  for (const r of confirmed) {
    fail(candidates[r.field] == null || JSON.stringify(candidates[r.field]) === JSON.stringify(r.confirmedValue), `${PRODUCT_PROFILES.pdu.fields[r.field].label}候选与已确认要求不一致`);
    candidates[r.field] = r.confirmedValue;
  }
  for (const [key,value] of Object.entries(candidates)) {
    fail(config[key] == null || JSON.stringify(config[key]) === JSON.stringify(value), `${PRODUCT_PROFILES.pdu.fields[key].label}采用输入与原文候选不一致，请先复核`);
    config[key] = value;
  }
  const component = (name,specification,quantity,unit,role,linked) => ({
    name,specification,quantity,unit,role,brand:'',model:'',code:'',modelStatus:'pending',requirementIds:linked,
    reference:`原文候选要求：${linked.join('、')}；未自动确认采用，厂家型号待核对`,
    risk: linked.some(id=>tentativeIds.has(id)) ? '原文限定后续/设计联络确定，采用参数待确认' : ''
  });
  const components = [];
  if (candidates.voltageV != null || candidates.ratedCurrentA != null) {
    components.push(component('PDU输入及接线', `输入${config.voltageV ?? '待确认'}V ${config.ratedCurrentA ?? '待确认'}A；接口及保护待确认`,null,'个','input',
      [...new Set([...(origins.get('voltageV') || []),...(origins.get('ratedCurrentA') || [])])]));
  }
  if (outputRows) {
    const linked = [...(origins.get('outputCount') || [])];
    components.push(...outputRows.map(row=>component('PDU输出插座',row.specification,row.quantity,'个','output',linked)));
  } else if (selected.some(r=>r.candidates.some(c=>/输出.*插座/.test(c.evidence.quote)))) {
    components.push(component('PDU输出插座（明细待确认）','',null,'个','output',ids));
  }
  for (const [key,label] of [['monitoring','插座监控/远程控制'],['meteringLevel','本地计量']]) {
    if (candidates[key]) components.push(component(label,candidates[key],null,'套','accessory',[...(origins.get(key)||[])]));
  }
  fail(components.length > 0, '选取条款尚不能生成PDU输入/插座/计量监控项，请保留要求并人工配置');
  fail(components.every(c=>c.quantity == null || equipment.quantity == null || Number.isSafeInteger(c.quantity * equipment.quantity)), 'PDU清单总数量超出安全整数范围');
  return { equipmentId,name:text(options.name)||`${equipment.label}PDU询价讨论稿`,config,components,
    origin:'pdu-assistant',assistant:{version:1,kind:'pdu-spec',sourceRevision:input.revision,sourceRequirementIds:[...ids]},
    requirementIds:requirements.map(r=>r.id),
    assumptions:['选取原文只生成候选草稿，不自动确认要求或满足应答；区域PDU数量由设备项明确登记。',
      ...[...tentativeIds].map(id=>`要求${id}包含暂定/设计联络限定语，采用参数待确认。`),...issues],
    exclusions:['输入接口/保护分路/附件数量、品牌型号及完整接线保护设计不自动补齐；非完整生产BOM。'] };
}
