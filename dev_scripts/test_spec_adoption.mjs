import assert from 'node:assert/strict';
import { analyzeSpecSource } from '../src/modules/spec-extraction.js';
import { specAdoptionItems, specCategoryFor, specAdoptionKey } from '../src/modules/spec-adoption.js';
import { createPresalesPackage, addPresalesSource, adoptExtractedEquipment, confirmPresalesRequirement, remapPresalesRequirement,
  createPresalesSnapshot, restorePresalesSnapshot, replacePresalesSource, withdrawAdoptedEquipment, addEquipment } from '../src/modules/nonstandard-presales.js';
import { specResultMarkup } from '../src/platform/spec-extraction-view.js';

// Synthetic software fixtures only: a Word-like source split into paragraph segments.
const paragraphs = ['合成采用验收资料。', '一、PDU技术要求', '★1）PDU额定电流为32A。', '2）防护等级：IP20。', '额定绝缘电压（V） | 试验电压（V）', '≤60 | 1000',
  '3）输出插座为C13', '型，共24位。', '二、UPS主机', 'UPS主机额定功率为200kVA。', '带★标记条款：为本文中不可偏离项。'];
let text = '', segments = [];
paragraphs.forEach((p, i) => { const start = text.length; text += p + '\n'; segments.push({ start, end: start + p.length, paragraph: i + 1 }); });
const pack0 = addPresalesSource(createPresalesPackage('合成'), { type: 'docx', name: '合成采用验收.docx', text, segments, warnings: [] }, '导入合成资料');
const source = pack0.sources[0];
const detail = (name, value, original_text, extra = {}) => ({ name, value, original_text, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT', ...extra });
const request = async input => {
  const data = JSON.parse(input.user);
  if (data.task === 'review') return { complete: true, source_checked: true, checked_parameter_ids: data.review_parameters.map(p => p.parameter_id), issues: [] };
  if (data.task === 'discovery') return { complete: true, devices: [
    { device_type: 'PDU', device_name: '交流PDU', scope: '', original_text: '一、PDU技术要求' },
    { device_type: 'UPS主机', device_name: 'UPS主机', scope: '', original_text: '二、UPS主机' }] };
  return { complete: true, products: data.known_devices.map(d => ({ ...d, params_detail: d.device_type === 'PDU' ? [
    detail('额定电流', '32 A'.replace(' ', ''), '★1）PDU额定电流为32A。'),
    detail('防护等级', 'IP20', '2）防护等级：IP20。'),
    detail('试验电压（≤60V档）', '≤60 | 1000', '额定绝缘电压（V） | 试验电压（V）\n≤60 | 1000'),
    detail('输出插座', 'C13型', '3）输出插座为C13\n型，共24位。'),
    { name: '认证要求', value: '文档未明确要求', original_text: '', risk: 'LOW', evidence_status: 'NOT_STATED', source_status: 'NOT_IN_DOCUMENT' }]
    : [detail('额定功率', '200kVA', 'UPS主机额定功率为200kVA。')] })) };
};
const result = await analyzeSpecSource(source, { request });
const pdu = result.products.find(p => p.device_type === 'PDU'), ups = result.products.find(p => p.device_type === 'UPS主机');
assert.equal(specCategoryFor(pdu), 'pdu');
assert.equal(specCategoryFor(ups), null, 'UPS主机在人工方案中没有对应品类');
assert.equal(specCategoryFor({ device_type: '列头柜' }), 'cabinet');
assert.equal(specCategoryFor({ device_type: '智能母线槽' }), 'busway');

// 转换：单段直接采用；跨段证据收窄到值所在段；值本身跨段列为未加入；未提及项不采用；★标记带入。
const { items, skipped } = specAdoptionItems(source, pdu);
assert.deepEqual(items.map(i => i.value), ['32A', 'IP20', '≤60 | 1000']);
assert.equal(items[2].evidence.quote, '≤60 | 1000', '表头+数据行的证据收窄到数据行所在段');
assert(items.every(i => source.text.slice(i.evidence.start, i.evidence.end) === i.evidence.quote && i.evidence.sourceId === source.id));
assert.equal(items[0].forbiddenDeviation, true);
assert.deepEqual(skipped.map(s => s.name), ['输出插座']);
assert.match(skipped[0].reason, /跨越多个段落/);

// 采用：一次修订新建设备并加入待复核条款；同一AI设备不能重复采用。
const origin = { sourceId: result.sourceId, deviceId: pdu.device_id, analysisCreatedAt: result.createdAt, deviceType: pdu.device_type };
const pack1 = adoptExtractedEquipment(pack0, { category: 'pdu', label: pdu.device_name, origin, items }, '采用AI整理结果');
assert.equal(pack1.revision, pack0.revision + 1, '一次修订');
assert.equal(pack1.equipment.length, 1);
assert.deepEqual(pack1.equipment[0].origin, { kind: 'ai-extraction', ...origin });
assert.equal(pack1.equipment[0].quantity, null, '数量由人填写');
assert.equal(pack1.requirements.length, 3);
assert(pack1.requirements.every(r => r.field === 'clause' && r.reviewStatus === 'pending' && r.equipmentId === pack1.equipment[0].id));
assert.equal(pack1.requirements[0].forbiddenDeviation, true);
assert.equal(pack1.requirements[1].forbiddenDeviation, null, '未标★的不预设为false，由人复核');
assert.throws(() => adoptExtractedEquipment(pack1, { category: 'pdu', label: pdu.device_name, origin, items }, '重复'), /已采用/);
assert.throws(() => adoptExtractedEquipment(pack0, { category: 'pdu', label: 'x', origin, items: [{ ...items[0], value: '99A' }] }, '伪造'), /证据无法核对/);
assert.throws(() => adoptExtractedEquipment(pack0, { category: 'pdu', label: 'x', origin: { ...origin, sourceId: 'other' }, items }, '错源'), /资料来源/);
assert.throws(() => adoptExtractedEquipment(pack0, { category: 'pdu', label: 'x', origin, items: [] }, '空'), /没有可采用/);

// 采用后走原有人工流程：条款可确认、可重新分配到结构化字段；备份恢复保留来源标记；资料替换后条款标为需重新复核。
const confirmed = confirmPresalesRequirement(pack1, pack1.requirements[1].id, { value: 'IP20', response: 'met', forbiddenDeviation: false }, '人工核对原文');
assert.equal(confirmed.requirements[1].reviewStatus, 'confirmed');
const current = pack1.requirements[0];
const remapped = remapPresalesRequirement(pack1, current.id, pack1.equipment[0].id, 'ratedCurrentA', [{ value: 32, evidence: current.candidates[0].evidence }], '分配到额定电流字段');
assert(remapped.requirements.some(r => r.field === 'ratedCurrentA' && r.candidates[0].value === 32));
const restored = restorePresalesSnapshot(createPresalesSnapshot(pack1));
assert.equal(restored.equipment[0].origin.deviceId, pdu.device_id);
const replaced = replacePresalesSource(pack1, source.id, { type: 'docx', name: '合成采用验收.docx', text: text + '修订', segments, warnings: [] }, '资料更新');
assert(replaced.requirements.every(r => r.reviewStatus === 'stale'));

// 页面：每台设备都可采用并由人选品类——认得的类型预选（PDU→PDU），认不得的（UPS主机）默认"请选择"并提示；
// 采用后显示已采用；导出HTML不含按钮。
const live = specResultMarkup(result, { interactive: true });
assert.equal((live.match(/data-adopt-device=/g) || []).length, 2);
const selectFor = id => live.slice(live.indexOf(`data-adopt-category-for="${id}"`)).split('</select>')[0];
assert.match(selectFor(pdu.device_id), /<option value="pdu" selected>PDU<\/option>/);
assert.doesNotMatch(selectFor(ups.device_id), / selected/);
assert.match(live, /该设备类型没有默认品类，请按复核需要选择/);
// 认不得的类型由人选品类后照样采用（如 UPS 主机按配电柜复核）。
const upsItems = specAdoptionItems(source, ups).items;
const byChoice = adoptExtractedEquipment(pack0, { category: 'cabinet', label: ups.device_name, items: upsItems,
  origin: { sourceId: result.sourceId, deviceId: ups.device_id, analysisCreatedAt: result.createdAt, deviceType: ups.device_type } }, '人工选择品类后采用');
assert.equal(byChoice.equipment[0].category, 'cabinet');
assert.equal(byChoice.requirements[0].candidates[0].value, '200kVA');
const after = specResultMarkup(result, { interactive: true, adoptedKeys: [specAdoptionKey(result, pdu)] });
assert.equal(after.includes(`data-adopt-device="${pdu.device_id}"`), false, '已采用的设备不再显示按钮');
assert(after.includes(`data-adopt-device="${ups.device_id}"`), '未采用的设备仍可采用');
assert.match(after, /已采用到下方人工复核/);
assert.equal(specResultMarkup(result).includes('data-adopt-device'), false);
assert.equal(specAdoptionKey(result, pdu), `${origin.sourceId}|${origin.deviceId}|${origin.analysisCreatedAt}`, '页面采用标识与工作稿来源标记一致');

// 同一句被提成多个参数（分段重叠重复提取、同句不同名称、同句不同值）只生成一条条款。
const at = quote => { const start = text.indexOf(quote); return { sourceId: source.id, start, end: start + quote.length, quote }; };
const dupProduct = { params_detail: [
  { name: '防护等级', value: 'IP20', evidence_status: 'VERIFIED', evidence: at('2）防护等级：IP20。') },
  { name: '外壳防护', value: 'IP20', evidence_status: 'VERIFIED', evidence: at('2）防护等级：IP20。') },
  { name: '防护等级', value: 'IP20', evidence_status: 'VERIFIED', evidence: at('一、PDU技术要求\n★1）PDU额定电流为32A。\n2）防护等级：IP20。') },
  { name: '额定电流', value: '32A', evidence_status: 'VERIFIED', evidence: at('★1）PDU额定电流为32A。'), forbiddenDeviation: true },
  { name: '电流类型', value: 'PDU额定电流', evidence_status: 'VERIFIED', evidence: at('★1）PDU额定电流为32A。') }] };
const dup = specAdoptionItems(source, dupProduct).items;
assert.equal(dup.length, 2, '同段同句只保留一条条款');
assert.deepEqual(dup.map(i => i.name), ['防护等级 / 外壳防护', '额定电流 / 电流类型']);
assert.equal(dup[0].value, 'IP20');
assert.equal(dup[1].value, 'PDU额定电流为32A', '同句不同值合并为覆盖两者的原文范围');
assert.equal(dup[1].forbiddenDeviation, true);
const dupPack = adoptExtractedEquipment(pack0, { category: 'pdu', label: '合成PDU', items: dup,
  origin: { sourceId: source.id, deviceId: 'dup', analysisCreatedAt: 't', deviceType: 'PDU' } }, '合成去重采用');
assert.equal(dupPack.requirements.length, 2);

// 撤销采用：未确认/应答时可撤销，连同条款移除并可重新采用；已确认后不可撤销；手工登记设备不可撤销。
const withdrawn = withdrawAdoptedEquipment(dupPack, dupPack.equipment[0].id, '合成撤销');
assert.equal(withdrawn.equipment.length, 0); assert.equal(withdrawn.requirements.length, 0);
assert.equal(withdrawn.revisions.at(-1).kind, 'equipment:withdraw-ai');
assert.equal(restorePresalesSnapshot(createPresalesSnapshot(withdrawn)).equipment.length, 0);
assert.equal(adoptExtractedEquipment(withdrawn, { category: 'pdu', label: '合成PDU', items: dup,
  origin: { sourceId: source.id, deviceId: 'dup', analysisCreatedAt: 't', deviceType: 'PDU' } }, '重新采用').requirements.length, 2, '撤销后可重新采用');
const confirmedDup = confirmPresalesRequirement(dupPack, dupPack.requirements[0].id, { value: 'IP20', forbiddenDeviation: false, response: 'met' }, '合成确认');
assert.throws(() => withdrawAdoptedEquipment(confirmedDup, confirmedDup.equipment[0].id, '合成撤销'), /已有确认或应答/);
const manual = addEquipment(pack0, { category: 'pdu', label: '手工PDU', quantity: 1 }, '手工登记');
assert.throws(() => withdrawAdoptedEquipment(manual, manual.equipment[0].id, '合成撤销'), /只能撤销由AI结果采用/);

console.log('AI结果采用到人工复核：同句多参数合并、撤销采用、品类映射、证据收窄与跨段隔离、一次修订采用与防重复、确认/字段重分配/备份/资料替换、页面按钮通过（合成软件用例）');
