// AI 整理参数 → 人工复核条款。人工复核要求证据落在同一段落/表格单元/页内且值原样出现在证据中：
// 证据收窄到参数值所在的那一段，值取原文中的原样写法（AI 值可能空白不同）。值本身跨段的不硬塞，列为未加入并说明原因。
import { SPEC_TYPE_TO_CATEGORY } from './nonstandard-presales.js';

const compact = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '');

// 在证据原文中定位参数值，返回原文中的绝对位置；先按原样查找，再按去空白/全半角统一后查找。
function locateValue(source, evidence, value) {
  const quote = source.text.slice(evidence.start, evidence.end), raw = String(value ?? '').trim();
  if (!raw) return null;
  const direct = quote.indexOf(raw);
  if (direct >= 0) return { start: evidence.start + direct, end: evidence.start + direct + raw.length };
  let joined = ''; const map = [];
  for (let i = 0; i < quote.length; i++) for (const unit of compact(quote[i])) { joined += unit; map.push(i); }
  const target = compact(raw), at = joined.indexOf(target);
  if (!target || at < 0) return null;
  return { start: evidence.start + map[at], end: evidence.start + map[at + target.length - 1] + 1 };
}

export function specCategoryFor(product) { return SPEC_TYPE_TO_CATEGORY[product?.device_type] || null; }

export function specAdoptionItems(source, product) {
  const items = [], skipped = [];
  for (const detail of product.params_detail || []) {
    if (detail.evidence_status === 'NOT_STATED') continue;
    const ev = detail.evidence;
    if (!ev || source.text.slice(ev.start, ev.end) !== ev.quote) { skipped.push({ name: detail.name, reason: '原文证据与当前资料不一致' }); continue; }
    const at = locateValue(source, ev, detail.value);
    if (!at) { skipped.push({ name: detail.name, reason: '参数值未原样出现在证据中（如跨页省略了页眉）' }); continue; }
    const segment = (source.segments || []).find(s => at.start >= s.start && at.end <= s.end);
    if (!segment) { skipped.push({ name: detail.name, reason: '参数值跨越多个段落或页面' }); continue; }
    const start = Math.max(ev.start, segment.start), end = Math.min(ev.end, segment.end);
    // 同一句原文常被提成多个参数（分段重叠重复提取，或同句拆成"安装场所/使用环境"等不同名称）；
    // 收窄到同一段后就是同一条条款，合并为一条，值取覆盖各参数值的原文范围。
    const same = items.find(item => item.evidence.start === start && item.evidence.end === end);
    if (same) {
      same.valueStart = Math.min(same.valueStart, at.start); same.valueEnd = Math.max(same.valueEnd, at.end);
      same.value = source.text.slice(same.valueStart, same.valueEnd);
      if (!same.names.includes(detail.name)) same.names.push(detail.name);
      same.forbiddenDeviation ||= detail.forbiddenDeviation === true;
      continue;
    }
    items.push({ names: [detail.name], valueStart: at.start, valueEnd: at.end, value: source.text.slice(at.start, at.end),
      evidence: { sourceId: source.id, start, end, quote: source.text.slice(start, end) }, forbiddenDeviation: detail.forbiddenDeviation === true });
  }
  return { items: items.map(({ names, valueStart, valueEnd, ...item }) => ({ name: names.join(' / '), ...item })), skipped };
}

export const specAdoptionKey = (result, product) => `${result.sourceId}|${product.device_id}|${result.createdAt}`;
