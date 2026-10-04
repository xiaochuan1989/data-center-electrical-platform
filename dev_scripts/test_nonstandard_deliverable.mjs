import assert from 'node:assert/strict';
import { createPresalesPackage, addEquipment, addPresalesSource, addRequirement, confirmPresalesRequirement,
  adoptPresalesScheme, confirmPresalesScheme, invalidatePresalesScheme, schemeReviewProblems,
  createPresalesSnapshot, restorePresalesSnapshot, adoptBuswayPresalesScheme } from '../src/modules/nonstandard-presales.js';
import { buildPresalesOutput, presalesReportHtml } from '../src/modules/nonstandard-deliverable.js';
import { createSmartBuswayDesign, calculateSmartBuswayDesign } from '../src/modules/engineering-calculators.js';
import { writePresalesXlsx } from '../src/modules/presales-xlsx.js';

// 显式合成软件用例，不是厂家配置、正式技术报告或客户业务验收。
let pack = addEquipment(createPresalesPackage('合成方案软件测试'), { category: 'cabinet', label: 'TEST-柜', quantity: 2 }, '合成登记');
const equipmentId = pack.equipment[0].id, raw = '额定电流：630A';
pack = addPresalesSource(pack, { type: 'text', name: '合成.txt', text: raw, segments: [{ start: 0, end: raw.length }] }, '合成来源');
pack = addRequirement(pack, { equipmentId, field: 'ratedCurrentA', forbiddenDeviation: true, candidates: [{ value: 630,
  evidence: { sourceId: pack.sources[0].id, start: 0, end: raw.length, quote: raw } }] }, '合成要求');
const rid = pack.requirements[0].id;
pack = confirmPresalesRequirement(pack, rid, { value: 630, response: 'met' }, '合成复核');
const item = { name: '合成出线', role: 'outgoing', specification: '仅软件测试', quantity: 2, unit: '个', model: 'TEST-ONLY', modelStatus: 'verified', reference: '合成依据非厂家', requirementIds: [rid] };
const scheme = { equipmentId, name: '<script>window.TEST_XSS=1</script>', config: { ratedCurrentA: 630, supplyBoundary: '合成柜体', outgoingCount: 3 },
  components: [item, { ...item, name: '=1+1', quantity: 1 }], requirementIds: [rid], assumptions: ['<img src=x onerror=alert(1)>'], exclusions: ['工程校核未完成'] };
