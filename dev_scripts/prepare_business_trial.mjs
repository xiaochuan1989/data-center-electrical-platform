// Real-work draft preflight only. Never confirms requirements/schemes or overwrites its input.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { restorePresalesSnapshot, createPresalesSnapshot, verifyPresalesEvidence, adoptPresalesScheme,
  updateEquipmentQuantity, schemeReviewProblems } from '../src/modules/nonstandard-presales.js';
import { buildPresalesOutput, presalesReportHtml, presalesEscape } from '../src/modules/nonstandard-deliverable.js';
import { writePresalesXlsx } from '../src/modules/presales-xlsx.js';
import { emptyTrialFeedback, assertEmptyTrialFeedback } from './business_trial_feedback.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(root, process.argv[2] || 'output/cabinet-real-case/micro-module-20260630/busway-working/combined-working.json');
const out = resolve(root, 'output/business-trial/2026-10-04');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(input), originalHash = digest(bytes);
const original = JSON.parse(bytes), pack = restorePresalesSnapshot(original), before = JSON.stringify(pack);
assert.equal(pack.equipment.length, 4); assert.equal(pack.schemes.length, 4);
assert.deepEqual(pack.equipment.map(e => e.category).sort(), ['busway','busway','pdu','pdu']);
assert.equal(pack.requirements.length, 194); assert.equal(pack.sources.length, 1);
assert(pack.requirements.every(r => r.reviewStatus !== 'confirmed' && r.response === 'pending'));
assert(pack.schemes.every(s => s.reviewStatus !== 'confirmed'));
const emptyFeedback = emptyTrialFeedback(pack.schemes);
// Protect any user edit, including added notes or changed topic/IDs, before the first write.
try {
  const existing = JSON.parse(await readFile(join(out, 'feedback.json'), 'utf8'));
  assertEmptyTrialFeedback(existing,pack.schemes);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
let evidenceCount = 0;
for (const r of pack.requirements) for (const c of r.candidates) {
  assert(verifyPresalesEvidence(pack, c.evidence, c.value)); evidenceCount++;
}
await mkdir(out, { recursive: true });
const snapshot = createPresalesSnapshot(pack);
await writeFile(join(out, 'prepared-working.json'), JSON.stringify(snapshot, null, 2));
const summary = [], links = [];
const sheets = [['header','方案概览'],['bom','配置清单'],['config','采用配置'],['requirements','技术要求与应答'],['notes','澄清与边界'],['revisions','修订记录']];
for (const [index, scheme] of pack.schemes.entries()) {
  const data = buildPresalesOutput(pack, scheme.id), equipment = data.output.equipment, stem = `scheme-${index + 1}`;
  const requirements = pack.requirements.filter(r => r.equipmentId === equipment.id);
  assert.deepEqual([...scheme.requirementIds].sort(), requirements.map(r => r.id).sort(), '方案未覆盖本设备全部已登记要求');
  assert(scheme.components.every(c => c.requirementIds.every(id => scheme.requirementIds.includes(id))));
  assert.equal(data.output.status, 'discussion-draft'); assert(schemeReviewProblems(pack, scheme.id).length);
  assert(data.output.bom.every(c => c.modelStatus === 'pending' && !c.model && !c.code));
  if (equipment.category === 'busway') assert.equal(equipment.quantity, 1);
  for (const c of data.output.bom) assert.equal(c.totalQuantity, c.quantity == null ? null : c.quantity * equipment.quantity);
  assert(data.output.bom.some(c => c.totalQuantity === null), '未知数量被补造');
  // Pure-memory modification probe: current saved configuration and BOM must be one object/version.
  const component = scheme.components.find(c => c.quantity != null && (equipment.category === 'pdu' ? c.role === 'output' : c.role === 'busway'));
  assert(component);
  const changedScheme = structuredClone(scheme); changedScheme.components.find(c => c.id === component.id).quantity += 1;
  const countField = equipment.category === 'pdu' ? 'outputCount' : 'buswayLengthM';
  if (changedScheme.config[countField] != null) changedScheme.config[countField] += 1;
  const changedPack = adoptPresalesScheme(pack, changedScheme, '软件纯内存修改负例，不作为业务采用输入');
  const changedOutput = buildPresalesOutput(changedPack, scheme.id);
  assert.equal(changedOutput.output.bom.find(c => c.id === component.id).totalQuantity, (component.quantity + 1) * equipment.quantity);
  assert.equal(changedOutput.output.packageRevision, pack.revision + 1);
  assert.notDeepEqual(changedOutput.output.description, data.output.description, '保存变更后说明未更新');
  assert.equal(changedOutput.tables.bom.find(row => row[0] === component.id)[6], (component.quantity + 1) * equipment.quantity);
  if (equipment.category === 'busway') {
    const invalid = updateEquipmentQuantity(pack, equipment.id, 2, '软件区域口径负例，不回写业务稿');
    assert(buildPresalesOutput(invalid, scheme.id).output.bom.every(c => c.totalQuantity === null));
    assert(schemeReviewProblems(invalid, scheme.id).some(p => p.includes('区域')));
  }
  await writeFile(join(out, `${stem}.json`), JSON.stringify(data, null, 2));
  await writeFile(join(out, `${stem}.html`), presalesReportHtml(data));
  await writeFile(join(out, `${stem}.xlsx`), writePresalesXlsx(sheets.map(([key,name]) => ({name,rows:data.tables[key]}))));
  summary.push({stem, schemeId:scheme.id, equipmentId:equipment.id, category:equipment.category, label:equipment.label,
    requirements:requirements.length, components:scheme.components.length, unknownQuantities:data.output.bom.filter(c => c.totalQuantity == null).length,
    reviewProblems:data.output.clarifications, status:data.output.status, modificationProbe:true, regionProbe:equipment.category === 'busway'});
  links.push(`<li>${presalesEscape(equipment.label)}：<a href="${stem}.html">方案说明</a> · <a href="${stem}.xlsx">配置清单</a> · <a href="${stem}.json">同源数据</a></li>`);
}
assert.equal(JSON.stringify(pack), before, '预检突变了工作包');
assert.equal(digest(await readFile(input)), originalHash, '原统一恢复包被改写');
const result = {passed:true,testedAt:new Date().toISOString(),scope:'真实四方案软件预检；非业务采用验收',inputHash:originalHash,
  inputUnchanged:true,sources:pack.sources.length,requirements:pack.requirements.length,evidenceCount,schemes:summary,
  modificationProbes:4,regionProbes:2,confirmed:0,businessAcceptance:'pending'};
await writeFile(join(out,'preflight-result.json'),JSON.stringify(result,null,2));
await writeFile(join(out,'feedback.json'),JSON.stringify(emptyFeedback,null,2));
await writeFile(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>业务试用资料（待复核）</title><body style="font:16px/1.8 system-ui;max-width:900px;margin:40px auto;padding:20px"><h1>业务试用资料（待复核）</h1><p>2026-10-04 · 四方案均为讨论稿，未确认采用、非生产图纸、非完整合规结论。原文位置沿用旧人工工作稿，不重绑新解析源。</p><p><a href="prepared-working.json">下载独立试用恢复副本</a>（先备份当前包，恢复会替换当前非标数据）。<a href="feedback.json">反馈记录模板</a>：观察、期望、依据与责任人尚未填写，不能算业务验收通过。</p><ul>${links.join('')}</ul><p>先复核一份PDU，再核对同区域母线；不默认接口、保护、附件数量或型号。软件纯内存修改/区域口径负例未写入此恢复副本；Excel是静态导出，修改不会回写应用。</p></body></html>`);
console.log(JSON.stringify({passed:true,requirements:pack.requirements.length,evidenceCount,schemes:summary.length,components:summary.reduce((n,s)=>n+s.components,0),modificationProbes:4,regionProbes:2,inputUnchanged:true,businessAcceptance:'pending',out},null,2));
