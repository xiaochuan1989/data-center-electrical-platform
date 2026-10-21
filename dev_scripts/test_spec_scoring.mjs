import assert from 'node:assert/strict';
import { prepareBaseline, resultItems, score, numberTokens, textKey, formatReport } from './score_spec_extraction.mjs';

// Synthetic software fixtures only. Never presented as a real customer extraction or a model accuracy result.
const page1 = '合成验收资料第一页。\n1、环境温度±40°C，相对湿度10%-90%RH。\n2、电池组电压DC480V，最大支持600V。\n3、单体电压控制精度≤±5mv。\n';
const page2 = '合成验收资料第二页。\n4、工作温度-25～50℃。\n5、 接线座标识清晰;具备良好的防短路设计。\n6、柜门采用双开门的方式。\n7、监控单元额定电压600V。\n';
const text = page1 + page2;
const source = { id: 'synthetic', type: 'pdf', name: '合成打分验收.pdf', text, warnings: [], segments: [{ start: 0, end: page1.length, page: 1 }, { start: page1.length, end: text.length, page: 2 }] };
const ev = (quote, from = 0) => { const start = text.indexOf(quote, from); assert(start >= 0, quote); return { sourceId: 'synthetic', start, end: start + quote.length, quote, location: `合成打分验收.pdf · PDF第${from >= page1.length ? 2 : 1}页` }; };
const p = (name, value, quote, from) => ({ name, value, original_text: quote, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT', evidence: ev(quote, from) });
const baselineAnalysis = { products: [
  { device_id: 'device-1', device_type: '电池开关箱', device_name: '电池开关箱', params_detail: [
    p('环境温度', '±40°C', '环境温度±40°C'),
    p('相对湿度', '10%-90%RH', '相对湿度10%-90%RH'),
    p('电池组电压', 'DC480V，最大支持600V', '电池组电压DC480V，最大支持600V'),
    p('单体电压控制精度', '≤±5mv', '单体电压控制精度≤±5mv'),
    p('工作温度', '-25～50℃', '工作温度-25～50℃'),
    p('接线标识', '接线座标识清晰', '接线座标识清晰'),
    p('柜门', '采用双开门的方式', '柜门采用双开门的方式'),
    { name: '质保期', value: '文档未明确要求', original_text: '', source_status: 'NOT_IN_DOCUMENT', evidence_status: 'NOT_STATED' },
  ] },
  { device_id: 'device-2', device_type: '监控单元', device_name: '监控单元', params_detail: [p('额定电压', '600V', '监控单元额定电压600V', page1.length)] },
] };
const baseline = prepareBaseline({ source, analysis: baselineAnalysis });
const run = analysis => score(baseline, resultItems({ source, analysis }, baseline));
const row = (rep, name) => rep.rows.find(r => r.name === name);
const clone = structuredClone;

// 记号规则：范围连接符不当负号，正负号/比较符/单位大小写保留；文字口径去掉条目序号与标点。
assert.deepEqual(numberTokens('10%-90%RH'), ['10%', '90%RH']);
assert.deepEqual(numberTokens('-25～50℃'), ['-25', '50°C']);
assert.deepEqual(numberTokens('≤±5mv'), ['≤±5mv']);
assert.deepEqual(numberTokens('GB/T 14315-2008'), ['14315', '2008']);
assert.equal(textKey('5、 接线座标识清晰;'), '接线座标识清晰');

// 基准对自身：全部命中，无基准外，未提及项不计分。
const self = run(clone(baselineAnalysis));
assert.equal(self.summary.baselineItems, 8);
assert.equal(self.summary.hit, 8);
assert.equal(self.summary.extra, 0);
assert.equal(self.sameSource, true);
assert.deepEqual(self.notStated.baseline.map(x => x.name), ['质保期']);

// 漏提、正负号丢失、单位大小写改动、负号丢失。
const broken = clone(baselineAnalysis), d1 = broken.products[0].params_detail;
d1.splice(d1.findIndex(x => x.name === '柜门'), 1);
d1.find(x => x.name === '环境温度').value = '40°C';
d1.find(x => x.name === '单体电压控制精度').value = '≤±5mV';
d1.find(x => x.name === '工作温度').value = '25～50℃';
const b = run(broken);
assert.equal(row(b, '柜门').status, 'MISS');
assert.equal(row(b, '环境温度').status, 'NUMBER_MISMATCH');
assert.deepEqual(row(b, '环境温度').missingTokens, ['±40°C']);
assert.equal(row(b, '单体电压控制精度').status, 'NUMBER_MISMATCH');
assert.equal(row(b, '工作温度').status, 'NUMBER_MISMATCH');
assert.equal(row(b, '相对湿度').status, 'HIT');

// 不同读取器的原文（空白不同）按引文定位：拆成两条、带序号与标点的结果仍算命中；措辞变窄列需人工看。
// 只差空白时规范化后相同，按结果自带偏移定位；多一行页眉才算不同原文，改为按引文定位。
const spaced = score(baseline, resultItems({ source: { ...source, text: text.replace(/\n/g, '\n\n  ') }, analysis: clone(baselineAnalysis) }, baseline));
assert.equal(spaced.sameSource, true);
const otherSource = { ...source, text: '合成页眉\n' + text.replace(/\n/g, '\n\n  ') };
const loose = clone(baselineAnalysis), d2 = loose.products[0].params_detail;
d2.splice(d2.findIndex(x => x.name === '电池组电压'), 1,
  { name: '电池组电压', value: 'DC480V', original_text: 'DC480V', evidence: { quote: 'DC480V' } },
  { name: '电池组最高电压', value: '最大支持 600V', original_text: '最大支持600V', evidence: { quote: '最大支持 600V' } });
d2.splice(d2.findIndex(x => x.name === '接线标识'), 1, { name: '接线座标识', value: '5、 接线座标识清晰;', evidence: { quote: '5、 接线座标识清晰;' } });
Object.assign(d2.find(x => x.name === '柜门'), { value: '双开门', evidence: { quote: '双开门' } });
d2.push({ name: '防短路设计', value: '具备良好的防短路设计', evidence: { quote: '具备良好的防短路设计' } });
d2.push({ name: '凭空参数', value: '100A', evidence: { quote: '原文没有这句话' } });
const l = score(baseline, resultItems({ source: otherSource, analysis: loose }, baseline));
assert.equal(l.sameSource, false);
assert.equal(row(l, '电池组电压').status, 'HIT', '拆成两条且标点不同仍应命中');
assert.equal(row(l, '接线标识').status, 'HIT', '带条目序号的值仍应命中');
assert.equal(row(l, '柜门').status, 'CHECK');
assert.equal(l.extra.length, 1, '防短路设计不在基准内，列基准外');
assert.equal(l.extra[0].sameClause, false);
assert.equal(l.unlocated.length, 1);
assert.equal(l.unlocated[0].unlocated, 'NOT_IN_BASELINE_SOURCE');

// 重复出现的短引文按页码消歧；设备归属按多数票映射后不一致即标记。
const dev = clone(baselineAnalysis);
dev.products[1].params_detail = [{ name: '额定电压', value: '600V', evidence: { quote: '600V', location: '合成打分验收.pdf · PDF第2页' } }];
const moved = dev.products[1].params_detail[0];
dev.products[0].params_detail.push({ ...clone(moved), name: '误挂电压' });
const dv = score(baseline, resultItems({ source: otherSource, analysis: dev }, baseline));
assert.equal(dv.summary.ambiguous, 0, '页码应消除 600V 的重复出现');
assert.equal(row(dv, '额定电压').status, 'HIT');
assert.equal(row(dv, '额定电压').deviceDiff, true, '同一参数也挂在了电池开关箱下');
assert.equal(row(dv, '环境温度').deviceDiff, false);

// 未完成工作稿：未核验候选不计入召回，但单独报告能补上的漏提。
const draft = clone(broken);
draft.draftVersion = 1;
draft.rejectedParameters = [{ device_id: 'device-1', candidate: { name: '柜门', value: '采用双开门的方式', original_text: '柜门采用双开门的方式' }, reason: '合成拒收原因' }];
const dr = run(draft);
assert.equal(dr.format, 'main-app-draft');
assert.equal(row(dr, '柜门').status, 'MISS');
assert.equal(dr.summary.unverifiedItems, 1);
assert.equal(dr.rescued.length, 1);
assert.equal(dr.rescued[0].by.status, 'HIT');

// 原型归档适配；无候选的失败归档明确报错而不是打 0 分。
const archive = { protocol: 'synthetic', records: [], source: {}, state: { devices: [{ id: 'd1', type: '电池开关箱' }], accepted: [
  { id: 'r1', device_id: 'd1', kind: 'REQUIREMENT', name: '环境温度', valueRaw: '±40°C', evidence: [{ page: 1, quote: '环境温度±40°C' }] }] } };
const ar = score(baseline, resultItems(archive, baseline));
assert.equal(ar.format, 'spec-v5-archive');
assert.equal(row(ar, '环境温度').status, 'HIT');
assert.equal(ar.summary.miss, 7);
assert.throws(() => resultItems({ protocol: 'synthetic', records: [], state: null, error: { phase: 'preflight', code: 'NETWORK_OR_CORS' } }, baseline), /没有候选结果.*NETWORK_OR_CORS/);
assert.throws(() => resultItems({ foo: 1 }, baseline), /无法识别/);

// 报告可读：各分组标题出现，未提及项不计分。
const text1 = formatReport('合成', b);
for (const t of ['漏提（1）', '数值不一致（3）', '严格召回', '文档未提及项（不计分）']) assert(text1.includes(t), t);

console.log('spec scoring tests passed');
