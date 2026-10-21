import assert from 'node:assert/strict';
import { analyzeSpecSource, validateSpecAnalysis } from '../src/modules/spec-extraction.js';
import { runPooled } from '../src/modules/run-pooled.js';

// Synthetic software fixtures only. Concurrency must change speed, never the result.
// 有限并行：同时进行的任务不超过上限；结果按输入顺序返回；任一失败后不再领取新任务并抛出第一个错误。
{
  let inFlight = 0, peak = 0;
  const out = await runPooled([5, 1, 4, 2, 3], 2, async n => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, n * 5)); inFlight--; return n * 10; });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(peak, 2);
  const started = [];
  await assert.rejects(() => runPooled([1, 2, 3, 4, 5, 6], 2, async n => { started.push(n); await new Promise(r => setTimeout(r, 5)); if (n === 2) throw new Error('第2项失败'); }), /第2项失败/);
  assert(started.length < 6, '失败后不再领取全部剩余任务');
  assert.deepEqual(await runPooled([], 3, async () => 1), []);
}

// 多片段资料：并行（3路）与串行（1路）结果完全一致；并行确实同时发出多个请求且更快。
const lines = [];
for (let i = 1; i <= 60; i++) lines.push(`第${i}条：甲柜第${i}路输出额定电流为${i * 10}A，本行为合成验收文字用于撑长篇幅。`);
const text = '合成并行验收资料。\n一、甲柜技术要求\n' + lines.join('\n') + '\n二、乙柜技术要求\n乙柜额定电压为DC240V。\n';
const source = { id: 'synthetic-concurrency', type: 'text', name: '合成并行.txt', text, warnings: [], segments: [] };
const detail = (name, value, original_text) => ({ name, value, original_text, risk: 'LOW', evidence_status: 'VERIFIED', source_status: 'DOCUMENT' });
function makeRequest(stats) {
  return async input => {
    const data = JSON.parse(input.user), raw = data.document_text;
    stats.inFlight++; stats.peak = Math.max(stats.peak, stats.inFlight); stats.calls++;
    // 按片段位置给出不同延迟，使并行时完成顺序与发出顺序不同。
    await new Promise(r => setTimeout(r, 10 + ((data.chunk?.start || 0) * 7) % 40));
    stats.inFlight--;
    if (data.task === 'discovery') return { complete: true, devices: [
      { device_type: '低压配电柜', device_name: '甲柜', scope: '', original_text: '一、甲柜技术要求' },
      { device_type: '低压配电柜', device_name: '乙柜', scope: '', original_text: '二、乙柜技术要求' }] };
    if (data.task === 'review') return { complete: true, source_checked: true, checked_parameter_ids: data.review_parameters.map(p => p.parameter_id),
      issues: data.review_parameters.slice(0, 1).map(p => ({ kind: 'VALUE', severity: 'WARNING', parameter_id: p.parameter_id, message: `合成疑点 ${p.parameter_id}`, original_text: p.detail.original_text })) };
    const params = [];
    for (const line of raw.split('\n')) {
      const m = /^第(\d+)条：甲柜第\d+路输出额定电流为(\d+A)，本行为合成验收文字用于撑长篇幅。$/.exec(line);
      if (m) params.push(['甲柜', detail(`第${m[1]}路输出额定电流`, m[2], line)]);
      if (line === '乙柜额定电压为DC240V。') params.push(['乙柜', detail('额定电压', 'DC240V', line)]);
    }
    return { complete: true, products: data.known_devices.map(d => ({ ...d, params_detail: params.filter(([name]) => name === d.device_name).map(([, p]) => p) })).filter(p => p.params_detail.length) };
  };
}
const strip = r => JSON.stringify({ products: r.products, findings: r.semanticReview.findings, checked: r.semanticReview.checkedParameterIds, coverage: r.coverage });
const serialStats = { inFlight: 0, peak: 0, calls: 0 }, parallelStats = { inFlight: 0, peak: 0, calls: 0 };
let t0 = Date.now();
const serial = await analyzeSpecSource(source, { request: makeRequest(serialStats), chunkSize: 500, concurrency: 1 });
const serialMs = Date.now() - t0; t0 = Date.now();
const parallel = await analyzeSpecSource(source, { request: makeRequest(parallelStats), chunkSize: 500, concurrency: 3 });
const parallelMs = Date.now() - t0;
assert(serial.coverage.extraction.length >= 4, '合成资料须分成多段');
assert.equal(serialStats.peak, 1);
assert(parallelStats.peak >= 2 && parallelStats.peak <= 3, `并行峰值应在2~3之间，实际${parallelStats.peak}`);
assert.equal(parallelStats.calls, serialStats.calls, '并行不增加请求次数');
assert.equal(strip(parallel), strip(serial), '并行与串行结果须完全一致');
assert.equal(parallel.products[0].params_detail.length, 60);
assert.deepEqual(parallel.products[0].params_detail.slice(0, 3).map(d => d.value), ['10A', '20A', '30A'], '参数按原文顺序');
assert(parallelMs < serialMs, `并行应更快（串行${serialMs}ms，并行${parallelMs}ms）`);
await validateSpecAnalysis(source, parallel);

// 中间稿串行发出：后发出的中间稿已完成片段数不少于先发出的。
const covered = [];
await analyzeSpecSource(source, { request: makeRequest({ inFlight: 0, peak: 0, calls: 0 }), chunkSize: 500, concurrency: 3, allowPartial: true,
  onDraft: async d => { await new Promise(r => setTimeout(r, 3)); covered.push(d.coverage.extraction.length); } });
assert(covered.every((n, i) => i === 0 || n >= covered[i - 1]), `中间稿不得倒退：${covered.join(',')}`);

console.log(`并行整理：有限并行与失败停止、并行串行结果一致、参数按原文顺序、中间稿不倒退通过（合成软件用例；串行${serialMs}ms/并行${parallelMs}ms）`);
