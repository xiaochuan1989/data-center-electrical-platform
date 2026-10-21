// 人工合并设备：同一设备在封面/章节/配置表中的不同叫法可能被识别为多台。程序无法可靠区分"同一设备的别名"
// 与"同类不同设备"，所以合并只由人决定。合并只改变参数挂在哪台设备下，不改参数内容：语义复核意见按确定规则
// 改到新的参数标识并重算参数指纹，同时留下合并记录，界面与导出均可见。
import { semanticParameterIndex, semanticResultFingerprint } from './spec-semantic-review.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const norm = value => String(value).normalize('NFKC').toLowerCase().replace(/\s/g, '');
const exactValue = value => String(value).normalize('NFKC').replace(/\s/g, '');
const paramKey = d => JSON.stringify([norm(d.name), exactValue(d.value), d.evidence?.start ?? null, d.evidence?.end ?? null]);

export function mergeableDevices(result, deviceId) {
  const device = result?.products?.find(p => p.device_id === deviceId);
  return device ? result.products.filter(p => p.device_id !== deviceId && p.device_type === device.device_type) : [];
}

export async function mergeSpecDevices(result, fromId, intoId, { now = () => new Date().toISOString() } = {}) {
  assert(fromId !== intoId, '不能把设备合并到它自己');
  const from = result?.products?.find(p => p.device_id === fromId), into = result?.products?.find(p => p.device_id === intoId);
  assert(from && into, '要合并的设备不存在');
  assert(from.device_type === into.device_type, '只能合并同一设备类型的设备');
  const next = structuredClone(result);
  const target = next.products.find(p => p.device_id === intoId), source = next.products.find(p => p.device_id === fromId);
  const oldIds = new Map(semanticParameterIndex(result.products).map(p => [p.detail, p.parameter_id]));
  // 旧参数标识 → 新参数标识：目标设备原有参数位置不变；并入的参数排在其后，与已有参数完全相同的只保留一份。
  const idMap = new Map();
  const fromOriginal = result.products.find(p => p.device_id === fromId);
  source.params_detail.forEach((detail, index) => {
    const existing = target.params_detail.findIndex(d => paramKey(d) === paramKey(detail));
    let position = existing;
    if (existing < 0) { target.params_detail.push(detail); position = target.params_detail.length - 1; }
    idMap.set(oldIds.get(fromOriginal.params_detail[index]), `${intoId}/p${position + 1}`);
  });
  for (const detail of target.params_detail) detail.multipleValues = target.params_detail.some(other => other.evidence_status === 'VERIFIED'
    && norm(other.name) === norm(detail.name) && exactValue(other.value) !== exactValue(detail.value));
  const mergedAt = now();
  target.mergedFrom = [...(target.mergedFrom || []),
    { device_id: source.device_id, device_type: source.device_type, device_name: source.device_name, scope: source.scope || '', evidence: source.evidence, mergedAt },
    ...(source.mergedFrom || [])];
  next.products = next.products.filter(p => p.device_id !== fromId);
  next.deviceMerges = [...(result.deviceMerges || []), { from: { device_id: fromId, device_name: from.device_name }, into: { device_id: intoId, device_name: into.device_name },
    movedParameters: source.params_detail.length, mergedAt }];
  if (Array.isArray(next.rejectedParameters)) for (const item of next.rejectedParameters) if (item.device_id === fromId) item.device_id = intoId;
  const review = next.semanticReview;
  if (review) {
    const remap = id => (id && idMap.has(id) ? idMap.get(id) : id);
    review.checkedParameterIds = [...new Set(review.checkedParameterIds.map(remap))].sort();
    // 合并去重后同一参数可能同时出现在已复核与未复核中：以已复核为准。
    if (Array.isArray(review.uncheckedParameterIds)) {
      const checked = new Set(review.checkedParameterIds);
      review.uncheckedParameterIds = [...new Set(review.uncheckedParameterIds.map(remap))].filter(id => !checked.has(id)).sort();
      if (!review.uncheckedParameterIds.length) delete review.uncheckedParameterIds;
    }
    const seen = new Set();
    review.findings = review.findings.map(f => ({ ...f, parameter_id: remap(f.parameter_id) })).filter(f => {
      const key = JSON.stringify([f.kind, f.parameter_id, f.evidence.start, f.evidence.end]);
      if (seen.has(key)) return false; seen.add(key); return true;
    });
    if (Array.isArray(review.rejectedFindings)) review.rejectedFindings = review.rejectedFindings.map(r => ({ ...r, parameter_id: remap(r.parameter_id) }));
    review.status = review.findings.length ? 'ISSUES_FOUND' : 'MODEL_REVIEWED';
    review.resultFingerprint = await semanticResultFingerprint(next.products);
  }
  return next;
}
