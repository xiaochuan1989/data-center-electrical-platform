import { PRODUCT_PROFILES, createPresalesPackage, addEquipment, updateEquipmentQuantity, addPresalesSource,
  replacePresalesSource, confirmPresalesRequirement, revisePresalesRequirement, invalidatePresalesRequirement,
  remapPresalesRequirement, createPresalesSnapshot, restorePresalesSnapshot } from '../modules/nonstandard-presales.js';
import { extractPresalesSource, parsePresalesClause, presalesEvidenceLocation } from '../modules/nonstandard-requirements.js';
import { readPresalesFile } from './nonstandard-file-reader.js';
import { nonstandardSchemeSection, mountNonstandardSchemes } from './nonstandard-scheme-view.js';
import { writePresalesXlsx } from '../modules/presales-xlsx.js';
import { requirementReviewPage, createRequirementDrafts, isRequirementTodo } from './requirement-review-state.js';
import '../css/nonstandard-requirements.css';

const STORAGE_KEY = 'nonstandard_presales_working_v1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const statuses = { pending: '待复核', unknown: '未知/待澄清', conflict: '候选冲突', stale: '来源已失效', confirmed: '人工已确认' };
const responses = { pending: '待应答', met: '人工复核：满足', deviation: '人工复核：偏离', 'not-applicable': '人工复核：不适用' };
const option = (value, label, current) => `<option value="${escape(value)}"${String(current) === String(value) ? ' selected' : ''}>${escape(label)}</option>`;
export function nonstandardRequirementView() {
  return `<section class="platform-view platform-card ns-requirements" id="platform-view-requirements" hidden>
    <header class="platform-section-head"><div><h1>非标配电售前方案</h1><p>配电柜 · PDU · 智能母线｜要求复核 → 采用方案 → 配置清单，非生产图纸。</p></div></header>
    <div class="ns-banner">资料先留证据，再分配设备与确认参数。文件内的指令仅作为客户条款，不执行宏、公式或自动应答；不调用外部AI/OCR。</div>
    <div class="ns-toolbar"><label><input type="checkbox" id="ns-autosave"> 仅本机自动保存（含客户原文）</label>
      <button id="ns-backup">备份方案工作稿JSON</button><label class="ns-file-button">恢复JSON<input id="ns-restore" type="file" accept=".json"></label>
      <button id="ns-export">导出技术要求Excel工作稿</button></div>
    <p id="ns-message" role="status" aria-live="polite"></p>
    <div class="ns-columns">
      <section class="ns-section"><h2>1. 登记设备项</h2><div class="platform-form-grid cols-3">
        <label>品类<select id="ns-category">${Object.entries(PRODUCT_PROFILES).map(([key, p]) => option(key, p.label, 'cabinet')).join('')}</select></label>
        <label>设备名称/位号<input id="ns-equipment-label" placeholder="填写客户设备名称"></label>
        <label>设备数量<input id="ns-equipment-quantity" type="number" min="1" step="1" placeholder="未知可留空"></label>
        <label>变更原因<input id="ns-equipment-reason" placeholder="登记依据或澄清原因"></label>
      </div><button id="ns-add-equipment" class="platform-primary-action">添加设备项</button><div id="ns-equipment-list"></div></section>
      <section class="ns-section"><h2>2. 导入需求资料</h2>
        <label>资料名称<input id="ns-source-name" placeholder="例如客户技术要求"></label>
        <label>粘贴原文<textarea id="ns-source-text" rows="5" placeholder="粘贴原文，不填默认技术参数"></textarea></label>
        <div class="ns-actions"><button id="ns-add-source">添加粘贴资料</button><label class="ns-file-button">选择需求文件<input id="ns-file" type="file" accept=".txt,.md,.docx,.pdf,.xlsx"></label></div>
        <p class="ns-muted">≤20MB；文字PDF、DOCX、UTF-8 TXT/MD、XLSX。解析库及PDF字库/worker由本机或同一站点提供，不上传客户内容、不依赖解析CDN。扫描页、图片/复杂表格需另行核对。</p>
        <label>已导入来源<select id="ns-source-select"></select></label>
        <div class="ns-actions"><button id="ns-extract">提取待复核条款</button><button id="ns-replace-source">用粘贴内容替换选中来源</button></div>
        <details><summary>查看选中来源原文</summary><pre id="ns-source-preview"></pre></details><div id="ns-read-warnings" class="ns-muted"></div>
      </section>
    </div>
    <section class="ns-section"><h2>3. 设备归属与人工复核</h2>
      <div class="ns-toolbar"><label>复核资料<select id="ns-filter-source"></select></label><button id="ns-review-source">按选中资料复核</button><label>设备筛选<select id="ns-filter-equipment"></select></label><label>状态筛选<select id="ns-filter-status">${option('', '全部', '')}${option('todo', '待处理（含待分配）', '')}${Object.entries(statuses).map(([key, label]) => option(key, label, '')).join('')}</select></label><label>条款关键词<input id="ns-filter-keyword" type="search" placeholder="原文、字段或位置"></label><span id="ns-summary"></span></div>
      <p class="ns-muted">先“分配/更新字段”，再确认。单值候选可预填，但不会自动确认；冲突必须人工选择并说明。复核输入一经修改，原确认立即失效。未点击确认/分配的编辑输入不写入备份，导出仅含已记录的数据。</p>
      <p id="ns-draft-status" class="ns-muted" aria-live="polite"></p><button id="ns-discard-drafts" hidden>放弃本次条款编辑</button>
      <div class="ns-pagination" aria-label="条款分页"><label>每页条款<select id="ns-page-size"><option value="10">10条</option><option value="20" selected>20条</option><option value="50">50条</option></select></label><button id="ns-page-prev">上一页条款</button><span id="ns-page-info" role="status" aria-live="polite"></span><button id="ns-page-next">下一页条款</button><label>跳到条款页<input id="ns-page-number" type="number" min="1" step="1" value="1"></label><button id="ns-page-go">跳转条款页</button></div>
      <div id="ns-requirement-list"></div>
    </section>
    <section class="ns-section"><h2>4. 待澄清与修订</h2><button id="ns-review-todo">查看待处理条款</button><div id="ns-clarifications"></div><details><summary>修订记录</summary><div id="ns-revisions"></div></details></section>
    ${nonstandardSchemeSection()}
  </section>`;
}

