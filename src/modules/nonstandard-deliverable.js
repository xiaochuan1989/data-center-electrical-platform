import { PRODUCT_PROFILES, COMPONENT_ROLES, buildPresalesDeliverable } from './nonstandard-presales.js';
import { presalesEvidenceLocation } from './nonstandard-requirements.js';

export const presalesEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const deliverableStatus = value => value === 'reviewed-presales' ? '人工已复核售前配置（非工程合规结论）' : '讨论稿／待复核';
const unknown = value => value == null || value === '' ? '待确认' : value;
const reviewLabels = { pending: '待复核', confirmed: '人工已确认', stale: '来源失效', conflict: '候选冲突', unknown: '未知' };
const responseLabels = { pending: '待应答', met: '人工复核：满足', deviation: '人工复核：偏离', 'not-applicable': '人工复核：不适用' };
export function presalesOutputTables(output) {
  const profile = PRODUCT_PROFILES[output.equipment.category];
  const header = [['售前方案工作稿', output.title], ['状态', deliverableStatus(output.status)],
    ['方案来源', ({ 'busway-assistant':'智能母线条款＋人工区域供货表（未自动确认采用）', 'pdu-assistant': 'PDU原文条款候选（未自动确认采用）', 'cabinet-assistant': '配电柜结构骨架＋人工回路表（非厂家选型）', 'busway-calculator': '既有母线工具只读桥接', manual: '人工编辑' })[output.origin] || '人工编辑'],
    ['设备', output.equipment.label], ['品类', profile.label], ['设备套数', unknown(output.equipment.quantity)],
    ['数据包ID', output.packageId], ['方案ID', output.schemeId], ['包修订号', output.packageRevision], ['边界', output.boundary]];
  const config = [['配置字段', '采用值', '单位'], ...Object.entries(profile.fields).map(([key, definition]) => [definition.label, unknown(output.config[key]), definition.unit])];
  const bom = [['组件ID', '用途', '名称', '功能规格', '每套数量', '设备套数', '总数量', '单位', '品牌', '型号', '编码', '型号状态', '核对依据', '关联要求ID', '风险', '方案ID', '包修订号'],
    ...output.bom.map(c => [c.id, COMPONENT_ROLES[output.equipment.category][c.role || 'other'], c.name, unknown(c.specification),
      unknown(c.perEquipmentQuantity), unknown(c.equipmentQuantity), unknown(c.totalQuantity), unknown(c.unit), c.brand,
      c.model, c.code, c.modelStatus === 'verified' ? '人工已核对型号' : '型号待核对', c.reference, c.requirementIds.join('、'), c.risk, c.schemeId, c.packageRevision])];
  const requirements = [['要求ID', '字段', '复核状态', '确认要求值', '禁止偏离', '人工应答', '原文', '来源位置', '复核原因'],
    ...output.requirements.flatMap(r => (r.candidates.length ? r.candidates : [{ evidence: null }]).map(c => [r.id, profile.fields[r.field]?.label || '全文条款', reviewLabels[r.reviewStatus],
      unknown(r.confirmedValue), r.forbiddenDeviation == null ? '未核对' : r.forbiddenDeviation ? '是' : '否', responseLabels[r.response],
      c.evidence?.quote || '', c.evidence ? presalesEvidenceLocation(output, c.evidence) : '无原文证据', r.decisionReason]))];
  const notes = [['类型', '内容'], ...(output.description || []).map(p => ['方案说明', p]), ...output.clarifications.map(p => ['待澄清/阻断', p]), ...output.assumptions.map(p => ['设计假设', p]), ...output.exclusions.map(p => ['排除项', p]),
    ...output.sources.flatMap(s => (s.warnings || []).map(p => ['来源读取告警', `${s.name}：${p}`]))];
  const revisions = [['版本', '操作', '对象ID', '原因', '时间'], ...output.revisions.map(r => [r.revision, r.kind, r.targetId, r.reason, r.at])];
  return { header, config, bom, requirements, notes, revisions };
}
export function buildPresalesOutput(input, id) {
  const output = buildPresalesDeliverable(input, id);
  return { output, tables: presalesOutputTables(output) };
}
export function presalesTableHtml(rows) {
  return `<div class="ns-table-wrap"><table><thead><tr>${rows[0].map(value => `<th>${presalesEscape(value)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map(value => `<td>${presalesEscape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function presalesReportHtml({ output, tables }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${presalesEscape(output.title)} — 售前方案工作稿</title>
    <style>body{font:14px/1.7 system-ui,sans-serif;color:#25374b;max-width:1400px;margin:30px auto;padding:0 20px}h1{font-size:26px}h2{font-size:19px;margin-top:30px}.boundary{padding:16px;background:#fff4dc;border-left:4px solid #cc8400}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d5dfe9;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#edf4fb}.ns-table-wrap{overflow:auto}dl{display:grid;grid-template-columns:140px 1fr}dt,dd{margin:0;padding:6px;border-bottom:1px solid #e5ebf2}@media print{body{margin:0;max-width:none;padding:0;font-size:11px}.ns-table-wrap{overflow:visible}table{font-size:8px}thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}@page{size:A4 landscape;margin:12mm}}</style></head><body>
    <h1>${presalesEscape(output.title)}</h1><p class="boundary">${presalesEscape(deliverableStatus(output.status))} · v${output.packageRevision}<br>${presalesEscape(output.boundary)}<br>短路、温升、保护配合、结构和施工设计尚需专项核对；不能用于生产或自动投标承诺。</p>
    <dl>${tables.header.map(([key, value]) => `<dt>${presalesEscape(key)}</dt><dd>${presalesEscape(value)}</dd>`).join('')}</dl>
    ${output.description?.length ? `<h2>当前采用方案说明</h2>${output.description.map(p => `<p>${presalesEscape(p)}</p>`).join('')}` : ''}
    <h2>采用配置（未知项不补造）</h2>${presalesTableHtml(tables.config)}<h2>同版本配置清单</h2>${presalesTableHtml(tables.bom)}
    <h2>技术要求与人工应答</h2>${presalesTableHtml(tables.requirements)}<h2>澄清、假设及排除项</h2>${presalesTableHtml(tables.notes)}
    <h2>修订记录</h2>${presalesTableHtml(tables.revisions)}<p>${presalesEscape(output.boundary)}</p></body></html>`;
}
