import { analyzeSpecSource, validateSpecAnalysis, validateSpecDraft } from '../modules/spec-extraction.js';
import { readSpecAiConfig, specAiDestination, requestSpecJson } from '../modules/spec-ai-client.js';
import { writePresalesXlsx } from '../modules/presales-xlsx.js';
import { mergeSpecDevices, mergeableDevices } from '../modules/spec-device-merge.js';

const CACHE_KEY = 'spec_ai_extractions_v1';
const DRAFT_CACHE_KEY = 'spec_ai_partial_extractions_v1';
const validateWork = (source, result) => result.complete === false ? validateSpecDraft(source, result) : validateSpecAnalysis(source, result);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const labels = { VERIFIED: '原文可核验', REFERENCED_EXTERNAL: '引用图纸/附件', NOT_STATED: '文档未提及' };
const evidenceLabel = detail => detail.evidence?.ocrPages?.length ? 'OCR文字待对照原图' : labels[detail.evidence_status];
const findingLabels = {OWNERSHIP:'设备归属',VALUE:'参数值',CONDITION:'适用条件',OMISSION:'可能漏项',DEVICE:'设备识别',OCR_UNCERTAINTY:'OCR歧义',CONFLICT:'原文冲突'};
export function semanticReviewMarkup(result) {
  const review=result.semanticReview;
  if (!review) return `<p class="ns-ai-note">${result.complete === false ? '本次语义复核尚未完成；下列参数仅通过文字证据校验。' : '旧版提取工作稿：尚未执行语义复核；历史参数保留，可重新整理。'}</p>`;
  return `<section class="ns-ai-review"><h3>语义复核 · 待人工确认</h3><p>同一模型另发请求复核了${review.checkedParameterIds.length}项参数及原文片段；${review.findings.length ? `报告${review.findings.length}项疑点` : '未报告疑点，仍可能有遗漏或误判'}。</p>
    ${review.requiresImageCheck ? '<p class="ns-ai-note">含OCR文字：模型不能证明原图的数值、单位或★/±符号正确，必须对照原图。</p>' : ''}
    ${review.findings.length ? `<details><summary>查看${review.findings.length}项待核对疑点</summary><ul>${review.findings.map(f=>`<li><strong>${esc(findingLabels[f.kind])} · ${f.severity==='ERROR'?'需优先核对':'待核对'}</strong><p>${esc(f.message)}</p><small>${esc(f.evidence.location)}${f.parameter_id?` · 参数标识 ${esc(f.parameter_id)}`:''}</small><blockquote>${esc(f.original_text)}</blockquote></li>`).join('')}</ul></details>` : ''}
    ${(review.rejectedFindings||[]).length ? `<details><summary>另有${review.rejectedFindings.length}条复核意见未通过结构校验（未计入疑点，模型原话供参考）</summary><ul>${review.rejectedFindings.map(r=>`<li><strong>${esc(findingLabels[r.kind]||r.kind||'未知类型')}</strong><p>${esc(r.message)}</p><small>未采纳原因：${esc(r.reason)}</small>${r.original_text?`<blockquote>${esc(r.original_text)}</blockquote>`:''}</li>`).join('')}</ul></details>` : ''}</section>`;
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
  const sheets = [{name:'设备参数',rows:[[result.complete === false ? '未完成工作稿：存在待核对项或分析中断；仅下列参数通过文字证据校验，不能作为完整清单采用' : 'AI提取工作稿：待人工复核，不代表整份规范无遗漏或工程合规'],
    ['设备类型','设备名称','适用范围','参数','规范要求','适用条件','条件原文位置','证据状态','多个值提示','禁止偏离','AI疑点等级','原文','原文位置','不可偏离定义原文','复核状态'],...rowsFor(result)]},
    {name:'语义复核',rows:[[review?'同一模型单独请求的复核意见；全部待人工确认':result.complete === false?'本次语义复核尚未完成':'旧版工作稿：未执行语义复核'],
      [review?`覆盖${review.checkedParameterIds.length}项参数，报告${review.findings.length}项疑点；未报告疑点不代表无遗漏`:'请重新整理以执行语义复核'],
      ['疑点类型','优先级','参数标识','问题说明','原文','原文位置','复核状态'],
      ...(review?.findings||[]).map(f=>[findingLabels[f.kind],f.severity,f.parameter_id||'',f.message,f.original_text,f.evidence.location,'待人工确认']),
      ...(review?.rejectedFindings||[]).map(r=>[findingLabels[r.kind]||r.kind||'未知类型',r.severity,r.parameter_id||'',r.message,r.original_text,'',`未采纳（${r.reason}）`])]}];
  if (result.complete === false) sheets.push({name:'未通过校验项',rows:[['模型候选项：未通过证据校验，不可作为已确认参数采用'],
    ['分析状态',result.processingState,'中断说明',result.pipelineError],
    ['设备','参数','模型候选值（未核验）','模型候选条件（未核验）','失败原因','模型引用文字（未核验）','模型条件引用（未核验）','分析片段起点','分析片段终点'],
    ...result.rejectedParameters.map(r=>[result.products.find(p=>p.device_id===r.device_id)?.device_name||r.device_id,r.candidate.name,r.candidate.value,r.candidate.condition,r.reason,r.candidate.original_text,r.candidate.condition_original_text,r.chunk.start,r.chunk.end]),
    ...((result.rejectedDevices||[]).length?[[],['未通过校验的设备候选'],['设备类型','设备名称','适用范围','失败原因','模型引用文字（未核验）','分析片段起点','分析片段终点'],
      ...result.rejectedDevices.map(r=>[r.candidate.device_type,r.candidate.device_name,r.candidate.scope,r.reason,r.candidate.original_text,r.chunk.start,r.chunk.end])]:[])]});
  if ((result.deviceMerges || []).length) sheets.push({ name: '设备合并记录', rows: [['人工确认为同一设备的不同叫法后合并；参数内容未改动'],
    ['被合并设备', '合并到', '并入参数项数', '合并时间', '被合并设备原文', '原文位置'],
    ...result.deviceMerges.map(m => { const record = result.products.flatMap(p => p.mergedFrom || []).find(x => x.device_id === m.from.device_id);
      return [m.from.device_name, m.into.device_name, m.movedParameters, m.mergedAt, record?.evidence?.quote || '', record?.evidence?.location || '']; })] });
  return sheets;
}
function partialMarkup(result) {
  if (result.complete !== false) return '';
  const rejectedDevices = result.rejectedDevices || [];
  return `<section class="ns-ai-note"><h3>未完成工作稿 · ${rejectedDevices.length ? `${rejectedDevices.length}项设备、` : ''}${result.rejectedParameters.length}项参数待核对</h3><p>已通过文字证据校验的参数保留在下方；待核对项单独列出，未计入已核验参数。此稿不能作为整份规范的完整清单采用。</p>
    <p>${esc({running:'分析仍在进行，结果会逐批更新。',stopped:'本次分析已停止，已完成的批次仍可查看和下载。',needs_review:'文字提取已结束，仍有未通过校验的内容。'}[result.processingState])}</p>
    ${result.pipelineError?`<p>停止或未完成原因：${esc(result.pipelineError)}</p>`:''}
    ${rejectedDevices.length?`<details open><summary>查看未通过校验的设备候选及原因（${rejectedDevices.length}项）</summary><ul>${rejectedDevices.map(r=>`<li><strong>${esc(r.candidate.device_name||'（未命名）')} · ${esc(r.candidate.device_type||'类型未返回')}</strong>${r.candidate.scope?`<p>适用范围：${esc(r.candidate.scope)}</p>`:''}<p>未通过原因：${esc(r.reason)}</p>${r.candidate.original_text?`<blockquote>${esc(r.candidate.original_text)}</blockquote>`:''}</li>`).join('')}</ul></details>`:''}
    ${result.rejectedParameters.length?`<details open><summary>查看未通过校验项及原因（${result.rejectedParameters.length}项）</summary><ul>${result.rejectedParameters.map(r=>`<li><strong>${esc(result.products.find(p=>p.device_id===r.device_id)?.device_name)} · ${esc(r.candidate.name||'未命名参数')}</strong><p>模型候选值（未核验）：${esc(r.candidate.value)}${r.candidate.condition?`；模型候选条件（未核验）：${esc(r.candidate.condition)}`:''}</p><p>失败原因：${esc(r.reason)}</p><details><summary>模型引用文字（未核验）· 分析片段字符 ${r.chunk.start+1}—${r.chunk.end}</summary><blockquote>${esc(r.candidate.original_text)}</blockquote>${r.candidate.condition_original_text?`<p>模型条件引用（未核验）：</p><blockquote>${esc(r.candidate.condition_original_text)}</blockquote>`:''}</details></li>`).join('')}</ul></details>`:''}</section>`;
}
export function specResultMarkup(result, { interactive = false } = {}) {
  const count = result.products.reduce((n, p) => n + p.params_detail.filter(d => d.evidence_status === 'VERIFIED').length, 0);
  return `<div class="ns-ai-overview"><b>${result.products.length}项设备 · ${count}项有原文依据的参数</b><span>${result.complete === false ? '未完成工作稿 · 不代表整份规范已整理完成' : '全部文字分段已处理 · 待人工复核'}</span></div>
    ${partialMarkup(result)}
    <p class="ns-muted">按设备查看参数；“原文可核验”只表示证据匹配，不代表工程要求已确认或整份规范无遗漏。提取范围包括29类设备，现有配置方案仍只支持配电柜、PDU、智能母线。</p>
    ${result.model ? `<p class="ns-muted">本次结果接口：${esc(result.apiOrigin)} · ${esc(result.model)} · 生成时间：${esc(result.createdAt)}</p>` : ''}
    ${semanticReviewMarkup(result)}
    <p class="ns-muted">下方“人工条款复核与方案配置”的数量仅统计人工方案；本次 AI 清单显示在这里。</p>
    ${result.products.map((p, index) => `<details class="ns-ai-device"${index === 0 ? ' open' : ''}><summary><strong>${esc(p.device_name)}</strong><span>${esc(p.device_type)}${p.scope ? ` · ${esc(p.scope)}` : ''} · ${p.params_detail.length}项</span></summary>
      ${(p.mergedFrom || []).length ? `<p class="ns-ai-note">已人工合并的其他叫法：${p.mergedFrom.map(m => `“${esc(m.device_name)}”（${esc(m.evidence?.location || '')}）`).join('、')}</p>` : ''}
      ${interactive && mergeableDevices(result, p.device_id).length ? `<div class="ns-actions ns-ai-merge"><label>确认是同一台设备的不同叫法时，合并到 <select data-merge-into-for="${esc(p.device_id)}">${mergeableDevices(result, p.device_id).map(o => `<option value="${esc(o.device_id)}">${esc(o.device_name)}（${o.params_detail.length}项）</option>`).join('')}</select></label><button type="button" data-merge-from="${esc(p.device_id)}">合并设备</button></div>` : ''}
      ${p.scopeInEvidence === false ? `<p class="ns-ai-note">适用范围“${esc(p.scope)}”为AI归纳，原文中未找到相同写法，请核对。</p>` : ''}
      ${p.nameInEvidence === false ? `<p class="ns-ai-note">设备名称为AI归纳，原文写法：“${esc(p.evidence?.quote || '')}”（${esc(p.evidence?.location || '')}），请核对。</p>` : ''}
      ${!p.params_detail.length?'<p class="ns-ai-note">设备已识别，尚无通过校验的参数；请检查待核对项或未完成批次。</p>':''}
      <div class="ns-table-wrap"><table><thead><tr><th>参数</th><th>规范要求</th><th>证据状态</th><th>原文依据</th></tr></thead><tbody>${p.params_detail.map(d => `<tr><td>${esc(d.name)}${d.condition ? `<p class="ns-ai-note">适用条件：${esc(d.condition)}</p>` : ''}${d.forbiddenDeviation === true ? '<p class="ns-ai-note">★ 不可偏离</p>' : ''}</td><td>${esc(d.value)}${d.multipleValues ? '<p class="ns-ai-note">多个值，需核对适用条件</p>' : ''}</td><td>${evidenceLabel(d)}${d.risk !== 'LOW' ? `<p class="ns-ai-note">AI疑点：${esc(d.risk)} · 待复核</p>` : ''}</td><td>${d.evidence ? `<details><summary>${esc(d.evidence.location)}</summary><blockquote>${esc(d.original_text)}</blockquote>${d.evidence.pageFurnitureOmittedInValue ? '<p class="ns-ai-note">参数值省略重复页眉页脚；此处保留跨页完整原文。</p>' : ''}${d.deviationRuleEvidence ? `<p>不可偏离定义：${esc(d.deviationRuleEvidence.quote)}</p>` : ''}<small>原文字符 ${d.evidence.start + 1}—${d.evidence.end}</small></details>` : '该检查项在文档中未明确提及'}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}`;
}
export function mountSpecExtraction(root, api) {
  const get = id => root.querySelector(`#${id}`);
  const results = new Map();
  const drafts = new Map();
  const mergeUndo = new Map();
  let active = null, renderVersion = 0, shownSource = '';
  const progress = (text, error = false) => { get('ns-ai-progress').textContent = text; get('ns-ai-progress').className = error ? 'ns-error' : 'ns-muted'; };
  function persist() {
    if (!api.autosave()) return true;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...results])); localStorage.setItem(DRAFT_CACHE_KEY, JSON.stringify([...drafts])); return true; }
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
    let result = source && (drafts.get(source.id) || results.get(source.id));
    if (!result) return;
    try {
      try { await validateWork(source, result); }
      catch (error) {
        const previous = source && results.get(source.id);
        if (result.complete !== false || !previous) throw error;
        await validateSpecAnalysis(source, previous); result = previous;
      }
      if (version !== renderVersion) return;
      get('ns-ai-results').innerHTML = specResultMarkup(result, { interactive: !active })
        + (mergeUndo.has(source.id) && !active ? '<div class="ns-actions"><button type="button" data-merge-undo>撤销上次设备合并</button></div>' : '');
      const previous = results.get(source.id);
      if (result.complete === false && previous) {
        try {
          await validateSpecAnalysis(source, previous);
          if (version !== renderVersion) return;
          get('ns-ai-results').innerHTML += `<details><summary>查看上次完整工作稿（本次未覆盖）</summary>${specResultMarkup(previous)}</details>`;
        } catch { /* An old source revision must not be shown. */ }
      }
      get('ns-ai-exports').hidden = false;
      if (sourceChanged && !active) progress(result.complete === false ? '已载入未完成工作稿，可查看并下载已保留内容；仍需处理待核对项或重新整理。' : '已载入当前资料上次完成的 AI 提取结果；原文证据校验通过，仍待人工复核。');
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
      const result = await analyzeSpecSource(source, { signal: run.controller.signal, allowPartial: true,
        request: input => requestSpecJson(config, input),
        onDraft: async draft => {
          if (JSON.stringify(api.source()) !== run.sourceJson) return;
          await validateSpecDraft(source, draft);
          draft.model = config.model; draft.apiOrigin = new URL(config.baseUrl).origin;
          drafts.set(source.id, draft); persist(); await render();
        },
        onProgress: info => progress(specProgressMessage(info)) });
      if (run.controller.signal.aborted || JSON.stringify(api.source()) !== run.sourceJson) throw new Error('资料已变化或整理已取消，本次结果未应用');
      await validateWork(source, result);
      result.model = config.model; result.apiOrigin = new URL(config.baseUrl).origin;
      if (result.complete === false) drafts.set(source.id, result);
      else { results.set(source.id, result); drafts.delete(source.id); }
      const saved = persist();
      progress(result.complete === false ? `本次保留${result.products.length}项设备、${result.products.reduce((n,p)=>n+p.params_detail.filter(d=>d.evidence_status==='VERIFIED').length,0)}项有原文依据的参数；另有${result.rejectedParameters.length}项未通过校验，请查看下方未完成工作稿。${saved?'':'本机缓存失败，请下载JSON工作稿。'}` : `提取及模型语义复核完成：${result.products.length}项设备，${result.semanticReview.findings.length}项模型疑点待人工确认。未自动覆盖原有方案。${saved ? '' : '本机缓存失败，请下载JSON工作稿。'}`, result.complete === false || !saved);
    } catch (error) { progress(`${error.message}。已完成批次请查看下方未完成工作稿；上次完整工作稿和人工方案保留。`, true); }
    finally { active = null; await render(); }
  });
  // 人工合并设备：先由人确认是同一设备的不同叫法；合并后整份工作稿重新复验，失败则不保存。可撤销最近一次。
  const store = (source, result) => { if (result.complete === false) drafts.set(source.id, result); else results.set(source.id, result); };
  get('ns-ai-results').addEventListener('click', async event => {
    const button = event.target.closest('button[data-merge-from], button[data-merge-undo]');
    if (!button || active) return;
    try {
      const { source, result } = await current();
      if (button.hasAttribute('data-merge-undo')) {
        const previous = mergeUndo.get(source.id); if (!previous) return;
        await validateWork(source, previous); store(source, previous); mergeUndo.delete(source.id); persist();
        progress('已撤销上次设备合并。'); await render(); return;
      }
      const fromId = button.dataset.mergeFrom, select = [...get('ns-ai-results').querySelectorAll('select[data-merge-into-for]')].find(x => x.dataset.mergeIntoFor === fromId);
      const from = result.products.find(p => p.device_id === fromId), into = result.products.find(p => p.device_id === select?.value);
      if (!from || !into) throw new Error('请选择要合并到的设备');
      if (!globalThis.confirm(`把“${from.device_name}”的${from.params_detail.length}项参数合并到“${into.device_name}”？\n只在确认两者是同一台设备的不同叫法时合并。合并后可撤销最近一次。`)) return;
      const merged = await mergeSpecDevices(result, from.device_id, into.device_id);
      await validateWork(source, merged);
      mergeUndo.set(source.id, result); store(source, merged); persist();
      progress(`已把“${from.device_name}”合并到“${into.device_name}”；语义复核意见已改到合并后的参数标识，仍待人工复核。`); await render();
    } catch (error) { progress(`设备合并未完成：${error.message}`, true); }
  });
  get('ns-ai-cancel').addEventListener('click', () => { active?.controller.abort(); progress('正在取消本次整理…'); });
  async function current() {
    const source = api.source();
    let result = source && (drafts.get(source.id) || results.get(source.id));
    if (!result) throw new Error('请先完成 AI 整理');
    try { await validateWork(source, result); }
    catch (error) {
      const previous = source && results.get(source.id);
      if (result.complete !== false || !previous) throw error;
      await validateSpecAnalysis(source, previous); result = previous;
    }
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
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_CACHE_KEY) || '[]');
    if (Array.isArray(stored)) for (const pair of stored) if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') drafts.set(pair[0], pair[1]);
  } catch { progress('未完成工作稿缓存无法读取，请检查已下载的JSON工作稿。', true); }
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
