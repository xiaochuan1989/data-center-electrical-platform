import assert from 'node:assert/strict';
import { emptyTrialFeedback, assertEmptyTrialFeedback } from './business_trial_feedback.mjs';
const schemes = Array.from({length:4},(_,i)=>({id:`s${i}`,equipmentId:`e${i}`}));
const template = emptyTrialFeedback(schemes), before=JSON.stringify(template);
assert.equal(template.items.length,24);assertEmptyTrialFeedback(structuredClone(template),schemes);
for(const field of ['objectId','observed','expected','evidence','owner','topic','equipmentId','schemeId','status']) {
  const changed=structuredClone(template);changed.items[0][field]='人工输入';
  assert.throws(()=>assertEmptyTrialFeedback(changed,schemes),/已有业务反馈/);
}
for(const alter of [v=>{v.notes='补充反馈';},v=>{v.businessAcceptance='reviewed';},v=>{v.items.reverse();},v=>{v.items.pop();},v=>{v.items[0].notes='附加意见';}]) {
  const changed=structuredClone(template);alter(changed);assert.throws(()=>assertEmptyTrialFeedback(changed,schemes),/已有业务反馈/);
}
assert.equal(JSON.stringify(template),before);
console.log('PASS: 空白24项反馈可复用；填写值、身份/主题/状态、新增意见或结构改变均阻断，原模板不突变');
