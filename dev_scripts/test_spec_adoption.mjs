import assert from 'node:assert/strict';
import { analyzeSpecSource } from '../src/modules/spec-extraction.js';
import { specAdoptionItems, specCategoryFor, specAdoptionKey } from '../src/modules/spec-adoption.js';
import { createPresalesPackage, addPresalesSource, adoptExtractedEquipment, confirmPresalesRequirement, remapPresalesRequirement,
  createPresalesSnapshot, restorePresalesSnapshot, replacePresalesSource } from '../src/modules/nonstandard-presales.js';
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

// 页面：PDU 显示采用按钮，UPS主机不显示；采用后显示已采用；导出HTML不含按钮。
const live = specResultMarkup(result, { interactive: true });
assert.equal((live.match(/data-adopt-device=/g) || []).length, 1);
assert(live.includes(`data-adopt-device="${pdu.device_id}"`));
const after = specResultMarkup(result, { interactive: true, adoptedKeys: [specAdoptionKey(result, pdu)] });
assert.equal(after.includes('data-adopt-device='), false);
assert.match(after, /已采用到下方人工复核/);
assert.equal(specResultMarkup(result).includes('data-adopt-device'), false);
assert.equal(specAdoptionKey(result, pdu), `${origin.sourceId}|${origin.deviceId}|${origin.analysisCreatedAt}`, '页面采用标识与工作稿来源标记一致');

console.log('AI结果采用到人工复核：品类映射、证据收窄与跨段隔离、一次修订采用与防重复、确认/字段重分配/备份/资料替换、页面按钮通过（合成软件用例）');
