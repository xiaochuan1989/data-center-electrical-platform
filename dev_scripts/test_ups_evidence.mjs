import assert from 'node:assert/strict';
import { createEvidenceSource, extractRequirementEvidence, normalizeEvidence, recordRequirementRevision,
  confirmationProblems, confirmRequirementEvidence, evidenceExportRows, evidenceSummary } from '../src/modules/ups-evidence.js';
import { normalizeUpsRequirement, assessUpsProduct } from '../src/modules/ups-selection.js';

const text = 'UPS额定容量不低于200kVA\n三进三出\n后备时间不低于30分钟';
const source = createEvidenceSource('pdf', 'C:\\客户资料\\技术要求.pdf', [{ start: 0, end: text.length, page: 12 }]);
let req = extractRequirementEvidence(text, [source]);
assert.equal(req.capacityKva, 200);
assert.equal(req.inputOutputPhase, '3:3');
assert.equal(req.backupMinutes, 30);
assert.equal(req.sources[0].name, '技术要求.pdf');
assert.equal(req.fieldEvidence.capacityKva.candidates[0].page, 12);
assert.equal(req.fieldEvidence.backupMinutes.candidates[0].line, 3);
assert.equal(text.slice(req.fieldEvidence.capacityKva.candidates[0].start, req.fieldEvidence.capacityKva.candidates[0].end), 'UPS额定容量不低于200kVA');
req = confirmRequirementEvidence(req, '2026-09-30T02:00:00Z');
assert.equal(req.fieldEvidence.capacityKva.reviewStatus, 'confirmed');
assert.equal(assessUpsProduct({ 型号: 'T-200', 描述: '200kVA三进三出', 功率因数: '1' }, req, { status: 'active' }).overall, 'unknown', '证据确认不自动满足后备时间');
const snapshot = JSON.stringify(req);
req = recordRequirementRevision(req, 'capacityKva', 200, 250);
assert.equal(req.confirmedAt, null);
assert.ok(confirmationProblems(req).some(p => p.includes('原因')));
req.revisions[0].reason = '客户澄清要求提高容量';
req = confirmRequirementEvidence(req);
assert.equal(JSON.parse(snapshot).capacityKva, 200, '修订不改变旧快照');
assert.equal(req.fieldEvidence.capacityKva.candidateValue, 200);
assert.equal(req.fieldEvidence.capacityKva.confirmedValue, 250);
const rows = evidenceExportRows(req);
assert.ok(rows.evidence.some(row => row.includes('PDF第12页，第1行') && row.includes('250')));
assert.ok(rows.revisions.some(row => row.includes('200') && row.includes('250') && row.includes('客户澄清要求提高容量')));
const roundtrip = normalizeUpsRequirement(JSON.parse(JSON.stringify(req)));
assert.deepEqual(evidenceExportRows(roundtrip), rows, '备份往返保留证据与修订');

let cleared = recordRequirementRevision(req, 'capacityKva', 250, null, '撤销容量下限，等待客户确认');
cleared = recordRequirementRevision(cleared, 'capacityKva', null, 200, '恢复原规范要求');
assert.deepEqual(cleared.revisions.map(r => [r.from, r.to]), [[200, 250], [250, null], [null, 200]]);
assert.equal(cleared.fieldEvidence.capacityKva.candidateValue, 200);

const conflictText = 'UPS容量200kVA\nUPS容量250kVA';
let conflict = extractRequirementEvidence(conflictText);
assert.equal(conflict.capacityKva, null, '不静默选择冲突首值');
assert.equal(conflict.fieldEvidence.capacityKva.candidates.length, 2);
assert.throws(() => confirmRequirementEvidence(conflict), /冲突/);
conflict = recordRequirementRevision(conflict, 'capacityKva', null, 250, '以澄清条款为准');
assert.equal(confirmRequirementEvidence(conflict).capacityKva, 250);
conflict = recordRequirementRevision(conflict, 'capacityKva', 250, null, '暂时清空');
assert.throws(() => confirmRequirementEvidence(conflict), /冲突/);

const stale = { ...req, sourceText: text.replace('200', '300') };
assert.throws(() => confirmRequirementEvidence(stale), /原文或资料来源已修改/);
assert.equal(normalizeEvidence(stale).fieldEvidence.capacityKva.reviewStatus, 'stale');
assert.ok(evidenceExportRows(stale).evidence.some(row => row.some(value => String(value).includes('待重新提取'))));
const sameTextNewSource = JSON.parse(JSON.stringify(req));
sameTextNewSource.fieldEvidence.capacityKva.reviewStatus = 'stale';
assert.throws(() => confirmRequirementEvidence(sameTextNewSource), /资料来源已修改/,
  '资料替换或文字改回原值仍须重新提取，不能恢复旧确认');
assert.throws(() => confirmRequirementEvidence(recordRequirementRevision(sameTextNewSource, 'capacityKva', 250, 300, '新要求')), /重新提取/);
const forged = JSON.parse(JSON.stringify(req));
forged.fieldEvidence.capacityKva.candidates[0].start = 10_000;
assert.equal(normalizeEvidence(forged).fieldEvidence.capacityKva.candidates[0].page, null, '失效片段不能冒充可核对页码');
assert.throws(() => confirmRequirementEvidence(forged), /无法核对/);

const page1 = 'UPS容量200kVA', page3 = 'UPS容量300kVA';
const multiple = page1 + '\n\n' + page3;
const pdfSource = createEvidenceSource('pdf', '多页.pdf', [{ start: 0, end: page1.length, page: 1 },
  { start: page1.length + 1, end: page1.length + 1, page: 2 }, { start: page1.length + 2, end: multiple.length, page: 3 }]);
assert.deepEqual(extractRequirementEvidence(multiple, [pdfSource]).fieldEvidence.capacityKva.candidates.map(c => c.page), [1, 3]);
assert.ok(evidenceExportRows(extractRequirementEvidence(multiple, [pdfSource])).evidence.some(row => row.includes('PDF第2页')));
const noCross = extractRequirementEvidence('UPS容量\n200kVA', [createEvidenceSource('pdf', '不能跨页.pdf', [
  { start: 0, end: 5, page: 1 }, { start: 6, end: 12, page: 2 }])]);
assert.equal(noCross.capacityKva, null, '跨页内容不能错误拼成一个条件');
const old = normalizeUpsRequirement({ capacityKva: 200, sourceText: '老客户需求', confirmedAt: '2026-09-01' });
assert.equal(old.capacityKva, 200);
assert.equal(old.evidenceVersion, undefined);
assert.equal(evidenceSummary(old), '历史记录未保存证据');
assert.equal(evidenceExportRows(old).evidence[0][1], '历史记录未保存证据');
console.log('UPS 证据、冲突、修订、失效与备份兼容测试通过');
