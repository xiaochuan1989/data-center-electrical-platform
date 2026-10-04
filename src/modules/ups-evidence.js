// 需求证据与修订的纯逻辑；不参与型号合格性判定。
export const EVIDENCE_VERSION = 1;
export const FIELD_LABELS = Object.freeze({ capacityKva: '额定容量下限', loadKw: '负荷功率', loadKva: '负荷容量',
  outputPowerFactor: '输出功率因数下限', inputOutputPhase: '输入/输出制式', parallelUnits: '并机台数',
  redundancy: '冗余架构', backupMinutes: '后备时间目标', batteryCells: '电池节数', batteryType: '电池类型',
  installation: '安装方式', needsSnmp: 'SNMP' });
const numericFields = new Set(['capacityKva', 'loadKw', 'loadKva', 'outputPowerFactor', 'parallelUnits', 'backupMinutes', 'batteryCells']);
export const scalarValue = (field, value) => {
  if (field === 'needsSnmp') return value === true || value === 'true';
  if (value == null || value === '') return null;
  if (numericFields.has(field)) return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  return String(value);
};
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createEvidenceSource(type, name, segments = [], importedAt = new Date().toISOString()) {
  return { id: uid(), type, name: String(name || '客户需求').split(/[\\/]/).pop(), importedAt,
    segments: segments.map(segment => ({ start: segment.start, end: segment.end, page: segment.page ?? null })) };
}

const rules = {
  capacityKva: [/(?:UPS|单机|额定|设备)\s*(?:额定\s*)?(?:容量|功率)\s*(?:不低于|不少于|至少|≥|>=)?\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*kVA/gi, Number],
  loadKw: [/(?:IT\s*负荷|有功负荷|负载功率|负荷功率|负载|负荷)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*kW\b/gi, Number],
  loadKva: [/(?:视在负荷|负载容量|负荷容量)\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*kVA/gi, Number],
  backupMinutes: [/(?:后备时间|备用时间|续航时间)\s*(?:不少于|不低于|至少|≥|>=)?\s*[:：=]?\s*(\d+(?:\.\d+)?)\s*(?:分钟|min)/gi, Number],
  parallelUnits: [/(?:并机(?:数量|台数)?|并联(?:数量|台数)?)\s*[:：=]?\s*(\d+)\s*台?/gi, Number],
  batteryCells: [/(?:每组|单组)?\s*电池\s*(?:节数|数量)\s*[:：=]?\s*(\d+)\s*节?/gi, Number],
  outputPowerFactor: [/(?:输出功率因数|UPS\s*功率因数)\s*(?:≥|>=|不低于)?\s*[:：=]?\s*(0?\.\d+|1(?:\.0+)?)/gi, Number],
  inputOutputPhase: [/(单进单出|三进单出|三进三出|单进三出|[13]\s*[:/]\s*[13])/g,
    value => ({ 单进单出: '1:1', 三进单出: '3:1', 三进三出: '3:3', 单进三出: '1:3' })[value] || value.replace(/\s/g, '').replace('/', ':')],
  batteryType: [/(磷酸铁锂|锂电|铅酸)/g, value => value === '铅酸' ? 'lead-acid' : 'lithium'],
  installation: [/(机架式|落地式|塔式)/g, value => value === '机架式' ? '机架式' : '塔式'],
  redundancy: [/(2\s*N|N\s*\+\s*1)/gi, value => /2/i.test(value) ? '2N' : 'N+1'],
  needsSnmp: [/(SNMP)/gi, () => true]
};