pack = adoptPresalesScheme(pack, scheme, '合成采用'); const sid = pack.schemes[0].id;
assert.deepEqual(schemeReviewProblems(pack, sid), []);
pack = confirmPresalesScheme(pack, sid, '合成确认');
const data = buildPresalesOutput(pack, sid), baseline = JSON.stringify(pack);
assert.equal(data.output.status, 'reviewed-presales');
assert.deepEqual(data.output.bom.map(r => r.totalQuantity), [4, 2]);
assert.deepEqual(data.tables.bom.slice(1).map(row => row[6]), [4, 2]);
assert.ok(data.tables.requirements[1][7].includes('合成.txt'));
const html = presalesReportHtml(data);
assert.ok(!html.includes('<script>') && !html.includes('<img '));
assert.ok(html.includes('&lt;script&gt;') && html.includes('非生产图纸'));
assert.equal(JSON.stringify(pack), baseline, '输出不回写采用配置');
const workbook = writePresalesXlsx([{ name: '合成清单', rows: data.tables.bom }]);
assert.equal(new DataView(workbook.buffer).getUint32(0, true), 0x04034b50);
const workbookText = new TextDecoder().decode(workbook);
assert.ok(workbookText.includes('t="inlineStr"') && workbookText.includes('=1+1') && !workbookText.includes('<f>'));
assert.throws(() => writePresalesXlsx([{ name: '错/名', rows: [[1]] }]), /名称/);
assert.throws(() => writePresalesXlsx([{ name: '过长', rows: [['A'.repeat(32768)]] }]), /32767/);
assert.throws(() => writePresalesXlsx([{ name: '非法', rows: [[Infinity]] }]), /有限数/);
assert.throws(() => writePresalesXlsx([{ name: '重复', rows: [[1]] }, { name: '重复', rows: [[1]] }]), /重复/);
assert.ok(new TextDecoder().decode(writePresalesXlsx([{ name: '编码', rows: [['\x00_x0000_\r\n']] }])).includes('_x0000__x005F_x0000_&#13;'));
const invalid = invalidatePresalesScheme(pack, sid);
assert.equal(invalid.schemes[0].reviewStatus, 'pending'); assert.equal(pack.schemes[0].reviewStatus, 'confirmed');
const restored = restorePresalesSnapshot(createPresalesSnapshot(pack));
assert.equal(restored.schemes[0].reviewStatus, 'pending'); assert.equal(restored.requirements[0].reviewStatus, 'pending');
assert.equal(buildPresalesOutput(restored, sid).output.status, 'discussion-draft');
const corruptQuantity = createPresalesSnapshot(pack); corruptQuantity.package.schemes[0].components[0].quantity = '';
assert.throws(() => restorePresalesSnapshot(corruptQuantity), /组件数量/);
assert.throws(() => addEquipment(createPresalesPackage(), { category: 'cabinet', label: '错误超大数量', quantity: Number.MAX_SAFE_INTEGER + 1 }, '合成错误'), /数量/);
const wrong = adoptPresalesScheme(pack, { ...scheme, id: sid, config: { ...scheme.config, outgoingCount: 4 } }, '合成数量错配');
assert.match(schemeReviewProblems(wrong, sid).join(' '), /出线数量.*不一致/);
const missing = adoptPresalesScheme(pack, { ...scheme, id: sid, components: [{ ...item, quantity: null }] }, '合成未知');
assert.match(schemeReviewProblems(missing, sid).join(' '), /数量\/单位待核对/);
const meter = adoptPresalesScheme(pack, { ...scheme, id: sid, components: [{ ...item, quantity: 3, unit: 'm' }] }, '合成错误单位');
assert.match(schemeReviewProblems(meter, sid).join(' '), /数量\/单位待核对/);
assert.throws(() => adoptPresalesScheme(pack, { ...scheme, components: [{ ...item, role: 'output' }] }, '跨品类用途'), /用途/);
const excessive = adoptPresalesScheme(pack, { ...scheme, id: sid, components: [{ ...item, quantity: Number.MAX_VALUE }] }, '合成数量溢出');
assert.throws(() => buildPresalesOutput(excessive, sid), /数值范围/);
const old = createPresalesSnapshot(pack); old.package.schemes[0].components.forEach(c => delete c.role);
assert.equal(restorePresalesSnapshot(old).schemes[0].components[0].role, undefined, '旧快照可读但用途仍待核对');

let pdu = addEquipment(createPresalesPackage(), { category: 'pdu', label: '合成PDU' }, '合成登记');
pdu = adoptPresalesScheme(pdu, { equipmentId: pdu.equipment[0].id, name: 'PDU合成讨论稿', config: { pduType: 'rack', outputCount: 4 }, components: [
  { name: '合成接口', role: 'output', specification: '合成规格', quantity: 4, unit: '个' }
] }, '合成采用');
assert.equal(buildPresalesOutput(pdu, pdu.schemes[0].id).output.bom[0].totalQuantity, null);
assert.ok(!schemeReviewProblems(pdu, pdu.schemes[0].id).some(p => p.includes('输出数量与清单')));

let busway = addEquipment(createPresalesPackage(), { category: 'busway', label: '合成母线', quantity: 2 }, '合成登记');
const design = createSmartBuswayDesign({ row1: { cabinets600: 2 }, row2: {}, defaultPowerKw: 5, topology: 'single' });
const calculated = calculateSmartBuswayDesign(design); calculated.design.plugBoxStrategies.forEach(s => { s.spareQuantity = 2; });
const original = JSON.stringify(calculated.design);
busway = adoptBuswayPresalesScheme(busway, busway.equipment[0].id, calculated.design, '合成桥接含备用');
assert.equal(JSON.stringify(calculated.design), original);
const bridged = buildPresalesOutput(busway, busway.schemes[0].id);
assert.equal(bridged.output.config.plugBoxCount, bridged.output.bom.filter(c => c.role === 'plugbox').reduce((sum, c) => sum + c.perEquipmentQuantity, 0));
assert.ok(!bridged.output.clarifications.some(p => /与清单用途数量不一致|清单数量\/单位待核对/.test(p)));
assert.ok(bridged.output.bom.every(c => c.modelStatus === 'pending'));
assert.equal(bridged.output.bom.find(c => c.role === 'busway').totalQuantity, bridged.output.config.buswayLengthM * 2);
console.log('非标采用方案与同源交付回归通过（合成软件验收，非业务验收）');
