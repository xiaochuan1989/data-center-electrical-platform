import { PRODUCT_PROFILES, COMPONENT_ROLES, adoptPresalesScheme, confirmPresalesScheme,
  invalidatePresalesScheme, adoptBuswayPresalesScheme } from '../modules/nonstandard-presales.js';
import { buildPresalesOutput, deliverableStatus, presalesEscape as esc, presalesReportHtml, presalesTableHtml } from '../modules/nonstandard-deliverable.js';
import { writePresalesXlsx } from '../modules/presales-xlsx.js';
import { createCabinetProposal, parseCabinetCircuitTable } from '../modules/cabinet-assistant.js';
import { CABINET_TEMPLATES } from '../modules/cabinet-rules.js';
import { createPduProposal } from '../modules/pdu-assistant.js';
import { createBuswayRegionProposal } from '../modules/busway-assistant.js';
import { parseBuswayRegionTable } from '../modules/busway-rules.js';

const option = (value, label, current) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`;
const lines = value => String(value || '').split(/\r?\n/).map(v => v.trim()).filter(Boolean);
const enumLabels = { single: '单相', three: '三相', dc: '直流', rack: '机架PDU', cabinet: '柜式配电单元', A: 'A路', B: 'B路', AB: 'A/B路' };
export function nonstandardSchemeSection() {
  return `<section class="ns-section" id="ns-scheme-section"><h2>5. 采用方案与配置清单</h2>
    <p class="ns-muted">先选择设备、编辑配置与逐项清单，再保存采用方案。未知不填默认值；数量一致性不替代短路、温升、保护配合校核。未保存的编辑不进入JSON备份，也不能确认/导出方案。</p>
    <div class="ns-toolbar"><label>方案设备<select id="ns-scheme-equipment"></select></label><label>已存方案<select id="ns-scheme-select"></select></label><button id="ns-scheme-reload">重新载入已存方案</button></div>
    <p id="ns-scheme-state" role="status"></p><div id="ns-scheme-editor"></div>
    <div class="ns-actions"><button id="ns-scheme-save" class="platform-primary-action">保存采用方案</button><button id="ns-scheme-confirm">人工确认售前配置</button><button id="ns-scheme-excel">导出配置清单Excel</button><button id="ns-scheme-html">下载可打印方案说明HTML</button></div>
    <div id="ns-scheme-preview"></div></section>`;
}

export function mountNonstandardSchemes(root, api) {
  const get = id => root.querySelector(`#${id}`);
  let equipmentId = '', schemeId = '', draft = null, dirty = false;
  let cabinetInput = { template: '', table: '' };
  let pduInput = { ids: [] };
  let buswayInput = { ids: [], table: '', quantityBasis: '', basisNote: '' };
  let helperDirty = false;
  const equipment = () => api.pack().equipment.find(e => e.id === equipmentId);
  const selected = () => api.pack().schemes.find(s => s.id === schemeId);
  const safe = fn => (...args) => { try { fn(...args); } catch (error) { api.message(error.message, true); } };
  function allowDiscard() { return !(dirty || helperDirty) || window.confirm('当前方案或辅助生成输入有未保存编辑，切换/恢复会放弃这些编辑。确定继续吗？'); }
  function readDraft() {
    if (!draft) return;
    draft.name = get('ns-scheme-name').value;
    draft.config = Object.fromEntries([...get('ns-scheme-editor').querySelectorAll('[data-ns-config]')].map(el => [el.dataset.nsConfig, el.value]));
    draft.assumptions = lines(get('ns-scheme-assumptions').value); draft.exclusions = lines(get('ns-scheme-exclusions').value);
    draft.requirementIds = [...get('ns-scheme-editor').querySelectorAll('[data-ns-scheme-requirement]:checked')].map(el => el.value);
    draft.components = [...get('ns-scheme-components').querySelectorAll('[data-ns-component]')].map(row => {
      const item = Object.fromEntries([...row.querySelectorAll('[data-ns-component-field]')].map(el => [el.dataset.nsComponentField, el.value]));
      if (row.dataset.nsComponent) item.id = row.dataset.nsComponent;
      item.requirementIds = [...row.querySelectorAll('[data-ns-component-link]:checked')].map(el => el.value); return item;
    });
    draft.reason = get('ns-scheme-reason').value;
  }
  function markDirty() {
    if (!draft) return;
    dirty = true; api.touch();
    const scheme = selected();
    if (scheme?.reviewStatus === 'confirmed') api.commit(invalidatePresalesScheme(api.pack(), scheme.id), '方案输入已修改，原确认失效；请保存编辑后复核');
    status();
  }
  function load() {
    const stored = selected();
    draft = equipment() ? stored ? structuredClone(stored) : { equipmentId, name: '', config: {}, components: [], requirementIds: [], assumptions: [], exclusions: [], origin: 'manual' } : null;
    if (draft) draft.reason = '';
    cabinetInput = { template: '', table: '' };
    pduInput = { ids: [] };
    buswayInput = { ids: [], table: '', quantityBasis: '', basisNote: '' };
    helperDirty = false;
    dirty = false; renderEditor(); status(); preview();
  }
  function links(current, attr) {
    return api.pack().requirements.filter(r => r.equipmentId === equipmentId).map(r => `<label class="ns-check"><input type="checkbox" ${attr} value="${esc(r.id)}"${current.includes(r.id) ? ' checked' : ''}>${esc(PRODUCT_PROFILES[equipment().category].fields[r.field]?.label || '全文条款')} · ${esc(r.confirmedValue ?? r.candidates[0]?.evidence.quote ?? '未知')} · ${r.reviewStatus === 'confirmed' ? '人工已确认' : '待复核'}</label>`).join('') || '<p class="ns-muted">本设备尚无关联要求；无要求不能确认方案。</p>';
  }
  function renderEditor() {
    if (!draft) { get('ns-scheme-editor').innerHTML = '<p>请先登记并选择设备。</p>'; return; }
    const profile = PRODUCT_PROFILES[equipment().category];
    get('ns-scheme-editor').innerHTML = `<div class="platform-form-grid cols-3"><label>方案名称<input id="ns-scheme-name" value="${esc(draft.name)}"></label>
      <label class="ns-reason">保存/确认原因<input id="ns-scheme-reason" value="${esc(draft.reason)}" placeholder="采用依据、修改或人工复核原因"></label></div>
      <div class="ns-actions"><button id="ns-scheme-from-requirements">带入本设备已确认标量要求</button>${equipment().category === 'busway' ? '<button id="ns-scheme-from-busway">带入当前已生成的母线布局</button>' : ''}</div>
      ${equipment().category === 'cabinet' ? `<details id="ns-cabinet-assistant"><summary>配电柜辅助生成（骨架＋人工回路表）</summary>
        <p class="ns-muted">生成新的未保存草稿，不覆盖已存方案；不是厂家典型图、自动选型或原文逐行提取。未知不补默认值，型号全部待核对。沿用下方明确采用输入，并带入已确认且应答满足的要求；数量错配会阻断。</p>
        <label>结构骨架<select id="ns-cabinet-template">${option('', '请选择，不自动推断', cabinetInput.template)}${Object.entries(CABINET_TEMPLATES).map(([key, label]) => option(key, label, cabinetInput.template)).join('')}</select></label>
        <label>回路表（从Excel复制四列；数量是每设备数量）<textarea id="ns-cabinet-circuits" rows="5" placeholder="用途&#9;名称&#9;功能规格&#9;每套数量">${esc(cabinetInput.table)}</textarea></label>
        <p class="ns-muted">用途填写进线、母联或出线；多规格分多行。可留空规格/数量，但不能据此确认方案。支持制表符或竖线分列，不混用。备用不自动追加，柜体、母线和附件须另行补齐。</p>
        <button id="ns-cabinet-generate">生成新的配电柜方案草稿</button></details>` : ''}
      ${equipment().category === 'pdu' ? `<details id="ns-pdu-assistant"><summary>PDU条款辅助生成（候选配置＋功能清单）</summary>
        <p class="ns-muted">先在下方明确选择机架PDU类型，再显式勾选本设备条款。选取不等于已确认满足；生成新未保存草稿，不覆盖已存方案。复合输入、多规格插座可作候选，保护/输入接口数量和型号不自动补齐。</p>
        <div class="ns-link-list">${api.pack().requirements.filter(r => r.equipmentId === equipmentId && r.reviewStatus !== 'stale').map(r => `<label class="ns-check"><input type="checkbox" data-ns-pdu-source value="${esc(r.id)}"${pduInput.ids.includes(r.id) ? ' checked' : ''}>${esc(r.candidates.map(c => c.evidence.quote).join('；'))} · ${r.reviewStatus === 'confirmed' ? '人工已确认' : '未确认候选'}</label>`).join('') || '<p>尚无本设备条款，请先导入原文、提取并分配到本PDU设备。</p>'}</div>
        <p class="ns-muted">设备项数量为本区域PDU供货总量；插座数量按每条PDU计算，不再乘每柜PDU数量。暂定/设计联络限定语保留，多值与不完整列表不取最大或补默认。</p>
        <button id="ns-pdu-generate">生成新的PDU询价草稿</button></details>` : ''}
      ${equipment().category === 'busway' ? `<details id="ns-busway-assistant"><summary>智能母线询价辅助生成（原文＋区域供货表）</summary>
        <p class="ns-muted">先明确数量口径及依据，再选择本设备条款。区域米数/箱数不再乘机柜、通道、A/B或PDU数；设备数量必须明确为1个区域包。生成新未保存草稿，不覆盖旧方案，不自动选型或确认要求。</p>
        <label>数量口径<select id="ns-busway-basis">${option('', '请选择，不自动推断', buswayInput.quantityBasis)}${option('region', '本区域整套清单（设备数量明确为1）', buswayInput.quantityBasis)}</select></label>
        <label>区域数量归属依据<input id="ns-busway-basis-note" value="${esc(buswayInput.basisNote)}" placeholder="附表区域、人工归属及待核对说明"></label>
        <div class="ns-link-list">${api.pack().requirements.filter(r=>r.equipmentId===equipmentId && r.reviewStatus!=='stale').map(r=>`<label class="ns-check"><input type="checkbox" data-ns-busway-source value="${esc(r.id)}"${buswayInput.ids.includes(r.id)?' checked':''}>${esc(r.candidates.map(c=>c.evidence.quote).join('；'))} · ${r.reviewStatus==='confirmed'?'人工已确认':'未确认候选'}</label>`).join('') || '<p>尚无本设备条款，请先导入、提取并分配到本区域母线设备。</p>'}</div>
        <label>区域供货表（从Excel复制五列）<textarea id="ns-busway-table" rows="6" placeholder="用途&#9;名称&#9;功能规格&#9;区域数量&#9;单位">${esc(buswayInput.table)}</textarea></label>
        <p class="ns-muted">用途：母线槽、主控箱、端口箱、始端箱、插接箱（或插线箱）、附件。母线用m/米，箱体用套/台/个/只；规格或数量可留空。主控、端口、始端分别登记；同一物理箱勿重复。附件数量/保护回路/厂家型号不补造。</p>
        <button id="ns-busway-generate">生成新的区域母线询价草稿</button></details>` : ''}
      <details class="ns-config-details" open><summary>采用配置（按本品类字段）</summary><div class="platform-form-grid cols-3">${Object.entries(profile.fields).map(([key, def]) => {
        const value = draft.config[key] ?? '';
        const input = def.type === 'enum' ? `<select data-ns-config="${key}">${option('', '未知/待确认', value)}${def.options.map(v => option(v, enumLabels[v] || v, value)).join('')}</select>` : `<input data-ns-config="${key}" ${['positive', 'count'].includes(def.type) ? `type="number" min="${def.type === 'count' ? '0' : '0.000000001'}" step="${def.type === 'count' ? '1' : 'any'}"` : ''} value="${esc(value)}" placeholder="未知留空">`;
        return `<label>${esc(def.label)}${def.unit ? `（${esc(def.unit)}）` : ''}${input}</label>`;
      }).join('')}</div></details>
      <div class="ns-columns"><label>设计假设（每行一项）<textarea id="ns-scheme-assumptions" rows="3">${esc(draft.assumptions.join('\n'))}</textarea></label><label>排除项（每行一项）<textarea id="ns-scheme-exclusions" rows="3">${esc(draft.exclusions.join('\n'))}</textarea></label></div>
      <details><summary>方案关联要求（仅本设备）</summary><div class="ns-link-list">${links(draft.requirementIds, 'data-ns-scheme-requirement')}</div></details>
      <h3>逐项配置清单（每套数量）</h3><p class="ns-muted">同用途可分多个规格。PDU输出接口与保护分路分开登记；一行不得代表未拆分的多种型号。按已填数量字段核对明细，不从功能描述推算数量。</p>
      <div id="ns-scheme-components"></div><button id="ns-scheme-add-component">添加配置项</button>`;
    renderComponents();
  }
  function renderComponents() {
    get('ns-scheme-components').innerHTML = draft.components.map((c, index) => `<article class="ns-component" data-ns-component="${esc(c.id || '')}"><header><b>配置项 ${index + 1}</b><button data-ns-remove-component="${index}">移除此项</button></header>
      <div class="platform-form-grid cols-3"><label>组件用途<select data-ns-component-field="role">${Object.entries(COMPONENT_ROLES[equipment().category]).map(([key, value]) => option(key, value, c.role || 'other')).join('')}</select></label>
      ${[['name', '组件名称'], ['specification', '功能规格'], ['quantity', '每套数量'], ['unit', '清单单位'], ['brand', '组件品牌'], ['model', '组件型号'], ['code', '组件编码']].map(([key, label]) => `<label>${label}<input data-ns-component-field="${key}"${key === 'quantity' ? ' type="number" min="0.000000001" step="any"' : ''} value="${esc(c[key] ?? '')}" placeholder="未知留空"></label>`).join('')}
      <label>型号核对状态<select data-ns-component-field="modelStatus">${option('pending', '型号待核对', c.modelStatus || 'pending')}${option('verified', '人工已核对型号', c.modelStatus)}</select></label>
      <label class="ns-reason">型号/选型核对依据<input data-ns-component-field="reference" value="${esc(c.reference || '')}"></label><label class="ns-reason">组件风险/待澄清<input data-ns-component-field="risk" value="${esc(c.risk || '')}"></label></div>
      <details><summary>组件关联要求</summary><div class="ns-link-list">${links(c.requirementIds || [], 'data-ns-component-link')}</div></details></article>`).join('') || '<p>尚无配置项；可先保存讨论稿，但空清单不能导出或确认。</p>';
  }
  function status() {
    get('ns-scheme-state').textContent = helperDirty ? '辅助生成有尚未生成的输入；请先生成新草稿，或重新载入并明确放弃输入后再保存/确认/导出。' : dirty ? '有未保存编辑；当前预览仅显示已保存版本，不能确认/导出方案。' : selected() ? `当前已存方案：${selected().reviewStatus === 'confirmed' ? '人工已复核售前配置' : '讨论稿/待复核'} · 包版本${api.pack().revision}` : '新方案，尚未保存。';
  }
  function preview() {
    if (!selected()) { get('ns-scheme-preview').innerHTML = ''; return; }
    const data = buildPresalesOutput(api.pack(), schemeId);
    get('ns-scheme-preview').innerHTML = `<h3>已存方案预览 · ${esc(deliverableStatus(data.output.status))} · v${data.output.packageRevision}</h3><p>${esc(data.output.boundary)}</p>
      ${data.output.description?.length ? `<details open><summary>当前采用方案说明</summary>${data.output.description.map(p => `<p>${esc(p)}</p>`).join('')}</details>` : ''}
      <div class="ns-scheme-problems">${data.output.clarifications.length ? `<ul>${data.output.clarifications.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p>当前登记要求及配置已满足本模块复核条件，仍非完整工程合规结论。</p>'}</div>
      ${presalesTableHtml(data.tables.bom)}<details><summary>采用配置及要求依据</summary>${presalesTableHtml(data.tables.config)}${presalesTableHtml(data.tables.requirements)}</details>`;
  }
  function render() {
    const pack = api.pack();
    if (!pack.equipment.some(e => e.id === equipmentId)) { equipmentId = pack.equipment[0]?.id || ''; schemeId = ''; dirty = false; draft = null; }
    if (schemeId && !pack.schemes.some(s => s.id === schemeId)) { schemeId = ''; dirty = false; draft = null; }
    get('ns-scheme-equipment').innerHTML = option('', '选择已登记设备', equipmentId) + pack.equipment.map(e => option(e.id, `${PRODUCT_PROFILES[e.category].label} · ${e.label}`, equipmentId)).join('');
    get('ns-scheme-select').innerHTML = option('', '新建方案（不覆盖已存方案）', schemeId) + pack.schemes.filter(s => s.equipmentId === equipmentId).map(s => option(s.id, s.name, schemeId)).join('');
    if (!dirty && !helperDirty) load(); else { status(); preview(); }
  }
  for (const [id, isEquipment] of [['ns-scheme-equipment', true], ['ns-scheme-select', false]]) get(id).addEventListener('change', safe(event => {
    const value = event.target.value;
    if (!allowDiscard()) { event.target.value = isEquipment ? equipmentId : schemeId; return; }
    if (isEquipment) { equipmentId = value; schemeId = ''; } else schemeId = value;
    dirty = false; render(); api.touch();
  }));
  get('ns-scheme-reload').addEventListener('click', safe(() => { if (allowDiscard()) { load(); api.touch(); } }));
  function editorChange(event) {
    if (event.target.hasAttribute('data-ns-busway-source') || ['ns-busway-basis','ns-busway-basis-note','ns-busway-table'].includes(event.target.id)) {
      buswayInput = { ids:[...get('ns-scheme-editor').querySelectorAll('[data-ns-busway-source]:checked')].map(el=>el.value),
        quantityBasis:get('ns-busway-basis').value,basisNote:get('ns-busway-basis-note').value,table:get('ns-busway-table').value };
      helperDirty=true; api.touch(); status(); return;
    }
    if (event.target.hasAttribute('data-ns-pdu-source')) {
      pduInput.ids = [...get('ns-scheme-editor').querySelectorAll('[data-ns-pdu-source]:checked')].map(el=>el.value);
      helperDirty = true; api.touch(); status(); return;
    }
    if (event.target.id === 'ns-cabinet-template' || event.target.id === 'ns-cabinet-circuits') {
      cabinetInput = { template: get('ns-cabinet-template').value, table: get('ns-cabinet-circuits').value };
      helperDirty = true; api.touch(); status(); return;
    }
    readDraft();
    if (event.target.id === 'ns-scheme-reason') api.touch(); else markDirty();
  }
  get('ns-scheme-editor').addEventListener('input', safe(editorChange));
  get('ns-scheme-editor').addEventListener('change', safe(editorChange));
  get('ns-scheme-editor').addEventListener('click', safe(event => {
    const button = event.target.closest('button'); if (!button || !draft) return;
    if (button.id === 'ns-cabinet-generate') {
      readDraft();
      const proposal = createCabinetProposal(api.pack(), equipmentId, { template: get('ns-cabinet-template').value,
        circuits: parseCabinetCircuitTable(get('ns-cabinet-circuits').value), config: draft.config, name: draft.name });
      if ((dirty || selected()) && !window.confirm('载入新的辅助草稿将替换当前编辑区（包括假设/排除项），不会覆盖已存方案。确定继续吗？')) return;
      const reason = draft.reason;
      schemeId = ''; draft = { ...proposal, reason }; dirty = true; helperDirty = false; api.touch(); renderEditor(); render();
      api.message('新的配电柜辅助草稿已载入，尚未保存；型号、供货完整性和工程校核均待复核。已存方案未覆盖');
    }
    if (button.id === 'ns-pdu-generate') {
      readDraft();
      const proposal = createPduProposal(api.pack(),equipmentId,{ requirementIds:pduInput.ids,config:draft.config,name:draft.name });
      if ((dirty || selected()) && !window.confirm('载入新的PDU草稿将替换当前编辑区（包括假设/排除项），不会覆盖已存方案。确定继续吗？')) return;
      const reason = draft.reason;
      schemeId = ''; draft = { ...proposal,reason }; dirty = true; helperDirty = false; api.touch(); renderEditor(); render();
      api.message('新的PDU候选草稿已载入，尚未保存；要求、型号、保护及供货完整性均待复核。已存方案未覆盖');
    }
    if (button.id === 'ns-busway-generate') {
      readDraft();
      const proposal=createBuswayRegionProposal(api.pack(),equipmentId,{ requirementIds:buswayInput.ids,quantityBasis:buswayInput.quantityBasis,
        basisNote:buswayInput.basisNote,rows:parseBuswayRegionTable(buswayInput.table),config:draft.config,name:draft.name });
      if ((dirty || selected()) && !window.confirm('载入新的区域母线草稿将替换当前编辑区（包括假设/排除项），不会覆盖已存方案。确定继续吗？')) return;
      const reason=draft.reason;
      schemeId=''; draft={...proposal,reason}; dirty=true; helperDirty=false; api.touch(); renderEditor(); render();
      api.message('新的区域母线讨论稿已载入，尚未保存；数量归属、接口、保护、型号及附件完整性均待复核。已存方案未覆盖');
    }
    if (button.id === 'ns-scheme-add-component') { readDraft(); draft.components.push({ name: '', specification: '', quantity: null, unit: '', modelStatus: 'pending', role: 'other', requirementIds: [] }); markDirty(); renderComponents(); }
    if (button.hasAttribute('data-ns-remove-component')) { readDraft(); draft.components.splice(Number(button.dataset.nsRemoveComponent), 1); markDirty(); renderComponents(); }
    if (button.id === 'ns-scheme-from-requirements') {
      readDraft();
      for (const r of api.pack().requirements.filter(r => r.equipmentId === equipmentId && r.field !== 'clause' && r.reviewStatus === 'confirmed' && r.response === 'met')) draft.config[r.field] = r.confirmedValue;
      markDirty(); renderEditor(); api.message('仅带入本设备人工确认且应答满足的标量要求；请编辑并保存采用方案，不代表自动满足');
    }
    if (button.id === 'ns-scheme-from-busway') {
      readDraft();
      if (!draft.reason.trim()) throw new Error('请填写带入母线布局的原因');
      if (!allowDiscard()) return;
      const raw = api.buswayDesign?.(); if (!raw) throw new Error('尚无已生成母线布局，请先在智能母线工具生成并核对');
      const next = adoptBuswayPresalesScheme(api.pack(), equipmentId, raw, draft.reason);
      schemeId = next.schemes.at(-1).id; dirty = false;
      api.commit(next, '母线已生成布局只读带入为新方案；重新计算保留阻断，型号仍待核对，原工具未修改');
    }
  }));
  get('ns-scheme-save').addEventListener('click', safe(() => {
    if (helperDirty) throw new Error(`${helperLabel()}尚未生成，请先生成新草稿或重新载入并明确放弃辅助输入`);
    if (!draft) throw new Error('请先登记并选择方案设备'); readDraft();
    const next = adoptPresalesScheme(api.pack(), { ...draft, ...(schemeId ? { id: schemeId } : {}) }, draft.reason);
    schemeId = schemeId || next.schemes.at(-1).id; dirty = false;
    api.commit(next, '采用方案已保存，清单与说明使用同一配置；仍需人工复核');
  }));
  function helperLabel() { return equipment()?.category === 'pdu' ? 'PDU辅助条款选择' : equipment()?.category === 'busway' ? '母线辅助条款/区域表' : '辅助回路表'; }
  function output() {
    if (helperDirty) throw new Error(`${helperLabel()}尚未生成，请先生成新草稿或重新载入并明确放弃辅助输入`);
    if (dirty) throw new Error('方案有未保存编辑，请先保存采用方案，避免导出旧清单');
    if (!selected()) throw new Error('请先保存并选择采用方案');
    const result = buildPresalesOutput(api.pack(), schemeId);
    if (!result.output.bom.length) throw new Error('配置清单为空，不能导出空方案结果');
    return result;
  }
  get('ns-scheme-confirm').addEventListener('click', safe(() => {
    output();
    const reason = get('ns-scheme-reason').value;
    api.commit(confirmPresalesScheme(api.pack(), schemeId, reason), '人工已复核售前配置，非生产图纸或完整合规结论');
  }));
  get('ns-scheme-excel').addEventListener('click', safe(() => {
    const data = output();
    const sheets = [['header', '方案概览'], ['bom', '配置清单'], ['config', '采用配置'], ['requirements', '技术要求与应答'], ['notes', '澄清与边界'], ['revisions', '修订记录']].map(([key, name]) => ({ name, rows: data.tables[key] }));
    api.download(writePresalesXlsx(sheets), `非标售前配置清单-v${data.output.packageRevision}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }));
  get('ns-scheme-html').addEventListener('click', safe(() => {
    const data = output(); api.download(presalesReportHtml(data), `非标售前方案说明-v${data.output.packageRevision}.html`, 'text/html;charset=utf-8');
  }));
  return { render, allowDiscard, reset: () => { equipmentId = ''; schemeId = ''; draft = null; dirty = false; helperDirty = false; cabinetInput = { template: '', table: '' }; pduInput = { ids: [] }; buswayInput = { ids: [], table: '', quantityBasis: '', basisNote: '' }; } };
}
