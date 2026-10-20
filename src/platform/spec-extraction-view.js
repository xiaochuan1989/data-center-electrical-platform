import { analyzeSpecSource, validateSpecAnalysis } from '../modules/spec-extraction.js';
import { readSpecAiConfig, specAiDestination, requestSpecJson } from '../modules/spec-ai-client.js';
import { writePresalesXlsx } from '../modules/presales-xlsx.js';

const CACHE_KEY = 'spec_ai_extractions_v1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { VERIFIED: '原文可核验', REFERENCED_EXTERNAL: '引用图纸/附件', NOT_STATED: '文档未提及' };
const evidenceLabel = detail => detail.evidence?.ocrPages?.length ? 'OCR文字待对照原图' : labels[detail.evidence_status];
const findingLabels = {OWNERSHIP:'设备归属',VALUE:'参数值',CONDITION:'适用条件',OMISSION:'可能漏项',DEVICE:'设备识别',OCR_UNCERTAINTY:'OCR歧义',CONFLICT:'原文冲突'};
export function semanticReviewMarkup(result) {
  const review=result.semanticReview;
  if (!review) return '<p class="ns-ai-note">旧版提取工作稿：尚未执行语义复核；历史参数保留，可重新整理。</p>';
  return `<section class="ns-ai-review"><h3>语义复核 · 待人工确认</h3><p>同一模型另发请求复核了${review.checkedParameterIds.length}项参数及原文片段；${review.findings.length ? `报告${review.findings.length}项疑点` : '未报告疑点，仍可能有遗漏或误判'}。</p>
    ${review.requiresImageCheck ? '<p class="ns-ai-note">含OCR文字：模型不能证明原图的数值、单位或★/±符号正确，必须对照原图。</p>' : ''}
    ${review.findings.length ? `<details><summary>查看${review.findings.length}项待核对疑点</summary><ul>${review.findings.map(f=>`<li><strong>${esc(findingLabels[f.kind])} · ${f.severity==='ERROR'?'需优先核对':'待核对'}</strong><p>${esc(f.message)}</p><small>${esc(f.evidence.location)}${f.parameter_id?` · 参数标识 ${esc(f.parameter_id)}`:''}</small><blockquote>${esc(f.original_text)}</blockquote></li>`).join('')}</ul></details>` : ''}</section>`;
}
export function specProgressMessage(info) {
  const phase={discovery:'识别设备',extraction:'整理参数',review:'语义复核'}[info.phase]||'分析';
  if(info.retry==='budget')return `${phase}回答达到预算，正在提高预算重试；保留思考模式…`;
  if(info.retry==='review_batch')return `语义复核回答过长，正在拆分${info.batchRows}项参数的复核批次…`;
  if(info.retry==='truncated')return `${phase}回答达到长度限制，正在缩小${info.chunkChars}字片段后重试（第${info.splitDepth}层）…`;
  return `${phase}：已完成${info.completed}批次（含自动拆分），已识别${info.devices}项设备，已发出${info.requests}次请求。`;
}
export function specExtractionSection() {
  return `<section class="ns-section ns-ai-section" id="ns-ai-section">
    <h2>设备与参数 · AI 自动整理</h2>
    <p>上传规范书后直接整理设备与参数，无需先手动登记设备。支持 extract-spec 的29类设备；结果保留原文依据，供人工复核。</p>
    <p class="ns-muted">分批提取后另做语义复核，检查设备归属、条件和漏项；会增加调用次数与耗时，模型复核不能替代人工确认。</p>
    <p class="ns-muted" id="ns-ai-destination"></p>
    <div class="ns-actions"><button id="ns-ai-analyze" class="platform-primary-action">AI 自动整理设备与参数</button><button id="ns-ai-cancel" disabled>取消整理</button></div>
    <p class="ns-muted">扫描PDF先在浏览器本机OCR；仅点击上方“AI 自动整理”才会把当前选中资料的文字分段发送到已配置的 AI 接口。OCR文字仍须对照原图核对，上传和本机保存不发送资料。</p>
    <p id="ns-ai-progress" role="status" aria-live="polite">先导入规范书，再点击 AI 自动整理。</p>
    <div class="ns-actions" id="ns-ai-exports" hidden><button id="ns-ai-json">下载设备参数JSON（含原文）</button><button id="ns-ai-excel">导出设备参数Excel</button><button id="ns-ai-html">下载提取报告HTML</button></div>
    <div id="ns-ai-results"></div>
  </section>`;
}
function rowsFor(result) {
  return result.products.flatMap(p => p.params_detail.map(d => [p.device_type, p.device_name, p.scope, d.name, d.value, d.condition || '', d.conditionEvidence?.location || '',
    evidenceLabel(d), d.multipleValues ? '同名参数有多个值，需核对范围' : '', d.forbiddenDeviation === true ? '禁止偏离（有原文依据）' : '未核对', d.risk, d.original_text, d.evidence?.location || '', d.deviationRuleEvidence?.quote || '', '待人工复核']));
}
export function specExportSheets(result) {
  const review=result.semanticReview;
  return [{name:'设备参数',rows:[['AI提取工作稿：待人工复核，不代表整份规范无遗漏或工程合规'],
    ['设备类型','设备名称','适用范围','参数','规范要求','适用条件','条件原文位置','证据状态','多个值提示','禁止偏离','AI疑点等级','原文','原文位置','不可偏离定义原文','复核状态'],...rowsFor(result)]},
    {name:'语义复核',rows:[[review?'同一模型单独请求的复核意见；全部待人工确认':'旧版工作稿：未执行语义复核'],
      [review?`覆盖${review.checkedParameterIds.length}项参数，报告${review.findings.length}项疑点；未报告疑点不代表无遗漏`:'请重新整理以执行语义复核'],
      ['疑点类型','优先级','参数标识','问题说明','原文','原文位置','复核状态'],
      ...(review?.findings||[]).map(f=>[findingLabels[f.kind],f.severity,f.parameter_id||'',f.message,f.original_text,f.evidence.location,'待人工确认'])]}];
}
export function specResultMarkup(result) {
  const count = result.products.reduce((n, p) => n + p.params_detail.filter(d => d.evidence_status === 'VERIFIED').length, 0);
  return `<div class="ns-ai-overview"><b>${result.products.length}项设备 · ${count}项有原文依据的参数</b><span>全部文字分段已处理 · 待人工复核</span></div>
    <p class="ns-muted">按设备查看参数；“原文可核验”只表示证据匹配，不代表工程要求已确认或整份规范无遗漏。提取范围包括29类设备，现有配置方案仍只支持配电柜、PDU、智能母线。</p>
    ${result.model ? `<p class="ns-muted">本次结果接口：${esc(result.apiOrigin)} · ${esc(result.model)} · 生成时间：${esc(result.createdAt)}</p>` : ''}
    ${semanticReviewMarkup(result)}
    ${result.products.map((p, index) => `<details class="ns-ai-device"${index === 0 ? ' open' : ''}><summary><strong>${esc(p.device_name)}</strong><span>${esc(p.device_type)}${p.scope ? ` · ${esc(p.scope)}` : ''} · ${p.params_detail.length}项</span></summary>
      <div class="ns-table-wrap"><table><thead><tr><th>参数</th><th>规范要求</th><th>证据状态</th><th>原文依据</th></tr></thead><tbody>${p.params_detail.map(d => `<tr><td>${esc(d.name)}${d.condition ? `<p class="ns-ai-note">适用条件：${esc(d.condition)}</p>` : ''}${d.forbiddenDeviation === true ? '<p class="ns-ai-note">★ 不可偏离</p>' : ''}</td><td>${esc(d.value)}${d.multipleValues ? '<p class="ns-ai-note">多个值，需核对适用条件</p>' : ''}</td><td>${evidenceLabel(d)}${d.risk !== 'LOW' ? `<p class="ns-ai-note">AI疑点：${esc(d.risk)} · 待复核</p>` : ''}</td><td>${d.evidence ? `<details><summary>${esc(d.evidence.location)}</summary><blockquote>${esc(d.original_text)}</blockquote>${d.evidence.pageFurnitureOmittedInValue ? '<p class="ns-ai-note">参数值省略重复页眉页脚；此处保留跨页完整原文。</p>' : ''}${d.deviationRuleEvidence ? `<p>不可偏离定义：${esc(d.deviationRuleEvidence.quote)}</p>` : ''}<small>原文字符 ${d.evidence.start + 1}—${d.evidence.end}</small></details>` : '该检查项在文档中未明确提及'}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}`;
}
export function mountSpecExtraction(root, api) {
  const get = id => root.querySelector(`#${id}`);
  const results = new Map();
  let active = null, renderVersion = 0, shownSource = '';
  const progress = (text, error = false) => { get('ns-ai-progress').textContent = text; get('ns-ai-progress').className = error ? 'ns-error' : 'ns-muted'; };
  function persist() {
    if (!api.autosave()) return true;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...results])); return true; }
    catch { progress('AI 结果本机缓存失败，当前结果仍保留；请下载JSON工作稿。', true); return false; }
  }
  async function render() {
    const version = ++renderVersion, source = api.source();
    const sourceJson = JSON.stringify(source);
    const sourceChanged = sourceJson !== shownSource;
    if (sourceChanged) {
      shownSource = sourceJson;
      if (!active) progress(source ? '当前资料已就绪，点击 AI 自动整理设备与参数。' : '先导入规范书，再点击 AI 自动整理。');
    }
    get('ns-ai-destination').textContent = `分析接口：${specAiDestination()}`;
    if (active && (!source || sourceJson !== active.sourceJson)) {
      active.controller.abort(); progress('资料来源已变化，本次整理已取消；旧请求结果不会应用。', true);
    }
    get('ns-ai-analyze').disabled = !!active || !source;
    get('ns-ai-cancel').disabled = !active;
    get('ns-ai-exports').hidden = true;
    get('ns-ai-results').innerHTML = '';
    const result = source && results.get(source.id);
    if (!result) return;
    try {
      await validateSpecAnalysis(source, result);
      if (version !== renderVersion) return;
      get('ns-ai-results').innerHTML = specResultMarkup(result);
      get('ns-ai-exports').hidden = false;
      if (sourceChanged && !active) progress('已载入当前资料上次完成的 AI 提取结果；原文证据校验通过，仍待人工复核。');
    } catch {
      if (version === renderVersion) progress('原文或提取工作稿已变化，旧 AI 结果未显示；请重新整理。', true);
    }
  }
  get('ns-ai-analyze').addEventListener('click', async () => {
    if (active) return;
    try {
      const source = structuredClone(api.source());
      if (!source) throw new Error('请先导入并选择需求资料');
      const config = readSpecAiConfig();
      const run = { controller: new AbortController(), sourceJson: JSON.stringify(source) };
      active = run; await render();
      progress('正在检查原文并识别设备…');
      const result = await analyzeSpecSource(source, { signal: run.controller.signal,
        request: input => requestSpecJson(config, input),
        onProgress: info => progress(specProgressMessage(info)) });
      if (run.controller.signal.aborted || JSON.stringify(api.source()) !== run.sourceJson) throw new Error('资料已变化或整理已取消，本次结果未应用');
      await validateSpecAnalysis(source, result);
      result.model = config.model; result.apiOrigin = new URL(config.baseUrl).origin;
      results.set(source.id, result); const saved = persist();
      progress(`提取及模型语义复核完成：${result.products.length}项设备，${result.semanticReview.findings.length}项模型疑点待人工确认。未自动覆盖原有方案。${saved ? '' : '本机缓存失败，请下载JSON工作稿。'}`, !saved);
    } catch (error) { progress(`${error.message}。已有结果和方案保留。`, true); }
    finally { active = null; await render(); }
  });
  get('ns-ai-cancel').addEventListener('click', () => { active?.controller.abort(); progress('正在取消本次整理…'); });
  async function current() {
    const source = api.source(), result = source && results.get(source.id);
    if (!result) throw new Error('请先完成 AI 整理');
    await validateSpecAnalysis(source, result);
    return { source, result };
  }
  const output = fn => async () => { try { await fn(await current()); } catch (error) { progress(error.message, true); } };
  get('ns-ai-json').addEventListener('click', output(({ source, result }) => api.download(JSON.stringify({ source, analysis: result }, null, 2), '规范书设备参数工作稿.json', 'application/json')));
  get('ns-ai-excel').addEventListener('click', output(({ result }) => api.download(writePresalesXlsx(specExportSheets(result)), '规范书设备参数工作稿.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')));
  get('ns-ai-html').addEventListener('click', output(({ result }) => api.download(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>规范书设备参数工作稿</title><style>body{font:14px/1.7 system-ui,sans-serif;color:#243449;max-width:1200px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd7e4;padding:10px;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f5fa}summary{cursor:pointer;padding:12px}blockquote{white-space:pre-wrap}.ns-ai-overview{padding:16px;background:#eef6ff}.ns-ai-overview span,.ns-ai-device summary span{display:block}.ns-ai-device{border:1px solid #ccd7e4;margin:16px 0}.ns-ai-note{color:#854b0b}</style><h1>${esc(result.file_name)} · 设备参数</h1><p>extract-spec ${esc(result.skillVersion)} 网页适配 · 待人工复核</p>${specResultMarkup(result).replace(/<details(?![^>]*\bopen\b)/g, '<details open')}</html>`, '规范书设备参数工作稿.html', 'text/html')));
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    if (Array.isArray(stored)) for (const pair of stored) if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') results.set(pair[0], pair[1]);
  } catch { progress('AI 提取缓存无法读取，未删除旧数据；可重新整理。', true); }
  // Changes to model settings are reflected before any request; this listener only refreshes the label.
  globalThis.addEventListener('focus', () => { get('ns-ai-destination').textContent = `分析接口：${specAiDestination()}`; });
  const updateDestination = event => {
    if (['provider', 'model', 'baseurl', 'baseurl-custom', 'apikey'].includes(event.target.id)) {
      get('ns-ai-destination').textContent = `分析接口：${specAiDestination()}`;
      if (active) { active.controller.abort(); progress('AI 接口设置已变化，本次整理已取消；请核对设置后重新开始。', true); }
    }
  };
  root.ownerDocument.addEventListener('input', updateDestination);
  root.ownerDocument.addEventListener('change', updateDestination);
  return { render, persist, busy: () => !!active };
}
