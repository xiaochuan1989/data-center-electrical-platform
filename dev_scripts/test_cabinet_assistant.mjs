import assert from 'node:assert/strict';
import { createPresalesPackage, addEquipment, addPresalesSource, addRequirement, confirmPresalesRequirement,
  adoptPresalesScheme, createPresalesSnapshot, restorePresalesSnapshot, schemeReviewProblems, replacePresalesSource } from '../src/modules/nonstandard-presales.js';
import { createCabinetProposal, parseCabinetCircuitTable } from '../src/modules/cabinet-assistant.js';
import { buildPresalesOutput, presalesReportHtml } from '../src/modules/nonstandard-deliverable.js';
import { parsePresalesClause } from '../src/modules/nonstandard-requirements.js';

// 显式合成软件用例，不作真实配电柜案例或厂家配置。
let pack = addEquipment(createPresalesPackage('合成柜助手测试'), { category: 'cabinet', label: 'TEST-CAB', quantity: 3 }, '合成登记');
pack = addEquipment(pack, { category: 'pdu', label: 'TEST-PDU' }, '合成登记');
const eid = pack.equipment[0].id;
const addConfirmed = (field, value, quote, response = 'met') => {
  pack = addPresalesSource(pack, { type: 'text', name: `合成-${field}.txt`, text: quote, segments: [{ start: 0, end: quote.length }] }, '合成来源');
  pack = addRequirement(pack, { equipmentId: eid, field, forbiddenDeviation: false,
    candidates: [{ value, evidence: { sourceId: pack.sources.at(-1).id, start: 0, end: quote.length, quote } }] }, '合成提取');
  pack = confirmPresalesRequirement(pack, pack.requirements.at(-1).id, { value, response }, '合成确认');
};
addConfirmed('ratedCurrentA', 630, '额定电流：630A');
addConfirmed('incomingCount', 1, '进线数量：1路');
addConfirmed('outgoingCount', 3, '出线数量：3路');
addConfirmed('tieCount', 0, '母联数量：0路');
addConfirmed('voltageV', 400, '额定电压：400V', 'not-applicable');
const unconfirmedText = '宽度：800mm';
pack = addPresalesSource(pack, { type: 'text', name: '合成未确认.txt', text: unconfirmedText, segments: [{ start: 0, end: unconfirmedText.length }] }, '合成来源');
pack = addRequirement(pack, { equipmentId: eid, field: 'widthMm', candidates: [{ value: 800,
  evidence: { sourceId: pack.sources.at(-1).id, start: 0, end: unconfirmedText.length, quote: unconfirmedText } }] }, '合成未复核');
