import assert from 'node:assert/strict';
import { analyzeSpecSource, validateSpecAnalysis, validateSpecDraft } from '../src/modules/spec-extraction.js';
import { mergeSpecDevices, mergeableDevices } from '../src/modules/spec-device-merge.js';
import { semanticParameterIndex } from '../src/modules/spec-semantic-review.js';
import { specResultMarkup, specExportSheets } from '../src/platform/spec-extraction-view.js';

// Synthetic software fixtures only: one device named three ways, plus a different device type.
const text = '合成合并验收资料。\n一、甲型开关箱\n甲型开关箱额定电压为DC480V。\n二、开关箱技术要求\n开关箱防护等级为IP20。\n三、配置表\n箱体名称：快速开关箱，安装方式为落地式安装。\n四、监控单元\n监控单元通讯接口为RS485。\n';
const source = { id: 'merge-source', type: 'pdf', name: '合成合并验收.pdf', text, warnings: [], segments: [{ start: 0, end: text.length, page: 1 }] };
const detail = (name, value, original_text) => ({ name, value, original_text, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT' });
const notStated = { name: '认证要求', value: '文档未明确要求', original_text: '', risk: 'LOW', evidence_status: 'NOT_STATED', source_status: 'NOT_IN_DOCUMENT' };
const devices = [['电池开关箱', '甲型开关箱', '一、甲型开关箱'], ['电池开关箱', '开关箱', '二、开关箱技术要求'], ['电池开关箱', '快速开关箱', '箱体名称：快速开关箱'], ['监控模块', '监控单元', '四、监控单元']];
const params = {
  '甲型开关箱': [detail('额定电压', 'DC480V', '甲型开关箱额定电压为DC480V。'), notStated],
  '开关箱': [detail('防护等级', 'IP20', '开关箱防护等级为IP20。'), notStated],
  '快速开关箱': [detail('安装方式', '落地式安装', '箱体名称：快速开关箱，安装方式为落地式安装。')],
  '监控单元': [detail('通讯接口', 'RS485', '监控单元通讯接口为RS485。')] };
const request = ({ rejectOn } = {}) => async input => {
  const data = JSON.parse(input.user);
  if (data.task === 'discovery') return { complete: true, devices: devices.map(([device_type, device_name, original_text]) => ({ device_type, device_name, scope: '', original_text })) };
  if (data.task === 'review') {
    const ip = data.review_parameters.find(p => p.detail.value === 'IP20');
    return { complete: true, source_checked: true, checked_parameter_ids: data.review_parameters.map(p => p.parameter_id),
      issues: ip ? [{ kind: 'DEVICE', severity: 'WARNING', parameter_id: ip.parameter_id, message: '“开关箱”可能与“甲型开关箱”是同一设备。', original_text: '开关箱防护等级为IP20。' }] : [] };
  }
  return { complete: true, products: data.known_devices.map(d => ({ ...d, params_detail: [...params[d.device_name],
    ...(rejectOn === d.device_name ? [detail('凭空参数', '999A', '原文没有这句话')] : [])] })) };
};
const result = await analyzeSpecSource(source, { request: request() });
const id = name => result.products.find(p => p.device_name === name).device_id;
assert.equal(result.products.length, 4);
assert.deepEqual(mergeableDevices(result, id('开关箱')).map(p => p.device_name), ['甲型开关箱', '快速开关箱'], '只列同类型设备');
assert.deepEqual(mergeableDevices(result, id('监控单元')), []);

// 合并"开关箱"到"甲型开关箱"：参数并入、完全相同的未提及项只保留一份、复核意见改到新的参数标识、整份重新复验通过。
const ipOld = result.semanticReview.findings[0].parameter_id;
const merged = await mergeSpecDevices(result, id('开关箱'), id('甲型开关箱'), { now: () => '2026-10-21T00:00:00.000Z' });
const target = merged.products.find(p => p.device_name === '甲型开关箱');
assert.equal(merged.products.length, 3);
assert.deepEqual(target.params_detail.map(d => d.value), ['DC480V', '文档未明确要求', 'IP20']);
assert.equal(target.mergedFrom[0].device_name, '开关箱');
assert.equal(target.mergedFrom[0].evidence.quote, '二、开关箱技术要求');
const ipNew = semanticParameterIndex(merged.products).find(p => p.detail.value === 'IP20').parameter_id;
assert.notEqual(ipNew, ipOld);
assert.equal(merged.semanticReview.findings[0].parameter_id, ipNew, '复核意见须跟随参数');
assert.deepEqual(merged.semanticReview.checkedParameterIds, semanticParameterIndex(merged.products).map(p => p.parameter_id).sort());
assert.deepEqual(merged.deviceMerges, [{ from: { device_id: id('开关箱'), device_name: '开关箱' }, into: { device_id: id('甲型开关箱'), device_name: '甲型开关箱' }, movedParameters: 2, mergedAt: '2026-10-21T00:00:00.000Z' }]);
assert.equal(await validateSpecAnalysis(source, merged), merged);
assert.equal(result.products.length, 4, '合并不修改传入的原结果（撤销依赖它）');

// 连续合并保留全部叫法；不同类型、自身、不存在的设备拒绝。
const twice = await mergeSpecDevices(merged, id('快速开关箱'), id('甲型开关箱'));
assert.deepEqual(twice.products.find(p => p.device_name === '甲型开关箱').mergedFrom.map(m => m.device_name), ['开关箱', '快速开关箱']);
assert.equal(await validateSpecAnalysis(source, twice), twice);
await assert.rejects(() => mergeSpecDevices(result, id('监控单元'), id('甲型开关箱')), /同一设备类型/);
await assert.rejects(() => mergeSpecDevices(result, id('开关箱'), id('开关箱')), /自己/);
await assert.rejects(() => mergeSpecDevices(result, 'device-x', id('开关箱')), /不存在/);

// 篡改合并记录或复核指纹均被复验拦下。
const forgedEvidence = structuredClone(merged); forgedEvidence.products.find(p => p.mergedFrom).mergedFrom[0].evidence.quote = '伪造原文';
await assert.rejects(() => validateSpecAnalysis(source, forgedEvidence), /人工合并设备记录/);
const forgedType = structuredClone(merged); forgedType.products.find(p => p.mergedFrom).mergedFrom[0].device_type = '监控模块';
await assert.rejects(() => validateSpecAnalysis(source, forgedType), /人工合并设备记录/);
const forgedParams = structuredClone(merged); forgedParams.products.find(p => p.mergedFrom).params_detail.pop();
await assert.rejects(() => validateSpecAnalysis(source, forgedParams));

// 未完成工作稿：被合并设备的待核对参数改挂到目标设备。
const draft = await analyzeSpecSource(source, { request: request({ rejectOn: '开关箱' }), allowPartial: true });
assert.equal(draft.complete, false);
assert.equal(draft.rejectedParameters[0].device_id, id('开关箱'));
const mergedDraft = await mergeSpecDevices(draft, id('开关箱'), id('甲型开关箱'));
assert.equal(mergedDraft.rejectedParameters[0].device_id, id('甲型开关箱'));
assert.equal(await validateSpecDraft(source, mergedDraft), mergedDraft);

// 页面：仅交互模式、仅同类型设备显示合并控件；已合并叫法在页面与导出均可见；Excel 增加合并记录表。
const live = specResultMarkup(result, { interactive: true });
assert.equal((live.match(/data-merge-from=/g) || []).length, 3, '三台同类设备各有合并控件，监控单元没有');
assert.equal(specResultMarkup(result).includes('data-merge-from'), false, '导出HTML不含交互控件');
assert.match(specResultMarkup(merged), /已人工合并的其他叫法：“开关箱”/);
const mergeSheet = specExportSheets(merged).find(s => s.name === '设备合并记录');
assert.deepEqual(mergeSheet.rows[2].slice(0, 3), ['开关箱', '甲型开关箱', 2]);
assert.equal(specExportSheets(result).some(s => s.name === '设备合并记录'), false);

console.log('设备合并：同类合并与去重、复核标识跟随、连续合并、类型/自身拒绝、篡改拦截、未完成稿、页面控件与导出通过（合成软件用例）');
