import { PRODUCT_PROFILES, addRequirement, retireStaleSourceRequirements } from './nonstandard-presales.js';

const labels = {
  voltageV: ['额定电压', '额定工作电压'], frequencyHz: ['频率', '额定频率'], ratedCurrentA: ['额定电流'],
  widthMm: ['宽度'], heightMm: ['高度'], depthMm: ['深度'], busbarCurrentA: ['主母线电流'],
  neutralRatioPct: ['N线比例'], shortCircuitKa: ['短路耐受电流'], shortCircuitDurationS: ['短路耐受时间'],
  buswayLengthM: ['母线长度'], terminalCurrentA: ['始端箱额定电流'], plugBoxCurrentA: ['插接箱额定电流'],
  incomingCount: ['进线数量', '进线回路数', '进线回路数量'], tieCount: ['母联数量', '母联回路数', '母联回路数量'],
  outgoingCount: ['出线数量', '出线回路数', '出线回路数量'], spareCount: ['备用数量', '备用回路数']
};
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function parsePresalesClause(category, quote) {
  const profile = PRODUCT_PROFILES[category];
  if (profile && !/[≥≤<>]|不低于|不高于|不少于|至少|包括|范围|最大|最小|\d\s*[～~]\s*\d/.test(quote)) {
    for (const [key, definition] of Object.entries(profile.fields)) {
      if (!['positive', 'count'].includes(definition.type)) continue;
      const aliases = labels[key] || [definition.label];
      const unit = definition.unit ? escapePattern(definition.unit) : '(?:个|台|路|套|柜)?';
      const pattern = new RegExp(`^(?:${aliases.map(escapePattern).join('|')})\\s*[:：=为]\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*[。；;]?\\s*$`, 'i');
      const match = String(quote).trim().match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (definition.type === 'count' ? Number.isInteger(value) && value >= 0 : value > 0) return { field: key, value };
      }
    }
  }
  // 复核草稿保留全文；未知数值及外部图纸引用不伪装为明确参数。
  return { field: 'clause', value: /XX+|待确认|待选型|按图|见图纸|另见附件|公式（未求值）/i.test(quote) ? null : String(quote).trim() };
}
export function presalesClauseBlocks(source) {
  const blocks = [];
  for (const segment of source.segments) {
    if (source.type === 'xlsx' && segment.role === 'context') continue;
    const part = source.text.slice(segment.start, segment.end);
    for (const match of part.matchAll(/[^\r\n]+/g)) {
      const quote = match[0].trim(); if (!quote) continue;
      const start = segment.start + match.index + match[0].indexOf(quote);
      blocks.push({ quote, sourceId: source.id, start, end: start + quote.length, segment });
    }
  }
  return blocks;
}
// Only omit recognisable document furniture. Unrecognised prose, technical titles,
// and repeated technical clauses stay available for human review with their locations.
function documentTextReason(quote) {
  const text = quote.trim();
  if (/^(?:[A-Z][A-Z\s&.-]*\s+)?CONFIDENTIAL(?:\s+DOCUMENTS?)?[.!。]?$/i.test(text)) return '保密页眉';
  if (/^(?:本文件|本文档|本资料|本技术文件).*(?:保密|未经.*许可).*(?:复制|传播|披露|使用)/.test(text)) return '保密声明';
  if (/^(?:日期\s*[:：]?\s*)?(?:\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2})[。.]?$/.test(text)) return '独立日期';
  if (/^(?:第\s*\d+\s*页(?:\s*[\/／，,]\s*共\s*\d+\s*页)?|\d+\s*[\/／]\s*\d+|目\s*录)$/.test(text)) return '页码或目录标题';
  if (/^(?:技术规格书|技术规范书|技术规范|技术要求|设备技术规格书)$/.test(text)) return '文档标题';
  return '';
}
export function previewPresalesExtraction(source) {
  const blocks = [], documentText = [];
  for (const block of presalesClauseBlocks(source)) {
    // A spreadsheet value may be a date or text required by its row heading.
    const reason = source.type === 'xlsx' ? '' : documentTextReason(block.quote);
    if (reason) documentText.push({ ...block, reason }); else blocks.push(block);
  }
  const scopeWarning = /\bUPS\b|不间断电源/i.test(`${source.name}\n${source.text}`)
    ? '资料包含 UPS 内容。本页的配置方案仅支持配电柜、PDU、智能母线；UPS 条款请在“智能选型”中核对，勿直接作为配电设备参数。' : '';
  return { blocks, documentText, scopeWarning };
}
export function extractPresalesSource(input, sourceId, { includeDocumentText = false } = {}) {
  const source = input.sources.find(s => s.id === sourceId); if (!source) throw new Error('来源不存在');
  const preview = previewPresalesExtraction(source);
  const blocks = includeDocumentText ? presalesClauseBlocks(source) : preview.blocks;
  if (!blocks.length) throw new Error(preview.documentText.length ? '仅识别到文档标题、日期或保密文字；请核对原文，或勾选包含文档辅助文字后提取' : '没有可提取文字');
  if (blocks.length > 1500) throw new Error('条款过多，请按设备拆分资料后导入');
  let pack = retireStaleSourceRequirements(input, sourceId);
  for (const block of blocks) {
    if (pack.requirements.some(r => r.reviewStatus !== 'stale' && r.candidates.some(c => c.evidence.sourceId === sourceId && c.evidence.start === block.start && c.evidence.end === block.end && c.evidence.quote === block.quote))) continue;
    const parsed = parsePresalesClause(null, block.quote);
    pack = addRequirement(pack, { equipmentId: null, field: 'clause', forbiddenDeviation: block.segment.forbiddenDeviation ?? null,
      candidates: [{ value: parsed.value, evidence: { sourceId, quote: block.quote, start: block.start, end: block.end } }] }, '规则提取工作稿，设备归属待人工确认');
  }
  return pack;
}
export function presalesEvidenceLocation(pack, evidence) {
  const source = pack.sources.find(s => s.id === evidence.sourceId);
  const segment = source?.segments.find(s => evidence.start >= s.start && evidence.end <= s.end);
  if (!source || !segment || source.text.slice(evidence.start, evidence.end) !== evidence.quote) return '证据已失效';
  const position = segment.sheet ? `${segment.sheet}!${segment.cell}` : segment.page ? `PDF第${segment.page}页`
    : segment.table ? `解析表格${segment.table}` : segment.paragraph ? `解析段落${segment.paragraph}`
    : `第${source.text.slice(0, evidence.start).split('\n').length}行`;
  return `${source.name} · ${position}${segment.method === 'ocr' ? ' · OCR文字，须对照原图' : ''}`;
}
