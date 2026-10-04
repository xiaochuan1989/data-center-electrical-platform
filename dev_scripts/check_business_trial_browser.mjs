// Verify the real UI restored/exported without any engineering mutation or confirmation.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createPresalesSnapshot } from '../src/modules/nonstandard-presales.js';
import { buildPresalesOutput, presalesReportHtml } from '../src/modules/nonstandard-deliverable.js';
const base = new URL('../output/', import.meta.url);
const directory = new URL('playwright/business-trial-20261004/',base);
const load = async url => JSON.parse(await readFile(url,'utf8'));
const before=await load(new URL('before.json',directory)),after=await load(new URL('after.json',directory));
assert.deepEqual(after,before,'查看/筛选/导出改变了已记录工作包');
const pack=createPresalesSnapshot(after.package).package;
const prepared=await load(new URL('business-trial/2026-10-04/prepared-working.json',base));
assert.equal(pack.revision,prepared.packageRevision+1);
for(const key of ['sources','equipment','requirements','schemes'])assert.deepEqual(pack[key],prepared.package[key],`${key}在UI试用中被改变`);
assert.equal(pack.requirements.length,194);assert.equal(pack.schemes.length,4);
assert(pack.requirements.every(r=>r.reviewStatus!=='confirmed'&&r.response==='pending'));
assert(pack.schemes.every(s=>s.reviewStatus!=='confirmed'));
const outputs=pack.schemes.map(s=>buildPresalesOutput(pack,s.id));
for(const [i,data] of outputs.entries()) {
  assert.equal(data.output.status,'discussion-draft');
  assert.equal(await readFile(new URL(`scheme-${i+1}.html`,directory),'utf8'),presalesReportHtml(data),'浏览器HTML与同源数据不一致');
}
const report=await load(new URL('browser-result.json',directory));assert(report.passed&&report.confirmedActions===0&&report.businessAcceptance==='pending');
assert(!report.errors.length&&!report.external.length&&!report.writes.length);
const preflight=await load(new URL('business-trial/2026-10-04/preflight-result.json',base));
const original=await readFile(new URL('cabinet-real-case/micro-module-20260630/busway-working/combined-working.json',base));
assert.equal(createHash('sha256').update(original).digest('hex'),preflight.inputHash);
await writeFile(new URL('expected-outputs.json',directory),JSON.stringify(outputs,null,2));
console.log('PASS: 真实四方案UI查看/筛选/导出不改包，194要求不确认，四HTML同源，原恢复包哈希不变');
