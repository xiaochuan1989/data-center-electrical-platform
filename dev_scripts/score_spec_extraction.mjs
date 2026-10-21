// 规范书提取结果 × 人工基准：离线打分，不调用任何接口。
// 只做可复核的机械比对：① 证据在原文中的位置是否与基准条目重叠；② 基准值里的数值记号（含正负号、比较符、
// 单位大小写）是否全部出现在结果值里。参数名称、角色、语义是否正确不由本脚本判断——"需人工看"一栏留给人。
// 基准与结果都含客户原文：本脚本不内置任何客户数据，报告只打印到终端或写到 --out 指定的位置（应在被忽略的 output/ 下）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const norm = s => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');

// 规范化文本，并记录每个规范化字符对应的原文下标，用于把原文偏移换算到规范化坐标。
export function indexText(text) {
  const src = String(text ?? ''), chars = [], map = [];
  for (let i = 0; i < src.length;) {
    const ch = String.fromCodePoint(src.codePointAt(i));
    for (const n of ch.normalize('NFKC').replace(/\s+/g, '')) { chars.push(n); map.push(i); }
    i += ch.length;
  }
  return { text: chars.join(''), map };
}
const toNorm = (idx, orig) => { let lo = 0, hi = idx.map.length; while (lo < hi) { const m = (lo + hi) >> 1; if (idx.map[m] < orig) lo = m + 1; else hi = m; } return lo; };
const spanOf = (idx, start, end) => ({ s: toNorm(idx, start), e: toNorm(idx, end) });

// 数值记号：可带 ±≤≥<> 或作负号的 "-"（紧跟数字/字母/%/°/右括号之后的 "-" 视为范围连接符），可带单位。
const TOKEN = /(?:[±≤≥<>]{1,2}|(?<![0-9A-Za-z.%°)）])-)?\d+(?:\.\d+)?(?:[A-Za-z%°]+)?/g;
export const numberTokens = s => [...new Set(norm(s).match(TOKEN) || [])];
const digitCore = t => t.replace(/^[±≤≥<>-]+/, '').replace(/[A-Za-z%°]+$/, '');
// 文字比较口径：去掉开头条目序号（"5、""（2）"）和标点。正负号、比较符、单位由 numberTokens 严格比对，不受此影响。
export const textKey = s => norm(s).replace(/^(?:[(（]\d+[)）]|\d+[、.．])/, '').replace(/\p{P}/gu, '');

// 在基准原文中定位一段引文；多处出现时用页码范围消歧，仍不唯一则标记 ambiguous 并保留全部位置。
function locate(base, quote, page) {
  const q = norm(quote);
  if (q.length < 2) return { spans: [], reason: 'QUOTE_TOO_SHORT' };
  let spans = [];
  for (let i = base.idx.text.indexOf(q); i >= 0; i = base.idx.text.indexOf(q, i + 1)) spans.push({ s: i, e: i + q.length });
  if (!spans.length) return { spans, reason: 'NOT_IN_BASELINE_SOURCE' };
  if (spans.length > 1 && page != null && base.pages.has(page)) {
    const r = base.pages.get(page), inPage = spans.filter(x => x.s >= r.s && x.e <= r.e);
    if (inPage.length) spans = inPage;
  }
  return { spans, ambiguous: spans.length > 1 };
}
const overlap = (a, b) => Math.min(a.e, b.e) - Math.max(a.s, b.s);
const touches = (spans, b) => spans.some(a => overlap(a, b) >= Math.max(1, Math.min(2, a.e - a.s, b.e - b.s)));

export function prepareBaseline(json) {
  const source = json.source, analysis = json.analysis || json;
  if (!source?.text || !Array.isArray(analysis?.products)) throw new Error('基准文件需包含 source.text 与 analysis.products');
  const idx = indexText(source.text), pages = new Map();
  for (const seg of source.segments || []) { const sp = spanOf(idx, seg.start, seg.end), old = pages.get(seg.page); pages.set(seg.page, old ? { s: Math.min(old.s, sp.s), e: Math.max(old.e, sp.e) } : sp); }
  const base = { idx, pages, items: [], notStated: [], devices: [] };
  for (const p of analysis.products) {
    const device = p.device_name || p.device_type || p.device_id;
    base.devices.push(device);
    for (const d of p.params_detail || []) {
      if (d.source_status === 'NOT_IN_DOCUMENT') { base.notStated.push({ device, name: d.name }); continue; }
      const ev = d.evidence;
      const span = ev && Number.isFinite(ev.start) ? spanOf(idx, ev.start, ev.end) : locate(base, d.original_text).spans[0];
      if (!span) throw new Error(`基准条目无法在基准原文中定位：${d.name}`);
      base.items.push({ device, name: d.name, value: d.value, span, tokens: numberTokens(d.value), external: d.source_status === 'DOCUMENT_REFERENCE' });
    }
  }
  return base;
}