export function extractRequirementEvidence(sourceText, sources = [], previous = null) {
  const raw = String(sourceText ?? '');
  const validSources = sources.length ? clone(sources) : [createEvidenceSource('text', '粘贴/手工需求', [{ start: 0, end: raw.length }])];
  const fieldEvidence = {}, values = {};
  for (const [field, [pattern, transform]] of Object.entries(rules)) {
    const candidates = [];
    // 分来源/页提取，避免把两页或两个文件的句子拼成一个条件。
    for (const source of validSources) for (const segment of source.segments) {
      const part = raw.slice(segment.start, segment.end);
      for (const match of part.matchAll(new RegExp(pattern.source, pattern.flags))) {
        const value = scalarValue(field, transform(match[1]));
        if (value == null) continue;
        const start = segment.start + match.index;
        candidates.push({ value, quote: match[0], sourceId: source.id, start, end: start + match[0].length,
          page: segment.page ?? null, line: part.slice(0, match.index).split('\n').length,
          method: source.type === 'image' ? 'ai-ocr-regex' : 'regex' });
      }
    }
    const distinct = [...new Set(candidates.map(item => JSON.stringify(item.value)))].map(item => JSON.parse(item));
    const candidateValue = distinct.length === 1 ? distinct[0] : field === 'needsSnmp' ? false : null;
    values[field] = candidateValue;
    fieldEvidence[field] = { candidateValue, confirmedValue: candidateValue, candidates, conflict: distinct.length > 1, reviewStatus: 'pending' };
  }
  return { ...values, sourceText: raw, confirmedAt: null, evidenceVersion: EVIDENCE_VERSION, evidenceText: raw,
    sources: validSources, fieldEvidence, revisions: clone(previous?.revisions || []) };
}

export function normalizeEvidence(value = {}) {
  if (value.evidenceVersion !== EVIDENCE_VERSION) return {};
  const raw = String(value.evidenceText ?? value.sourceText ?? '');
  const sources = (Array.isArray(value.sources) ? value.sources : []).filter(s => s && typeof s.id === 'string').map(s => ({
    id: s.id, type: ['text', 'pdf', 'docx', 'image', 'manual'].includes(s.type) ? s.type : 'text',
    name: String(s.name || '客户需求').split(/[\\/]/).pop(), importedAt: s.importedAt || null,
    segments: (Array.isArray(s.segments) ? s.segments : []).filter(p => Number.isInteger(p?.start) && Number.isInteger(p?.end) && p.start >= 0 && p.end >= p.start && p.end <= raw.length)
      .map(p => ({ start: p.start, end: p.end, page: Number.isInteger(p.page) && p.page > 0 ? p.page : null }))
  }));
  const fieldEvidence = {};
  for (const field of Object.keys(FIELD_LABELS)) {
    const e = value.fieldEvidence?.[field] || {};
    const candidates = (Array.isArray(e.candidates) ? e.candidates : []).filter(c => c && typeof c.quote === 'string').map(c => {
      const source = sources.find(s => s.id === c.sourceId);
      const segment = source?.segments.find(s => c.start >= s.start && c.end <= s.end);
      const verified = !!segment && Number.isInteger(c.start) && Number.isInteger(c.end) && raw.slice(c.start, c.end) === c.quote && c.end > c.start;
      return { value: scalarValue(field, c.value), quote: c.quote, sourceId: source?.id || null,
        start: verified ? c.start : null, end: verified ? c.end : null,
        page: verified ? segment.page : null,
        line: verified ? raw.slice(segment.start, c.start).split('\n').length : null,
        method: ['regex', 'ai-ocr-regex', 'manual'].includes(c.method) ? c.method : 'manual', verified };
    });
    fieldEvidence[field] = { candidateValue: scalarValue(field, e.candidateValue), confirmedValue: scalarValue(field, value[field]), candidates,
      conflict: new Set(candidates.map(c => JSON.stringify(c.value))).size > 1,
      reviewStatus: String(value.sourceText ?? '') !== raw ? 'stale' : ['confirmed', 'stale'].includes(e.reviewStatus) ? e.reviewStatus : 'pending' };
  }
  const revisions = (Array.isArray(value.revisions) ? value.revisions : []).filter(r => r && Object.hasOwn(FIELD_LABELS, r.field)).map(r => ({
    id: typeof r.id === 'string' ? r.id : uid(), field: r.field, from: scalarValue(r.field, r.from), to: scalarValue(r.field, r.to),
    reason: String(r.reason || ''), at: r.at || null
  }));
  return { evidenceVersion: EVIDENCE_VERSION, evidenceText: raw, sources, fieldEvidence, revisions };
}

export function recordRequirementRevision(requirement, field, from, to, reason = '', at = new Date().toISOString()) {
  if (!Object.hasOwn(FIELD_LABELS, field)) throw new Error('未知技术条件');
  const before = scalarValue(field, from), after = scalarValue(field, to);
  const result = clone(requirement);
  result[field] = after;
  result.confirmedAt = null;
  if (!equal(before, after)) result.revisions.push({ id: uid(), field, from: before, to: after, reason, at });
  if (result.fieldEvidence[field]) {
    result.fieldEvidence[field].confirmedValue = after;
    result.fieldEvidence[field].reviewStatus = result.evidenceText === result.sourceText && requirement.fieldEvidence[field].reviewStatus !== 'stale' ? 'pending' : 'stale';
  }
  return result;
}