export function mountNonstandardRequirements(root, options = {}) {
  let pack = createPresalesPackage(), autosave = false, generation = 0, busy = false;
  let page = 1, keywordTimer = null;
  const drafts = createRequirementDrafts();
  const get = id => root.querySelector(`#${id}`);
  const message = (value, error = false) => { get('ns-message').textContent = value; get('ns-message').className = error ? 'ns-error' : 'ns-success'; };
  function persist() {
    if (!autosave) return true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, snapshot: createPresalesSnapshot(pack) })); return true; }
    catch { message('本机保存失败（空间或浏览器权限不足）。当前页面工作稿仍在，请下载JSON备份。', true); return false; }
  }
  const equipmentOptions = current => option('', '待分配', current || '') + pack.equipment.map(e => option(e.id, `${PRODUCT_PROFILES[e.category].label} · ${e.label}`, current)).join('');
  function fieldOptions(equipmentId, current) {
    const equipment = pack.equipment.find(e => e.id === equipmentId);
    return option('clause', '全文/功能条款', current) + (equipment ? Object.entries(PRODUCT_PROFILES[equipment.category].fields).map(([key, d]) => option(key, `${d.label}${d.unit ? `(${d.unit})` : ''}`, current)).join('') : '');
  }
  function showSource() {
    const source = pack.sources.find(s => s.id === get('ns-source-select').value);
    get('ns-source-preview').textContent = source?.text || '尚未导入来源';
    get('ns-read-warnings').textContent = (source?.warnings || []).join('；');
  }
  function reviewPage() {
    return requirementReviewPage(pack, { sourceId: get('ns-filter-source').value, equipmentId: get('ns-filter-equipment').value,
      status: get('ns-filter-status').value, keyword: get('ns-filter-keyword').value, page, pageSize: Number(get('ns-page-size').value) });
  }
  function draftStatus() {
    get('ns-draft-status').textContent = drafts.size ? `${drafts.size}条未记录编辑仅在本次页面会话保留；切页可回来继续，自动保存/JSON/Excel不含这些输入，刷新或关闭会丢失。` : '当前无未记录条款编辑；切页/筛选不改变复核结论。';
    get('ns-discard-drafts').hidden = !drafts.size;
  }
  function renderRequirements() {
    clearTimeout(keywordTimer);
    const result = reviewPage(); page = result.page;
    get('ns-page-info').textContent = `筛选${result.total}条 · 第${result.totalPages ? page : 0}/${result.totalPages}页 · 显示${result.start}—${result.end}条（包内共${pack.requirements.length}条）`;
    get('ns-page-number').value = result.totalPages ? page : '';
    get('ns-page-number').max = Math.max(1, result.totalPages);
    get('ns-page-prev').disabled = !result.total || page <= 1;
    get('ns-page-next').disabled = !result.total || page >= result.totalPages;
    get('ns-page-go').disabled = !result.total;
    get('ns-requirement-list').innerHTML = result.items.length ? result.items.map((r, index) => {
      const values = [...new Set(r.candidates.map(c => c.value).filter(v => v != null))];
      const initial = r.confirmedValue ?? (values.length === 1 ? values[0] : '');
      return `<article class="ns-requirement" data-ns-id="${escape(r.id)}">
        <header><span data-ns-status>${statuses[r.reviewStatus]}</span><small>筛选序号${result.start + index} · ${escape(r.field === 'clause' ? '全文条款' : r.field)}</small><small data-ns-dirty hidden>未记录编辑</small></header>
        <div class="ns-evidence">${r.candidates.map(c => {
          const source = pack.sources.find(s => s.id === c.evidence.sourceId), segment = source?.segments.find(s => c.evidence.start >= s.start && c.evidence.end <= s.end);
          return `${segment?.contextTitle ? `<b>${escape(segment.contextTitle)}（${escape(segment.contextCell)}）</b>` : ''}<blockquote>${escape(c.evidence.quote)}</blockquote><small>${escape(presalesEvidenceLocation(pack, c.evidence))} · 候选：${escape(c.value ?? '未知')}</small>`;
        }).join('')}</div>
        <div class="platform-form-grid cols-3">
          <label>归属设备<select data-ns-equipment>${equipmentOptions(r.equipmentId)}</select></label>
          <label>字段<select data-ns-field>${fieldOptions(r.equipmentId, r.field)}</select></label>
          <div class="field-action"><button data-ns-action="map">分配/更新字段</button></div>
          <label>确认值<input data-ns-value value="${escape(initial)}" placeholder="未知请留空；按字段单位填写"></label>
          <label>禁止偏离<select data-ns-forbidden>${option('', '尚未核对', r.forbiddenDeviation == null ? '' : r.forbiddenDeviation)}${option('true', '是', r.forbiddenDeviation)}${option('false', '否', r.forbiddenDeviation)}</select></label>
          <label>人工应答<select data-ns-response>${Object.entries(responses).map(([key, label]) => option(key, label, r.response)).join('')}</select></label>
          <label class="ns-reason">复核/修改原因<input data-ns-reason value="${escape(r.decisionReason)}" placeholder="说明采用依据或澄清原因"></label>
        </div><div class="ns-actions"><button data-ns-action="confirm">确认本条要求</button><button data-ns-action="clear">清空确认值</button></div>
      </article>`;
    }).join('') : '<p class="ns-empty">暂无符合条件的条款。先导入资料并提取，或调整筛选。</p>';
    for (const row of get('ns-requirement-list').querySelectorAll('[data-ns-id]')) {
      const values = drafts.get(row.dataset.nsId); if (!values) continue;
      row.querySelector('[data-ns-field]').innerHTML = fieldOptions(values.equipment || null, values.field);
      for (const [key, value] of Object.entries(values)) row.querySelector(`[data-ns-${key}]`).value = value;
      row.querySelector('[data-ns-dirty]').hidden = false;
    }
    draftStatus();
  }
  function renderSummary() {
    const pending = pack.requirements.filter(isRequirementTodo);
    get('ns-summary').textContent = `版本${pack.revision} · ${pack.equipment.length}设备 · ${pack.requirements.length}条要求 · ${pending.length}条待处理`;
    get('ns-clarifications').innerHTML = !pack.requirements.length ? '<p>尚无技术要求，不能判定已复核或资料完整。</p>' : pending.length ? `<p>全包${pending.length}条待处理，仅显示前${Math.min(20, pending.length)}条摘要；请用上方按钮进入分页（保留资料/设备筛选）。</p><ul>${pending.slice(0, 20).map(r => `<li>${escape(pack.equipment.find(e => e.id === r.equipmentId)?.label || '待分配')}：${escape(r.candidates[0]?.evidence.quote || '人工补录')}（${statuses[r.reviewStatus]}）</li>`).join('')}</ul>` : '<p>当前登记条款均已人工复核，不代表资料完整或整份规范全部合规。</p>';
    get('ns-revisions').innerHTML = pack.revisions.length ? `<p>共${pack.revisions.length}条修订，仅显示最近${Math.min(20, pack.revisions.length)}条；完整记录在JSON/Excel中。</p>${pack.revisions.slice(-20).reverse().map(r => `<p data-ns-revision>v${r.revision} · ${escape(r.kind)} · ${escape(r.reason)}</p>`).join('')}` : '<p>暂无修订</p>';
  }
  function render() {
    const sourceId = get('ns-source-select').value, filterId = get('ns-filter-equipment').value, reviewId = get('ns-filter-source').value;
    get('ns-source-select').innerHTML = option('', '选择资料来源', '') + pack.sources.map(s => option(s.id, s.name, sourceId)).join('');
    if (!sourceId && pack.sources.length) get('ns-source-select').value = pack.sources.at(-1).id;
    get('ns-filter-source').innerHTML = option('', '全部资料', reviewId) + pack.sources.map(s => option(s.id, s.name, reviewId)).join('');
    get('ns-filter-equipment').innerHTML = option('', '全部设备', filterId) + option('unassigned', '待分配', filterId) + pack.equipment.map(e => option(e.id, e.label, filterId)).join('');
    get('ns-equipment-list').innerHTML = pack.equipment.map(e => `<div class="ns-equipment" data-ns-equipment-row="${escape(e.id)}"><b>${escape(e.label)}</b><span>${escape(PRODUCT_PROFILES[e.category].label)}</span><label>数量<input type="number" min="1" step="1" value="${escape(e.quantity ?? '')}" data-ns-quantity></label><input data-ns-quantity-reason aria-label="数量修改原因" placeholder="数量修改原因"><button data-ns-quantity-save>更新数量</button></div>`).join('') || '<p class="ns-empty">尚未登记设备；未知数量留空，不默认为1。</p>';
    showSource(); renderRequirements(); renderSummary(); schemeUI.render();
  }
  function commit(next, success, { clearDraftId, sourceId, targetId, reset = false } = {}) {
    if (reset) {
      drafts.clear(); page = 1; get('ns-source-select').value = ''; get('ns-filter-source').value = ''; get('ns-filter-equipment').value = ''; get('ns-filter-status').value = ''; get('ns-filter-keyword').value = '';
    }
    if (clearDraftId) drafts.clear(clearDraftId);
    pack = next; generation += 1;
    const dropped = drafts.sync(pack);
    if (sourceId) { get('ns-filter-source').value = sourceId; page = 1; }
    let targetOutside = false;
    if (targetId) {
      const result = reviewPage(), index = result.ids.indexOf(targetId);
      if (index >= 0) page = Math.floor(index / result.pageSize) + 1; else targetOutside = true;
    }
    render();
    if (persist()) message(success + (dropped.length ? `；${dropped.length}条编辑因证据/字段变化失效，请重新填写` : '') + (targetOutside ? '；该条款已移出当前筛选，调整筛选可查看' : ''));
  }
  const safe = fn => (...args) => { try { fn(...args); } catch (error) { message(error.message, true); } };
  get('ns-add-equipment').addEventListener('click', safe(() => commit(addEquipment(pack, { category: get('ns-category').value, label: get('ns-equipment-label').value, quantity: get('ns-equipment-quantity').value }, get('ns-equipment-reason').value), '设备项已登记（数量为空时保持未知）')));
  get('ns-equipment-list').addEventListener('click', safe(event => {
    if (!event.target.matches('[data-ns-quantity-save]')) return;
    const row = event.target.closest('[data-ns-equipment-row]');
    commit(updateEquipmentQuantity(pack, row.dataset.nsEquipmentRow, row.querySelector('[data-ns-quantity]').value, row.querySelector('[data-ns-quantity-reason]').value), '设备数量已更新，关联方案需重新复核');
  }));
  get('ns-add-source').addEventListener('click', safe(() => {
    const value = get('ns-source-text').value;
    if (value.length > 800000) throw new Error('文字过多，请拆分');
    const next = addPresalesSource(pack, { type: 'text', name: get('ns-source-name').value || '粘贴需求', text: value, segments: [{ start: 0, end: value.length }] }, '人工添加原文');
    // Refresh options before selecting the newly added source.
    commit(next, '资料已添加，请提取并分配条款'); get('ns-filter-source').value = next.sources.at(-1).id; page = 1; renderRequirements();
    get('ns-source-select').value = pack.sources.at(-1).id; showSource();
  }));
  get('ns-extract').addEventListener('click', safe(() => commit(extractPresalesSource(pack, get('ns-source-select').value), '已生成待复核条款；默认待分配，重复片段不重复追加', { sourceId: get('ns-source-select').value })));
  get('ns-replace-source').addEventListener('click', safe(() => {
    const id = get('ns-source-select').value, value = get('ns-source-text').value;
    if (!id) throw new Error('请先选择要替换的来源');
    if (!window.confirm('替换选中来源后，原条款证据与确认将失效。确定替换吗？')) return;
    commit(replacePresalesSource(pack, id, { type: 'text', name: get('ns-source-name').value || pack.sources.find(s => s.id === id).name, text: value, segments: [{ start: 0, end: value.length }] }, '人工替换资料原文'), '来源已替换；旧条款失效，请重新提取并复核', { sourceId: id });
  }));
  for (const id of ['ns-source-text', 'ns-source-name', 'ns-source-select']) get(id).addEventListener('input', () => { generation += 1; });
  get('ns-source-select').addEventListener('change', showSource);
  async function upload(file, restore = false) {
    if (!file || busy) return;
    busy = true; const ticket = ++generation; message('正在本机读取…');
    try {
      let result;
      if (restore) {
        if (file.size > 20 * 1024 * 1024) throw new Error('JSON不得超过20MB');
        result = restorePresalesSnapshot(JSON.parse(await file.text()));
      } else result = await readPresalesFile(file);
      if (ticket !== generation) throw new Error('读取期间工作稿或输入已变化，旧结果未应用，请重新导入');
      if (restore) {
        if (!window.confirm('恢复将替换当前非标需求工作稿，并重新复核确认状态。确定吗？')) { message('已取消恢复，当前工作稿保持不变'); return; }
        if (drafts.size && !window.confirm(`恢复将放弃${drafts.size}条未记录条款编辑。确定吗？`)) { message('已取消恢复，未记录条款编辑保持不变'); return; }
        if (!schemeUI.allowDiscard()) { message('已取消恢复，未保存方案编辑保持不变'); return; }
        schemeUI.reset();
        commit(result, '工作稿已恢复，确认状态回到待复核', { reset: true });
      } else {
        commit(addPresalesSource(pack, result, '本机只读导入需求文件'), '文件已导入需求来源，UPS产品目录未改变；请提取并人工分配');
        get('ns-filter-source').value = pack.sources.at(-1).id; page = 1; renderRequirements();
        get('ns-source-select').value = pack.sources.at(-1).id; showSource();
        get('ns-read-warnings').textContent = result.warnings.join('；');
      }
    } catch (error) { message(`${error.message}。当前工作稿未被本次导入覆盖。`, true); }
    finally { busy = false; }
  }
  get('ns-file').addEventListener('change', event => { if (busy) { generation += 1; message('上次读取尚未结束；其旧结果已取消，请稍后重新选择文件', true); } else upload(event.target.files[0]); event.target.value = ''; });
  get('ns-restore').addEventListener('change', event => { if (busy) { generation += 1; message('上次读取尚未结束，请稍后重新选择备份', true); } else upload(event.target.files[0], true); event.target.value = ''; });
  function invalidateRow(event) {
    const row = event.target.closest('[data-ns-id]'); if (!row) return;
    const requirement = pack.requirements.find(r => r.id === row.dataset.nsId); if (!requirement) return;
    generation += 1;
    if (requirement.reviewStatus === 'confirmed') {
      pack = invalidatePresalesRequirement(pack, requirement.id); row.querySelector('[data-ns-status]').textContent = statuses.pending;
      row.querySelector('[data-ns-response]').value = 'pending'; renderSummary(); schemeUI.render(); persist();
    }
    rememberRow(row);
  }
  function rememberRow(row) {
    const values = Object.fromEntries(['equipment', 'field', 'value', 'forbidden', 'response', 'reason'].map(key => [key, row.querySelector(`[data-ns-${key}]`).value]));
    drafts.remember(pack, row.dataset.nsId, values); row.querySelector('[data-ns-dirty]').hidden = false; draftStatus();
  }
  get('ns-requirement-list').addEventListener('input', safe(invalidateRow));
  get('ns-requirement-list').addEventListener('change', safe(event => {
    invalidateRow(event);
    const row = event.target.closest('[data-ns-id]'); if (!row) return;
    if (event.target.matches('[data-ns-equipment]')) {
      const equipment = pack.equipment.find(e => e.id === event.target.value), requirement = pack.requirements.find(r => r.id === row.dataset.nsId);
      const parsed = parsePresalesClause(equipment?.category, requirement.candidates[0]?.evidence.quote || '');
      row.querySelector('[data-ns-field]').innerHTML = fieldOptions(equipment?.id, parsed.field);
      row.querySelector('[data-ns-value]').value = parsed.value ?? '';
    }
    rememberRow(row);
  }));
  get('ns-requirement-list').addEventListener('click', safe(event => {
    const button = event.target.closest('[data-ns-action]'); if (!button) return;
    const row = button.closest('[data-ns-id]'), r = pack.requirements.find(item => item.id === row.dataset.nsId);
    const equipmentId = row.querySelector('[data-ns-equipment]').value || null, key = row.querySelector('[data-ns-field]').value;
    const reason = row.querySelector('[data-ns-reason]').value;
    if (button.dataset.nsAction === 'map') {
      const equipment = pack.equipment.find(e => e.id === equipmentId);
      const candidates = r.candidates.map(c => {
        const parsed = parsePresalesClause(equipment?.category, c.evidence.quote);
        return { evidence: c.evidence, value: key === 'clause' ? parsePresalesClause(null, c.evidence.quote).value : key === r.field ? c.value : parsed.field === key ? parsed.value : null };
      });
      const next = remapPresalesRequirement(pack, r.id, equipmentId, key, candidates, reason);
      commit(next, '条款归属/字段已更新，请复核确认值及禁止偏离标记', { clearDraftId: r.id, targetId: next.revisions.at(-1)?.detail?.to?.id });
    } else {
      if (equipmentId !== r.equipmentId || key !== r.field) throw new Error('归属或字段尚未保存，请先分配/更新字段');
      if (button.dataset.nsAction === 'clear') commit(revisePresalesRequirement(pack, r.id, null, reason), '确认值已清空，保持待澄清', { clearDraftId: r.id, targetId: r.id });
      else commit(confirmPresalesRequirement(pack, r.id, { value: row.querySelector('[data-ns-value]').value,
        forbiddenDeviation: row.querySelector('[data-ns-forbidden]').value === '' ? null : row.querySelector('[data-ns-forbidden]').value === 'true',
        response: row.querySelector('[data-ns-response]').value }, reason), '本条已人工复核，非完整合规结论', { clearDraftId: r.id, targetId: r.id });
    }
  }));
  function applyFilters() { page = 1; renderRequirements(); }
  for (const id of ['ns-filter-source', 'ns-filter-equipment', 'ns-filter-status', 'ns-page-size']) get(id).addEventListener('change', applyFilters);
  get('ns-filter-keyword').addEventListener('input', () => { clearTimeout(keywordTimer); keywordTimer = setTimeout(applyFilters, 250); });
  get('ns-filter-keyword').addEventListener('keydown', event => { if (event.key === 'Enter') applyFilters(); });
  get('ns-review-source').addEventListener('click', safe(() => { const id = get('ns-source-select').value; if (!id) throw new Error('请先选择资料来源'); get('ns-filter-source').value = id; applyFilters(); }));
  get('ns-review-todo').addEventListener('click', () => { get('ns-filter-status').value = 'todo'; get('ns-filter-keyword').value = ''; applyFilters(); get('ns-page-info').scrollIntoView({ block: 'center' }); });
  get('ns-page-prev').addEventListener('click', () => { page -= 1; renderRequirements(); });
  get('ns-page-next').addEventListener('click', () => { page += 1; renderRequirements(); });
  const goToPage = safe(() => { const target = Number(get('ns-page-number').value), count = reviewPage().totalPages; if (!Number.isSafeInteger(target) || target < 1 || target > count) throw new Error(`页码须为1—${count}的整数`); page = target; renderRequirements(); });
  get('ns-page-go').addEventListener('click', goToPage);
  get('ns-page-number').addEventListener('keydown', event => { if (event.key === 'Enter') goToPage(); });
  get('ns-discard-drafts').addEventListener('click', () => { if (!window.confirm(`放弃${drafts.size}条未记录编辑？已撤销的确认不会自动恢复。`)) return; drafts.clear(); renderRequirements(); message('已放弃本次条款编辑，已撤销的确认仍需重新复核'); });
  window.addEventListener('beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = ''; } });
  get('ns-autosave').addEventListener('change', event => {
    autosave = event.target.checked;
    if (autosave) { if (persist()) message('已启用仅本机自动保存；客户原文不会上传'); }
    else {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, enabled: false }));
        message('已关闭自动保存，已有本机缓存保留；后续修改请主动下载JSON备份');
      } catch { message('已停止本次页面自动保存，但保存偏好未更新，旧缓存仍保留；请检查浏览器存储权限', true); }
    }
  });
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); outputDraftWarning();
  }
  function outputDraftWarning() { if (drafts.size) message(`输出只含已记录数据，${drafts.size}条会话编辑未写入文件，请先逐条分配/确认后再导出最终工作稿`, true); }
  get('ns-backup').addEventListener('click', safe(() => download(JSON.stringify(createPresalesSnapshot(pack), null, 2), '非标方案工作稿.json', 'application/json')));
  get('ns-export').addEventListener('click', safe(() => {
    if (!pack.requirements.length) throw new Error('尚无条款，不能导出空提取结果');
    const rows = [['工作稿：待人工复核，不是完整合规结论', `版本${pack.revision}`], ['设备', '字段', '状态', '候选值', '确认值', '禁止偏离', '人工应答', '原文', '位置', '原因']];
    pack.requirements.forEach(r => r.candidates.forEach(c => rows.push([pack.equipment.find(e => e.id === r.equipmentId)?.label || '待分配', r.field, statuses[r.reviewStatus], c.value ?? '未知', r.confirmedValue ?? '未知', r.forbiddenDeviation == null ? '未核对' : r.forbiddenDeviation ? '是' : '否', responses[r.response], c.evidence.quote, presalesEvidenceLocation(pack, c.evidence), r.decisionReason])));
    download(writePresalesXlsx([{ name: '技术要求工作稿', rows }, { name: '修订记录', rows: [['版本', '操作', '原因', '时间'], ...pack.revisions.map(r => [r.revision, r.kind, r.reason, r.at])] }]), '非标技术要求工作稿.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }));
  const schemeUI = mountNonstandardSchemes(root, { pack: () => pack, commit, message, download,
    touch: () => { generation += 1; }, buswayDesign: options.buswayDesign });
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored?.snapshot) { pack = restorePresalesSnapshot(stored.snapshot); autosave = !!stored.enabled; get('ns-autosave').checked = autosave; message(`已恢复本机工作稿，原确认回到待复核；自动保存${autosave ? '已开启' : '已关闭'}`); }
  } catch { message('本机工作稿无法验证，未覆盖或删除旧缓存；可用JSON备份恢复', true); }
  render();
  return { snapshot: () => createPresalesSnapshot(pack) };
}