// 结果适配：主程序导出工作稿 {source, analysis}（含未完成稿 rejectedParameters）、裸 analysis、原型归档 latest.json。
export function resultItems(json, base) {
  if (json && 'state' in json && 'records' in json && !json.state?.accepted) throw new Error(`原型归档没有候选结果（该轮未产出状态${json.error ? '，错误 ' + (json.error.code || '') + ' @ ' + (json.error.phase || '') : ''}）`);
  if (json?.state?.accepted) {
    const devices = new Map((json.state.devices || []).map(d => [d.id, d.name || d.device_name || d.type || d.device_type || d.id]));
    return { format: 'spec-v5-archive', items: json.state.accepted.map(c => ({
      device: devices.get(c.device_id) || c.device_id, name: c.name, value: c.valueRaw ?? (c.value_parts || []).map(q => q.quote).join(''),
      quotes: (c.evidence || []).map(q => ({ quote: q.quote, page: q.page })), verified: true, kind: c.kind })) };
  }
  const analysis = json?.analysis || json;
  if (!Array.isArray(analysis?.products)) throw new Error('无法识别的结果格式：需要 {source, analysis} 工作稿、analysis 或原型 latest.json');
  // 同一份原文时直接用结果自带的字符偏移，避免短引文多处出现导致误定位。
  const own = json.source?.text ? indexText(json.source.text) : null, sameSource = !!own && own.text === base.idx.text;
  const pageOf = loc => { const m = /第(\d+)页/.exec(loc || ''); return m ? Number(m[1]) : null; };
  const fromDetail = (device, d, verified) => {
    const ev = d.evidence;
    return { device, name: d.name, value: d.value, verified, notStated: d.source_status === 'NOT_IN_DOCUMENT',
      quotes: [{ quote: ev?.quote ?? d.original_text, page: pageOf(ev?.location), span: sameSource && ev && Number.isFinite(ev.start) ? spanOf(own, ev.start, ev.end) : null }] };
  };
  const names = new Map(analysis.products.map(p => [p.device_id, p.device_name || p.device_type || p.device_id]));
  const items = analysis.products.flatMap(p => (p.params_detail || []).map(d => fromDetail(names.get(p.device_id), d, true)));
  for (const r of analysis.rejectedParameters || []) items.push({ ...fromDetail(names.get(r.device_id) || r.device_id, r.candidate || {}, false), rejectReason: r.reason });
  return { format: analysis.draftVersion != null || analysis.rejectedParameters ? 'main-app-draft' : 'main-app', items, sameSource,
    processingState: analysis.processingState || null, pipelineError: analysis.pipelineError || '' };
}