export function confirmationProblems(requirement) {
  const problems = [];
  if (requirement.evidenceVersion !== EVIDENCE_VERSION) return ['请重新提取技术条件并核对证据'];
  if (requirement.sourceText !== requirement.evidenceText || Object.values(requirement.fieldEvidence || {}).some(e => e.reviewStatus === 'stale')) {
    problems.push('需求原文或资料来源已修改，请重新提取技术条件');
  }
  if ((requirement.revisions || []).some(r => !String(r.reason || '').trim())) problems.push('请填写每次技术条件修改/补录的原因');
  for (const [field, e] of Object.entries(requirement.fieldEvidence || {})) {
    if (e.conflict && (requirement[field] == null || !requirement.revisions.some(r => r.field === field && equal(r.to, requirement[field]) && String(r.reason || '').trim()))) problems.push(`${FIELD_LABELS[field]}存在冲突，请选择或补录确认值并说明原因`);
    if (e.candidates.some(c => c.verified === false)) problems.push(`${FIELD_LABELS[field]}证据位置无法核对，请重新提取`);
  }
  return [...new Set(problems)];
}

export function confirmRequirementEvidence(requirement, at = new Date().toISOString()) {
  const result = { ...clone(requirement), ...normalizeEvidence(requirement) };
  const problems = confirmationProblems(result);
  if (problems.length) throw new Error(problems.join('；'));
  result.confirmedAt = at;
  for (const e of Object.values(result.fieldEvidence)) e.reviewStatus = 'confirmed';
  return result;
}

export function evidenceExportRows(requirement = {}) {
  const normalized = normalizeEvidence(requirement);
  if (!normalized.evidenceVersion) return { evidence: [['证据状态', '历史记录未保存证据']], revisions: [['修订状态', '历史记录未保存修订过程']] };
  const display = value => value == null ? '未明确' : value === true ? '需要' : value === false ? '未要求' : String(value);
  const evidence = [['技术条件', '提取候选值', '确认值', '来源', '位置', '原文片段', '提取方式', '复核状态']];
  for (const source of normalized.sources.filter(s => s.type === 'pdf')) {
    const emptyPages = source.segments.filter(s => !normalized.evidenceText.slice(s.start, s.end).trim()).map(s => s.page);
    if (emptyPages.length) evidence.push(['文档完整性', '', '', source.name, `PDF第${emptyPages.join('、')}页`, '', '未读取到文字', '请核对扫描页或补录；其他页面的证据不代表整份资料完整']);
  }
  for (const [field, e] of Object.entries(normalized.fieldEvidence)) {
    for (const c of e.candidates.length ? e.candidates : [null]) {
      const source = normalized.sources.find(s => s.id === c?.sourceId);
      const status = e.reviewStatus === 'stale' ? '原文已变更/待重新提取' : e.reviewStatus === 'confirmed' ? '已人工确认' : '待人工确认';
      evidence.push([FIELD_LABELS[field], display(c ? c.value : e.candidateValue), display(requirement[field]), source?.name || '人工补录/无原文证据',
        c?.verified === false ? '位置未验证' : c?.page ? `PDF第${c.page}页，第${c.line}行` : c?.line ? `第${c.line}行` : '—',
        c?.quote || '', c?.method === 'ai-ocr-regex' ? 'AI图片识别后提取' : c ? '本地文字提取' : '人工填写/未提取', `${e.conflict ? '存在冲突；' : ''}${status}`]);
    }
  }
  const revisions = [['技术条件', '修改前', '修改后', '修改原因', '时间']];
  for (const r of normalized.revisions) revisions.push([FIELD_LABELS[r.field], display(r.from), display(r.to), r.reason, r.at || '未记录']);
  if (revisions.length === 1) revisions.push(['无人工修订', '', '', '', '']);
  return { evidence, revisions };
}

export function evidenceSummary(requirement) {
  if (requirement?.evidenceVersion !== EVIDENCE_VERSION) return '历史记录未保存证据';
  const normalized = normalizeEvidence(requirement);
  return `${Object.values(normalized.fieldEvidence).filter(e => e.candidates.length).length}项有原文证据；${normalized.revisions.length}次人工修订`;
}