const table = '用途\t名称\t功能规格\t每套数量\n进线\t合成进线\t测试规格I\t1\n出线\t合成出线A\t测试规格A\t2\n出线\t=1+1\t<script>alert(1)</script>\t1';
const circuits = parseCabinetCircuitTable(table), options = { template: 'distribution', circuits, config: { supplyBoundary: '合成供货边界' } };
const before = JSON.stringify(pack), proposal = createCabinetProposal(pack, eid, options);
assert.equal(JSON.stringify(pack), before);
assert.equal(proposal.id, undefined); assert.equal(proposal.config.ratedCurrentA, 630);
assert.equal(proposal.config.voltageV, undefined); assert.equal(proposal.config.widthMm, undefined);
assert.deepEqual([proposal.config.incomingCount, proposal.config.tieCount, proposal.config.outgoingCount], [1, 0, 3]);
assert.ok(proposal.components.every(c => !c.model && !c.code && !c.brand && c.modelStatus === 'pending'));
assert.ok(proposal.components.every(c => c.reference.includes('人工回路表')));
assert.equal(proposal.components[1].requirementIds.length, 1);
let adopted = adoptPresalesScheme(pack, proposal, '合成采用助手草稿'), sid = adopted.schemes.at(-1).id;
const data = buildPresalesOutput(adopted, sid);
assert.equal(data.output.status, 'discussion-draft');
assert.deepEqual(data.output.bom.map(c => c.totalQuantity), [3, 6, 3]);
assert.ok(data.output.description.join(' ').includes('出线3'));
assert.ok(data.tables.notes.some(row => row[0] === '方案说明'));
assert.ok(!presalesReportHtml(data).includes('<script>'));
assert.ok(schemeReviewProblems(adopted, sid).some(p => p.includes('型号待核对')));
assert.equal(restorePresalesSnapshot(createPresalesSnapshot(adopted)).schemes[0].assistant.template, 'distribution');
const corrupt = createPresalesSnapshot(adopted); corrupt.package.schemes[0].assistant.sourceRevision = adopted.revision + 1;
assert.throws(() => restorePresalesSnapshot(corrupt), /元数据/);
assert.throws(() => adoptPresalesScheme(pack, { ...proposal, origin: 'manual' }, '错误'), /来源标记/);
assert.throws(() => createCabinetProposal(pack, pack.equipment[1].id, options), /仅用于/);
assert.throws(() => createCabinetProposal(pack, eid, { ...options, config: { ratedCurrentA: 800 } }), /采用输入/);
assert.throws(() => createCabinetProposal(pack, eid, { ...options, circuits: [{ ...circuits[0], quantity: 2 }] }), /进线数量/);
assert.throws(() => createCabinetProposal(pack, eid, { ...options, circuits: [...circuits, { role: 'tie', name: '合成母联', quantity: 1 }] }), /不含母联/);
assert.throws(() => createCabinetProposal(pack, eid, { ...options, template: 'sectional' }), /母联数量0/);
for (const value of ['', '用途\t名称\t功能规格\t每套数量', '进线|A|B|1.5', '出线|A|B|0', 'constructor|A|B|1', '进线\tA|B\tC\t1', '出线|A|B']) {
  assert.throws(() => parseCabinetCircuitTable(value));
}
assert.throws(() => parseCabinetCircuitTable(Array(201).fill('出线|A|B|1').join('\n')), /200/);
assert.throws(() => createCabinetProposal(pack, eid, { ...options, circuits: [{ role: 'incoming', name: 'A', quantity: Number.MAX_SAFE_INTEGER }, { role: 'incoming', name: 'B', quantity: 1 }] }), /安全整数/);
const unknown = createCabinetProposal(pack, eid, { ...options, circuits: parseCabinetCircuitTable('进线|I||\n出线|O|按图|') });
assert.equal(unknown.components[0].quantity, null); assert.equal(unknown.components[1].specification, '');
const partial = addEquipment(createPresalesPackage('合成未知总数'), { category: 'cabinet', label: 'UNKNOWN' }, '合成登记');
const excessiveTotal = addEquipment(createPresalesPackage(), { category: 'cabinet', label: 'EXCESSIVE', quantity: 3 }, '合成登记');
assert.throws(() => createCabinetProposal(excessiveTotal, excessiveTotal.equipment[0].id, { template: 'distribution', circuits: [{ role: 'outgoing', name: '合成', quantity: Number.MAX_SAFE_INTEGER }] }), /总数量/);
const partialProposal = createCabinetProposal(partial, partial.equipment[0].id, { template: 'distribution', circuits: parseCabinetCircuitTable('出线|A|测试|2\n出线|B|测试|') });
assert.equal(partialProposal.config.outgoingCount, undefined, '未知行不能只汇总已知部分');
assert.equal(partialProposal.config.tieCount, undefined, '无母联行不等于要求0');
assert.deepEqual(parsePresalesClause('cabinet', '出线回路数：12路'), { field: 'outgoingCount', value: 12 });
assert.equal(parsePresalesClause('cabinet', '出线回路数：不少于12路').field, 'clause');
const sectional = createCabinetProposal(partial, partial.equipment[0].id, { template: 'sectional', circuits: parseCabinetCircuitTable('进线|I|测试|2\n母联|T|测试|1\n出线|O|测试|4') });
assert.deepEqual([sectional.config.incomingCount, sectional.config.tieCount, sectional.config.outgoingCount], [2, 1, 4]);
const pp = adoptPresalesScheme(partial, partialProposal, '合成未知采用');
assert.ok(schemeReviewProblems(pp, pp.schemes[0].id).some(p => /母联数量0/.test(p)));
const edited = adoptPresalesScheme(adopted, { ...adopted.schemes[0], config: { ...adopted.schemes[0].config, outgoingCount: 4 }, components: adopted.schemes[0].components.map((c, i) => i === 2 ? { ...c, quantity: 2 } : c) }, '合成修改');
assert.ok(buildPresalesOutput(edited, sid).output.description.join(' ').includes('出线4'));
assert.deepEqual(buildPresalesOutput(edited, sid).output.bom.map(c => c.totalQuantity), [3, 6, 6]);
const replacementText = '额定电流：800A';
const stale = replacePresalesSource(pack, pack.sources[0].id, { type: 'text', name: '合成新电流.txt', text: replacementText, segments: [{ start: 0, end: replacementText.length }] }, '合成替换');
assert.equal(createCabinetProposal(stale, eid, options).config.ratedCurrentA, undefined);
console.log('配电柜骨架、回路汇总、有效证据、未知、数量阻断、草稿/同源说明与兼容回归通过（合成软件验收）');
