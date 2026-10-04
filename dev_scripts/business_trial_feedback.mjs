// Development-only protection for private, human-owned trial feedback.
import assert from 'node:assert/strict';
const topics = ['原文及区域归属','数量口径','接口/保护/附件/供货边界','型号及核对依据','方案清单一致性','操作体验'];
export function emptyTrialFeedback(schemes) {
  return { businessAcceptance:'pending', items:schemes.flatMap(scheme => topics.map(topic => ({
    equipmentId:scheme.equipmentId,schemeId:scheme.id,topic,objectId:'',observed:'',expected:'',evidence:'',owner:'',status:'待业务复核'
  }))) };
}
export function assertEmptyTrialFeedback(existing, schemes) {
  assert.deepEqual(existing,emptyTrialFeedback(schemes),'已有业务反馈或模板变化，拒绝重建试用目录；请保留原反馈并使用新批次');
}