export function score(base, result) {
  const items = result.items.map((r, i) => {
    if (r.notStated) return { ...r, i, spans: [], tokens: [] };
    const located = r.quotes.map(q => q.span ? { spans: [q.span] } : locate(base, q.quote, q.page));
    const spans = located.flatMap(x => x.spans);
    return { ...r, i, spans, ambiguous: located.some(x => x.ambiguous), unlocated: !spans.length ? (located[0]?.reason || 'NO_QUOTE') : null, tokens: numberTokens(r.value) };
  });
  const scorable = items.filter(r => !r.notStated && !r.unlocated);
  const evaluate = (b, pool) => {
    const nb = textKey(b.value), near = pool.filter(r => touches(r.spans, b.span));
    // 同一句里常有好几条参数：只有与基准值共享数字或文字互相包含的结果才算"对应这一条"。
    const relevant = near.filter(r => { const nr = textKey(r.value); return (nr.length >= 2 && (nb.includes(nr) || nr.includes(nb))) || r.tokens.some(t => b.tokens.some(u => digitCore(t) === digitCore(u))); })
      .sort((x, y) => Math.min(...x.spans.map(s => s.s)) - Math.min(...y.spans.map(s => s.s)));
    if (!relevant.length) return { status: 'MISS', near: near.length, relevant };
    const tokens = new Set(relevant.flatMap(r => r.tokens)), joined = relevant.map(r => textKey(r.value)).join('');
    const missingTokens = b.tokens.filter(t => !tokens.has(t));
    if (missingTokens.length) return { status: 'NUMBER_MISMATCH', missingTokens, relevant };
    const text = relevant.some(r => textKey(r.value) === nb) || joined === nb ? 'EQUAL' : joined.includes(nb) ? 'CONTAINS' : 'DIFFERENT';
    // 结果常把主语放在参数名、谓语放在值里；缺的字若都在结果参数名里，仍列"需人工看"，但注明，便于人快速放行。
    const nameCarries = text === 'DIFFERENT' && textKey(relevant.map(r => (r.name || '') + r.value).join('')).length >= nb.length
      && [...nb].every(ch => joined.includes(ch) || relevant.some(r => textKey(r.name).includes(ch)));
    return { status: text === 'DIFFERENT' ? 'CHECK' : 'HIT', text, nameCarries, relevant };
  };
  const verified = scorable.filter(r => r.verified), unverified = scorable.filter(r => !r.verified);
  const rows = base.items.map(b => ({ ...b, ...evaluate(b, verified) }));
  // 结果设备 → 基准设备：按命中条目多数票映射；映射后仍不一致的命中条目标记设备归属不同。
  const votes = new Map();
  for (const row of rows) for (const r of row.relevant || []) { const v = votes.get(r.device) || new Map(); v.set(row.device, (v.get(row.device) || 0) + 1); votes.set(r.device, v); }
  const deviceMap = new Map([...votes].map(([d, v]) => [d, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
  for (const row of rows) row.deviceDiff = (row.relevant || []).some(r => deviceMap.get(r.device) !== row.device);
  const used = new Set(rows.flatMap(row => (row.relevant || []).map(r => r.i)));
  const extra = verified.filter(r => !used.has(r.i)).map(r => ({ ...r, sameClause: base.items.some(b => touches(r.spans, b.span)) }));
  const rescued = rows.filter(row => row.status === 'MISS').map(row => ({ row, by: evaluate(row, unverified) })).filter(x => x.by.status !== 'MISS');
  const count = s => rows.filter(r => r.status === s).length, n = rows.length;
  return {
    format: result.format, sameSource: !!result.sameSource, processingState: result.processingState || null, pipelineError: result.pipelineError || '',
    summary: { baselineItems: n, hit: count('HIT'), check: count('CHECK'), numberMismatch: count('NUMBER_MISMATCH'), miss: count('MISS'),
      recall: n ? count('HIT') / n : 0, looseRecall: n ? (count('HIT') + count('CHECK')) / n : 0, deviceDiff: rows.filter(r => r.deviceDiff).length,
      resultItems: items.length, verifiedItems: items.filter(r => r.verified && !r.notStated).length, unverifiedItems: items.filter(r => !r.verified).length,
      extra: extra.length, unlocated: items.filter(r => r.unlocated).length, ambiguous: items.filter(r => r.ambiguous).length, rescuedByUnverified: rescued.length,
      baselineDevices: base.devices, resultDevices: [...new Set(items.map(r => r.device))] },
    rows, extra, unlocated: items.filter(r => r.unlocated), rescued,
    notStated: { baseline: base.notStated, result: items.filter(r => r.notStated).map(r => ({ device: r.device, name: r.name })) },
  };
}

const cut = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n) + '…' : t; };
const pct = x => (x * 100).toFixed(1) + '%';
export function formatReport(file, rep, { summaryOnly = false } = {}) {
  const s = rep.summary, out = [];
  out.push(`=== ${file}`, `格式 ${rep.format}${rep.sameSource ? '（与基准同一原文，按字符偏移定位）' : '（按引文在基准原文中定位）'}`);
  if (rep.processingState === 'running') out.push('⚠ 这份工作稿是整理进行中下载的（running），分数不代表最终结果；请等页面整理结束后重新下载再打分。');
  else if (rep.processingState) out.push(`⚠ 未完成工作稿（${rep.processingState}）${rep.pipelineError ? `，停止原因：${rep.pipelineError}` : ''}；分数只反映已完成的批次。`);
  out.push(`基准 ${s.baselineItems} 条：命中 ${s.hit} · 需人工看 ${s.check} · 数值不一致 ${s.numberMismatch} · 漏提 ${s.miss}`);
  out.push(`严格召回 ${pct(s.recall)} · 宽松召回（含需人工看）${pct(s.looseRecall)} · 设备归属不同 ${s.deviceDiff}`);
  out.push(`结果 ${s.resultItems} 条（已核验 ${s.verifiedItems}，未核验 ${s.unverifiedItems}）：基准外 ${s.extra} · 引文无法在原文定位 ${s.unlocated} · 引文多处出现 ${s.ambiguous}${s.unverifiedItems ? ` · 未核验候选能补上的漏提 ${s.rescuedByUnverified}` : ''}`);
  out.push(`设备：基准 [${s.baselineDevices.join('、')}] · 结果 [${s.resultDevices.join('、')}]`);
  if (summaryOnly) return out.join('\n');
  const vals = row => (row.relevant || []).map(r => r.value).join(' ‖ ');
  const section = (title, list, line) => { if (!list.length) return; out.push('', `--- ${title}（${list.length}）`); for (const x of list) out.push('  ' + line(x)); };
  section('漏提', rep.rows.filter(r => r.status === 'MISS'), r => `${r.name} = ${cut(r.value)}${r.near ? `（同句有 ${r.near} 条其他结果，值对不上）` : ''}`);
  section('数值不一致', rep.rows.filter(r => r.status === 'NUMBER_MISMATCH'), r => `${r.name}：基准 ${cut(r.value)} → 结果 ${cut(vals(r))} · 缺 ${r.missingTokens.join(' ')}`);
  section('需人工看（数值一致，措辞不同）', rep.rows.filter(r => r.status === 'CHECK'), r => `${r.name}：基准 ${cut(r.value)} → 结果 ${cut(vals(r))}${r.nameCarries ? '（缺的字在结果参数名里）' : ''}`);
  section('设备归属不同', rep.rows.filter(r => r.deviceDiff), r => `${r.name}：基准设备 ${r.device} → 结果设备 ${[...new Set(r.relevant.map(x => x.device))].join('、')}`);
  section('基准外（基准未收录，可能是有效细分，也可能是噪声）', rep.extra, r => `${r.name} = ${cut(r.value)}${r.sameClause ? '（与某基准条目同句）' : ''}`);
  section('引文无法在原文定位', rep.unlocated, r => `${r.name} = ${cut(r.value)} · ${r.unlocated} · 引文：${cut(r.quotes.map(q => q.quote).join(' / '), 50)}`);
  section('未核验候选能补上的漏提', rep.rescued, x => `${x.row.name}：${x.by.status} ← ${cut(x.by.relevant.map(r => `${r.value}（${cut(r.rejectReason, 30)}）`).join(' ‖ '))}`);
  if (rep.notStated.baseline.length || rep.notStated.result.length) out.push('', `--- 文档未提及项（不计分）：基准 [${rep.notStated.baseline.map(x => x.name).join('、')}] · 结果 [${rep.notStated.result.map(x => x.name).join('、')}]`);
  return out.join('\n');
}

async function main(argv) {
  const args = { results: [], baseline: 'output/spec-real-validation/offline-baseline.json', out: null, summaryOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--summary') args.summaryOnly = true;
    else if (a === '-h' || a === '--help') { console.log('用法：node dev_scripts/score_spec_extraction.mjs [--baseline 基准.json] [--summary] [--out 报告.json] 结果1.json [结果2.json ...]\n结果可为网页导出的“规范书设备参数工作稿.json”（含未完成稿）或原型 runs/<id>/latest.json。'); return 0; }
    else args.results.push(a);
  }
  if (!args.results.length) { console.error('缺少结果文件。用 --help 查看用法。'); return 2; }
  const base = prepareBaseline(JSON.parse(fs.readFileSync(args.baseline, 'utf8')));
  const reports = [];
  for (const file of args.results) {
    try {
      const rep = score(base, resultItems(JSON.parse(fs.readFileSync(file, 'utf8')), base));
      reports.push({ file, ...rep });
      console.log(formatReport(path.basename(path.dirname(file)) + '/' + path.basename(file), rep, args) + '\n');
    } catch (e) { console.error(`=== ${file}\n无法打分：${e.message}\n`); reports.push({ file, error: e.message }); }
  }
  if (args.out) {
    const slim = r => r.error ? r : { file: r.file, format: r.format, summary: r.summary,
      rows: r.rows.map(({ relevant, span, ...x }) => ({ ...x, resultValues: (relevant || []).map(v => v.value) })),
      extra: r.extra.map(({ name, value, device }) => ({ name, value, device })), unlocated: r.unlocated.map(({ name, value, unlocated }) => ({ name, value, unlocated })) };
    fs.writeFileSync(args.out, JSON.stringify({ baseline: args.baseline, createdAt: new Date().toISOString(), reports: reports.map(slim) }, null, 2));
    console.log('报告已写入', args.out);
  }
  return reports.some(r => r.error) ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
