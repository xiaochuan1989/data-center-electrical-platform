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
export function extractPresalesSource(input, sourceId) {
  const source = input.sources.find(s => s.id === sourceId); if (!source) throw new Error('来源不存在');
  const blocks = presalesClauseBlocks(source); if (!blocks.length) throw new Error('没有可提取文字');
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
  return `${source.name} · ${position}`;
}
